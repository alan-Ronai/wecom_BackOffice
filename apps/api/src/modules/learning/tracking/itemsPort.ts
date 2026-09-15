import type { SourceVersion } from '@wecom/shared';
import type { Queryable } from '../../../lib/sql.js';
import { getVersion } from '../../documents/repo.js';

/**
 * V2's view of V1's tables (spec §3). Plain SQL rather than an import so this module compiles and
 * tests before V1 lands; V6 may swap these for V1's repo functions once both are on main.
 *
 * The five V1-shaped exports (`getPublishedItem`, `itemSourceVersions`, `listItemsReferencing`,
 * `needsUpdateFor`, `documentSnapshotFor`) keep the coordinator's pinned names and shapes, so a
 * re-point is a body change and never a caller change. `significantChangeSince`, `needsUpdate`
 * and `assignmentStats` are V2-owned and stay here.
 */
export interface PublishedItem {
  id: string;
  kind: 'briefing' | 'quiz';
  title: string;
  description: string;
  worldSlug: string | null;
  currentVersion: number;
  passMark: number | null;
  maxAttempts: number | null;
  estimatedMinutes: number | null;
  status: 'draft' | 'published' | 'archived';
}
export interface StoredQuestion {
  id: string;
  documentId: string;
  stepKey: string | null;
  stem: string;
  kind: 'single' | 'multi' | 'order' | 'free';
  options: { id: string; text: string; correct: boolean }[];
  explanation: string;
}
export interface StoredEntry {
  id: string;
  documentId: string;
  stepKey: string | null;
  note: string;
  position: number;
}

const toItem = (r: Record<string, unknown>): PublishedItem => ({
  id: r.id as string,
  kind: r.kind as PublishedItem['kind'],
  title: r.title as string,
  description: (r.description as string) ?? '',
  worldSlug: (r.world_slug as string | null) ?? null,
  currentVersion: r.current_version as number,
  passMark: (r.pass_mark as number | null) ?? null,
  maxAttempts: (r.max_attempts as number | null) ?? null,
  estimatedMinutes: (r.estimated_minutes as number | null) ?? null,
  status: r.status as PublishedItem['status'],
});

export async function getItem(q: Queryable, id: string): Promise<PublishedItem | null> {
  const r = await q.query(`select * from learning_items where id=$1 and deleted_at is null`, [id]);
  return r.rowCount ? toItem(r.rows[0]) : null;
}

export async function getPublishedItem(
  q: Queryable,
  id: string,
): Promise<{ item: PublishedItem; version: number; sourceVersions: SourceVersion[] } | null> {
  const item = await getItem(q, id);
  if (!item || item.status !== 'published') return null;
  return {
    item,
    version: item.currentVersion,
    sourceVersions: await itemSourceVersions(q, id, item.currentVersion),
  };
}

export async function itemSourceVersions(
  q: Queryable,
  itemId: string,
  version: number,
): Promise<SourceVersion[]> {
  const r = await q.query(`select snapshot from learning_item_versions where item_id=$1 and version=$2`, [
    itemId,
    version,
  ]);
  const snap = (r.rows[0]?.snapshot as { sourceVersions?: SourceVersion[] } | undefined) ?? {};
  return snap.sourceVersions ?? [];
}

export async function itemQuestions(q: Queryable, itemId: string): Promise<StoredQuestion[]> {
  const r = await q.query(`select * from quiz_questions where item_id=$1 order by position`, [itemId]);
  return r.rows.map((x) => ({
    id: x.id as string,
    documentId: x.document_id as string,
    stepKey: (x.step_key as string | null) ?? null,
    stem: x.stem as string,
    kind: x.kind as StoredQuestion['kind'],
    options: (x.options as StoredQuestion['options']) ?? [],
    explanation: (x.explanation as string) ?? '',
  }));
}

export async function itemEntries(q: Queryable, itemId: string): Promise<StoredEntry[]> {
  const r = await q.query(`select * from briefing_entries where item_id=$1 order by position`, [itemId]);
  return r.rows.map((x) => ({
    id: x.id as string,
    documentId: x.document_id as string,
    stepKey: (x.step_key as string | null) ?? null,
    note: (x.note as string) ?? '',
    position: x.position as number,
  }));
}

