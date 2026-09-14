import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { FEEDBACK_KIND_LABELS, type FeedbackRow, type Notifier, type TaxonomyResolver } from '@wecom/shared';
import { hasColumn } from './repo.js';
import { leadIds } from '../collab/repo.js';

export interface AlertDeps {
  db: pg.Pool;
  notifier: Notifier;
  taxonomy: TaxonomyResolver;
  log: FastifyBaseLogger;
}

/** Owner + responsible editor (W2 columns) or, before W2, whoever last touched the document. */
export async function recipientsFor(db: pg.Pool, documentId: string): Promise<string[]> {
  const hasOwner = await hasColumn(db, 'documents', 'owner_id');
  const hasEditor = await hasColumn(db, 'documents', 'editor_id');
  const cols = [
    hasOwner ? 'owner_id' : 'null::uuid as owner_id',
    hasEditor ? 'editor_id' : 'null::uuid as editor_id',
    'updated_by',
  ];
  const r = await db.query(`select ${cols.join(', ')} from documents where id=$1`, [documentId]);
  if (!r.rowCount) return [];
  const row = r.rows[0] as { owner_id: string | null; editor_id: string | null; updated_by: string | null };
  const ids = [row.owner_id, row.editor_id].filter((x): x is string => !!x);
  if (!ids.length && row.updated_by) ids.push(row.updated_by);
  return [...new Set(ids)];
}

/** Everyone who may publish in the item's world; falls back to all leads before W1 lands. */
async function publishersFor(deps: AlertDeps, world: string): Promise<string[]> {
  const scoped = await deps.taxonomy.usersWithPermissionInWorld('docs.publish', world);
  return scoped.length ? scoped : leadIds(deps.db, null);
}

export async function notifyOnCreate(deps: AlertDeps, f: FeedbackRow, title: string): Promise<void> {
  const ids = new Set(await recipientsFor(deps.db, f.documentId));
  if (f.kind === 'process_fails') for (const id of await publishersFor(deps, f.worldSlug)) ids.add(id);
  ids.delete(f.userId); // the reporter already knows
  if (!ids.size) return;
  const step = f.stepKey ? ` · שלב ${f.stepKey}` : '';
  await deps.notifier.notify({
    userIds: [...ids],
    kind: 'feedback',
    title: `משוב חדש: ${FEEDBACK_KIND_LABELS[f.kind]}`,
    body: `${title}${step}${f.text ? ' — ' + f.text.slice(0, 140) : ''}`,
    href: `/feedback/${f.id}`,
    entityType: 'feedback',
    entityId: f.id,
  });
}

const WINDOW_TITLES = {
  repeat: 'דיווחים חוזרים על אותו פריט',
  anomaly: 'כמות חריגה של דיווחים',
} as const;

async function alertOnce(
  deps: AlertDeps,
  kind: 'repeat' | 'anomaly',
  doc: { id: string; title: string; world: string; count: number },
  windowStart: Date,
  windowEnd: Date,
): Promise<boolean> {
  const dup = await deps.db.query(
    `select 1 from feedback_alerts where document_id=$1 and kind=$2 and window_end > $3`,
    [doc.id, kind, windowStart.toISOString()],
  );
  if (dup.rowCount) return false;
  await deps.db.query(
    `insert into feedback_alerts(document_id, kind, window_start, window_end, count) values ($1,$2,$3,$4,$5)`,
    [doc.id, kind, windowStart.toISOString(), windowEnd.toISOString(), doc.count],
  );
  const ids = new Set([...(await recipientsFor(deps.db, doc.id)), ...(await publishersFor(deps, doc.world))]);
  if (!ids.size) return true;
  await deps.notifier.notify({
    userIds: [...ids],
    kind: 'feedback',
    title: `${WINDOW_TITLES[kind]}: ${doc.title}`,
    body: `${doc.count} דיווחים ${kind === 'repeat' ? 'ב-7 הימים האחרונים' : 'ב-24 השעות האחרונות'}`,
    href: `/feedback?documentId=${doc.id}`,
    entityType: 'feedback_alert',
    entityId: doc.id,
  });
  return true;
}

/** Runs every 10 minutes (`feedback.alerts`). Idempotent thanks to `feedback_alerts`. */
export async function evaluateWindows(
  deps: AlertDeps,
  now = new Date(),
): Promise<{ repeat: number; anomaly: number }> {
  const d7 = new Date(now.getTime() - 7 * 86400_000);
  const d1 = new Date(now.getTime() - 86400_000);
  const d30 = new Date(now.getTime() - 30 * 86400_000);
  const out = { repeat: 0, anomaly: 0 };
  const rep = await deps.db.query(
    `select f.document_id id, d.title, max(f.world_slug) world, count(*)::int count
     from feedback f join documents d on d.id=f.document_id
     where f.created_at >= $1 group by f.document_id, d.title having count(*) >= 3`,
    [d7.toISOString()],
  );
  for (const r of rep.rows) if (await alertOnce(deps, 'repeat', r as never, d7, now)) out.repeat++;
  const ano = await deps.db.query(
    `select f.document_id id, d.title, max(f.world_slug) world,
            count(*) filter (where f.created_at >= $1)::int count,
            count(*)::int total30
     from feedback f join documents d on d.id=f.document_id
     where f.created_at >= $2 group by f.document_id, d.title
     having count(*) filter (where f.created_at >= $1) >= 5
        and count(*) filter (where f.created_at >= $1) >= 2 * (count(*)::numeric / 30)`,
    [d1.toISOString(), d30.toISOString()],
  );
  for (const r of ano.rows) if (await alertOnce(deps, 'anomaly', r as never, d1, now)) out.anomaly++;
  return out;
}

/** 08:00 daily (`feedback.digest`): one summary per person who can work the queue. */
export async function sendDigest(deps: AlertDeps, now = new Date()): Promise<number> {
  const editors = await deps.db.query<{ id: string }>(
    `select distinct u.id from users u
       join user_roles ur on ur.user_id=u.id
       join role_permissions rp on rp.role_id=ur.role_id
      where rp.permission='feedback.manage' and u.active`,
  );
  if (!editors.rowCount) return 0;
  const open = await deps.db.query<{ assignee_id: string | null; n: number }>(
    `select assignee_id, count(*)::int n from feedback where status in ('new','in_review','needs_update') group by assignee_id`,
  );
  const total = open.rows.reduce((s, r) => s + r.n, 0);
  if (!total) return 0;
  let sentCount = 0;
  for (const e of editors.rows) {
    const mine = open.rows.find((r) => r.assignee_id === e.id)?.n ?? 0;
    await deps.notifier.notify({
      userIds: [e.id],
      kind: 'feedback',
      title: `${total} משובים פתוחים` + (mine ? ` · ${mine} משויכים אליך` : ''),
      body: `סיכום יומי ${now.toLocaleDateString('he-IL')}`,
      href: '/feedback',
      entityType: 'feedback_digest',
      entityId: now.toISOString().slice(0, 10),
    });
    sentCount++;
  }
  return sentCount;
}
