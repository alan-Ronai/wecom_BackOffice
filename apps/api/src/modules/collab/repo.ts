import type pg from 'pg';
import { makeEvent, type Notification } from '@wecom/shared';
import type { EventBus } from '../../lib/events.js';
import type { Tx } from '../../lib/sql.js';

export type Q = pg.Pool | Tx;
export type NotificationKind = Notification['kind'];

export const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

/** Same rule the identity module uses, so an avatar looks the same wherever it is drawn. */
export const initialsOf = (name: string): string =>
  name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0] ?? '')
    .join('') || '?';

export interface NotifyInput {
  userId: string;
  kind: NotificationKind;
  title: string;
  body?: string;
  href?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

/**
 * Writes one notification row inside the caller's transaction and publishes
 * `notification.created` on the same transaction, so a rolled-back write never
 * lights up somebody's bell. Self-notifications are dropped: telling the author
 * that they mentioned themselves is noise, not news.
 */
export async function notify(
  tx: Tx,
  events: EventBus,
  n: NotifyInput,
  actorId: string | null = null,
): Promise<string | null> {
  if (actorId && actorId === n.userId) return null;
  const r = await tx.query<{ id: string }>(
    `insert into notifications(user_id, kind, title, body, href, entity_type, entity_id)
     values ($1,$2,$3,$4,$5,$6,$7) returning id`,
    [n.userId, n.kind, n.title, n.body ?? '', n.href ?? null, n.entityType ?? null, n.entityId ?? null],
  );
  const id = r.rows[0].id;
  await events.publish(
    tx,
    makeEvent('notification.created', {
      notificationId: id,
      userId: n.userId,
      kind: n.kind,
      title: n.title,
    }),
  );
  return id;
}

/** Everyone who may publish — the people a review request is actually for. */
export async function leadIds(q: Q, exclude: string | null): Promise<string[]> {
  const r = await q.query<{ id: string }>(
    `select distinct u.id from users u
       join user_roles ur on ur.user_id = u.id
       join role_permissions rp on rp.role_id = ur.role_id
      where rp.permission = 'docs.publish' and u.active and ($1::uuid is null or u.id <> $1)`,
    [exclude],
  );
  return r.rows.map((x) => x.id);
}

export const documentTitle = async (q: Q, id: string): Promise<string> =>
  (await q.query<{ title: string }>('select title from documents where id=$1', [id])).rows[0]?.title ??
  'מסמך';
