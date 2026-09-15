/**
 * Wave 5 (V1) — learning content repository: items, briefing entries, quiz questions,
 * versioned publish snapshots that pin the referenced documents' versions, and the
 * referencing helpers V2 builds assignments and refresh flags on.
 *
 * Learners never read the live rows: `getPublishedItem` returns the latest snapshot, so an
 * editor may keep editing a published item without changing what anyone is currently learning.
 */
import type {
  BriefingEntry,
  LearningItem,
  LearningItemCard,
  LearningItemCreate,
  LearningItemPatch,
  LearningItemsQuery,
  QuizQuestion,
  SourceVersion,
} from '@wecom/shared';
import { sanitizeHtml } from '@wecom/shared';
import type pg from 'pg';
import type { Tx } from '../../lib/sql.js';
import { httpError } from '../../lib/http.js';
import { getDocument, iso } from '../documents/repo.js';
import { getWorkflowSettings } from '../../lib/workflowSettings.js';
import type { ReqUser } from '../../lib/user.js';

export type Q = pg.Pool | Tx;
type Row = Record<string, unknown>;

export interface Viewer {
  user: ReqUser;
  manage: boolean;
}
export const viewerOf = (user: ReqUser): Viewer => ({
  user,
  manage: user.permissions.has('learning.manage'),
});

/* ── assembly ─────────────────────────────────────────────────────────── */
const toEntry = (r: Row): BriefingEntry => ({
  id: r.id as string,
  documentId: r.document_id as string,
  stepKey: (r.step_key as string | null) ?? null,
  note: (r.note as string) ?? '',
});
const toQuestion = (r: Row): QuizQuestion => ({
  id: r.id as string,
  documentId: r.document_id as string,
  stepKey: (r.step_key as string | null) ?? null,
  stem: r.stem as string,
  kind: r.kind as QuizQuestion['kind'],
  options: (r.options as QuizQuestion['options']) ?? [],
  explanation: (r.explanation as string) ?? '',
  generated: !!r.generated,
  modelConf: r.model_conf === null ? null : Number(r.model_conf),
});

async function assemble(q: Q, rows: Row[], needsUpdate: Map<string, boolean>): Promise<LearningItem[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id as string);
  const [e, qs, sv] = await Promise.all([
    q.query('select * from briefing_entries where item_id = any($1) order by item_id, position', [ids]),
    q.query('select * from quiz_questions where item_id = any($1) order by item_id, position', [ids]),
    q.query(
      `select item_id, snapshot->'sourceVersions' sv from learning_item_versions v
       where item_id = any($1) and version = (select max(version) from learning_item_versions x where x.item_id = v.item_id)`,
      [ids],
    ),
  ]);
  const by = <T>(rs: Row[], f: (r: Row) => T) => {
    const m = new Map<string, T[]>();
    for (const r of rs) {
      const k = r.item_id as string;
      (m.get(k) ?? m.set(k, []).get(k)!).push(f(r));
    }
    return m;
  };
  const entries = by(e.rows, toEntry);
  const questions = by(qs.rows, toQuestion);
  const versions = new Map(sv.rows.map((r) => [r.item_id as string, (r.sv as SourceVersion[]) ?? []]));
  return rows.map((r) => ({
    id: r.id as string,
    kind: r.kind as LearningItem['kind'],
    title: r.title as string,
    description: (r.description as string) ?? '',
    worldSlug: (r.world_slug as string | null) ?? null,
    status: r.status as LearningItem['status'],
    currentVersion: r.current_version as number,
    passMark: (r.pass_mark as number | null) ?? null,
    maxAttempts: (r.max_attempts as number | null) ?? null,
    estimatedMinutes: (r.estimated_minutes as number | null) ?? null,
    entries: entries.get(r.id as string) ?? [],
    questions: questions.get(r.id as string) ?? [],
    sourceVersions: versions.get(r.id as string) ?? [],
    needsUpdate: needsUpdate.get(r.id as string) ?? false,
    createdBy: (r.created_by as string | null) ?? null,
    updatedAt: iso(r.updated_at as Date)!,
    publishedAt: iso(r.published_at as Date | null),
  }));
}

