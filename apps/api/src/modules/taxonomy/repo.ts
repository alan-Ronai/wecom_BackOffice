import type pg from 'pg';
import type { z } from 'zod';
import {
  DOC_TYPES,
  TopicSchema,
  TopicViewSchema,
  WorldSchema,
  type TopicView,
  type TaxonomyResolver,
  type Topic,
  type TopicBodySchema,
  type TopicPatchSchema,
  type World,
  type WorldBodySchema,
  type WorldPatchSchema,
} from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { iso, orderWorlds, type Q } from '../documents/repo.js';

type WorldBody = z.infer<typeof WorldBodySchema>;
type WorldPatch = z.infer<typeof WorldPatchSchema>;
type TopicBody = z.infer<typeof TopicBodySchema>;
type TopicPatch = z.infer<typeof TopicPatchSchema>;

const WORLD_SELECT = `select w.*,
    (select count(*)::int from topics t where t.world_id = w.id and t.active) topic_count,
    (select count(*)::int from document_worlds dw join documents d on d.id = dw.document_id
      where dw.world_slug = w.slug and d.deleted_at is null) item_count
  from worlds w`;
const TOPIC_SELECT = `select t.*, w.slug world_slug,
    (select count(*)::int from document_topics dt join documents d on d.id = dt.document_id
      where dt.topic_id = t.id and d.deleted_at is null) item_count
  from topics t join worlds w on w.id = t.world_id`;

const toWorld = (r: Record<string, unknown>): World =>
  WorldSchema.parse({
    id: r.id,
    slug: r.slug,
    name: r.name,
    description: r.description ?? '',
    position: r.position,
    active: r.active,
    topicCount: r.topic_count,
    itemCount: r.item_count,
    createdAt: iso(r.created_at as Date),
    updatedAt: iso(r.updated_at as Date),
  });
const toTopic = (r: Record<string, unknown>): Topic =>
  TopicSchema.parse({
    id: r.id,
    worldSlug: r.world_slug,
    slug: r.slug,
    name: r.name,
    description: r.description ?? '',
    position: r.position,
    active: r.active,
    itemCount: r.item_count,
  });

