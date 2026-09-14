import type { Dashboard } from '@wecom/shared';
import type { Q } from '../documents/repo.js';
import { iso } from '../documents/repo.js';

const int = (v: unknown): number => Number(v ?? 0);

/**
 * Every number on the dashboards is a SQL aggregate over the live tables — coverage and
 * freshness from `documents`, usage from `recent_views` + `telemetry_events`, pipeline from
 * `suggestions` and sync from `sync_links`. Nothing here is estimated or cached in a table.
 */
export async function computeDashboard(q: Q): Promise<Dashboard> {
  const [
    coverage,
    coverageByCategory,
    freshness,
    freshnessByCategory,
    views,
    top,
    telemetry,
    pipeline,
    bySource,
    sync,
  ] = await Promise.all([
    q.query(
      `select count(*)::int cards,
                count(*) filter (where status in ('published','partial'))::int with_document,
                count(*) filter (where status = 'partial')::int partial,
                count(*) filter (where status = 'draft')::int drafts
           from documents where deleted_at is null`,
    ),
    q.query(
      `select category, count(*)::int cards,
                count(*) filter (where status in ('published','partial'))::int with_document
           from documents where deleted_at is null group by category order by category`,
    ),
    q.query(
      `select count(*) filter (where updated_at > now() - interval '30 days')::int updated_30,
                count(*) filter (where updated_at < now() - interval '180 days')::int stale_180
           from documents where deleted_at is null`,
    ),
    q.query(
      `select category, max(updated_at) last_updated,
                coalesce(percentile_cont(0.5) within group
                  (order by extract(epoch from (now() - updated_at)) / 86400), 0) median_days
           from documents where deleted_at is null group by category order by category`,
    ),
    q.query(
      `select coalesce(sum(count) filter (where viewed_at > now() - interval '7 days'), 0)::int views_7,
                coalesce(sum(count) filter (where viewed_at > now() - interval '30 days'), 0)::int views_30
           from recent_views`,
    ),
    q.query(
      `select d.id, d.title, sum(v.count)::int views
           from recent_views v join documents d on d.id = v.document_id and d.deleted_at is null
          group by d.id, d.title order by views desc, d.title limit 5`,
    ),
    q.query(
      `select count(*) filter (where kind = 'outcome' and at > now() - interval '7 days')::int outcomes,
                count(*) filter (where kind = 'call_completed' and at > now() - interval '7 days')::int calls
           from telemetry_events`,
    ),
    q.query(
      `select count(*) filter (where status = 'pending')::int pending,
                count(*) filter (where status = 'accepted')::int accepted,
                count(*) filter (where status = 'rejected')::int rejected,
                count(*) filter (where status = 'applied')::int applied
           from suggestions`,
    ),
    q.query(
      `select s.id, s.title,
                count(*) filter (where g.status = 'pending')::int pending,
                count(*) filter (where g.status = 'applied')::int applied
           from suggestions g
           join source_revisions sr on sr.id = g.source_revision_id
           join sources s on s.id = sr.source_id and s.deleted_at is null
          group by s.id, s.title order by pending desc, s.title limit 10`,
    ),
    q.query(
      `select count(*)::int links,
                count(*) filter (where state = 'synced')::int synced,
                count(*) filter (where state = 'pending_import')::int pending_import,
                count(*) filter (where state = 'pending_push')::int pending_push,
                count(*) filter (where state = 'conflict')::int conflicts,
                max(last_synced_at) last_run
           from sync_links`,
    ),
  ]);

  const c = coverage.rows[0];
  const f = freshness.rows[0];
  const v = views.rows[0];
  const t = telemetry.rows[0];
  const p = pipeline.rows[0];
  const s = sync.rows[0];
  return {
    generatedAt: new Date().toISOString(),
    coverage: {
      cards: int(c.cards),
      withDocument: int(c.with_document),
      partial: int(c.partial),
      drafts: int(c.drafts),
      byCategory: coverageByCategory.rows.map((r) => ({
        category: r.category as Dashboard['coverage']['byCategory'][number]['category'],
        cards: int(r.cards),
        withDocument: int(r.with_document),
      })),
    },
    freshness: {
      updatedLast30d: int(f.updated_30),
      staleOver180d: int(f.stale_180),
      byCategory: freshnessByCategory.rows.map((r) => ({
        category: r.category as Dashboard['freshness']['byCategory'][number]['category'],
        lastUpdatedAt: iso(r.last_updated as Date | null),
        median_days: Math.round(Number(r.median_days ?? 0) * 10) / 10,
      })),
    },
    usage: {
      views7d: int(v.views_7),
      views30d: int(v.views_30),
      topDocuments: top.rows.map((r) => ({
        documentId: r.id as string,
        title: r.title as string,
        views: int(r.views),
      })),
      outcomesPicked7d: int(t.outcomes),
      callsCompleted7d: int(t.calls),
    },
    pipeline: {
      pending: int(p.pending),
      accepted: int(p.accepted),
      rejected: int(p.rejected),
      applied: int(p.applied),
      bySource: bySource.rows.map((r) => ({
        sourceId: r.id as string,
        title: r.title as string,
        pending: int(r.pending),
        applied: int(r.applied),
      })),
    },
    sync: {
      links: int(s.links),
      synced: int(s.synced),
      pendingImport: int(s.pending_import),
      pendingPush: int(s.pending_push),
      conflicts: int(s.conflicts),
      lastRunAt: iso(s.last_run as Date | null),
    },
  };
}

export interface TelemetryRow {
  kind: string;
  documentId?: string;
  stepKey?: string;
  at?: string;
}

/**
 * Telemetry arrives in batches from a client that may hold a card id the KB has since
 * deleted, so a row whose document is gone is dropped rather than failing the batch.
 */
export async function recordTelemetry(q: Q, userId: string, events: TelemetryRow[]): Promise<number> {
  let written = 0;
  for (const e of events) {
    const r = await q.query(
      `insert into telemetry_events(user_id, kind, document_id, step_key, at)
       select $1, $2, $3::uuid, $4, coalesce($5::timestamptz, now())
        where $3::uuid is null or exists (select 1 from documents where id = $3::uuid)`,
      [userId, e.kind, e.documentId ?? null, e.stepKey ?? null, e.at ?? null],
    );
    written += r.rowCount ?? 0;
  }
  return written;
}
