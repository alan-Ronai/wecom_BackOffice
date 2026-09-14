import type pg from 'pg';
import type { UsageAnalytics } from '@wecom/shared';
import type { z } from 'zod';
import type { SearchLogQuerySchema, UsageAnalyticsQuerySchema } from '@wecom/shared';
import { visibleStatusSql } from '../../lib/visibility.js';

type Q = pg.Pool | pg.PoolClient;
export type UsageQuery = z.infer<typeof UsageAnalyticsQuerySchema>;
export type SearchLogQuery = z.infer<typeof SearchLogQuerySchema>;

/** Columns/tables owned by other wave 4 lanes; probed per request so the answers get richer as lanes merge. */
export interface Caps {
  docType: boolean; // documents.doc_type (W1)
  owner: boolean; // documents.owner_id (W2)
  publishedAt: boolean; // documents.published_at (W2)
  topics: boolean; // topics + worlds tables (W1)
}

export async function probeCapabilities(q: Q): Promise<Caps> {
  const cols = await q.query<{ column_name: string }>(
    `select column_name from information_schema.columns
     where table_schema='public' and table_name='documents' and column_name in ('doc_type','owner_id','published_at')`,
  );
  const have = new Set(cols.rows.map((r) => r.column_name));
  const t = await q.query<{ topics: string | null; worlds: string | null }>(
    `select to_regclass('public.topics')::text topics, to_regclass('public.worlds')::text worlds`,
  );
  return {
    docType: have.has('doc_type'),
    owner: have.has('owner_id'),
    publishedAt: have.has('published_at'),
    topics: !!t.rows[0].topics && !!t.rows[0].worlds,
  };
}

const DAY = 86400_000;
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

/** Resolves the window: default last 30 days, `to` defaults to now. */
export const window = (query: UsageQuery): { from: Date; to: Date } => {
  const to = query.to ? new Date(query.to) : new Date();
  const from = query.from ? new Date(query.from) : new Date(to.getTime() - 30 * DAY);
  return { from, to };
};

/**
 * B-I8 / B-M7: §2.5 grants `analytics.read` to lead, admin **and editor**, and editors are the
 * role that carries `world_scope`. Unscoped, a single-world editor read every world's item
 * titles, the org-wide viewer leaderboard and the org-wide staleness table. `worldScopes` is
 * the caller's grant (null = every world) and is applied on top of the `?world=` filter.
 *
 * Both terms now intersect `document_worlds` rather than comparing `documents.category`: the
 * contract said W5 would use the primary world "until W6 widens to `document_worlds`", and
 * this is W6.
 */