/* ── worlds ─────────────────────────────────────────────────────────────── */
export async function listWorlds(q: Q, includeInactive = false): Promise<World[]> {
  const r = await q.query(`${WORLD_SELECT} where ($1::boolean or w.active) order by w.position, w.name`, [
    includeInactive,
  ]);
  return r.rows.map(toWorld);
}
export async function getWorld(q: Q, slug: string): Promise<World | null> {
  const r = await q.query(`${WORLD_SELECT} where w.slug = $1`, [slug]);
  return r.rowCount ? toWorld(r.rows[0]) : null;
}
export async function createWorld(tx: Tx, body: WorldBody, userId: string): Promise<World> {
  try {
    const r = await tx.query(
      `insert into worlds(slug, name, description, active, position, created_by, updated_by)
       values ($1,$2,$3,$4,(select coalesce(max(position),-1)+1 from worlds),$5,$5) returning slug`,
      [body.slug, body.name, body.description ?? '', body.active ?? true, userId],
    );
    return (await getWorld(tx, r.rows[0].slug as string))!;
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw httpError(409, 'WORLD_EXISTS', 'עולם תוכן עם מזהה זה כבר קיים');
    throw e;
  }
}
export async function patchWorld(tx: Tx, slug: string, body: WorldPatch, userId: string): Promise<World> {
  const r = await tx.query(
    `update worlds set name = coalesce($2, name), description = coalesce($3, description), active = coalesce($4, active),
       updated_by = $5, updated_at = now() where slug = $1 returning slug`,
    [slug, body.name ?? null, body.description ?? null, body.active ?? null, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'עולם התוכן לא נמצא');
  return (await getWorld(tx, slug))!;
}
/** Never deletes rows: items and history stay. 409 while active items remain unless `force`. */
export async function deactivateWorld(
  tx: Tx,
  slug: string,
  force: boolean,
  userId: string,
): Promise<World> {
  const w = await getWorld(tx, slug);
  if (!w) throw httpError(404, 'NOT_FOUND', 'עולם התוכן לא נמצא');
  if (w.itemCount > 0 && !force)
    throw httpError(409, 'WORLD_IN_USE', `בעולם התוכן יש עדיין ${w.itemCount} פריטים`, {
      items: w.itemCount,
    });
  await tx.query('update worlds set active=false, updated_by=$2, updated_at=now() where slug=$1', [
    slug,
    userId,
  ]);
  return (await getWorld(tx, slug))!;
}
export async function reorderWorlds(tx: Tx, ids: string[]): Promise<World[]> {
  await tx.query(
    `update worlds w set position = x.pos - 1, updated_at = now()
       from unnest($1::uuid[]) with ordinality as x(id, pos) where w.id = x.id`,
    [ids],
  );
  return listWorlds(tx, true);
}

/* ── topics ─────────────────────────────────────────────────────────────── */
const worldId = async (q: Q, slug: string): Promise<string> => {
  const r = await q.query('select id from worlds where slug=$1', [slug]);
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'עולם התוכן לא נמצא');
  return r.rows[0].id as string;
};
export async function listTopics(q: Q, worldSlug: string, includeInactive = false): Promise<Topic[]> {
  await worldId(q, worldSlug);
  const r = await q.query(
    `${TOPIC_SELECT} where w.slug = $1 and ($2::boolean or t.active) order by t.position, t.name`,
    [worldSlug, includeInactive],
  );
  return r.rows.map(toTopic);
}
export async function getTopic(q: Q, id: string): Promise<Topic | null> {
  const r = await q.query(`${TOPIC_SELECT} where t.id = $1`, [id]);
  return r.rowCount ? toTopic(r.rows[0]) : null;
}
export async function createTopic(
  tx: Tx,
  worldSlug: string,
  body: TopicBody,
  userId: string,
): Promise<Topic> {
  const wid = await worldId(tx, worldSlug);
  try {
    const r = await tx.query(
      `insert into topics(world_id, slug, name, description, active, position, created_by, updated_by)
       values ($1,$2,$3,$4,$5,(select coalesce(max(position),-1)+1 from topics where world_id=$1),$6,$6) returning id`,
      [wid, body.slug, body.name, body.description ?? '', body.active ?? true, userId],
    );
    return (await getTopic(tx, r.rows[0].id as string))!;
  } catch (e) {
    if ((e as { code?: string }).code === '23505')
      throw httpError(409, 'TOPIC_EXISTS', 'נושא עם מזהה זה כבר קיים בעולם התוכן');
    throw e;
  }
}
export async function patchTopic(tx: Tx, id: string, body: TopicPatch, userId: string): Promise<Topic> {
  const wid = body.worldSlug ? await worldId(tx, body.worldSlug) : null;
  const r = await tx.query(
    `update topics set name = coalesce($2, name), description = coalesce($3, description), active = coalesce($4, active),
       world_id = coalesce($5, world_id), updated_by = $6, updated_at = now() where id = $1 returning id`,
    [id, body.name ?? null, body.description ?? null, body.active ?? null, wid, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'הנושא לא נמצא');
  return (await getTopic(tx, id))!;
}
export async function deactivateTopic(tx: Tx, id: string, userId: string): Promise<Topic> {
  const r = await tx.query(
    'update topics set active=false, updated_by=$2, updated_at=now() where id=$1 returning id',
    [id, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'הנושא לא נמצא');
  return (await getTopic(tx, id))!;
}
export async function reorderTopics(tx: Tx, worldSlug: string, ids: string[]): Promise<Topic[]> {
  const wid = await worldId(tx, worldSlug);
  await tx.query(
    `update topics t set position = x.pos - 1, updated_at = now()
       from unnest($2::uuid[]) with ordinality as x(id, pos) where t.id = x.id and t.world_id = $1`,
    [wid, ids],
  );
  return listTopics(tx, worldSlug, true);
}

/* ── TaxonomyResolver (W0 contract) ─────────────────────────────────────── */
export class PgTaxonomy implements TaxonomyResolver {
  constructor(private db: pg.Pool) {}
  async worldsOf(documentId: string): Promise<string[]> {
    const r = await this.db.query<{ world_slug: string }>(
      `select dw.world_slug from document_worlds dw join documents d on d.id = dw.document_id
        where dw.document_id = $1 order by (dw.world_slug = d.category) desc, dw.world_slug`,
      [documentId],
    );
    return r.rows.map((x) => x.world_slug);
  }
  async usersWithPermissionInWorld(permission: string, world: string): Promise<string[]> {
    const r = await this.db.query<{ id: string }>(
      `select distinct u.id from users u
         join user_roles ur on ur.user_id = u.id
         join role_permissions rp on rp.role_id = ur.role_id
        where u.active and rp.permission = $1 and (ur.world_scope is null or $2 = any(ur.world_scope))`,
      [permission, world],
    );
    return r.rows.map((x) => x.id);
  }
}

/* ── topic view + tags ──────────────────────────────────────────────────── */
export interface Visibility {
  /** true when the caller holds `docs.read_unpublished` */
  unpublished: boolean;
  worldScopes: readonly string[] | null;
}

/** Every item in a topic, grouped by doc type in PRD order; empty groups are omitted. */
export async function topicView(q: Q, topicId: string, vis: Visibility): Promise<TopicView | null> {
  const topic = await getTopic(q, topicId);
  if (!topic) return null;
  const world = (await getWorld(q, topic.worldSlug))!;
  const r = await q.query(
    `select d.id, d.slug, d.title, d.doc_type, d.kind, d.status, d.description, d.tags, d.updated_at, d.category,
            coalesce((select array_agg(dw.world_slug order by dw.world_slug) from document_worlds dw where dw.document_id = d.id), '{}') worlds
       from document_topics dt join documents d on d.id = dt.document_id
      where dt.topic_id = $1 and d.deleted_at is null
        and ($2::boolean or d.status in ('published','partial'))
        and ($3::text[] is null or exists (select 1 from document_worlds sw where sw.document_id = d.id and sw.world_slug = any($3)))
      order by d.title`,
    [topicId, vis.unpublished, vis.worldScopes ? [...vis.worldScopes] : null],
  );
  const items = r.rows.map((x) => ({
    id: x.id as string,
    slug: x.slug as string,
    title: x.title as string,
    docType: x.doc_type as string,
    kind: x.kind as string,
    status: x.status as string,
    worlds: orderWorlds(x.category as string, x.worlds as string[]),
    description: (x.description as string) ?? '',
    tags: (x.tags as string[]) ?? [],
    updatedAt: iso(x.updated_at as Date)!,
  }));
  const groups = DOC_TYPES.map((docType) => ({
    docType,
    items: items.filter((i) => i.docType === docType),
  })).filter((g) => g.items.length);
  return TopicViewSchema.parse({ topic, world, groups });
}

export async function listTags(q: Q, o: { q?: string; limit: number }): Promise<{ tag: string; count: number }[]> {
  const r = await q.query(
    `select tag, count(*)::int count from documents d, unnest(d.tags) tag
      where d.deleted_at is null and ($1::text is null or tag ilike '%' || $1 || '%')
      group by tag order by count desc, tag limit $2`,
    [o.q ?? null, o.limit],
  );
  return r.rows.map((x) => ({ tag: x.tag as string, count: x.count as number }));
}