/**
 * A-I2 — what the learner was assigned, not what the editor is currently typing.
 *
 * `learning/repo.ts`'s own header states the rule: "Learners never read the live rows:
 * `getPublishedItem` returns the latest snapshot, so an editor may keep editing a published item
 * without changing what anyone is currently learning." The V2 port never honoured it — the player
 * and the grader both read `select * from quiz_questions where item_id=$1`, the *current* rows,
 * regardless of the version the assignment pins.
 *
 * Two things went wrong at once, and the second is the quiet one. `replaceQuestions` used to
 * delete and re-insert, minting new uuids, so an editor touching a published quiz changed what
 * learners mid-assignment saw and were graded on *and* orphaned every stored
 * `learning_attempts.answers` key — those keys are question ids, and both the dashboard's
 * failed-question tile and `heuristics.failedQuestions` join on them. The history did not go
 * wrong, it went silent.
 *
 * `learning_item_versions.snapshot` already carries the whole item, questions and entries
 * included, so the pinned read is a jsonb lookup rather than a new table. An item with no version
 * row at that number was never published at it — the only way to reach that is a draft, which has
 * no assignments — so the live rows are the honest answer there and the fallback says so.
 */
interface Snapshot {
  item?: { questions?: StoredQuestion[]; entries?: Omit<StoredEntry, 'position'>[] };
}
const snapshotOf = async (q: Queryable, itemId: string, version: number): Promise<Snapshot | null> => {
  const r = await q.query(`select snapshot from learning_item_versions where item_id=$1 and version=$2`, [
    itemId,
    version,
  ]);
  return r.rowCount ? ((r.rows[0].snapshot as Snapshot) ?? null) : null;
};

/** The questions frozen into `version`'s snapshot; the live rows only for an item never published at it. */
export async function itemQuestionsAt(
  q: Queryable,
  itemId: string,
  version: number,
): Promise<StoredQuestion[]> {
  const snap = await snapshotOf(q, itemId, version);
  const frozen = snap?.item?.questions;
  if (!frozen) return itemQuestions(q, itemId);
  return frozen.map((x) => ({
    id: x.id,
    documentId: x.documentId,
    stepKey: x.stepKey ?? null,
    stem: x.stem,
    kind: x.kind,
    options: x.options ?? [],
    explanation: x.explanation ?? '',
  }));
}

/** The entries frozen into `version`'s snapshot, in their published order. */
export async function itemEntriesAt(q: Queryable, itemId: string, version: number): Promise<StoredEntry[]> {
  const snap = await snapshotOf(q, itemId, version);
  const frozen = snap?.item?.entries;
  if (!frozen) return itemEntries(q, itemId);
  return frozen.map((e, i) => ({
    id: e.id,
    documentId: e.documentId,
    stepKey: e.stepKey ?? null,
    note: e.note ?? '',
    position: i,
  }));
}

/** Items (any status) whose current version pins `documentId`. */
export async function listItemsReferencing(
  q: Queryable,
  documentId: string,
): Promise<
  {
    itemId: string;
    kind: 'briefing' | 'quiz';
    status: 'draft' | 'published' | 'archived';
    currentVersion: number;
  }[]
> {
  const r = await q.query(
    `select distinct i.id, i.kind, i.status, i.current_version
       from learning_items i
       join learning_item_versions v on v.item_id=i.id and v.version=i.current_version
       cross join lateral jsonb_array_elements(coalesce(v.snapshot->'sourceVersions','[]'::jsonb)) p
      where i.deleted_at is null and p->>'documentId' = $1`,
    [documentId],
  );
  return r.rows.map((x) => ({
    itemId: x.id as string,
    kind: x.kind as 'briefing' | 'quiz',
    status: x.status as 'draft' | 'published' | 'archived',
    currentVersion: x.current_version as number,
  }));
}

