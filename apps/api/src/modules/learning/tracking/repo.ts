import type {
  Assignment,
  AttemptResult,
  Audience,
  AudienceCreate,
  CompletionResponse,
  DocumentLearning,
  LearningDashboard,
  LearningItemCard,
  MyLearningResponse,
  PlayerItem,
  StartAttemptResponse,
  WorkflowSettings,
} from '@wecom/shared';
import { makeEvent } from '@wecom/shared';
import { httpError, notFound } from '../../../lib/http.js';
import type { Queryable, Tx } from '../../../lib/sql.js';
import { iso } from '../../documents/repo.js';
import {
  assignmentStats,
  documentSnapshotFor,
  getItem,
  getPublishedItem,
  itemQuestions,
  itemSourceVersions,
  needsUpdate,
  type PublishedItem,
} from './itemsPort.js';
import { createAssignments, resolveAudience, type TrackingDeps } from './audiences.js';
import { gradeAttempt, type AnswerInput } from './scoring.js';

/* ── row mapping ──────────────────────────────────────────────────────────── */
const ASSIGNMENT_SELECT = `
  select a.*, i.kind, i.title, i.world_slug, i.estimated_minutes, i.pass_mark, i.max_attempts,
         (select count(*)::int from learning_attempts t where t.assignment_id=a.id and t.finished_at is not null) attempts_used,
         (select t.score from learning_attempts t where t.assignment_id=a.id and t.finished_at is not null order by t.attempt_no desc limit 1) last_score
    from learning_assignments a join learning_items i on i.id=a.item_id`;

const toAssignment = (r: Record<string, unknown>): Assignment => ({
  id: r.id as string,
  itemId: r.item_id as string,
  itemVersion: r.item_version as number,
  kind: r.kind as Assignment['kind'],
  title: r.title as string,
  worldSlug: (r.world_slug as string | null) ?? null,
  estimatedMinutes: (r.estimated_minutes as number | null) ?? null,
  reason: r.reason as Assignment['reason'],
  status: r.status as Assignment['status'],
  assignedAt: iso(r.assigned_at as Date)!,
  dueAt: iso(r.due_at as Date)!,
  completedAt: iso(r.completed_at as Date | null),
  attemptsUsed: (r.attempts_used as number) ?? 0,
  maxAttempts: (r.max_attempts as number | null) ?? null,
  lastScore: (r.last_score as number | null) ?? null,
  passMark: (r.pass_mark as number | null) ?? null,
  refreshReason: (r.refresh_reason as string | null) ?? null,
});

/* ── audiences ────────────────────────────────────────────────────────────── */
export async function createAudience(
  tx: Tx,
  deps: Pick<TrackingDeps, 'notifier' | 'events'>,
  itemId: string,
  body: AudienceCreate,
  actorId: string,
): Promise<Audience> {
  const pub = await getPublishedItem(tx, itemId);
  if (!pub) throw notFound('פריט הלמידה');
  const r = await tx.query(
    `insert into learning_audiences(item_id, role_names, world_slugs, user_ids, due_days, created_by)
     values ($1,$2,$3,$4,$5,$6) returning *`,
    [itemId, body.roleNames, body.worldSlugs, body.userIds, body.dueDays, actorId],
  );
  const a = r.rows[0];
  const users = await resolveAudience(tx, body);
  await createAssignments(tx, deps, {
    item: pub.item,
    userIds: users,
    reason: 'audience',
    dueDays: body.dueDays,
    audienceId: a.id as string,
    actorId,
  });
  return {
    id: a.id as string,
    itemId,
    roleNames: a.role_names as string[],
    worldSlugs: a.world_slugs as string[],
    userIds: a.user_ids as string[],
    dueDays: a.due_days as number,
    resolvedUsers: users.length,
    createdAt: iso(a.created_at as Date)!,
  };
}

export async function deleteAudience(tx: Tx, id: string): Promise<boolean> {
  const r = await tx.query(`delete from learning_audiences where id=$1`, [id]);
  return (r.rowCount ?? 0) > 0;
}

/* ── the agent's own view ─────────────────────────────────────────────────── */
export async function myLearning(q: Queryable, userId: string): Promise<MyLearningResponse> {
  const r = await q.query(
    `${ASSIGNMENT_SELECT} where a.user_id=$1 order by a.due_at asc, a.assigned_at desc`,
    [userId],
  );
  const all = r.rows.map(toAssignment);
  return {
    open: all.filter((a) => a.status === 'open'),
    overdue: all.filter((a) => a.status === 'overdue'),
    completed: all.filter((a) => a.status === 'completed'),
    invalidated: all.filter((a) => a.status === 'invalidated'),
  };
}

