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
