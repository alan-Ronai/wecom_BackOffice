import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { makeEvent, type Notifier } from '@wecom/shared';
import { withTransaction, type Queryable, type Tx } from '../../../lib/sql.js';
import type { EventBus } from '../../../lib/events.js';
import { getPublishedItem, type PublishedItem } from './itemsPort.js';

export interface TrackingDeps {
  db: pg.Pool;
  notifier: Notifier;
  events: EventBus;
  log: FastifyBaseLogger;
}

/**
 * Spec §1.3: audience = roles × worlds (+ explicit users). A user matches when they hold one of
 * the roles and their scope is unrestricted (null) or overlaps the audience's worlds; an empty
 * `worldSlugs` means "every world". Inactive users never match.
 */
export async function resolveAudience(
  q: Queryable,
  a: { roleNames: string[]; worldSlugs: string[]; userIds: string[] },
): Promise<string[]> {
  const ids = new Set<string>(a.userIds);
  if (a.roleNames.length) {
    const r = await q.query(
      `select distinct u.id from users u
         join user_roles ur on ur.user_id=u.id
         join roles r on r.id=ur.role_id
        where u.active and r.name = any($1::text[])
          and (cardinality($2::text[]) = 0 or ur.world_scope is null or ur.world_scope && $2::text[])`,
      [a.roleNames, a.worldSlugs],
    );
    for (const x of r.rows) ids.add(x.id as string);
  }
  if (a.userIds.length) {
    const r = await q.query(`select id from users where active and id = any($1::uuid[])`, [a.userIds]);
    const active = new Set(r.rows.map((x) => x.id as string));
    for (const u of a.userIds) if (!active.has(u)) ids.delete(u);
  }
  return [...ids];
}

export interface CreateAssignmentsInput {
  item: PublishedItem;
  userIds: string[];
  reason: 'audience' | 'manual' | 'refresh';
  dueDays: number;
  audienceId?: string | null;
  refreshReason?: string | null;
  actorId: string | null;
}

/** Unique on (item, user, item_version, reason): re-runs skip existing rows instead of duplicating. */
export async function createAssignments(
  tx: Tx,
  deps: Pick<TrackingDeps, 'notifier' | 'events'>,
  i: CreateAssignmentsInput,
): Promise<{ assigned: number; skipped: number; assignmentIds: string[] }> {
  const ids: string[] = [];
  let skipped = 0;
  for (const userId of i.userIds) {
    const r = await tx.query(
      `insert into learning_assignments(item_id, item_version, user_id, audience_id, reason, due_at, refresh_reason)
       values ($1,$2,$3,$4,$5, now() + ($6::int || ' days')::interval, $7)
       on conflict (item_id, user_id, item_version, reason) do nothing returning id`,
      [
        i.item.id,
        i.item.currentVersion,
        userId,
        i.audienceId ?? null,
        i.reason,
        i.dueDays,
        i.refreshReason ?? null,
      ],
    );
    if (!r.rowCount) {
      skipped++;
      continue;
    }
    const id = r.rows[0].id as string;
    ids.push(id);
    await deps.events.publish(
      tx,
      makeEvent('learning.assigned', { assignmentId: id, userId, itemId: i.item.id }),
    );
    if (userId !== i.actorId)
      await deps.notifier.notify({
        userIds: [userId],
        kind: 'learning',
        title:
          (i.reason === 'refresh'
            ? 'רענון ידע נדרש: '
            : i.item.kind === 'quiz'
              ? 'שאלון ידע חדש: '
              : 'תדריך חדש: ') + i.item.title,
        body: i.refreshReason ?? `יש להשלים עד ${i.dueDays} ימים מהיום`,
        href: `/learning/${id}`,
        entityType: 'learning_assignment',
        entityId: id,
      });
  }
  return { assigned: ids.length, skipped, assignmentIds: ids };
}

/** Nightly: re-resolve every audience of every published item so joiners get their assignments. */
export async function resolveAllAudiences(
  deps: TrackingDeps,
): Promise<{ audiences: number; assigned: number }> {
  const auds = await deps.db.query(
    `select a.* from learning_audiences a join learning_items i on i.id=a.item_id
      where i.status='published' and i.deleted_at is null`,
  );
  let assigned = 0;
  for (const a of auds.rows) {
    const n = await withTransaction(deps.db, async (tx) => {
      const pub = await getPublishedItem(tx, a.item_id as string);
      if (!pub) return 0;
      const users = await resolveAudience(tx, {
        roleNames: a.role_names as string[],
        worldSlugs: a.world_slugs as string[],
        userIds: a.user_ids as string[],
      });
      const r = await createAssignments(tx, deps, {
        item: pub.item,
        userIds: users,
        reason: 'audience',
        dueDays: a.due_days as number,
        audienceId: a.id as string,
        actorId: null,
      });
      return r.assigned;
    });
    assigned += n;
  }
  return { audiences: auds.rowCount ?? 0, assigned };
}