export async function getOwnAssignment(
  q: Queryable,
  assignmentId: string,
  userId: string,
): Promise<Assignment | null> {
  const r = await q.query(`${ASSIGNMENT_SELECT} where a.id=$1 and a.user_id=$2`, [assignmentId, userId]);
  return r.rowCount ? toAssignment(r.rows[0]) : null;
}

/** Player payload: entries carry the *pinned* document version's phases; questions lose `correct`. */
export async function playerItem(
  q: Queryable,
  assignmentId: string,
  userId: string,
): Promise<PlayerItem | null> {
  const assignment = await getOwnAssignment(q, assignmentId, userId);
  if (!assignment) return null;
  const item = await getItem(q, assignment.itemId);
  if (!item) return null;
  const pins = new Map(
    (await itemSourceVersions(q, item.id, assignment.itemVersion)).map((p) => [p.documentId, p.version]),
  );
  const entries = [];
  for (const e of await documentSnapshotFor(q, item.id, assignment.itemVersion)) {
    const changed = await q.query(
      `select 1 from document_change_flags f
        where f.document_id=$1 and f.significant and f.version > $2 and f.created_at >= $3 limit 1`,
      [e.documentId, pins.get(e.documentId) ?? 0, assignment.assignedAt],
    );
    entries.push({ ...e, changedSinceAssigned: (changed.rowCount ?? 0) > 0 });
  }
  const questions = (await itemQuestions(q, item.id)).map((qq) => ({
    id: qq.id,
    documentId: qq.documentId,
    stepKey: qq.stepKey,
    stem: qq.stem,
    kind: qq.kind,
    explanation: '',
    options: qq.options.map((o) => ({ id: o.id, text: o.text })),
  }));
  return {
    assignment,
    item: {
      id: item.id,
      kind: item.kind,
      title: item.title,
      description: item.description,
      worldSlug: item.worldSlug,
      currentVersion: item.currentVersion,
      passMark: item.passMark,
      maxAttempts: item.maxAttempts,
      estimatedMinutes: item.estimatedMinutes,
    },
    entries,
    questions,
  };
}

/* ── completion actions ───────────────────────────────────────────────────── */
const lockOpen = async (tx: Tx, assignmentId: string, userId: string) => {
  const r = await tx.query(`${ASSIGNMENT_SELECT} where a.id=$1 and a.user_id=$2 for update of a`, [
    assignmentId,
    userId,
  ]);
  if (!r.rowCount) throw notFound('המשימה');
  const a = toAssignment(r.rows[0]);
  if (a.status === 'completed' || a.status === 'invalidated')
    throw httpError(409, 'ASSIGNMENT_CLOSED', 'המשימה כבר נסגרה');
  return a;
};

const complete = async (
  tx: Tx,
  deps: Pick<TrackingDeps, 'events'>,
  a: Assignment,
  userId: string,
  passed: boolean,
) => {
  await tx.query(`update learning_assignments set status='completed', completed_at=now() where id=$1`, [
    a.id,
  ]);
  await deps.events.publish(
    tx,
    makeEvent('learning.completed', { assignmentId: a.id, userId, itemId: a.itemId, passed }),
  );
};

export async function acknowledge(
  tx: Tx,
  deps: Pick<TrackingDeps, 'events'>,
  assignmentId: string,
  userId: string,
): Promise<Assignment> {
  const a = await lockOpen(tx, assignmentId, userId);
  if (a.kind !== 'briefing') throw httpError(409, 'NOT_A_BRIEFING', 'אישור קריאה חל על תדריכים בלבד');
  await tx.query(
    `insert into learning_acknowledgements(assignment_id, item_version) values ($1,$2)
       on conflict (assignment_id) do nothing`,
    [a.id, a.itemVersion],
  );
  await complete(tx, deps, a, userId, true);
  return (await getOwnAssignment(tx, assignmentId, userId))!;
}

const effectiveMax = (a: Assignment, s: WorkflowSettings) =>
  a.maxAttempts ?? s.learning.defaultMaxAttempts ?? null;
const effectivePass = (a: Assignment, s: WorkflowSettings) => a.passMark ?? s.learning.defaultPassMark;