/** §1.8 status half: any live reference to a document that is invalid/archived/deleted. V2 ORs in its significant-change half. */
export async function needsUpdateFor(q: Q, itemIds: string[]): Promise<Map<string, boolean>> {
  if (!itemIds.length) return new Map();
  const r = await q.query(
    `select ref.item_id, bool_or(d.deleted_at is not null or d.status in ('invalid','archived')) flag
     from (select item_id, document_id from briefing_entries union all select item_id, document_id from quiz_questions) ref
     join documents d on d.id = ref.document_id where ref.item_id = any($1) group by ref.item_id`,
    [itemIds],
  );
  return new Map(r.rows.map((x) => [x.item_id as string, !!x.flag]));
}

export async function getItem(q: Q, id: string): Promise<LearningItem | null> {
  const r = await q.query('select * from learning_items where id=$1 and deleted_at is null', [id]);
  if (!r.rowCount) return null;
  return (await assemble(q, r.rows, await needsUpdateFor(q, [id])))[0];
}

/**
 * A-C1: the answer key never leaves the authoring view.
 *
 * `GET /learning/items/:id` is `learning.read`, which 0038 grants to the `agent` role, and
 * `canSee` lets a non-manager see any *published* item — which is the state every assigned quiz
 * is in. Returned verbatim, `LearningItemSchema.questions[].options[].correct` handed every agent
 * `correct: true` for every question before attempt #1, and `explanation` with it. The player
 * (`tracking/repo.playerItem`) and the preview both strip it; this route was the hole between
 * them.
 *
 * The response schema stays `LearningItemSchema` so the contract shape does not fork per caller;
 * what changes is that for a non-manager every answer-bearing field reads as its empty value —
 * `correct: false` on every option, no `explanation`, and no authoring provenance (`generated`,
 * `modelConf`), which is the same projection `PlayerQuestionSchema` expresses by omission.
 */
export function projectForLearner(item: LearningItem): LearningItem {
  return {
    ...item,
    questions: item.questions.map((q) => ({
      ...q,
      options: q.options.map((o) => ({ ...o, correct: false })),
      explanation: '',
      generated: false,
      modelConf: null,
    })),
  };
}

/* ── visibility & scope (spec §1.8 + world scope) ──────────────────────── */
/** Worlds an item belongs to: its own world_slug, else the union of its referenced documents' worlds. */
export async function worldsOfItem(q: Q, id: string): Promise<string[]> {
  const r = await q.query(
    `select coalesce(li.world_slug, dw.world_slug) w from learning_items li
     left join (select ref.item_id, x.world_slug from (select item_id, document_id from briefing_entries union select item_id, document_id from quiz_questions) ref
                join document_worlds x on x.document_id = ref.document_id) dw on dw.item_id = li.id
     where li.id=$1`,
    [id],
  );
  return [...new Set(r.rows.map((x) => x.w as string).filter(Boolean))];
}
export async function canSee(q: Q, item: LearningItem, v: Viewer): Promise<boolean> {
  if (!v.manage && item.status !== 'published') return false;
  if (v.user.worldScopes === null) return true;
  const worlds = await worldsOfItem(q, item.id);
  return worlds.length === 0 || worlds.some((w) => v.user.worldScopes!.includes(w));
}

/**
 * "This item is in one of my worlds", as SQL over a `learning_items` alias.
 *
 * An item's worlds are its own `world_slug` or, when it has none, the union of its referenced
 * documents' worlds; an item with neither is visible to everyone. Extracted from `listCards`
 * because V2's dashboard needs the same rule — its `totals.items` counted the whole org next to
 * scoped assignment counts (A-M2), so the two numbers on the tile did not mean the same thing.
 *
 * `push` is the caller's parameter appender; it is called once, and the second reference reuses
 * the placeholder it returned.
 */
export function itemWorldScopeSql(alias: string, scopes: readonly string[], push: (v: unknown) => string) {
  const p = push([...scopes]);
  return `(${alias}.world_slug is null and not exists (select 1 from briefing_entries e where e.item_id = ${alias}.id union select 1 from quiz_questions x where x.item_id = ${alias}.id)
      or ${alias}.world_slug = any(${p})
      or exists (select 1 from (select item_id, document_id from briefing_entries union select item_id, document_id from quiz_questions) ref
                 join document_worlds dw on dw.document_id = ref.document_id where ref.item_id = ${alias}.id and dw.world_slug = any(${p})))`;
}

