import type { Gap, GapKind, GapsQuery } from '@wecom/shared';
import type { Queryable, Tx } from '../../lib/sql.js';

type Q = Queryable;
export type { GapsQuery };

export interface GapCandidate {
  kind: GapKind;
  key: string;
  title: string;
  evidence: Record<string, unknown>;
  score: number;
  suggestedAction: 'create' | 'update' | 'add_question' | 'review';
  documentId: string | null;
  topicId: string | null;
  worldSlug: string | null;
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

const toGap = (r: Record<string, unknown>): Gap => ({
  id: r.id as string,
  kind: r.kind as Gap['kind'],
  key: r.key as string,
  title: r.title as string,
  score: Number(r.score),
  status: r.status as Gap['status'],
  evidence: (r.evidence as Record<string, unknown>) ?? {},
  suggestedAction: r.suggested_action as Gap['suggestedAction'],
  documentId: (r.document_id as string | null) ?? null,
  topicId: (r.topic_id as string | null) ?? null,
  worldSlug: (r.world_slug as string | null) ?? null,
  firstSeenAt: iso(r.first_seen_at as Date)!,
  lastSeenAt: iso(r.last_seen_at as Date)!,
  dismissedReason: (r.dismissed_reason as string | null) ?? null,
  resolvedDocumentId: (r.resolved_document_id as string | null) ?? null,
});

/**
 * Idempotent: the `(kind, key)` pair is the identity, so the nightly run lands on the row the
 * operator already saw. A repeat sighting refreshes evidence, score and `last_seen_at` but never
 * touches `status` — a dismissed gap stays dismissed and a resolved one stays resolved, which is
 * the whole reason "dismiss" is worth offering at all.
 */
export async function upsertCandidates(
  tx: Tx,
  cands: GapCandidate[],
): Promise<{ detected: number; updated: number; newIds: string[] }> {
  let detected = 0;
  let updated = 0;
  const newIds: string[] = [];
  for (const c of cands) {
    const r = await tx.query<{ id: string; inserted: boolean }>(
      `insert into knowledge_gaps(kind, key, title, evidence, score, suggested_action, document_id, topic_id, world_slug)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       on conflict (kind, key) do update
         set title = excluded.title, evidence = excluded.evidence, score = excluded.score,
             suggested_action = excluded.suggested_action, document_id = excluded.document_id,
             topic_id = excluded.topic_id, world_slug = excluded.world_slug, last_seen_at = now()
       returning id, (xmax = 0) as inserted`,
      [
        c.kind,
        c.key,
        c.title,
        JSON.stringify(c.evidence),
        c.score,
        c.suggestedAction,
        c.documentId,
        c.topicId,
        c.worldSlug,
      ],
    );
    if (r.rows[0].inserted) {
      detected++;
      newIds.push(r.rows[0].id);
    } else updated++;
  }
  return { detected, updated, newIds };
}

const SELECT = 'select g.* from knowledge_gaps g';

export async function listGaps(
  q: Q,
  query: GapsQuery,
  worldScopes: readonly string[] | null,
): Promise<{ items: Gap[]; total: number }> {
  const params: unknown[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const where = [`g.status = ${p(query.status)}`];
  if (query.kind) where.push(`g.kind = ${p(query.kind)}`);
  if (query.world) where.push(`g.world_slug = ${p(query.world)}`);
  // A world-scoped editor sees gaps in their worlds plus the world-less ones: a zero-result
  // search carries no world, and hiding those from everyone but an unrestricted admin would
  // hide the single most actionable kind from the people who write the answers.
  if (worldScopes) where.push(`(g.world_slug is null or g.world_slug = any(${p([...worldScopes])}::text[]))`);
  const w = 'where ' + where.join(' and ');
  const total = await q.query<{ n: string }>(`select count(*) n from knowledge_gaps g ${w}`, params);
  const rows = await q.query(
    `${SELECT} ${w} order by g.score desc, g.last_seen_at desc limit ${p(query.pageSize)} offset ${p(
      (query.page - 1) * query.pageSize,
    )}`,
    params,
  );
  return { items: rows.rows.map(toGap), total: Number(total.rows[0].n) };
}

export async function getGap(q: Q, id: string): Promise<Gap | null> {
  const r = await q.query(`${SELECT} where g.id=$1`, [id]);
  return r.rowCount ? toGap(r.rows[0]) : null;
}

export async function dismissGap(tx: Tx, id: string, reason: string, userId: string): Promise<Gap | null> {
  const r = await tx.query(
    `update knowledge_gaps set status='dismissed', dismissed_by=$2, dismissed_reason=$3, dismissed_at=now()
     where id=$1 and status='open' returning *`,
    [id, userId, reason],
  );
  return r.rowCount ? toGap(r.rows[0]) : null;
}

/**
 * Links a gap to the document that answers it. If that document is already published the gap
 * resolves now; otherwise it resolves on that document's next publish (`autoResolvePublished`).
 */
export async function resolveGap(tx: Tx, id: string, documentId: string): Promise<Gap | null> {
  const r = await tx.query(
    `update knowledge_gaps g set resolved_document_id=$2,
        status = case when exists (
            select 1 from documents d
             where d.id=$2 and d.status in ('published','partial') and d.deleted_at is null
          ) then 'resolved' else g.status end,
        resolved_at = case when exists (
            select 1 from documents d
             where d.id=$2 and d.status in ('published','partial') and d.deleted_at is null
          ) then now() else g.resolved_at end
     where g.id=$1 and g.status <> 'resolved' returning *`,
    [id, documentId],
  );
  return r.rowCount ? toGap(r.rows[0]) : null;
}

/**
 * Closes the loop without an operator: a gap linked to a document (explicitly via resolve, or
 * implicitly by kind on `document_id`) is resolved once that document has a published version
 * newer than the gap's last sighting.
 */
export async function autoResolvePublished(q: Q): Promise<number> {
  const r = await q.query(
    `update knowledge_gaps g set status='resolved', resolved_at=now()
     where g.status='open'
       and coalesce(g.resolved_document_id, g.document_id) is not null
       and exists (
         select 1 from document_versions v
         where v.document_id = coalesce(g.resolved_document_id, g.document_id)
           and v.kind = 'published' and v.created_at > g.last_seen_at
       )`,
  );
  return r.rowCount ?? 0;
}

export async function lastRunAt(q: Q): Promise<string | null> {
  const r = await q.query<{ finished_at: Date | null }>(
    'select finished_at from gap_runs where finished_at is not null order by finished_at desc limit 1',
  );
  return r.rowCount ? iso(r.rows[0].finished_at) : null;
}

export async function recordRun(
  q: Q,
  r: { detected: number; updated: number; resolved: number; error?: string },
  startedAt: Date,
): Promise<void> {
  await q.query(
    'insert into gap_runs(started_at, finished_at, detected, updated, resolved, error) values ($1, now(), $2, $3, $4, $5)',
    [startedAt, r.detected, r.updated, r.resolved, r.error ?? null],
  );
}