export async function startAttempt(
  tx: Tx,
  assignmentId: string,
  userId: string,
  settings: WorkflowSettings,
): Promise<StartAttemptResponse> {
  const a = await lockOpen(tx, assignmentId, userId);
  if (a.kind !== 'quiz') throw httpError(409, 'NOT_A_QUIZ', 'ניסיונות חלים על שאלונים בלבד');
  const max = effectiveMax(a, settings);
  if (max != null && a.attemptsUsed >= max)
    throw httpError(409, 'ATTEMPTS_EXHAUSTED', 'מספר הניסיונות מוצה', { maxAttempts: max });
  // An unfinished attempt is resumed, not duplicated.
  const open = await tx.query(
    `select id, attempt_no from learning_attempts where assignment_id=$1 and finished_at is null
      order by attempt_no desc limit 1`,
    [a.id],
  );
  if (open.rowCount)
    return { attemptId: open.rows[0].id as string, attemptNo: open.rows[0].attempt_no as number };
  const next = (
    await tx.query(`select coalesce(max(attempt_no),0)+1 n from learning_attempts where assignment_id=$1`, [
      a.id,
    ])
  ).rows[0].n as number;
  const r = await tx.query(`insert into learning_attempts(assignment_id, attempt_no) values ($1,$2) returning id`, [
    a.id,
    next,
  ]);
  return { attemptId: r.rows[0].id as string, attemptNo: next };
}

export async function submitAttempt(
  tx: Tx,
  deps: Pick<TrackingDeps, 'events'>,
  attemptId: string,
  userId: string,
  answers: AnswerInput[],
  settings: WorkflowSettings,
): Promise<AttemptResult> {
  const t = await tx.query(
    `select t.id, t.assignment_id, t.finished_at from learning_attempts t
       join learning_assignments a on a.id=t.assignment_id
      where t.id=$1 and a.user_id=$2 for update of t`,
    [attemptId, userId],
  );
  if (!t.rowCount) throw notFound('הניסיון');
  if (t.rows[0].finished_at) throw httpError(409, 'ATTEMPT_FINISHED', 'הניסיון כבר הוגש');
  const a = await lockOpen(tx, t.rows[0].assignment_id as string, userId);
  const questions = await itemQuestions(tx, a.itemId);
  const graded = gradeAttempt(questions, answers, effectivePass(a, settings));
  // Pinned storage shape (V3's failed-question heuristic reads it): { [questionId]: { selected, correct } }.
  const stored: Record<string, { selected: string[] | string | null; correct: boolean }> = {};
  for (const p of graded.perQuestion) {
    const given = answers.find((x) => x.questionId === p.questionId);
    stored[p.questionId] = {
      selected: given?.text ?? (given?.optionIds?.length ? given.optionIds : null),
      correct: p.correct,
    };
  }
  await tx.query(
    `update learning_attempts set finished_at=now(), score=$2, passed=$3, answers=$4::jsonb where id=$1`,
    [attemptId, graded.score, graded.passed, JSON.stringify(stored)],
  );
  if (graded.passed) await complete(tx, deps, a, userId, true);
  const max = effectiveMax(a, settings);
  return {
    attemptId,
    score: graded.score,
    passed: graded.passed,
    attemptsLeft: max == null ? null : Math.max(0, max - (a.attemptsUsed + 1)),
    perQuestion: graded.perQuestion,
  };
}

/* ── manager views (world-scoped) ─────────────────────────────────────────── */
/** A user is "in scope" for a manager when unscoped, or when one of their role scopes is null or overlaps. */
const userScopeTerm = (params: unknown[], scopes: readonly string[] | null, alias = 'a'): string => {
  if (!scopes) return '';
  params.push([...scopes]);
  return ` and exists (select 1 from user_roles ur where ur.user_id=${alias}.user_id and (ur.world_scope is null or ur.world_scope && $${params.length}::text[]))`;
};

/** One round trip for the display name and the world scopes of every row's user. */
const userFacts = async (q: Queryable, userIds: string[]) => {
  const out = new Map<string, { name: string; worlds: string[] }>();
  if (!userIds.length) return out;
  const r = await q.query(
    `select u.id, u.display_name, coalesce(array_agg(distinct s) filter (where s is not null), '{}') worlds
       from users u
       left join user_roles ur on ur.user_id=u.id
       left join unnest(ur.world_scope) s on true
      where u.id = any($1::uuid[]) group by u.id, u.display_name`,
    [userIds],
  );
  for (const x of r.rows)
    out.set(x.id as string, { name: x.display_name as string, worlds: (x.worlds as string[]) ?? [] });
  return out;
};