/* ── cards & list ──────────────────────────────────────────────────────── */
/** V2 replaces the two `0`/`null` subqueries with counts from learning_assignments. */
const cardSql = `
  select li.*, (select count(*)::int from briefing_entries e where e.item_id = li.id) entry_count,
         (select count(*)::int from quiz_questions x where x.item_id = li.id) question_count,
         0::int assigned_users, null::numeric completion_rate
  from learning_items li`;
const toCard = (r: Row, needsUpdate: boolean): LearningItemCard => ({
  id: r.id as string,
  kind: r.kind as LearningItemCard['kind'],
  title: r.title as string,
  description: (r.description as string) ?? '',
  worldSlug: (r.world_slug as string | null) ?? null,
  status: r.status as LearningItemCard['status'],
  currentVersion: r.current_version as number,
  estimatedMinutes: (r.estimated_minutes as number | null) ?? null,
  needsUpdate,
  updatedAt: iso(r.updated_at as Date)!,
  publishedAt: iso(r.published_at as Date | null),
  entryCount: r.entry_count as number,
  questionCount: r.question_count as number,
  assignedUsers: r.assigned_users as number,
  completionRate: r.completion_rate === null ? null : Number(r.completion_rate),
});
export async function assembleCard(q: Q, id: string): Promise<LearningItemCard | null> {
  const r = await q.query(cardSql + ' where li.id=$1 and li.deleted_at is null', [id]);
  if (!r.rowCount) return null;
  return toCard(r.rows[0], (await needsUpdateFor(q, [id])).get(id) ?? false);
}
export async function listCards(
  q: Q,
  query: LearningItemsQuery,
  v: Viewer,
): Promise<{ items: LearningItemCard[]; total: number }> {
  const params: unknown[] = [];
  const p = (x: unknown) => {
    params.push(x);
    return '$' + params.length;
  };
  const where = ['li.deleted_at is null'];
  if (!v.manage) where.push(`li.status = 'published'`);
  if (query.kind) where.push(`li.kind = ${p(query.kind)}`);
  if (query.status) where.push(`li.status = ${p(query.status)}`);
  if (query.world) where.push(`li.world_slug = ${p(query.world)}`);
  if (query.q)
    where.push(
      `(li.title ilike '%' || ${p(query.q)} || '%' or li.description ilike '%' || $${params.length} || '%')`,
    );
  if (v.user.worldScopes !== null) where.push(itemWorldScopeSql('li', v.user.worldScopes, p));
  const w = ' where ' + where.join(' and ');
  const total = (await q.query(`select count(*)::int n from learning_items li${w}`, params)).rows[0]
    .n as number;
  params.push(query.pageSize, (query.page - 1) * query.pageSize);
  const r = await q.query(
    `${cardSql}${w} order by li.updated_at desc limit $${params.length - 1} offset $${params.length}`,
    params,
  );
  const flags = await needsUpdateFor(
    q,
    r.rows.map((x) => x.id as string),
  );
  return { items: r.rows.map((x) => toCard(x, flags.get(x.id as string) ?? false)), total };
}

/* ── writes ────────────────────────────────────────────────────────────── */

/**
 * The same ruling as wave 4's C-C2, for the same reason.
 *
 * `learning_items.description` is rich text — `RichText … compact` writes it, and
 * `ItemPreview.tsx` renders it with `dangerouslySetInnerHTML`, its comment already asserting
 * "Sanitised server-side, like every other rich-text body the app renders". Nothing was. The
 * create and patch routes put the authored string straight into the column, so a manager could
 * store `<p onclick="…">` or a `<script>` and every later preview of that item would carry it.
 *
 * Sanitizing here rather than in the routes means no caller can forget — the way
 * `documents/repo.ts`'s `cleanBody` and `sourcedocs/repo.ts`'s `saveSourceDocument` already do
 * it for the two other HTML columns. It also covers the publish snapshot for free:
 * `publishItem` builds its snapshot from `getItem`, so it can only ever see a cleaned row.
 *
 * `briefing_entries.note` and the `quiz_questions` columns are deliberately *not* run through
 * this: they are plain text, rendered as text (`{e.note}` in `BriefingReader` and `ItemPreview`,
 * `{q.stem}` in the players), so React escapes them and sanitizing would only corrupt a note
 * that legitimately mentions `<` or `&`.
 */
