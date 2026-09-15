import type { SuggestionAnalytics, SuggestionAnalyticsQuery } from '@wecom/shared';
import type { Queryable } from '../../lib/sql.js';
import { hasColumn } from '../feedback/repo.js';
import { TtlCache } from '../usage/cache.js';

/**
 * Acceptance analytics for the suggestion pipeline (spec §1.9) — the numbers that say whether the
 * briefing is working, broken down by type, source, model and prompt version.
 *
 * The definitions are the contract for X4a's analytics tab, and they are here rather than in the
 * UI so every consumer counts the same thing:
 *
 * - **decided** = `accepted | rejected | applied`; **accepted** = `accepted | applied`.
 * - **edited** = accepted *and* the editor changed it — `edit_diff` has at least one row, or a
 *   partial accept recorded `applied_parts`. Derived server-side, never claimed by the client.
 * - `rates.*` are shares of the decided rows (all `0` when nothing has been decided).
 * - `meanMinutesToDecision` averages `decided_at - created_at`; `null` when nothing is decided.
 * - Remainder suggestions (`parent_id` set) count as suggestions in their own right — they are
 *   decisions the editor still owes — so `total` includes them.
 *
 * `model` and `prompt_version` are X1's 0051 columns. Until that migration lands both bucket
 * under `'—'`, so this lane is green on a database that has only 0053.
 */
const cache = new TtlCache<SuggestionAnalytics>(60_000);

/** Tests that mutate suggestions between two reads clear the 60 s window. */
export const resetSuggestionAnalyticsCache = (): void => cache.clear();

const UNKNOWN = '—';

const EDITED = `(g.status in ('accepted','applied')
  and (jsonb_array_length(coalesce(g.edit_diff->'rows','[]'::jsonb)) > 0 or g.applied_parts is not null))`;

type BucketRow = {
  key: string;
  total: number;
  accepted: number;
  edited: number;
  rejected: number;
  pending: number;
};

export async function suggestionAnalytics(
  q: Queryable,
  query: SuggestionAnalyticsQuery,
): Promise<SuggestionAnalytics> {
  const key = JSON.stringify([query.from ?? null, query.to ?? null, query.sourceId ?? null, query.type ?? null]);
  const hit = cache.get(key);
  if (hit) return hit;

  const [hasModel, hasPrompt] = await Promise.all([
    hasColumn(q, 'suggestions', 'model'),
    hasColumn(q, 'suggestions', 'prompt_version'),
  ]);
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const where: string[] = ['true'];
  if (query.from) where.push(`g.created_at >= ${p(query.from)}`);
  if (query.to) where.push(`g.created_at < ${p(query.to)}`);
  if (query.sourceId) where.push(`sr.source_id = ${p(query.sourceId)}`);
  if (query.type) where.push(`g.type = ${p(query.type)}`);
  const base = `from suggestions g
    join source_revisions sr on sr.id = g.source_revision_id
    join sources s on s.id = sr.source_id
   where ${where.join(' and ')}`;
  const agg = `count(*)::int total,
    count(*) filter (where g.status in ('accepted','applied'))::int accepted,
    count(*) filter (where ${EDITED})::int edited,
    count(*) filter (where g.status='rejected')::int rejected,
    count(*) filter (where g.status='pending')::int pending`;
  const modelExpr = hasModel ? `coalesce(g.model, '${UNKNOWN}')` : `'${UNKNOWN}'`;
  const promptExpr = hasPrompt ? `coalesce(g.prompt_version, '${UNKNOWN}')` : `'${UNKNOWN}'`;

  const [totals, byType, bySource, byModel, byPrompt] = await Promise.all([
    q.query(
      `select ${agg},
              avg(extract(epoch from (g.decided_at - g.created_at))/60)
                filter (where g.decided_at is not null) mean_min
         ${base}`,
      params,
    ),
    q.query<BucketRow>(`select g.type key, ${agg} ${base} group by g.type order by total desc, key`, params),
    q.query<BucketRow>(
      `select s.id::text key, ${agg} ${base} group by s.id order by total desc, key limit 50`,
      params,
    ),
    q.query<BucketRow>(`select ${modelExpr} key, ${agg} ${base} group by 1 order by total desc, key`, params),
    q.query<BucketRow>(
      `select ${promptExpr} key, ${agg} ${base} group by 1 order by total desc, key`,
      params,
    ),
  ]);

  const t = totals.rows[0] as {
    total: number;
    accepted: number;
    edited: number;
    rejected: number;
    mean_min: string | null;
  };
  const decided = t.accepted + t.rejected;
  const rate = (n: number) => (decided ? n / decided : 0);
  const bucket = (r: BucketRow) => ({
    key: r.key,
    total: r.total,
    accepted: r.accepted,
    edited: r.edited,
    rejected: r.rejected,
    pending: r.pending,
  });
  const out: SuggestionAnalytics = {
    total: t.total,
    byType: byType.rows.map(bucket),
    bySource: bySource.rows.map(bucket),
    byModel: byModel.rows.map(bucket),
    byPromptVersion: byPrompt.rows.map(bucket),
    rates: { accepted: rate(t.accepted), edited: rate(t.edited), rejected: rate(t.rejected) },
    meanMinutesToDecision: t.mean_min === null ? null : Math.max(0, Number(t.mean_min)),
  };
  cache.set(key, out);
  return out;
}