const itemCard = async (q: Queryable, item: PublishedItem): Promise<LearningItemCard> => {
  const c = await q.query(
    `select (select count(*)::int from briefing_entries e where e.item_id=$1) entries,
            (select count(*)::int from quiz_questions qq where qq.item_id=$1) questions,
            (select updated_at from learning_items where id=$1) updated_at,
            (select published_at from learning_items where id=$1) published_at`,
    [item.id],
  );
  const x = c.rows[0];
  const stats = (await assignmentStats(q, [item.id])).get(item.id)!;
  const nu = (await needsUpdate(q, [item.id])).get(item.id) ?? false;
  return {
    id: item.id,
    kind: item.kind,
    title: item.title,
    description: item.description,
    worldSlug: item.worldSlug,
    status: item.status,
    currentVersion: item.currentVersion,
    estimatedMinutes: item.estimatedMinutes,
    needsUpdate: nu,
    updatedAt: iso(x.updated_at as Date)!,
    publishedAt: iso(x.published_at as Date | null),
    entryCount: x.entries as number,
    questionCount: x.questions as number,
    assignedUsers: stats.assignedUsers,
    completionRate: stats.completionRate,
  };
};

export async function completionFor(
  q: Queryable,
  itemId: string,
  scopes: readonly string[] | null,
): Promise<CompletionResponse> {
  const item = await getItem(q, itemId);
  if (!item) throw notFound('פריט הלמידה');
  const params: unknown[] = [itemId];
  const rows = await q.query(
    `${ASSIGNMENT_SELECT}
       join users u on u.id=a.user_id
      where a.item_id=$1 and a.item_version=i.current_version${userScopeTerm(params, scopes)}
      order by u.display_name`,
    params,
  );
  const facts = await userFacts(q, [...new Set(rows.rows.map((r) => r.user_id as string))]);
  const out = rows.rows.map((r) => {
    const a = toAssignment(r);
    const n = facts.get(r.user_id as string) ?? { name: '', worlds: [] };
    return {
      userId: r.user_id as string,
      displayName: n.name,
      worldSlugs: n.worlds,
      status: a.status,
      dueAt: a.dueAt,
      completedAt: a.completedAt,
      score: a.lastScore,
      attempts: a.attemptsUsed,
    };
  });
  const byWorld = new Map<string, { assigned: number; completed: number; overdue: number }>();
  for (const r of out)
    for (const w of r.worldSlugs.length ? r.worldSlugs : ['—']) {
      const b = byWorld.get(w) ?? { assigned: 0, completed: 0, overdue: 0 };
      b.assigned++;
      if (r.status === 'completed') b.completed++;
      if (r.status === 'overdue') b.overdue++;
      byWorld.set(w, b);
    }
  return {
    item: await itemCard(q, item),
    rows: out,
    byWorld: [...byWorld].map(([worldSlug, b]) => ({ worldSlug, ...b })),
  };
}