const cleanDescription = (html: string | null | undefined): string =>
  html == null ? '' : sanitizeHtml(html);

export async function createItem(tx: Tx, body: LearningItemCreate, userId: string): Promise<LearningItem> {
  const r = await tx.query(
    `insert into learning_items(kind, title, description, world_slug, pass_mark, max_attempts, estimated_minutes, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning id`,
    [
      body.kind,
      body.title,
      cleanDescription(body.description),
      body.worldSlug ?? null,
      body.passMark ?? null,
      body.maxAttempts ?? null,
      body.estimatedMinutes ?? null,
      userId,
    ],
  );
  return (await getItem(tx, r.rows[0].id as string))!;
}
const PATCH_COLUMNS: Record<keyof LearningItemPatch, string> = {
  title: 'title',
  description: 'description',
  worldSlug: 'world_slug',
  passMark: 'pass_mark',
  maxAttempts: 'max_attempts',
  estimatedMinutes: 'estimated_minutes',
};
export async function patchItem(
  tx: Tx,
  id: string,
  body: LearningItemPatch,
  userId: string,
): Promise<LearningItem> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  for (const [k, col] of Object.entries(PATCH_COLUMNS) as [keyof LearningItemPatch, string][])
    if (body[k] !== undefined) {
      params.push(k === 'description' ? cleanDescription(body.description) : body[k]);
      sets.push(`${col} = $${params.length}`);
    }
  params.push(userId);
  await tx.query(
    `update learning_items set ${[...sets, `updated_by = $${params.length}`, 'updated_at = now()'].join(', ')} where id=$1 and deleted_at is null`,
    params,
  );
  return (await getItem(tx, id))!;
}

const refKey = (s: string | null | undefined) => s ?? '';

/** Only published documents may be referenced, and a stepKey must exist in the document. */
export async function validateReferences(
  q: Q,
  refs: { documentId: string; stepKey?: string | null }[],
): Promise<void> {
  const unique = new Map<string, { documentId: string; stepKey?: string | null }>(
    refs.map((r) => [r.documentId + '#' + refKey(r.stepKey), r] as const),
  );
  for (const ref of unique.values()) {
    const doc = await getDocument(q, ref.documentId);
    if (!doc || !['published', 'partial'].includes(doc.status))
      throw httpError(400, 'DOCUMENT_NOT_PUBLISHED', 'ניתן לקשר רק מסמכים שפורסמו', {
        documentId: ref.documentId,
      });
    if (ref.stepKey && !doc.phases.some((ph) => ph.steps.some((s) => s.key === ref.stepKey)))
      throw httpError(400, 'UNKNOWN_STEP', 'השלב אינו קיים במסמך', {
        documentId: ref.documentId,
        stepKey: ref.stepKey,
      });
  }
}