export async function usageAnalytics(
  q: Q,
  query: UsageQuery,
  caps: Caps,
  worldScopes: readonly string[] | null = null,
): Promise<UsageAnalytics> {
  const { from, to } = window(query);
  const limit = query.limit;
  const worldTerm = (alias: string, params: unknown[]) => {
    let sql = '';
    const member = (v: unknown) => {
      params.push(v);
      return ` and exists (select 1 from document_worlds dw where dw.document_id=${alias}.id and dw.world_slug = any($${params.length}::text[]))`;
    };
    if (worldScopes) sql += member([...worldScopes]);
    if (query.world) sql += member([query.world]);
    return sql;
  };
  const docType = caps.docType ? 'd.doc_type' : 'null::text';

  const p1: unknown[] = [from, to];
  const w1 = worldTerm('d', p1);
  p1.push(limit);
  const itemViews = await q.query(
    `select d.id document_id, d.title, ${docType} doc_type, sum(rv.count)::int views,
            count(distinct rv.user_id)::int viewers, max(rv.viewed_at) last_viewed_at
     from recent_views rv join documents d on d.id=rv.document_id
     where d.deleted_at is null and rv.viewed_at between $1 and $2${w1}
     group by d.id order by views desc, d.title limit $${p1.length}`,
    p1,
  );

  const p2: unknown[] = [from, to];
  const w2 = worldTerm('d', p2);
  p2.push(limit);
  const viewers = await q.query(
    `select u.id user_id, u.display_name, sum(rv.count)::int views
     from recent_views rv join users u on u.id=rv.user_id join documents d on d.id=rv.document_id
     where d.deleted_at is null and rv.viewed_at between $1 and $2${w2}
     group by u.id order by views desc, u.display_name limit $${p2.length}`,
    p2,
  );

  const zero = await q.query(
    `select q, count(*)::int count, max(at) last_at from search_log
     where results = 0 and at between $1 and $2
     group by q order by count desc, last_at desc limit $3`,
    [from, to, limit],
  );

  let topTopics: UsageAnalytics['topTopics'] = [];
  if (caps.topics) {
    const p3: unknown[] = [from, to];
    let w3 = '';
    if (worldScopes) {
      p3.push([...worldScopes]);
      w3 += ` and w.slug = any($${p3.length}::text[])`;
    }
    if (query.world) {
      p3.push(query.world);
      w3 += ` and w.slug = $${p3.length}`;
    }
    p3.push(limit);
    const r = await q.query(
      `select t.id topic_id, t.name, w.slug world_slug, sum(tv.count)::int views
       from topic_views tv join topics t on t.id=tv.topic_id join worlds w on w.id=t.world_id
       where tv.viewed_at between $1 and $2${w3}
       group by t.id, t.name, w.slug order by views desc, t.name limit $${p3.length}`,
      p3,
    );
    topTopics = r.rows.map((x) => ({
      topicId: x.topic_id as string,
      name: x.name as string,
      worldSlug: x.world_slug as string,
      views: x.views as number,
    }));
  }

  const p4: unknown[] = [];
  const w4 = worldTerm('d', p4);
  p4.push(limit);
  const ownerSel = caps.owner ? 'o.display_name owner_name' : 'null::text owner_name';
  const ownerJoin = caps.owner ? 'left join users o on o.id=d.owner_id' : '';
  const publishedSel = caps.publishedAt ? 'd.published_at' : 'null::timestamptz published_at';
  const stale = await q.query(
    `select d.id document_id, d.title, ${ownerSel}, d.updated_at, ${publishedSel},
            floor(extract(epoch from (now() - d.updated_at)) / 86400)::int days
     from documents d ${ownerJoin}
     where d.deleted_at is null and ${visibleStatusSql()}${w4}
     order by d.updated_at asc limit $${p4.length}`,
    p4,
  );

  return {
    from: from.toISOString(),
    to: to.toISOString(),
    itemViews: itemViews.rows.map((x) => ({
      documentId: x.document_id as string,
      title: x.title as string,
      docType: (x.doc_type as UsageAnalytics['itemViews'][number]['docType']) ?? null,
      views: x.views as number,
      viewers: x.viewers as number,
      lastViewedAt: iso(x.last_viewed_at as Date),
    })),
    // B-M7: a top-10, not a second copy of `itemViews` at the same limit.
    topItems: itemViews.rows.slice(0, 10).map((x) => ({
      documentId: x.document_id as string,
      title: x.title as string,
      views: x.views as number,
    })),
    topTopics,
    viewers: viewers.rows.map((x) => ({
      userId: x.user_id as string,
      displayName: x.display_name as string,
      views: x.views as number,
    })),
    zeroResultTerms: zero.rows.map((x) => ({
      q: x.q as string,
      count: x.count as number,
      lastAt: iso(x.last_at as Date)!,
    })),
    staleness: stale.rows.map((x) => ({
      documentId: x.document_id as string,
      title: x.title as string,
      ownerName: (x.owner_name as string | null) ?? null,
      updatedAt: iso(x.updated_at as Date)!,
      publishedAt: iso(x.published_at as Date | null),
      daysSinceUpdate: x.days as number,
    })),
  };
}

export async function listSearchLog(q: Q, query: SearchLogQuery) {
  const params: unknown[] = [];
  const where: string[] = [];
  if (query.zeroOnly) where.push('l.results = 0');
  if (query.from) {
    params.push(query.from);
    where.push(`l.at >= $${params.length}`);
  }
  if (query.to) {
    params.push(query.to);
    where.push(`l.at <= $${params.length}`);
  }
  const w = where.length ? 'where ' + where.join(' and ') : '';
  const total = await q.query(`select count(*)::int n from search_log l ${w}`, params);
  params.push(query.pageSize, (query.page - 1) * query.pageSize);
  const rows = await q.query(
    `select l.id, l.user_id, u.display_name user_name, l.q, l.filters, l.results, l.took_ms, l.at
     from search_log l left join users u on u.id=l.user_id ${w}
     order by l.at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  return {
    items: rows.rows.map((x) => ({
      id: x.id as string,
      userId: (x.user_id as string | null) ?? null,
      userName: (x.user_name as string | null) ?? null,
      q: x.q as string,
      filters: (x.filters as Record<string, unknown>) ?? {},
      results: x.results as number,
      tookMs: x.took_ms as number,
      at: iso(x.at as Date)!,
    })),
    total: total.rows[0].n as number,
    page: query.page,
    pageSize: query.pageSize,
  };
}