export async function dashboard(
  q: Queryable,
  world: string | undefined,
  scopes: readonly string[] | null,
): Promise<LearningDashboard> {
  const params: unknown[] = [];
  let worldTerm = '';
  if (world) {
    params.push(world);
    worldTerm = ` and i.world_slug = $${params.length}`;
  }
  const scopeTerm = userScopeTerm(params, scopes);
  const base = `from learning_assignments a join learning_items i on i.id=a.item_id
      where a.item_version=i.current_version${worldTerm}${scopeTerm}`;
  const totals = (
    await q.query(
      `select (select count(*)::int from learning_items i
                where i.status='published' and i.deleted_at is null${worldTerm}) items,
              count(*)::int assigned,
              count(*) filter (where a.status='completed')::int completed,
              count(*) filter (where a.status='overdue')::int overdue,
              count(*) filter (where a.reason='refresh' and a.status in ('open','overdue'))::int refresh_pending
         ${base}`,
      params,
    )
  ).rows[0];
  const byWorld = (
    await q.query(
      `select coalesce(i.world_slug,'—') world_slug, count(*)::int assigned,
              count(*) filter (where a.status='completed')::int completed,
              count(*) filter (where a.status='overdue')::int overdue
         ${base} group by 1 order by 1`,
      params,
    )
  ).rows.map((r) => ({
    worldSlug: r.world_slug as string,
    assigned: r.assigned as number,
    completed: r.completed as number,
    overdue: r.overdue as number,
    rate: (r.assigned as number) ? (r.completed as number) / (r.assigned as number) : 0,
  }));
  const failed = (
    await q.query(
      `select ans.key question_id, i.id item_id, i.title item_title, qq.stem,
              count(*)::int attempts,
              count(*) filter (where (ans.value->>'correct')::boolean = false)::int failed
         from learning_attempts t
         join learning_assignments a on a.id=t.assignment_id
         join learning_items i on i.id=a.item_id
         cross join lateral jsonb_each(t.answers) ans
         join quiz_questions qq on qq.id::text = ans.key
        where t.finished_at is not null${worldTerm}${scopeTerm}
        group by 1,2,3,4 having count(*) >= 3
        order by (count(*) filter (where (ans.value->>'correct')::boolean = false))::float / count(*) desc
        limit 10`,
      params,
    )
  ).rows.map((r) => ({
    questionId: r.question_id as string,
    itemId: r.item_id as string,
    itemTitle: r.item_title as string,
    stem: r.stem as string,
    failRate: (r.failed as number) / (r.attempts as number),
    attempts: r.attempts as number,
  }));
  const recent = (
    await q.query(
      `select a.user_id, u.display_name, i.title item_title, a.completed_at,
              (select t.passed from learning_attempts t
                where t.assignment_id=a.id and t.finished_at is not null order by t.attempt_no desc limit 1) passed
         from learning_assignments a
         join learning_items i on i.id=a.item_id
         join users u on u.id=a.user_id
        where a.item_version=i.current_version and a.status='completed'${worldTerm}${scopeTerm}
        order by a.completed_at desc limit 20`,
      params,
    )
  ).rows;
  return {
    generatedAt: new Date().toISOString(),
    totals: {
      items: totals.items as number,
      assigned: totals.assigned as number,
      completed: totals.completed as number,
      overdue: totals.overdue as number,
      refreshPending: totals.refresh_pending as number,
    },
    byWorld,
    failedQuestions: failed,
    recentCompletions: recent.map((r) => ({
      userId: r.user_id as string,
      displayName: r.display_name as string,
      itemTitle: r.item_title as string,
      completedAt: iso(r.completed_at as Date)!,
      passed: (r.passed as boolean | null) ?? null,
    })),
  };
}

export async function documentLearning(
  q: Queryable,
  documentId: string,
  userId: string,
): Promise<DocumentLearning> {
  const items = await q.query(
    `select distinct i.id from learning_items i
       join learning_item_versions v on v.item_id=i.id and v.version=i.current_version
       cross join lateral jsonb_array_elements(coalesce(v.snapshot->'sourceVersions','[]'::jsonb)) p
      where i.deleted_at is null and i.status='published' and p->>'documentId'=$1
      order by i.id`,
    [documentId],
  );
  const cards: LearningItemCard[] = [];
  for (const r of items.rows) {
    const item = await getItem(q, r.id as string);
    if (item) cards.push(await itemCard(q, item));
  }
  cards.sort((a, b) => a.title.localeCompare(b.title, 'he'));
  const refresh = await q.query(
    `select a.id from learning_assignments a
      where a.user_id=$1 and a.reason='refresh' and a.status in ('open','overdue')
        and a.item_id = any($2::uuid[]) order by a.due_at asc limit 1`,
    [userId, items.rows.map((r) => r.id)],
  );
  const last = await q.query(
    `select version, created_at, reasons from document_change_flags
      where document_id=$1 and significant order by version desc limit 1`,
    [documentId],
  );
  return {
    items: cards,
    refreshRequired: (refresh.rowCount ?? 0) > 0,
    refreshAssignmentId: refresh.rowCount ? (refresh.rows[0].id as string) : null,
    lastSignificantChange: last.rowCount
      ? {
          version: last.rows[0].version as number,
          at: iso(last.rows[0].created_at as Date)!,
          reasons: (last.rows[0].reasons as string[]) ?? [],
        }
      : null,
  };
}

/** Idempotent: open assignments past due become overdue. Returns how many changed. */
export async function markOverdue(q: Queryable): Promise<number> {
  const r = await q.query(`update learning_assignments set status='overdue' where status='open' and due_at < now()`);
  return r.rowCount ?? 0;
}