export async function replaceEntries(
  tx: Tx,
  id: string,
  entries: BriefingEntry[],
  userId: string,
): Promise<LearningItem> {
  await validateReferences(tx, entries);
  await tx.query('delete from briefing_entries where item_id=$1', [id]);
  for (const [i, e] of entries.entries())
    await tx.query(
      'insert into briefing_entries(item_id, position, document_id, step_key, note) values ($1,$2,$3,$4,$5)',
      [id, i, e.documentId, e.stepKey ?? null, e.note ?? ''],
    );
  await tx.query('update learning_items set updated_by=$2, updated_at=now() where id=$1', [id, userId]);
  return (await getItem(tx, id))!;
}
export async function replaceQuestions(
  tx: Tx,
  id: string,
  questions: QuizQuestion[],
  userId: string,
): Promise<LearningItem> {
  await validateReferences(tx, questions);
  for (const qn of questions) {
    /**
     * Recorded deviation (web review): `free` stays in `QuestionKindSchema` but no surface
     * implements it. `scoring.ts` has no grader for free text, the player has no control for it
     * and the generator never emits it, so a saved `free` question would be a quiz item no
     * learner can answer and no attempt can pass. Refused here rather than dropped silently, and
     * refused at save rather than at publish, so the editor hears about it while they are
     * looking at the question. The schema keeps the value for the wave that grades it.
     */
    if (qn.kind === 'free')
      throw httpError(400, 'UNSUPPORTED_KIND', 'שאלה פתוחה אינה נתמכת עדיין', {
        kind: 'free',
        stem: qn.stem,
      });
    if (qn.kind === 'single' && qn.options.filter((o) => o.correct).length !== 1)
      throw httpError(400, 'INVALID_QUIZ', 'בשאלה עם תשובה אחת חייבת להיות בדיוק תשובה נכונה אחת', {
        reason: 'single',
        stem: qn.stem,
      });
    if (qn.kind === 'multi' && !qn.options.some((o) => o.correct))
      throw httpError(400, 'INVALID_QUIZ', 'בשאלה מרובת תשובות חייבת להיות לפחות תשובה נכונה אחת', {
        reason: 'multi',
        stem: qn.stem,
      });
    if (qn.kind === 'order' && (qn.options.length < 2 || !qn.options.every((o) => o.correct)))
      throw httpError(400, 'INVALID_QUIZ', 'בשאלת סדר כל האפשרויות מסומנות כנכונות, לפי הסדר', {
        reason: 'order',
        stem: qn.stem,
      });
  }
  /**
   * A-I2: an incoming `id` is preserved.
   *
   * This used to `delete from quiz_questions where item_id=$1` and re-insert, minting a new uuid
   * for every question on every save. Those uuids are the keys of `learning_attempts.answers`,
   * and both the dashboard's failed-question tile (`join quiz_questions qq on qq.id::text =
   * ans.key`) and `heuristics.failedQuestions` join on them — so an editor fixing one typo
   * silently dropped the entire attempt history of the quiz. The tile and the heuristic went
   * quiet rather than wrong, which is the harder failure to notice.
   *
   * A question the caller did not send is gone; one it sent with an id it already owns is
   * updated in place; one with no id, or an id this item does not own, is inserted fresh. There
   * is no unique index on `(item_id, position)`, so the positions can be rewritten row by row.
   */
  const keep = questions.map((q) => q.id).filter((x): x is string => !!x);
  await tx.query(`delete from quiz_questions where item_id=$1 and not (id = any($2::uuid[]))`, [id, keep]);
  for (const [i, qn] of questions.entries()) {
    const values = [
      qn.documentId,
      qn.stepKey ?? null,
      qn.stem,
      qn.kind,
      JSON.stringify(qn.options),
      qn.explanation ?? '',
      !!qn.generated,
      qn.modelConf ?? null,
    ];
    if (qn.id) {
      const updated = await tx.query(
        `update quiz_questions set position=$3, document_id=$4, step_key=$5, stem=$6, kind=$7,
                options=$8, explanation=$9, generated=$10, model_conf=$11
          where id=$2 and item_id=$1`,
        [id, qn.id, i, ...values],
      );
      if (updated.rowCount) continue;
    }
    await tx.query(
      'insert into quiz_questions(item_id, position, document_id, step_key, stem, kind, options, explanation, generated, model_conf) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, i, ...values],
    );
  }
  await tx.query('update learning_items set updated_by=$2, updated_at=now() where id=$1', [id, userId]);
  return (await getItem(tx, id))!;
}