/** V1's half of `needsUpdate`: a referenced document is invalid or archived (or gone). */
export async function needsUpdateFor(q: Queryable, itemIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map(itemIds.map((id) => [id, false]));
  if (!itemIds.length) return out;
  const r = await q.query(
    `select distinct i.id from learning_items i
       join learning_item_versions v on v.item_id=i.id and v.version=i.current_version
       cross join lateral jsonb_array_elements(coalesce(v.snapshot->'sourceVersions','[]'::jsonb)) p
       left join documents d on d.id = (p->>'documentId')::uuid
      where i.id = any($1::uuid[]) and (d.id is null or d.deleted_at is not null or d.status in ('invalid','archived'))`,
    [itemIds],
  );
  for (const x of r.rows) out.set(x.id as string, true);
  return out;
}

/** V2's half: a significant change flag newer than the pinned version of any referenced document. */
export async function significantChangeSince(q: Queryable, itemIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map(itemIds.map((id) => [id, false]));
  if (!itemIds.length) return out;
  const r = await q.query(
    `select distinct i.id from learning_items i
       join learning_item_versions v on v.item_id=i.id and v.version=i.current_version
       cross join lateral jsonb_array_elements(coalesce(v.snapshot->'sourceVersions','[]'::jsonb)) p
       join document_change_flags f
         on f.document_id = (p->>'documentId')::uuid and f.significant and f.version > (p->>'version')::int
      where i.id = any($1::uuid[])`,
    [itemIds],
  );
  for (const x of r.rows) out.set(x.id as string, true);
  return out;
}

export async function needsUpdate(q: Queryable, itemIds: string[]): Promise<Map<string, boolean>> {
  const a = await needsUpdateFor(q, itemIds);
  const b = await significantChangeSince(q, itemIds);
  return new Map(itemIds.map((id) => [id, !!a.get(id) || !!b.get(id)]));
}

/** Briefing entries rendered from the pinned document versions; `changedSinceAssigned` is for the caller to set. */
export async function documentSnapshotFor(q: Queryable, itemId: string, version: number) {
  const pinned = new Map(
    (await itemSourceVersions(q, itemId, version)).map((p) => [p.documentId, p.version]),
  );
  const out: {
    id: string;
    documentId: string;
    stepKey: string | null;
    note: string;
    documentTitle: string;
    phases: NonNullable<Awaited<ReturnType<typeof getVersion>>>['phases'];
    changedSinceAssigned: false;
  }[] = [];
  for (const e of await itemEntriesAt(q, itemId, version)) {
    const at = pinned.get(e.documentId);
    const doc = at != null ? await getVersion(q, e.documentId, at) : null;
    out.push({
      id: e.id,
      documentId: e.documentId,
      stepKey: e.stepKey,
      note: e.note,
      documentTitle: doc?.title ?? '',
      phases: doc?.phases ?? [],
      changedSinceAssigned: false as const,
    });
  }
  return out;
}

/** Fills V1's card placeholders: distinct assigned users and completion rate for the current version. */
export async function assignmentStats(
  q: Queryable,
  itemIds: string[],
): Promise<Map<string, { assignedUsers: number; completionRate: number | null }>> {
  const out = new Map(itemIds.map((id) => [id, { assignedUsers: 0, completionRate: null as number | null }]));
  if (!itemIds.length) return out;
  /**
   * A-M1: both halves count *users*.
   *
   * `count(*) filter (status='completed')` over `count(distinct user_id)` mixed rows with people,
   * and a user can legitimately hold both an `audience` and a `manual` row at the same
   * `item_version` — `reason` is part of the unique key precisely so they can. Two completed rows
   * for one user made the rate exceed 1, which `LearningItemCardSchema.completionRate`
   * (`z.number().min(0).max(1)`) then refused at serialization: the card 500s rather than reads
   * wrong.
   */
  const r = await q.query(
    `select a.item_id, count(distinct a.user_id)::int assigned,
            count(distinct a.user_id) filter (where a.status='completed')::int completed
       from learning_assignments a join learning_items i on i.id=a.item_id and a.item_version=i.current_version
      where a.item_id = any($1::uuid[]) group by a.item_id`,
    [itemIds],
  );
  for (const x of r.rows)
    out.set(x.item_id as string, {
      assignedUsers: x.assigned as number,
      completionRate: (x.assigned as number) ? (x.completed as number) / (x.assigned as number) : null,
    });
  return out;
}