/* ── publish ───────────────────────────────────────────────────────────── */
export async function publishItem(
  tx: Tx,
  id: string,
  label: string,
  userId: string,
): Promise<{ item: LearningItem; version: number }> {
  const cur = await tx.query(
    'select status, kind from learning_items where id=$1 and deleted_at is null for update',
    [id],
  );
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'פריט הלמידה לא נמצא');
  if (cur.rows[0].status === 'archived')
    throw httpError(409, 'ITEM_ARCHIVED', 'פריט בארכיון אינו ניתן לפרסום');
  const live = (await getItem(tx, id))!;
  if (live.kind === 'briefing' && live.entries.length === 0)
    throw httpError(400, 'EMPTY_BRIEFING', 'תדריך חייב לכלול לפחות פריט ידע אחד');
  if (live.kind === 'quiz' && live.questions.length === 0)
    throw httpError(400, 'INVALID_QUIZ', 'בוחן חייב לכלול לפחות שאלה אחת', { reason: 'empty' });
  const refs = [...live.entries, ...live.questions].map((r) => r.documentId);
  await validateReferences(tx, [...live.entries, ...live.questions]);
  const settings = await getWorkflowSettings(tx);
  const passMark = live.kind === 'quiz' ? (live.passMark ?? settings.learning.defaultPassMark) : null;
  const versions = await tx.query('select id, current_version from documents where id = any($1)', [
    [...new Set(refs)],
  ]);
  const sourceVersions: SourceVersion[] = versions.rows.map((r) => ({
    documentId: r.id as string,
    version: r.current_version as number,
  }));
  const version = live.currentVersion + 1;
  const snapshotItem: LearningItem = {
    ...live,
    status: 'published',
    currentVersion: version,
    passMark,
    sourceVersions,
  };
  await tx.query(
    'insert into learning_item_versions(item_id, version, snapshot, author_id, label) values ($1,$2,$3,$4,$5)',
    [id, version, JSON.stringify({ item: snapshotItem, sourceVersions }), userId, label],
  );
  await tx.query(
    `update learning_items set status='published', current_version=$2, pass_mark=$3, published_at=now(), updated_by=$4, updated_at=now() where id=$1`,
    [id, version, passMark, userId],
  );
  return { item: (await getItem(tx, id))!, version };
}
export async function archiveItem(tx: Tx, id: string, userId: string): Promise<void> {
  await tx.query(
    `update learning_items set status='archived', updated_by=$2, updated_at=now() where id=$1 and deleted_at is null`,
    [id, userId],
  );
}
export async function softDeleteItem(tx: Tx, id: string, userId: string): Promise<void> {
  await tx.query(`update learning_items set deleted_at=now(), updated_by=$2 where id=$1`, [id, userId]);
}

/* ── snapshots (what learners see) ─────────────────────────────────────── */
export async function getVersionSnapshot(
  q: Q,
  id: string,
  version: number,
): Promise<{ item: LearningItem; sourceVersions: SourceVersion[] } | null> {
  const r = await q.query('select snapshot from learning_item_versions where item_id=$1 and version=$2', [
    id,
    version,
  ]);
  return r.rowCount ? (r.rows[0].snapshot as { item: LearningItem; sourceVersions: SourceVersion[] }) : null;
}
export async function getPublishedItem(
  q: Q,
  id: string,
): Promise<{ item: LearningItem; version: number; sourceVersions: SourceVersion[] } | null> {
  const r = await q.query(
    `select version, snapshot from learning_item_versions where item_id=$1 order by version desc limit 1`,
    [id],
  );
  if (!r.rowCount) return null;
  const s = r.rows[0].snapshot as { item: LearningItem; sourceVersions: SourceVersion[] };
  return { item: s.item, version: r.rows[0].version as number, sourceVersions: s.sourceVersions ?? [] };
}
export const itemSourceVersions = async (q: Q, id: string, version: number): Promise<SourceVersion[]> =>
  (await getVersionSnapshot(q, id, version))?.sourceVersions ?? [];
export async function listVersions(q: Q, id: string) {
  const r = await q.query(
    `select v.version, v.label, coalesce(u.display_name,'מערכת') author_name, v.created_at, v.snapshot->'sourceVersions' sv
     from learning_item_versions v left join users u on u.id=v.author_id where v.item_id=$1 order by v.version desc`,
    [id],
  );
  return r.rows.map((x) => ({
    version: x.version as number,
    label: x.label as string,
    authorName: x.author_name as string,
    createdAt: iso(x.created_at as Date)!,
    sourceVersions: (x.sv as SourceVersion[]) ?? [],
  }));
}
export async function listItemsReferencing(q: Q, documentId: string) {
  const r = await q.query(
    `select distinct li.id item_id, li.kind, li.status, li.current_version from learning_items li
     join (select item_id, document_id from briefing_entries union select item_id, document_id from quiz_questions) ref on ref.item_id = li.id
     where ref.document_id=$1 and li.deleted_at is null`,
    [documentId],
  );
  return r.rows.map((x) => ({
    itemId: x.item_id as string,
    kind: x.kind as 'briefing' | 'quiz',
    status: x.status as string,
    currentVersion: x.current_version as number,
  }));
}

/** Entry + the referenced document's title and phases (agent view, preview and V2's player). */
export async function documentSnapshotFor(q: Q, entries: BriefingEntry[]) {
  const out = [];
  for (const e of entries) {
    const doc = await getDocument(q, e.documentId);
    out.push({
      ...e,
      documentTitle: doc?.title ?? '—',
      phases: doc?.phases ?? [],
      changedSinceAssigned: false,
    });
  }
  return out;
}
