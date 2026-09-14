# V2 — Assignments & Tracking (api) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn published learning items into tracked work: audiences (roles × worlds) and manual assignments, the agent's own list and player payloads, briefing acknowledgement, quiz attempts with a pass mark and unlimited retakes, completion and dashboard data for managers, reminders, and the knowledge-refresh loop — a significant publish invalidates completions of every learning item that pins the old document version and hands the affected users a refresh assignment.

**Architecture:** One sub-module `apps/api/src/modules/learning/tracking/` (routes, repo, audiences, scoring, change detector, refresh, jobs) registered by one line in `modules/index.ts`. It reads learning items through its own SQL over the spec §3 tables (`itemsPort.ts`) so it compiles and tests with or without V1 merged; V6 may point the port at V1's repo functions later. The significant-change detector is a pure function over two `Document` values plus the diff engine's row classification; the publish route calls `applyChangeFlag` inside its transaction and returns `changeFlag`. Alerts go through the wave-4 `app.notifier` holder (kind `learning`); events and queues come from V0.

**Tech Stack:** Node 22, Fastify 5, fastify-type-provider-zod, pg 8, pg-boss 10, zod 3, `@wecom/shared` (`wave5.ts`, `diffDocuments`, `detectFieldRefs`, `stripFmt`, `Notifier`, events), vitest 2 + testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` §1.3–§1.5, §1.8, §3 (audiences, assignments, attempts, acknowledgements, change flags), §4 "Assignments", §5 reader/player/refresh, §7. Contract: `docs/api/CONTRACTS-wave5.md` (V2 rows). Canonical names: `docs/superpowers/plans/2026-09-15-V0-wave5-contracts.md`.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root as `pnpm --filter @wecom/api …`, or from `apps/api` with `pnpm vitest run <file>`; integration tests need `RUN_INTEGRATION=1` and Docker.
- Every request/response schema comes from `@wecom/shared` (`packages/shared/src/schemas/wave5.ts`). Route params are inline `z.object({ id: IdSchema })` like every module. Two **additive** schemas this lane appends to `wave5.ts` (Task 1): `AssignResultSchema`, `LearningDashboardQuerySchema`. V0 provides `StartAttemptResponseSchema { attemptId, attemptNo }`, makes `PlayerQuestionSchema.id` required and adds `DocumentLearningSchema.refreshAssignmentId: IdSchema.nullable()`; if any of the three is missing on your branch, append it to `wave5.ts` with exactly those names/shapes.
- Route permission declaration exactly `config: { requires: ['learning.manage'] }` / `['learning.read']` / `['docs.read'], scope: 'document'`. Permission strings only from `PERMISSIONS`.
- Event names only `learning.assigned`, `learning.completed`, `learning.refresh_required` (V0), built with `makeEvent` and published inside the writing transaction via `app.events.publish(tx, …)`.
- Queue names only `QUEUES.learningResolveAudiences`, `QUEUES.learningReminders`.
- Settings only through `getWorkflowSettings(q)` from `apps/api/src/lib/workflowSettings.ts` (V0): `learning.defaultPassMark`, `learning.defaultMaxAttempts` (null = unlimited), `learning.refreshDueDays`, `learning.reminderDaysBefore`.
- Migration for this lane: `apps/api/migrations/0040_learning_tracking.js` only. `item_id` columns are plain `uuid` (no FK) because `learning_items` is V1's table (0039) and may not exist in this worktree; V6 adds the FKs in 0042.
- Shared files this lane may touch, append-only: `apps/api/src/modules/index.ts` (one import + one list entry), `packages/shared/src/schemas/wave5.ts` (the additive schemas above, appended at the end).
- **Pinned cross-lane contracts (coordinator):** `learning_attempts.answers` is stored as a JSON object `{ [questionId]: { selected: string[] | string | null; correct: boolean } }` — V3's failed-question heuristic reads exactly that shape. `POST /learning/my/:assignmentId/attempts` answers **201** with `StartAttemptResponseSchema`. V1's exports consumed through `itemsPort.ts` are exactly: `getPublishedItem(q, id) → { item, version, sourceVersions } | null`, `itemSourceVersions(q, id, version)`, `listItemsReferencing(q, documentId) → { itemId, kind, status, currentVersion }[]`, `needsUpdateFor(q, itemIds) → Map<string, boolean>` (V1's invalid/archived half; V2 ORs in its significant-change half), `documentSnapshotFor(q, itemId, version) → entries with changedSinceAssigned: false` (V2 sets the flag); `learning_item_versions.snapshot` is `{ item, sourceVersions }`; V1's `assembleCard` leaves `assignedUsers`/`completionRate` as placeholders that V2's `assignmentStats(q, itemIds)` fills. One deliberate exception, Task 7: a nine-line hunk inside the publish handler of `apps/api/src/modules/documents/routes.ts`.
- **Never** edit `apps/api/src/app.ts`, `stage45.ts`, anything under `apps/web/`, or V1's `apps/api/src/modules/learning/{repo,routes,generate}.ts` (if present).
- Hebrew for user-facing strings, English for identifiers and logs.
- Commit after every task; end every commit message with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

```
apps/api/migrations/0040_learning_tracking.js                 audiences, assignments, attempts, acknowledgements, change flags
apps/api/src/modules/learning/tracking/itemsPort.ts           V1-shaped adapter over spec §3 tables: getPublishedItem, itemSourceVersions, listItemsReferencing, needsUpdateFor, documentSnapshotFor (local SQL until V6 points them at V1) + V2's own significantChangeSince, assignmentStats
apps/api/src/modules/learning/tracking/audiences.ts           resolveAudience, createAssignments, resolveAllAudiences
apps/api/src/modules/learning/tracking/scoring.ts             pure: gradeAttempt(questions, answers, passMark)
apps/api/src/modules/learning/tracking/changeDetector.ts      pure: detectSignificantChange(before, after, blocks, fieldNames)
apps/api/src/modules/learning/tracking/refresh.ts             applyChangeFlag(tx, deps, input) → ChangeFlag (flags, invalidation, refresh assignments, alerts, event)
apps/api/src/modules/learning/tracking/repo.ts                assignments/attempts/acks/completion/dashboard/documentLearning SQL
apps/api/src/modules/learning/tracking/routes.ts              the eleven V2 routes
apps/api/src/modules/learning/tracking/jobs.ts                startTrackingJobs: resolve audiences nightly, reminders daily
apps/api/src/modules/learning/tracking/index.ts               plugin: routes + jobs
apps/api/src/modules/documents/routes.ts                      (modify: publish handler → applyChangeFlag, changeFlag in response)
apps/api/src/modules/index.ts                                 (modify: + learningTracking)
packages/shared/src/schemas/wave5.ts                          (modify, append: AssignResultSchema, LearningDashboardQuerySchema)
apps/api/test/helpers/v2/learningStub.ts                      creates spec-§3 item tables when absent; seeds items
apps/api/test/unit/scoring.test.ts, unit/changeDetector.test.ts
apps/api/test/learning-tracking.test.ts                       integration
apps/api/test/migrations.test.ts                              (modify: +1 case)
```

## Decisions recorded for the controller

- **D1 — item tables in tests.** V1's migration 0039 creates `learning_items`, `learning_item_versions`, `briefing_entries`, `quiz_questions`. This lane's worktree may not have it, so `test/helpers/v2/learningStub.ts` creates those tables **only if `to_regclass('learning_items') is null`**, with exactly the spec §3 columns. `needsUpdate` is **computed on read**: V1's `needsUpdateFor` (invalid/archived references) OR-ed with V2's `significantChangeSince` (a significant flag newer than the pinned version); no column is written by V2.
- **D2 — `itemsPort.ts` mirrors V1's export names and shapes exactly** (pinned by the coordinator) but is implemented as local SQL over the §3 tables so V2 compiles and tests before V1 merges. V6 replaces the bodies with re-exports from V1's `apps/api/src/modules/learning/repo.ts`; callers never change.
- **D3 — refresh scope.** A significant publish of document D at version N affects every *published* learning item whose current version snapshot pins D at a version < N. Open and completed assignments of that item version are invalidated (`invalidated_reason`), and one refresh assignment per affected user is created for the item's current version with `reason='refresh'` and `refresh_reason`. `needsUpdate` for those items becomes true on read through `significantChangeSince` until the item's next publish re-pins the documents (V1 owns that publish).
- **D4 — attempts.** Unlimited unless `learning_items.max_attempts` (or, when null there, `settings.learning.defaultMaxAttempts`, which V0 defaults to null) is set. `attemptsLeft` on `AttemptResult` is `null` when unlimited; the start response carries only `{ attemptId, attemptNo }` (pinned). Answers are persisted as the pinned object shape keyed by question id. Starting an attempt when exhausted → 409 `ATTEMPTS_EXHAUSTED`; starting when the assignment is `completed`/`invalidated` → 409 `ASSIGNMENT_CLOSED`.
- **D5 — reminders dedupe** via a new column `learning_assignments.reminded_at` (one reminder per assignment while open, sent when `due_at <= now() + reminderDaysBefore days`; overdue marking is separate and idempotent).

---

### Task 1: Additive schemas + migration 0040

**Files:**
- Modify: `packages/shared/src/schemas/wave5.ts` (append), `packages/shared/test/wave5.test.ts` (append one case)
- Create: `apps/api/migrations/0040_learning_tracking.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: `IdSchema`, `paginated` from `./common.js` (already imported in `wave5.ts`).
- Produces: `AssignResultSchema { assigned: number; skipped: number }`, `LearningDashboardQuerySchema { world?: string }` + types `AssignResult`, `LearningDashboardQuery` (V0 owns `StartAttemptResponseSchema`, `PlayerQuestionSchema.id` required, `DocumentLearningSchema.refreshAssignmentId`); tables per spec §3 with the two additions `learning_assignments.reminded_at` and `learning_assignments.refresh_reason`.

- [ ] **Step 1: Write the failing tests**

Append to `packages/shared/test/wave5.test.ts`:
```ts
import { AssignResultSchema, StartAttemptResponseSchema, LearningDashboardQuerySchema, DocumentLearningSchema, PlayerQuestionSchema } from '../src/index.js';

describe('wave5 V2 additive schemas', () => {
  it('assign result, attempt start, dashboard query', () => {
    expect(AssignResultSchema.parse({ assigned: 2, skipped: 1 })).toEqual({ assigned: 2, skipped: 1 });
    expect(StartAttemptResponseSchema.parse({ attemptId: U, attemptNo: 1 })).toEqual({ attemptId: U, attemptNo: 1 });
    expect(PlayerQuestionSchema.shape.id.isOptional()).toBe(false);
    expect(DocumentLearningSchema.shape.refreshAssignmentId.isNullable()).toBe(true);
    expect(LearningDashboardQuerySchema.parse({}).world).toBeUndefined();
    expect(LearningDashboardQuerySchema.parse({ world: 'tech' }).world).toBe('tech');
  });
});
```
Append to `apps/api/test/migrations.test.ts` inside the integration describe:
```ts
  it('creates the wave 5 tracking tables (0040)', async () => {
    const r = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('learning_audiences','learning_assignments','learning_attempts','learning_acknowledgements','document_change_flags') order by 1",
    );
    expect(r.rows.map((x) => x.table_name)).toEqual([
      'document_change_flags', 'learning_acknowledgements', 'learning_assignments', 'learning_attempts', 'learning_audiences',
    ]);
    const cols = await pool.query(
      "select column_name from information_schema.columns where table_name='learning_assignments' and column_name in ('reminded_at','refresh_reason','item_version')",
    );
    expect(cols.rowCount).toBe(3);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- wave5` → FAIL (`AssignResultSchema` not exported). Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts` → FAIL (tables missing).

- [ ] **Step 3: Append the schemas**

At the end of `packages/shared/src/schemas/wave5.ts`:
```ts
/* ── V2 additive: assignment results, dashboard query ────────────────────── */
export const AssignResultSchema = z.object({
  assigned: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export type AssignResult = z.infer<typeof AssignResultSchema>;
export const LearningDashboardQuerySchema = z.object({ world: z.string().optional() });
export type LearningDashboardQuery = z.infer<typeof LearningDashboardQuerySchema>;
```

- [ ] **Step 4: Write the migration**

`apps/api/migrations/0040_learning_tracking.js`:
```js
/**
 * Wave 5 (V2): audiences, assignments, attempts, acknowledgements, document change flags.
 * Spec §3. `item_id` is a plain uuid: `learning_items` is V1's table (0039) and may land in a
 * different worktree; V6 adds the foreign keys in 0042 once both migrations are on main.
 */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });

exports.up = (pgm) => {
  pgm.createTable('learning_audiences', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true },
    role_names: { type: 'text[]', notNull: true, default: '{}' },
    world_slugs: { type: 'text[]', notNull: true, default: '{}' },
    user_ids: { type: 'uuid[]', notNull: true, default: '{}' },
    due_days: { type: 'integer', notNull: true, default: 14 },
    created_by: { type: 'uuid', references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('learning_audiences', 'item_id');

  pgm.createTable('learning_assignments', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true },
    item_version: { type: 'integer', notNull: true },
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    audience_id: { type: 'uuid', references: 'learning_audiences', onDelete: 'set null' },
    reason: { type: 'text', notNull: true, check: "reason in ('audience','manual','refresh')" },
    assigned_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    due_at: { type: 'timestamptz', notNull: true },
    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check: "status in ('open','completed','overdue','invalidated')",
    },
    completed_at: 'timestamptz',
    invalidated_at: 'timestamptz',
    invalidated_reason: 'text',
    refresh_reason: 'text',
    reminded_at: 'timestamptz',
  });
  pgm.addConstraint('learning_assignments', 'learning_assignments_unique', {
    unique: ['item_id', 'user_id', 'item_version', 'reason'],
  });
  pgm.createIndex('learning_assignments', ['user_id', 'status']);
  pgm.createIndex('learning_assignments', ['item_id', 'status']);
  pgm.createIndex('learning_assignments', 'due_at', { where: "status in ('open','overdue')" });

  pgm.createTable('learning_attempts', {
    id: id(pgm),
    assignment_id: { type: 'uuid', notNull: true, references: 'learning_assignments', onDelete: 'cascade' },
    attempt_no: { type: 'integer', notNull: true },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: 'timestamptz',
    score: 'integer',
    passed: 'boolean',
    answers: { type: 'jsonb', notNull: true, default: '{}' }, // { [questionId]: { selected, correct } } (pinned for V3)
  });
  pgm.addConstraint('learning_attempts', 'learning_attempts_unique', { unique: ['assignment_id', 'attempt_no'] });

  pgm.createTable('learning_acknowledgements', {
    id: id(pgm),
    assignment_id: { type: 'uuid', notNull: true, references: 'learning_assignments', onDelete: 'cascade', unique: true },
    acknowledged_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    item_version: { type: 'integer', notNull: true },
  });

  pgm.createTable('document_change_flags', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    significant: { type: 'boolean', notNull: true },
    reasons: { type: 'jsonb', notNull: true, default: '[]' },
    decided_by: { type: 'uuid', references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('document_change_flags', 'document_change_flags_unique', { unique: ['document_id', 'version'] });
  pgm.createIndex('document_change_flags', ['document_id', 'significant']);
};

exports.down = (pgm) => {
  for (const t of [
    'document_change_flags',
    'learning_acknowledgements',
    'learning_attempts',
    'learning_assignments',
    'learning_audiences',
  ])
    pgm.dropTable(t);
};
```

- [ ] **Step 5: Run** — `pnpm --filter @wecom/shared build && pnpm --filter @wecom/shared test` → PASS; `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts` → PASS (down-to-empty included).

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api/migrations/0040_learning_tracking.js apps/api/test/migrations.test.ts
git commit -m "feat(api,shared): wave 5 V2 — tracking tables (0040) and additive result schemas"
```

---

### Task 2: Items port and the test stub

**Files:**
- Create: `apps/api/src/modules/learning/tracking/itemsPort.ts`, `apps/api/test/helpers/v2/learningStub.ts`
- Test: `apps/api/test/learning-tracking.test.ts` (created here with the first case; later tasks append)

**Interfaces:**
- Produces:
```ts
export interface PublishedItem { id: string; kind: 'briefing'|'quiz'; title: string; description: string; worldSlug: string|null; currentVersion: number; passMark: number|null; maxAttempts: number|null; estimatedMinutes: number|null; status: 'draft'|'published'|'archived' }
export interface StoredQuestion { id: string; documentId: string; stepKey: string|null; stem: string; kind: 'single'|'multi'|'order'|'free'; options: { id: string; text: string; correct: boolean }[]; explanation: string }
export interface StoredEntry { id: string; documentId: string; stepKey: string|null; note: string; position: number }
// V1-shaped (names and shapes pinned; local SQL now, V6 re-exports V1's):
getItem(q, id): Promise<PublishedItem | null>                                                       // any status
getPublishedItem(q, id): Promise<{ item: PublishedItem; version: number; sourceVersions: SourceVersion[] } | null>   // status='published' only
itemSourceVersions(q, itemId, version): Promise<SourceVersion[]>                                    // snapshot.sourceVersions
listItemsReferencing(q, documentId): Promise<{ itemId: string; kind: 'briefing'|'quiz'; status: 'draft'|'published'|'archived'; currentVersion: number }[]>
needsUpdateFor(q, itemIds: string[]): Promise<Map<string, boolean>>                                 // V1's half: a referenced document is invalid/archived
documentSnapshotFor(q, itemId, version): Promise<{ id; documentId; stepKey; note; documentTitle; phases; changedSinceAssigned: false }[]>
itemQuestions(q, itemId): Promise<StoredQuestion[]>                                                 // ordered by position
// V2-owned (exported for V1's card assembly and V6):
significantChangeSince(q, itemIds: string[]): Promise<Map<string, boolean>>                         // a significant flag newer than the pinned version of any referenced document
assignmentStats(q, itemIds: string[]): Promise<Map<string, { assignedUsers: number; completionRate: number | null }>>
needsUpdate(q, itemIds): Promise<Map<string, boolean>>                                              // needsUpdateFor OR significantChangeSince
```
`SourceVersion` is `{ documentId: string; version: number }` from `@wecom/shared`.
- Stub: `ensureLearningTables(pool)` creates the four §3 tables if absent; `seedQuiz(pool, { documentId, title, worldSlug, passMark, maxAttempts, questions })` and `seedBriefing(pool, { documentIds, title, worldSlug })` insert a **published** item with version 1 and a snapshot `{ sourceVersions: [{documentId, version}] }` read from `documents.current_version`; both return the item id. The snapshot they write is `{ item: <LearningItem fields>, sourceVersions }` — the pinned shape.

- [ ] **Step 1: Write the failing test** — `apps/api/test/learning-tracking.test.ts` (skeleton + first case):
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';
import { ensureLearningTables, seedQuiz, seedBriefing } from './helpers/v2/learningStub.js';
import * as port from '../src/modules/learning/tracking/itemsPort.js';

const run = integration ? describe : describe.skip;

run('learning tracking', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let manager: Awaited<ReturnType<typeof makeUser>>;
  let agentA: Awaited<ReturnType<typeof makeUser>>;
  let agentB: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;
  let quizId: string;
  let briefingId: string;

  const createDoc = async (title = 'מסמך למידה') => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(manager),
        payload: { title, category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(manager), 'if-match': c.etag },
      payload: minimalStructure,
    });
    await app.inject({ method: 'POST', url: `/api/v1/documents/${c.id}/publish`, headers: auth(manager), payload: { label: 'v1' } });
    return c.id as string;
  };
  /** Gives a user the named system role scoped to worlds (null = all). */
  const grantRole = async (userId: string, role: string, worlds: string[] | null) => {
    await db.pool.query(
      `insert into user_roles(user_id, role_id, world_scope) select $1, id, $3 from roles where name=$2 on conflict do nothing`,
      [userId, role, worlds],
    );
  };

  beforeAll(async () => {
    db = await startTestDb();
    await ensureLearningTables(db.pool);
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    manager = await makeUser(db.pool, { name: 'מנהלת' });
    agentA = await makeUser(db.pool, { perms: ['docs.read', 'learning.read'], scopes: ['tech'], name: 'נציג א' });
    agentB = await makeUser(db.pool, { perms: ['docs.read', 'learning.read'], scopes: ['billing'], name: 'נציג ב' });
    await grantRole(agentA.id, 'agent', ['tech']);
    await grantRole(agentB.id, 'agent', ['billing']);
    docId = await createDoc();
    quizId = await seedQuiz(db.pool, {
      documentId: docId, title: 'חידון SIM', worldSlug: 'tech', passMark: 80, maxAttempts: null,
      questions: [
        { stem: 'מה עושים קודם?', kind: 'single', options: [{ id: 'a', text: 'מאפסים', correct: true }, { id: 'b', text: 'מנתקים', correct: false }], explanation: 'איפוס תחילה' },
        { stem: 'אילו שדות נבדקים?', kind: 'multi', options: [{ id: 'x', text: 'IMSI', correct: true }, { id: 'y', text: 'APN', correct: true }, { id: 'z', text: 'PUK', correct: false }], explanation: '' },
      ],
    });
    briefingId = await seedBriefing(db.pool, { documentIds: [docId], title: 'תדריך SIM', worldSlug: 'tech' });
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('port reads published items, their questions and pinned source versions', async () => {
    const got = await port.getPublishedItem(db.pool, quizId);
    expect(got?.item.kind).toBe('quiz');
    expect(got?.version).toBe(1);
    expect(got?.sourceVersions).toEqual([{ documentId: docId, version: 1 }]);
    const qs = await port.itemQuestions(db.pool, quizId);
    expect(qs).toHaveLength(2);
    expect(qs[0].options.find((o) => o.id === 'a')?.correct).toBe(true);
    const pins = await port.itemSourceVersions(db.pool, quizId, 1);
    expect(pins).toEqual([{ documentId: docId, version: 1 }]);
    expect(await port.listItemsReferencing(db.pool, docId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ itemId: quizId, kind: 'quiz', status: 'published', currentVersion: 1 }),
        expect.objectContaining({ itemId: briefingId, kind: 'briefing' }),
      ]),
    );
    expect(await port.needsUpdate(db.pool, [quizId])).toEqual(new Map([[quizId, false]]));
    expect((await port.documentSnapshotFor(db.pool, briefingId, 1))[0]).toMatchObject({ documentId: docId, changedSinceAssigned: false });
  });
});
```
(`db.stop`: check `apps/api/test/helpers/db.ts:5-35` for the `TestDb` shape — the field may be named `stop` or `close`; use the real name.)

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/learning-tracking.test.ts` → FAIL (module not found).

- [ ] **Step 3: Write the stub**

`apps/api/test/helpers/v2/learningStub.ts`:
```ts
import type pg from 'pg';

/**
 * V1's migration 0039 creates the learning item tables. This lane's worktree may predate it, so
 * tests create the spec-§3 shape when absent. Column names match the spec verbatim; V6 verifies
 * parity against 0039 when both are on main.
 */
export async function ensureLearningTables(pool: pg.Pool): Promise<void> {
  const r = await pool.query(`select to_regclass('learning_items') as t`);
  if (r.rows[0]?.t) return;
  await pool.query(`
    create table learning_items (
      id uuid primary key default gen_random_uuid(),
      kind text not null check (kind in ('briefing','quiz')),
      title text not null,
      description text not null default '',
      world_slug text,
      status text not null default 'draft' check (status in ('draft','published','archived')),
      current_version integer not null default 0,
      pass_mark integer,
      max_attempts integer,
      estimated_minutes integer,
      created_by uuid references users,
      updated_by uuid references users,
      published_at timestamptz,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now(),
      deleted_at timestamptz
    );
    create table learning_item_versions (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references learning_items on delete cascade,
      version integer not null,
      snapshot jsonb not null,
      author_id uuid references users,
      label text not null default '',
      created_at timestamptz not null default now(),
      unique (item_id, version)
    );
    create table briefing_entries (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references learning_items on delete cascade,
      position integer not null,
      document_id uuid not null references documents,
      step_key text,
      note text not null default ''
    );
    create table quiz_questions (
      id uuid primary key default gen_random_uuid(),
      item_id uuid not null references learning_items on delete cascade,
      position integer not null,
      document_id uuid not null references documents,
      step_key text,
      stem text not null,
      kind text not null check (kind in ('single','multi','order','free')),
      options jsonb not null default '[]',
      explanation text not null default '',
      generated boolean not null default false,
      model_conf numeric
    );
  `);
}

const pins = async (pool: pg.Pool, documentIds: string[]) => {
  const r = await pool.query(`select id, current_version from documents where id = any($1::uuid[])`, [documentIds]);
  return r.rows.map((x) => ({ documentId: x.id as string, version: x.current_version as number }));
};

export interface SeedQuestion {
  stem: string;
  kind: 'single' | 'multi' | 'order' | 'free';
  options: { id: string; text: string; correct: boolean }[];
  explanation?: string;
}

export async function seedQuiz(
  pool: pg.Pool,
  o: { documentId: string; title: string; worldSlug: string | null; passMark: number | null; maxAttempts: number | null; questions: SeedQuestion[] },
): Promise<string> {
  const r = await pool.query(
    `insert into learning_items(kind, title, world_slug, status, current_version, pass_mark, max_attempts, published_at)
     values ('quiz', $1, $2, 'published', 1, $3, $4, now()) returning id`,
    [o.title, o.worldSlug, o.passMark, o.maxAttempts],
  );
  const id = r.rows[0].id as string;
  let pos = 0;
  for (const q of o.questions)
    await pool.query(
      `insert into quiz_questions(item_id, position, document_id, stem, kind, options, explanation) values ($1,$2,$3,$4,$5,$6,$7)`,
      [id, pos++, o.documentId, q.stem, q.kind, JSON.stringify(q.options), q.explanation ?? ''],
    );
  await pool.query(`insert into learning_item_versions(item_id, version, snapshot, label) values ($1, 1, $2, 'v1')`, [
    id,
    JSON.stringify({ item: { id, kind: 'quiz', title: o.title, worldSlug: o.worldSlug, passMark: o.passMark, maxAttempts: o.maxAttempts }, sourceVersions: await pins(pool, [o.documentId]) }),
  ]);
  return id;
}

export async function seedBriefing(
  pool: pg.Pool,
  o: { documentIds: string[]; title: string; worldSlug: string | null },
): Promise<string> {
  const r = await pool.query(
    `insert into learning_items(kind, title, world_slug, status, current_version, published_at)
     values ('briefing', $1, $2, 'published', 1, now()) returning id`,
    [o.title, o.worldSlug],
  );
  const id = r.rows[0].id as string;
  let pos = 0;
  for (const d of o.documentIds)
    await pool.query(`insert into briefing_entries(item_id, position, document_id, note) values ($1,$2,$3,'')`, [id, pos++, d]);
  await pool.query(`insert into learning_item_versions(item_id, version, snapshot, label) values ($1, 1, $2, 'v1')`, [
    id,
    JSON.stringify({ item: { id, kind: 'briefing', title: o.title, worldSlug: o.worldSlug }, sourceVersions: await pins(pool, o.documentIds) }),
  ]);
  return id;
}
```

- [ ] **Step 4: Write the port**

`apps/api/src/modules/learning/tracking/itemsPort.ts`:
```ts
import type { Q } from '../../documents/repo.js';
import type { Tx } from '../../../lib/sql.js';

/**
 * V2's view of V1's tables (spec §3). Plain SQL rather than an import so this module compiles and
 * tests before V1 lands; V6 may swap these for V1's repo functions once both are on main.
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

export async function getItem(q: Q, id: string): Promise<PublishedItem | null> {
  const r = await q.query(`select * from learning_items where id=$1 and deleted_at is null`, [id]);
  return r.rowCount ? toItem(r.rows[0]) : null;
}
export async function getPublishedItem(
  q: Q,
  id: string,
): Promise<{ item: PublishedItem; version: number; sourceVersions: SourceVersion[] } | null> {
  const item = await getItem(q, id);
  if (!item || item.status !== 'published') return null;
  return { item, version: item.currentVersion, sourceVersions: await itemSourceVersions(q, id, item.currentVersion) };
}

export async function itemSourceVersions(q: Q, itemId: string, version: number): Promise<SourceVersion[]> {
  const r = await q.query(`select snapshot from learning_item_versions where item_id=$1 and version=$2`, [itemId, version]);
  const snap = (r.rows[0]?.snapshot as { sourceVersions?: SourceVersion[] } | undefined) ?? {};
  return snap.sourceVersions ?? [];
}

export async function itemQuestions(q: Q, itemId: string): Promise<StoredQuestion[]> {
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

/** Items (any status) whose current version pins `documentId`. */
export async function listItemsReferencing(q: Q, documentId: string) {
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
export async function needsUpdateFor(q: Q, itemIds: string[]): Promise<Map<string, boolean>> {
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
export async function significantChangeSince(q: Q, itemIds: string[]): Promise<Map<string, boolean>> {
  const out = new Map(itemIds.map((id) => [id, false]));
  if (!itemIds.length) return out;
  const r = await q.query(
    `select distinct i.id from learning_items i
       join learning_item_versions v on v.item_id=i.id and v.version=i.current_version
       cross join lateral jsonb_array_elements(coalesce(v.snapshot->'sourceVersions','[]'::jsonb)) p
       join document_change_flags f on f.document_id = (p->>'documentId')::uuid and f.significant and f.version > (p->>'version')::int
      where i.id = any($1::uuid[])`,
    [itemIds],
  );
  for (const x of r.rows) out.set(x.id as string, true);
  return out;
}

export async function needsUpdate(q: Q, itemIds: string[]): Promise<Map<string, boolean>> {
  const a = await needsUpdateFor(q, itemIds);
  const b = await significantChangeSince(q, itemIds);
  return new Map(itemIds.map((id) => [id, !!a.get(id) || !!b.get(id)]));
}

/** Briefing entries rendered from the pinned document versions; `changedSinceAssigned` is for the caller to set. */
export async function documentSnapshotFor(q: Q, itemId: string, version: number) {
  const pins = new Map((await itemSourceVersions(q, itemId, version)).map((p) => [p.documentId, p.version]));
  const rows = await q.query(`select * from briefing_entries where item_id=$1 order by position`, [itemId]);
  const out = [];
  for (const e of rows.rows) {
    const pinned = pins.get(e.document_id as string);
    const doc = pinned != null ? await getVersion(q, e.document_id as string, pinned) : null;
    out.push({
      id: e.id as string,
      documentId: e.document_id as string,
      stepKey: (e.step_key as string | null) ?? null,
      note: (e.note as string) ?? '',
      documentTitle: doc?.title ?? '',
      phases: doc?.phases ?? [],
      changedSinceAssigned: false as const,
    });
  }
  return out;
}

/** Fills V1's card placeholders: distinct assigned users and completion rate for the current version. */
export async function assignmentStats(
  q: Q,
  itemIds: string[],
): Promise<Map<string, { assignedUsers: number; completionRate: number | null }>> {
  const out = new Map(itemIds.map((id) => [id, { assignedUsers: 0, completionRate: null as number | null }]));
  if (!itemIds.length) return out;
  const r = await q.query(
    `select a.item_id, count(distinct a.user_id)::int assigned, count(*) filter (where a.status='completed')::int completed
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
```
Add to the imports at the top of the file: `import type { SourceVersion } from '@wecom/shared';` and `import { getVersion } from '../../documents/repo.js';`.

- [ ] **Step 5: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/learning-tracking.test.ts` → PASS (1 test).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/learning/tracking/itemsPort.ts apps/api/test/helpers/v2/learningStub.ts apps/api/test/learning-tracking.test.ts
git commit -m "feat(api): wave 5 V2 — learning items port over spec tables and the test stub"
```

---

### Task 3: Scoring (pure) and the change detector (pure)

**Files:**
- Create: `apps/api/src/modules/learning/tracking/scoring.ts`, `apps/api/src/modules/learning/tracking/changeDetector.ts`
- Test: `apps/api/test/unit/scoring.test.ts`, `apps/api/test/unit/changeDetector.test.ts`

**Interfaces:**
- Produces:
```ts
gradeAttempt(questions: StoredQuestion[], answers: { questionId: string; optionIds?: string[]; text?: string }[], passMark: number)
  : { score: number; passed: boolean; perQuestion: { questionId: string; correct: boolean; correctOptionIds: string[]; explanation: string }[] }
detectSignificantChange(before: Document, after: Document, blocks: Map<string, Block>, fieldNames: string[])
  : { significant: boolean; reasons: string[] }
```
Rules (spec §1.5): significant when any of — a step deleted; any outcome added/removed/changed (kind, text, goto); any branch question or option (label, text, goto) added/removed/changed; any CRM field reference added/removed (via `detectFieldRefs`); or more than 40% of the aligned steps are `changed`/`added`/`removed` per `diffDocuments`. Reasons are Hebrew strings, e.g. `'שלב הוסר: 1ב'`, `'תוצאה השתנתה בשלב 2א'`, `'הסתעפות השתנתה בשלב 3'`, `'שדה CRM השתנה: IMSI'`, `'יותר מ-40% מהשלבים השתנו'`.

Grading rules: `single` — exactly one chosen and it is the correct option; `multi` — chosen set equals the correct set; `order` — chosen ids in the same order as the option list filtered to `correct` options (all of them); `free` — trimmed, case-folded text equals any correct option's text. Score = round(100 × correct / questions.length); `passed = score >= passMark`; zero questions → score 0, passed false.

- [ ] **Step 1: Write the failing tests**

`apps/api/test/unit/scoring.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { gradeAttempt } from '../../src/modules/learning/tracking/scoring.js';
import type { StoredQuestion } from '../../src/modules/learning/tracking/itemsPort.js';

const Q: StoredQuestion[] = [
  { id: 'q1', documentId: 'd', stepKey: null, stem: 's', kind: 'single', explanation: 'e1', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] },
  { id: 'q2', documentId: 'd', stepKey: null, stem: 'm', kind: 'multi', explanation: '', options: [{ id: 'x', text: 'X', correct: true }, { id: 'y', text: 'Y', correct: true }, { id: 'z', text: 'Z', correct: false }] },
  { id: 'q3', documentId: 'd', stepKey: null, stem: 'o', kind: 'order', explanation: '', options: [{ id: '1', text: 'ראשון', correct: true }, { id: '2', text: 'שני', correct: true }] },
  { id: 'q4', documentId: 'd', stepKey: null, stem: 'f', kind: 'free', explanation: '', options: [{ id: 'k', text: 'איפוס', correct: true }] },
];

describe('gradeAttempt', () => {
  it('grades all four kinds and applies the pass mark', () => {
    const r = gradeAttempt(Q, [
      { questionId: 'q1', optionIds: ['a'] },
      { questionId: 'q2', optionIds: ['y', 'x'] },
      { questionId: 'q3', optionIds: ['1', '2'] },
      { questionId: 'q4', text: ' איפוס ' },
    ], 80);
    expect(r.score).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.perQuestion.map((p) => p.correct)).toEqual([true, true, true, true]);
    expect(r.perQuestion[0].correctOptionIds).toEqual(['a']);
    expect(r.perQuestion[0].explanation).toBe('e1');
  });
  it('partial credit is per question, not per option; wrong order fails; missing answers count wrong', () => {
    const r = gradeAttempt(Q, [{ questionId: 'q1', optionIds: ['a'] }, { questionId: 'q2', optionIds: ['x'] }, { questionId: 'q3', optionIds: ['2', '1'] }], 80);
    expect(r.score).toBe(25);
    expect(r.passed).toBe(false);
  });
  it('an empty quiz never passes', () => {
    expect(gradeAttempt([], [], 80)).toEqual({ score: 0, passed: false, perQuestion: [] });
  });
});
```
`apps/api/test/unit/changeDetector.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Document, Step } from '@wecom/shared';
import { detectSignificantChange } from '../../src/modules/learning/tracking/changeDetector.js';

const T = '2026-09-15T00:00:00.000Z';
const step = (key: string, over: Partial<Step> = {}): Step => ({
  key, num: key, title: 'שלב ' + key, blockRefs: [], deps: [], actions: [{ id: key + 'a', text: 'פעולה' }],
  outcomes: [{ kind: 'next', text: 'המשך', goto: undefined }], ...over,
});
const doc = (steps: Step[]): Document => ({
  id: '11111111-1111-4111-8111-111111111111', slug: 'd', title: 'מסמך', description: '', category: 'tech', wave: 1,
  priority: 'm', kind: 'steps', status: 'published', currentVersion: 1, phases: [{ id: 'p1', label: '', steps }],
  related: [], createdAt: T, updatedAt: T, tags: [], worlds: ['tech'], topics: [], sourceReviewNeeded: false,
});
const blocks = new Map();

describe('detectSignificantChange', () => {
  it('a title-only change is not significant', () => {
    const a = doc([step('s1'), step('s2'), step('s3')]);
    const b = doc([step('s1', { title: 'כותרת אחרת' }), step('s2'), step('s3')]);
    expect(detectSignificantChange(a, b, blocks, [])).toEqual({ significant: false, reasons: [] });
  });
  it('a removed step is significant', () => {
    const a = doc([step('s1'), step('s2')]);
    const r = detectSignificantChange(a, doc([step('s1')]), blocks, []);
    expect(r.significant).toBe(true);
    expect(r.reasons[0]).toMatch(/שלב הוסר/);
  });
  it('a changed outcome or branch option is significant', () => {
    const a = doc([step('s1'), step('s2')]);
    const b = doc([step('s1', { outcomes: [{ kind: 'alert', text: 'עצור' }] }), step('s2')]);
    expect(detectSignificantChange(a, b, blocks, []).reasons).toContainEqual(expect.stringMatching(/תוצאה/));
    const c = doc([step('s1', { branch: { q: 'יש קליטה?', options: [{ kind: 'if', label: 'כן', text: 'המשך' }] } }), step('s2')]);
    const d = doc([step('s1', { branch: { q: 'יש קליטה?', options: [{ kind: 'if', label: 'לא', text: 'המשך' }] } }), step('s2')]);
    expect(detectSignificantChange(c, d, blocks, []).reasons).toContainEqual(expect.stringMatching(/הסתעפות/));
  });
  it('a CRM field reference change is significant', () => {
    const a = doc([step('s1', { actions: [{ id: 'x', text: 'בדוק {{IMSI}}' }] })]);
    const b = doc([step('s1', { actions: [{ id: 'x', text: 'בדוק {{PUK}}' }] })]);
    const r = detectSignificantChange(a, b, blocks, ['IMSI', 'PUK']);
    expect(r.significant).toBe(true);
    expect(r.reasons.join(' ')).toMatch(/שדה CRM/);
  });
  it('more than 40% of steps changed in text is significant even without structural change', () => {
    const a = doc([step('s1'), step('s2'), step('s3'), step('s4'), step('s5')]);
    const b = doc([step('s1', { actions: [{ id: '1', text: 'אחר' }] }), step('s2', { actions: [{ id: '2', text: 'אחר' }] }), step('s3', { actions: [{ id: '3', text: 'אחר' }] }), step('s4'), step('s5')]);
    expect(detectSignificantChange(a, b, blocks, []).reasons).toContain('יותר מ-40% מהשלבים השתנו');
  });
});
```
(The `{{IMSI}}` syntax: check how `crmIn` in `packages/shared/src/format/links.ts` detects a field reference — it may be `[[שדה]]`, `{IMSI}` or a bare field name; use whatever `packages/shared/test/links.test.ts` uses so the test exercises the real detector. Also confirm the exact required fields of `Document`/`Step` against `packages/shared/src/schemas/content.ts` and adjust the builders; the assertions stay.)

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm vitest run test/unit/scoring.test.ts test/unit/changeDetector.test.ts` → FAIL (modules missing).

- [ ] **Step 3: Implement scoring**

`apps/api/src/modules/learning/tracking/scoring.ts`:
```ts
import type { StoredQuestion } from './itemsPort.js';

export interface AnswerInput {
  questionId: string;
  optionIds?: string[];
  text?: string;
}
export interface GradedQuestion {
  questionId: string;
  correct: boolean;
  correctOptionIds: string[];
  explanation: string;
}
export interface Graded {
  score: number;
  passed: boolean;
  perQuestion: GradedQuestion[];
}

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

const isCorrect = (q: StoredQuestion, a: AnswerInput | undefined): boolean => {
  const correct = q.options.filter((o) => o.correct).map((o) => o.id);
  const chosen = a?.optionIds ?? [];
  switch (q.kind) {
    case 'single':
      return chosen.length === 1 && correct.length === 1 && chosen[0] === correct[0];
    case 'multi':
      return correct.length > 0 && sameSet(chosen, correct);
    case 'order':
      return correct.length > 0 && chosen.length === correct.length && chosen.every((id, i) => id === correct[i]);
    case 'free': {
      const t = norm(a?.text ?? '');
      return t.length > 0 && q.options.some((o) => o.correct && norm(o.text) === t);
    }
  }
};

/** Pure grading: one point per question, score in whole percent, pass when score >= passMark. */
export function gradeAttempt(questions: StoredQuestion[], answers: AnswerInput[], passMark: number): Graded {
  if (!questions.length) return { score: 0, passed: false, perQuestion: [] };
  const byId = new Map(answers.map((a) => [a.questionId, a]));
  const perQuestion = questions.map((q) => ({
    questionId: q.id,
    correct: isCorrect(q, byId.get(q.id)),
    correctOptionIds: q.options.filter((o) => o.correct).map((o) => o.id),
    explanation: q.explanation,
  }));
  const right = perQuestion.filter((p) => p.correct).length;
  const score = Math.round((100 * right) / questions.length);
  return { score, passed: score >= passMark, perQuestion };
}
```

- [ ] **Step 4: Implement the detector**

`apps/api/src/modules/learning/tracking/changeDetector.ts`:
```ts
import { detectFieldRefs, type Block, type Document, type Step } from '@wecom/shared';
import { allSteps, diffDocuments } from '../../documents/diff.js';

export interface ChangeDetection {
  significant: boolean;
  reasons: string[];
}

const outcomeSig = (s: Step) => JSON.stringify(s.outcomes.map((o) => [o.kind, o.text, o.goto ?? null]));
const branchSig = (s: Step) =>
  s.branch ? JSON.stringify([s.branch.q, s.branch.options.map((o) => [o.kind, o.label, o.text, o.goto ?? null])]) : '';
const fieldSig = (doc: Document, fieldNames: string[], blocks: Map<string, Block>) =>
  new Set(detectFieldRefs(doc, fieldNames, blocks).map((r) => r.stepKey + '|' + r.fieldName));

/**
 * Spec §1.5: a publish is "significant" when it changes what an agent must *do* — an outcome,
 * a branch, a CRM field, a removed step — or when more than 40% of the steps changed at all.
 * Text-only edits to actions/titles below that threshold are not significant.
 */
export function detectSignificantChange(
  before: Document,
  after: Document,
  blocks: Map<string, Block>,
  fieldNames: string[],
): ChangeDetection {
  const reasons: string[] = [];
  const B = new Map(allSteps(before).map((s) => [s.key, s]));
  const A = new Map(allSteps(after).map((s) => [s.key, s]));

  for (const [key, s] of B) if (!A.has(key)) reasons.push(`שלב הוסר: ${s.num}`);
  for (const [key, n] of A) {
    const o = B.get(key);
    if (!o) continue;
    if (outcomeSig(o) !== outcomeSig(n)) reasons.push(`תוצאה השתנתה בשלב ${n.num}`);
    if (branchSig(o) !== branchSig(n)) reasons.push(`הסתעפות השתנתה בשלב ${n.num}`);
  }

  const fb = fieldSig(before, fieldNames, blocks);
  const fa = fieldSig(after, fieldNames, blocks);
  const changedFields = new Set<string>();
  for (const x of fb) if (!fa.has(x)) changedFields.add(x.split('|')[1]);
  for (const x of fa) if (!fb.has(x)) changedFields.add(x.split('|')[1]);
  for (const f of changedFields) reasons.push(`שדה CRM השתנה: ${f}`);

  const rows = diffDocuments(before, after, blocks);
  const total = Math.max(B.size, A.size, 1);
  const touched = rows.filter((r) => r.kind !== 'same').length;
  if (touched / total > 0.4) reasons.push('יותר מ-40% מהשלבים השתנו');

  return { significant: reasons.length > 0, reasons };
}
```

- [ ] **Step 5: Run** — both unit files PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/learning/tracking/scoring.ts apps/api/src/modules/learning/tracking/changeDetector.ts apps/api/test/unit/scoring.test.ts apps/api/test/unit/changeDetector.test.ts
git commit -m "feat(api): wave 5 V2 — quiz grading and significant-change detection (pure)"
```

---

### Task 4: Repo — assignments, audiences, player, completion, dashboard, document learning

**Files:**
- Create: `apps/api/src/modules/learning/tracking/repo.ts`, `apps/api/src/modules/learning/tracking/audiences.ts`
- Test: `apps/api/test/learning-tracking.test.ts` (append cases 2–4)

**Interfaces:**
- Consumes: `itemsPort`, `getWorkflowSettings`, `getVersion`/`getDocument` from `../../documents/repo.js`, `PhaseSchema`-shaped `phases` from a document version snapshot.
- Produces (all return shared-schema shapes):
```ts
// audiences.ts
resolveAudience(q, a: { roleNames: string[]; worldSlugs: string[]; userIds: string[] }): Promise<string[]>   // active user ids
createAssignments(tx, deps, i: { item: PublishedItem; userIds: string[]; reason: 'audience'|'manual'|'refresh'; dueDays: number; audienceId?: string|null; refreshReason?: string|null; actorId: string|null }): Promise<{ assigned: number; skipped: number; assignmentIds: string[] }>   // unique-guarded, notifies, publishes learning.assigned
resolveAllAudiences(deps): Promise<{ audiences: number; assigned: number }>                                   // nightly
// repo.ts
createAudience(tx, itemId, body: AudienceCreate, actorId): Promise<Audience>
deleteAudience(tx, id): Promise<boolean>
myLearning(q, userId): Promise<MyLearningResponse>
getOwnAssignment(q, assignmentId, userId): Promise<AssignmentRow | null>        // 404 semantics live in routes
playerItem(q, assignmentId, userId): Promise<PlayerItem | null>
acknowledge(tx, assignmentId, userId): Promise<Assignment>                     // briefing only
startAttempt(tx, assignmentId, userId, settings): Promise<AttemptStart>       // 409s thrown here
submitAttempt(tx, deps, attemptId, userId, answers): Promise<AttemptResult>   // grades, completes, event learning.completed
completionFor(q, itemId, scopes: string[]|null): Promise<CompletionResponse>
dashboard(q, world: string|undefined, scopes: string[]|null): Promise<LearningDashboard>
documentLearning(q, documentId, userId): Promise<DocumentLearning>
markOverdue(q): Promise<number>
```
- `TrackingDeps = { db: pg.Pool; notifier: Notifier; events: EventBus; log: FastifyBaseLogger }` (`EventBus` type from `apps/api/src/lib/events.ts`; check the exact export name).

- [ ] **Step 1: Write the failing tests** (append to `learning-tracking.test.ts`):
```ts
  it('an audience of agents in tech resolves to agent A only, assigns, and alerts', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/v1/learning/items/${quizId}/audiences`, headers: auth(manager),
      payload: { roleNames: ['agent'], worldSlugs: ['tech'], userIds: [], dueDays: 5 },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().resolvedUsers).toBe(1);
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    expect(mine.open).toHaveLength(1);
    expect(mine.open[0]).toMatchObject({ itemId: quizId, kind: 'quiz', title: 'חידון SIM', reason: 'audience', maxAttempts: null, passMark: 80 });
    const other = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    expect(other.open).toHaveLength(0);
    const n = await db.pool.query(`select kind, href from notifications where user_id=$1 order by created_at desc limit 1`, [agentA.id]);
    expect(n.rows[0]?.kind).toBe('learning');
    expect(n.rows[0]?.href).toMatch(/^\/learning\//);
  });

  it('manual assign skips duplicates and reaches users outside the audience', async () => {
    const r = await app.inject({
      method: 'POST', url: `/api/v1/learning/items/${quizId}/assign`, headers: auth(manager),
      payload: { userIds: [agentA.id, agentB.id], dueDays: 3 },
    });
    expect(r.json()).toEqual({ assigned: 1, skipped: 1 });
    const other = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    expect(other.open[0]).toMatchObject({ itemId: quizId, reason: 'manual' });
  });

  it('player payload hides correct flags and is visible to its owner only', async () => {
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    const aid = mine.open[0].id as string;
    const p = (await app.inject({ method: 'GET', url: `/api/v1/learning/my/${aid}`, headers: auth(agentA) })).json();
    expect(p.item.kind).toBe('quiz');
    expect(p.questions).toHaveLength(2);
    expect(p.questions[0].options[0]).not.toHaveProperty('correct');
    expect((await app.inject({ method: 'GET', url: `/api/v1/learning/my/${aid}`, headers: auth(agentB) })).statusCode).toBe(404);
  });
```

- [ ] **Step 2: Run to verify failure** — the three new cases FAIL (404 route not found).

- [ ] **Step 3: Write `audiences.ts`**

```ts
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { makeEvent, type Notifier } from '@wecom/shared';
import type { Tx } from '../../../lib/sql.js';
import type { EventBus } from '../../../lib/events.js';
import type { Q } from '../../documents/repo.js';
import { withTransaction } from '../../../lib/sql.js';
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
  q: Q,
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
      [i.item.id, i.item.currentVersion, userId, i.audienceId ?? null, i.reason, i.dueDays, i.refreshReason ?? null],
    );
    if (!r.rowCount) {
      skipped++;
      continue;
    }
    const id = r.rows[0].id as string;
    ids.push(id);
    await deps.events.publish(tx, makeEvent('learning.assigned', { assignmentId: id, userId, itemId: i.item.id }));
    if (userId !== i.actorId)
      await deps.notifier.notify({
        userIds: [userId],
        kind: 'learning',
        title: (i.reason === 'refresh' ? 'רענון ידע נדרש: ' : i.item.kind === 'quiz' ? 'שאלון ידע חדש: ' : 'תדריך חדש: ') + i.item.title,
        body: i.refreshReason ?? `יש להשלים עד ${i.dueDays} ימים מהיום`,
        href: `/learning/${id}`,
        entityType: 'learning_assignment',
        entityId: id,
      });
  }
  return { assigned: ids.length, skipped, assignmentIds: ids };
}

/** Nightly: re-resolve every audience of every published item so joiners get their assignments. */
export async function resolveAllAudiences(deps: TrackingDeps): Promise<{ audiences: number; assigned: number }> {
  const auds = await deps.db.query(
    `select a.* from learning_audiences a join learning_items i on i.id=a.item_id where i.status='published' and i.deleted_at is null`,
  );
  let assigned = 0;
  for (const a of auds.rows) {
    const n = await withTransaction(deps.db, async (tx) => {
      const pub = await getPublishedItem(tx, a.item_id as string);
      if (!pub) return 0;
      const item = pub.item;
      const users = await resolveAudience(tx, {
        roleNames: a.role_names as string[],
        worldSlugs: a.world_slugs as string[],
        userIds: a.user_ids as string[],
      });
      const r = await createAssignments(tx, deps, {
        item,
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
```
(Check `apps/api/src/lib/events.ts` for the exported bus type name — `EventBus` per the L2 plan — and that `publish(tx, event)` is its signature.)

- [ ] **Step 4: Write `repo.ts`**

```ts
import type { Assignment, AttemptResult, StartAttemptResponse, Audience, AudienceCreate, CompletionResponse, DocumentLearning, LearningDashboard, MyLearningResponse, PlayerItem, WorkflowSettings } from '@wecom/shared';
import { makeEvent } from '@wecom/shared';
import { httpError, notFound } from '../../../lib/http.js';
import type { Tx } from '../../../lib/sql.js';
import { getVersion, iso, type Q } from '../../documents/repo.js';
import { assignmentStats, documentSnapshotFor, getItem, getPublishedItem, itemQuestions, itemSourceVersions, needsUpdate, type PublishedItem } from './itemsPort.js';
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
  const item = pub.item;
  const r = await tx.query(
    `insert into learning_audiences(item_id, role_names, world_slugs, user_ids, due_days, created_by) values ($1,$2,$3,$4,$5,$6) returning *`,
    [itemId, body.roleNames, body.worldSlugs, body.userIds, body.dueDays, actorId],
  );
  const a = r.rows[0];
  const users = await resolveAudience(tx, body);
  await createAssignments(tx, deps, { item, userIds: users, reason: 'audience', dueDays: body.dueDays, audienceId: a.id as string, actorId });
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
export async function myLearning(q: Q, userId: string): Promise<MyLearningResponse> {
  const r = await q.query(`${ASSIGNMENT_SELECT} where a.user_id=$1 order by a.due_at asc, a.assigned_at desc`, [userId]);
  const all = r.rows.map(toAssignment);
  return {
    open: all.filter((a) => a.status === 'open'),
    overdue: all.filter((a) => a.status === 'overdue'),
    completed: all.filter((a) => a.status === 'completed'),
    invalidated: all.filter((a) => a.status === 'invalidated'),
  };
}

export async function getOwnAssignment(q: Q, assignmentId: string, userId: string): Promise<Assignment | null> {
  const r = await q.query(`${ASSIGNMENT_SELECT} where a.id=$1 and a.user_id=$2`, [assignmentId, userId]);
  return r.rowCount ? toAssignment(r.rows[0]) : null;
}

/** Player payload: entries carry the *pinned* document version's phases; questions lose `correct`. */
export async function playerItem(q: Q, assignmentId: string, userId: string): Promise<PlayerItem | null> {
  const assignment = await getOwnAssignment(q, assignmentId, userId);
  if (!assignment) return null;
  const item = await getItem(q, assignment.itemId);
  if (!item) return null;
  const pins = new Map((await itemSourceVersions(q, item.id, assignment.itemVersion)).map((p) => [p.documentId, p.version]));
  const entries = [];
  for (const e of await documentSnapshotFor(q, item.id, assignment.itemVersion)) {
    const changed = await q.query(
      `select 1 from document_change_flags f where f.document_id=$1 and f.significant and f.version > $2 and f.created_at >= $3 limit 1`,
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
  const r = await tx.query(`${ASSIGNMENT_SELECT} where a.id=$1 and a.user_id=$2 for update of a`, [assignmentId, userId]);
  if (!r.rowCount) throw notFound('המשימה');
  const a = toAssignment(r.rows[0]);
  if (a.status === 'completed' || a.status === 'invalidated') throw httpError(409, 'ASSIGNMENT_CLOSED', 'המשימה כבר נסגרה');
  return a;
};

const complete = async (tx: Tx, deps: Pick<TrackingDeps, 'events'>, a: Assignment, passed: boolean | null) => {
  await tx.query(`update learning_assignments set status='completed', completed_at=now() where id=$1`, [a.id]);
  await deps.events.publish(tx, makeEvent('learning.completed', { assignmentId: a.id, userId: (await tx.query(`select user_id from learning_assignments where id=$1`, [a.id])).rows[0].user_id as string, itemId: a.itemId, passed: passed ?? true }));
};

export async function acknowledge(tx: Tx, deps: Pick<TrackingDeps, 'events'>, assignmentId: string, userId: string): Promise<Assignment> {
  const a = await lockOpen(tx, assignmentId, userId);
  if (a.kind !== 'briefing') throw httpError(409, 'NOT_A_BRIEFING', 'אישור קריאה חל על תדריכים בלבד');
  await tx.query(
    `insert into learning_acknowledgements(assignment_id, item_version) values ($1,$2) on conflict (assignment_id) do nothing`,
    [a.id, a.itemVersion],
  );
  await complete(tx, deps, a, null);
  return (await getOwnAssignment(tx, assignmentId, userId))!;
}

const effectiveMax = (a: Assignment, s: WorkflowSettings) => a.maxAttempts ?? s.learning.defaultMaxAttempts ?? null;
const effectivePass = (a: Assignment, s: WorkflowSettings) => a.passMark ?? s.learning.defaultPassMark;

export async function startAttempt(tx: Tx, assignmentId: string, userId: string, settings: WorkflowSettings): Promise<StartAttemptResponse> {
  const a = await lockOpen(tx, assignmentId, userId);
  if (a.kind !== 'quiz') throw httpError(409, 'NOT_A_QUIZ', 'ניסיונות חלים על שאלונים בלבד');
  const max = effectiveMax(a, settings);
  if (max != null && a.attemptsUsed >= max) throw httpError(409, 'ATTEMPTS_EXHAUSTED', 'מספר הניסיונות מוצה', { maxAttempts: max });
  // An unfinished attempt is resumed, not duplicated.
  const open = await tx.query(`select id, attempt_no from learning_attempts where assignment_id=$1 and finished_at is null order by attempt_no desc limit 1`, [a.id]);
  if (open.rowCount) return { attemptId: open.rows[0].id as string, attemptNo: open.rows[0].attempt_no as number };
  const next = (await tx.query(`select coalesce(max(attempt_no),0)+1 n from learning_attempts where assignment_id=$1`, [a.id])).rows[0].n as number;
  const r = await tx.query(`insert into learning_attempts(assignment_id, attempt_no) values ($1,$2) returning id`, [a.id, next]);
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
    `select t.id, t.assignment_id, t.finished_at from learning_attempts t join learning_assignments a on a.id=t.assignment_id where t.id=$1 and a.user_id=$2 for update of t`,
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
    const a = answers.find((x) => x.questionId === p.questionId);
    stored[p.questionId] = { selected: a?.text ?? (a?.optionIds?.length ? a.optionIds : null), correct: p.correct };
  }
  await tx.query(`update learning_attempts set finished_at=now(), score=$2, passed=$3, answers=$4::jsonb where id=$1`, [
    attemptId, graded.score, graded.passed, JSON.stringify(stored),
  ]);
  if (graded.passed) await complete(tx, deps, a, true);
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

export async function completionFor(q: Q, itemId: string, scopes: readonly string[] | null): Promise<CompletionResponse> {
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
  const names = new Map<string, { name: string; worlds: string[] }>();
  for (const r of rows.rows) {
    const w = await q.query(`select coalesce(array_agg(distinct s), '{}') w from user_roles ur, unnest(coalesce(ur.world_scope, '{}')) s where ur.user_id=$1`, [r.user_id]);
    names.set(r.user_id as string, { name: (await q.query(`select display_name from users where id=$1`, [r.user_id])).rows[0].display_name as string, worlds: (w.rows[0].w as string[]) ?? [] });
  }
  const out = rows.rows.map((r) => {
    const a = toAssignment(r);
    const n = names.get(r.user_id as string)!;
    return { userId: r.user_id as string, displayName: n.name, worldSlugs: n.worlds, status: a.status, dueAt: a.dueAt, completedAt: a.completedAt, score: a.lastScore, attempts: a.attemptsUsed };
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
  const card = await itemCard(q, item);
  return { item: card, rows: out, byWorld: [...byWorld].map(([worldSlug, b]) => ({ worldSlug, ...b })) };
}

const itemCard = async (q: Q, item: PublishedItem) => {
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
    id: item.id, kind: item.kind, title: item.title, description: item.description, worldSlug: item.worldSlug, status: item.status,
    currentVersion: item.currentVersion, estimatedMinutes: item.estimatedMinutes, needsUpdate: nu,
    updatedAt: iso(x.updated_at as Date)!, publishedAt: iso(x.published_at as Date | null),
    entryCount: x.entries as number, questionCount: x.questions as number, assignedUsers: stats.assignedUsers,
    completionRate: stats.completionRate,
  };
};

export async function dashboard(q: Q, world: string | undefined, scopes: readonly string[] | null): Promise<LearningDashboard> {
  const params: unknown[] = [];
  let worldTerm = '';
  if (world) {
    params.push(world);
    worldTerm = ` and i.world_slug = $${params.length}`;
  }
  const scopeTerm = userScopeTerm(params, scopes);
  const base = `from learning_assignments a join learning_items i on i.id=a.item_id where a.item_version=i.current_version${worldTerm}${scopeTerm}`;
  const totals = (await q.query(
    `select (select count(*)::int from learning_items i where i.status='published' and i.deleted_at is null${worldTerm.replace(/\$\d+/, '$1')}) items,
            count(*)::int assigned,
            count(*) filter (where a.status='completed')::int completed,
            count(*) filter (where a.status='overdue')::int overdue,
            count(*) filter (where a.reason='refresh' and a.status in ('open','overdue'))::int refresh_pending
       ${base}`,
    params,
  )).rows[0];
  const byWorld = (await q.query(
    `select coalesce(i.world_slug,'—') world_slug, count(*)::int assigned,
            count(*) filter (where a.status='completed')::int completed,
            count(*) filter (where a.status='overdue')::int overdue
       ${base} group by 1 order by 1`,
    params,
  )).rows.map((r) => ({
    worldSlug: r.world_slug as string, assigned: r.assigned as number, completed: r.completed as number, overdue: r.overdue as number,
    rate: (r.assigned as number) ? (r.completed as number) / (r.assigned as number) : 0,
  }));
  const failed = (await q.query(
    `select ans.key question_id, i.id item_id, i.title item_title, qq.stem,
            count(*)::int attempts, count(*) filter (where (ans.value->>'correct')::boolean = false)::int failed
       from learning_attempts t
       join learning_assignments a on a.id=t.assignment_id
       join learning_items i on i.id=a.item_id
       cross join lateral jsonb_each(t.answers) ans
       join quiz_questions qq on qq.id::text = ans.key
      where t.finished_at is not null${worldTerm}${scopeTerm}
      group by 1,2,3,4 having count(*) >= 3
      order by (count(*) filter (where (ans.value->>'correct')::boolean = false))::float / count(*) desc limit 10`,
    params,
  )).rows.map((r) => ({
    questionId: r.question_id as string, itemId: r.item_id as string, itemTitle: r.item_title as string, stem: r.stem as string,
    failRate: (r.failed as number) / (r.attempts as number), attempts: r.attempts as number,
  }));
  const recent = (await q.query(
    `select a.user_id, u.display_name, i.title item_title, a.completed_at,
            (select t.passed from learning_attempts t where t.assignment_id=a.id and t.finished_at is not null order by t.attempt_no desc limit 1) passed
       ${base} and a.status='completed' join users u on u.id=a.user_id
      order by a.completed_at desc limit 20`.replace(`join users u on u.id=a.user_id\n      order`, 'order'),
    params,
  )).rows;
  // NOTE: the `join users` must precede the where clause; write the query as a proper SQL string
  // (from … join learning_items … join users u … where …) rather than the replace() above.
  return {
    generatedAt: new Date().toISOString(),
    totals: { items: totals.items as number, assigned: totals.assigned as number, completed: totals.completed as number, overdue: totals.overdue as number, refreshPending: totals.refresh_pending as number },
    byWorld,
    failedQuestions: failed,
    recentCompletions: recent.map((r) => ({ userId: r.user_id as string, displayName: r.display_name as string, itemTitle: r.item_title as string, completedAt: iso(r.completed_at as Date)!, passed: (r.passed as boolean | null) ?? null })),
  };
}
```
Two corrections to make while writing, not after: (1) write `recent` as one clean SQL string with `join users u on u.id=a.user_id` placed before the `where`, and drop the `.replace(...)`; (2) in `totals` the `items` subquery must use its own parameter for `world` — build it as `world ? 'and i.world_slug=$1' : ''` with `params[0] === world`, which holds because `world` is pushed first. Also replace the per-row `names` loop in `completionFor` with one query: `select u.id, u.display_name, coalesce(array_agg(distinct s) filter (where s is not null), '{}') worlds from users u left join user_roles ur on ur.user_id=u.id left join unnest(ur.world_scope) s on true where u.id = any($1::uuid[]) group by u.id` — one round trip instead of 2N.

```ts
export async function documentLearning(q: Q, documentId: string, userId: string): Promise<DocumentLearning> {
  const items = await q.query(
    `select distinct i.* from learning_items i
       join learning_item_versions v on v.item_id=i.id and v.version=i.current_version
       cross join lateral jsonb_array_elements(coalesce(v.snapshot->'sourceVersions','[]'::jsonb)) p
      where i.deleted_at is null and i.status='published' and p->>'documentId'=$1 order by i.title`,
    [documentId],
  );
  const cards = [];
  for (const r of items.rows) cards.push(await itemCard(q, (await getItem(q, r.id as string))!));
  const refresh = await q.query(
    `select a.id from learning_assignments a where a.user_id=$1 and a.reason='refresh' and a.status in ('open','overdue')
        and a.item_id = any($2::uuid[]) order by a.due_at asc limit 1`,
    [userId, items.rows.map((r) => r.id)],
  );
  const last = await q.query(
    `select version, created_at, reasons from document_change_flags where document_id=$1 and significant order by version desc limit 1`,
    [documentId],
  );
  return {
    items: cards,
    refreshRequired: (refresh.rowCount ?? 0) > 0,
    refreshAssignmentId: refresh.rowCount ? (refresh.rows[0].id as string) : null,
    lastSignificantChange: last.rowCount
      ? { version: last.rows[0].version as number, at: iso(last.rows[0].created_at as Date)!, reasons: (last.rows[0].reasons as string[]) ?? [] }
      : null,
  };
}

/** Idempotent: open assignments past due become overdue. Returns how many changed. */
export async function markOverdue(q: Q): Promise<number> {
  const r = await q.query(`update learning_assignments set status='overdue' where status='open' and due_at < now()`);
  return r.rowCount ?? 0;
}
```

- [ ] **Step 5: Routes needed by the three tests** — do Task 5 next; the tests pass once routes exist. Run `pnpm typecheck` now to keep the repo compiling.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/learning/tracking/repo.ts apps/api/src/modules/learning/tracking/audiences.ts apps/api/test/learning-tracking.test.ts
git commit -m "feat(api): wave 5 V2 — assignment repo, audiences, player, completion, dashboard"
```

---

### Task 5: Routes and module registration

**Files:**
- Create: `apps/api/src/modules/learning/tracking/routes.ts`, `apps/api/src/modules/learning/tracking/index.ts`
- Modify: `apps/api/src/modules/index.ts` (append)
- Test: `apps/api/test/learning-tracking.test.ts` (append cases 5–8)

**Interfaces:**
- Produces the routes in `CONTRACTS-wave5.md` V2 rows; `learningTracking` default export plugin.

- [ ] **Step 1: Append tests**
```ts
  it('quiz attempts: wrong then right; unlimited retakes; completion on pass', async () => {
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    const aid = mine.open[0].id as string;
    const s1 = (await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentA) })).json();
    expect(s1).toEqual({ attemptId: expect.any(String), attemptNo: 1 });
    const r1 = (await app.inject({
      method: 'PUT', url: `/api/v1/learning/attempts/${s1.attemptId}`, headers: auth(agentA),
      payload: { answers: [{ questionId: quizQuestionIds[0], optionIds: ['a'] }, { questionId: quizQuestionIds[1], optionIds: ['z'] }] },
    })).json();
    expect(r1).toMatchObject({ score: 50, passed: false, attemptsLeft: null });
    expect(r1.perQuestion[1].correctOptionIds.sort()).toEqual(['x', 'y']);
    const s2 = (await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentA) })).json();
    expect(s2.attemptNo).toBe(2);
    const r2 = (await app.inject({
      method: 'PUT', url: `/api/v1/learning/attempts/${s2.attemptId}`, headers: auth(agentA),
      payload: { answers: [{ questionId: quizQuestionIds[0], optionIds: ['a'] }, { questionId: quizQuestionIds[1], optionIds: ['x', 'y'] }] },
    })).json();
    expect(r2).toMatchObject({ score: 100, passed: true });
    const after = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    expect(after.completed[0]).toMatchObject({ id: aid, status: 'completed', attemptsUsed: 2, lastScore: 100 });
    expect((await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentA) })).statusCode).toBe(409);
  });

  it('a capped quiz refuses the attempt after the cap', async () => {
    const capped = await seedQuiz(db.pool, { documentId: docId, title: 'חידון מוגבל', worldSlug: 'tech', passMark: 100, maxAttempts: 1, questions: [{ stem: 'ש', kind: 'single', options: [{ id: 'a', text: 'A', correct: true }, { id: 'b', text: 'B', correct: false }] }] });
    await app.inject({ method: 'POST', url: `/api/v1/learning/items/${capped}/assign`, headers: auth(manager), payload: { userIds: [agentB.id] } });
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    const aid = (mine.open as { itemId: string; id: string }[]).find((a) => a.itemId === capped)!.id;
    const qid = (await db.pool.query(`select id from quiz_questions where item_id=$1`, [capped])).rows[0].id as string;
    const start = await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentB) });
    expect(start.statusCode).toBe(201);
    const s = start.json();
    const r = (await app.inject({ method: 'PUT', url: `/api/v1/learning/attempts/${s.attemptId}`, headers: auth(agentB), payload: { answers: [{ questionId: qid, optionIds: ['b'] }] } })).json();
    expect(r).toMatchObject({ passed: false, attemptsLeft: 0 });
    const again = await app.inject({ method: 'POST', url: `/api/v1/learning/my/${aid}/attempts`, headers: auth(agentB) });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ATTEMPTS_EXHAUSTED');
  });

  it('briefings complete by acknowledgement; quizzes cannot be acknowledged', async () => {
    await app.inject({ method: 'POST', url: `/api/v1/learning/items/${briefingId}/assign`, headers: auth(manager), payload: { userIds: [agentA.id] } });
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    const b = (mine.open as { itemId: string; id: string }[]).find((a) => a.itemId === briefingId)!;
    const p = (await app.inject({ method: 'GET', url: `/api/v1/learning/my/${b.id}`, headers: auth(agentA) })).json();
    expect(p.entries[0]).toMatchObject({ documentId: docId, changedSinceAssigned: false });
    expect(p.entries[0].phases.length).toBeGreaterThan(0);
    const ack = await app.inject({ method: 'POST', url: `/api/v1/learning/my/${b.id}/acknowledge`, headers: auth(agentA) });
    expect(ack.json().status).toBe('completed');
    const quizAssignment = (mine.completed as { id: string }[])[0]?.id ?? (mine.open as { id: string }[])[0].id;
    expect((await app.inject({ method: 'POST', url: `/api/v1/learning/my/${quizAssignment}/acknowledge`, headers: auth(agentA) })).statusCode).toBe(409);
  });

  it('permission denials', async () => {
    expect((await app.inject({ method: 'POST', url: `/api/v1/learning/items/${quizId}/audiences`, headers: auth(agentA), payload: { roleNames: ['agent'], worldSlugs: [], userIds: [], dueDays: 3 } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(agentA) })).statusCode).toBe(403);
    const noLearning = await makeUser(db.pool, { perms: ['docs.read'] });
    expect((await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(noLearning) })).statusCode).toBe(403);
  });
```
Add at the top of the describe: `let quizQuestionIds: string[] = [];` and after `seedQuiz` in `beforeAll`: `quizQuestionIds = (await db.pool.query('select id from quiz_questions where item_id=$1 order by position', [quizId])).rows.map((r) => r.id as string);`.

- [ ] **Step 2: Run to verify failure** — 404s.

- [ ] **Step 3: Write `routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AssignBodySchema, AssignResultSchema, AssignmentSchema, AttemptAnswersSchema, AttemptResultSchema, StartAttemptResponseSchema,
  AudienceCreateSchema, AudienceSchema, CompletionResponseSchema, DocumentLearningSchema, IdSchema,
  LearningDashboardQuerySchema, LearningDashboardSchema, MyLearningResponseSchema, PlayerItemSchema,
} from '@wecom/shared';
import { audit } from '../../../lib/audit.js';
import { notFound } from '../../../lib/http.js';
import { withTransaction } from '../../../lib/sql.js';
import { requireUser } from '../../../lib/user.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { assertVisibleDocument } from '../../../lib/visibility.js';
import * as repo from './repo.js';
import { createAssignments, type TrackingDeps } from './audiences.js';
import { getPublishedItem } from './itemsPort.js';

const Id = z.object({ id: IdSchema });
const AssignmentId = z.object({ assignmentId: IdSchema });

export default function trackingRoutes(deps: () => TrackingDeps) {
  return async function routes(app: FastifyInstance) {
    app.post('/learning/items/:id/audiences', {
      config: { requires: ['learning.manage'] },
      schema: { tags: ['learning'], params: Id, body: AudienceCreateSchema, response: { 200: AudienceSchema } },
    }, async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof AudienceCreateSchema>;
      return withTransaction(app.db, async (tx) => {
        const a = await repo.createAudience(tx, deps(), id, body, user.id);
        await audit(tx, { actorId: user.id, action: 'learning.audience.create', entityType: 'learning_item', entityId: id, before: null, after: { audienceId: a.id, resolvedUsers: a.resolvedUsers }, requestId: req.id, ip: req.ip });
        return a;
      });
    });

    app.delete('/learning/audiences/:id', {
      config: { requires: ['learning.manage'] },
      schema: { tags: ['learning'], params: Id },
    }, async (req, reply) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      await withTransaction(app.db, async (tx) => {
        if (!(await repo.deleteAudience(tx, id))) throw notFound('קהל היעד');
        await audit(tx, { actorId: user.id, action: 'learning.audience.delete', entityType: 'learning_audience', entityId: id, before: null, after: null, requestId: req.id, ip: req.ip });
      });
      reply.code(204);
      return null;
    });

    app.post('/learning/items/:id/assign', {
      config: { requires: ['learning.manage'] },
      schema: { tags: ['learning'], params: Id, body: AssignBodySchema, response: { 200: AssignResultSchema } },
    }, async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof AssignBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const pub = await getPublishedItem(tx, id);
        if (!pub) throw notFound('פריט הלמידה');
        const r = await createAssignments(tx, deps(), { item: pub.item, userIds: body.userIds, reason: 'manual', dueDays: body.dueDays ?? 14, actorId: user.id });
        await audit(tx, { actorId: user.id, action: 'learning.assign', entityType: 'learning_item', entityId: id, before: null, after: { assigned: r.assigned, skipped: r.skipped }, requestId: req.id, ip: req.ip });
        return { assigned: r.assigned, skipped: r.skipped };
      });
    });

    app.get('/learning/my', {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], response: { 200: MyLearningResponseSchema } },
    }, async (req) => repo.myLearning(app.db, requireUser(req).id));

    app.get('/learning/my/:assignmentId', {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: AssignmentId, response: { 200: PlayerItemSchema } },
    }, async (req) => {
      const user = requireUser(req);
      const p = await repo.playerItem(app.db, (req.params as { assignmentId: string }).assignmentId, user.id);
      if (!p) throw notFound('המשימה');
      return p;
    });

    app.post('/learning/my/:assignmentId/acknowledge', {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: AssignmentId, response: { 200: AssignmentSchema } },
    }, async (req) => {
      const user = requireUser(req);
      return withTransaction(app.db, (tx) => repo.acknowledge(tx, deps(), (req.params as { assignmentId: string }).assignmentId, user.id));
    });

    app.post('/learning/my/:assignmentId/attempts', {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: AssignmentId, response: { 201: StartAttemptResponseSchema } },
    }, async (req, reply) => {
      const user = requireUser(req);
      const r = await withTransaction(app.db, async (tx) => repo.startAttempt(tx, (req.params as { assignmentId: string }).assignmentId, user.id, await getWorkflowSettings(tx)));
      reply.code(201);
      return r;
    });

    app.put('/learning/attempts/:id', {
      config: { requires: ['learning.read'] },
      schema: { tags: ['learning'], params: Id, body: AttemptAnswersSchema, response: { 200: AttemptResultSchema } },
    }, async (req) => {
      const user = requireUser(req);
      const body = req.body as z.infer<typeof AttemptAnswersSchema>;
      return withTransaction(app.db, async (tx) => repo.submitAttempt(tx, deps(), (req.params as { id: string }).id, user.id, body.answers, await getWorkflowSettings(tx)));
    });

    app.get('/learning/items/:id/completion', {
      config: { requires: ['learning.manage'] },
      schema: { tags: ['learning'], params: Id, response: { 200: CompletionResponseSchema } },
    }, async (req) => repo.completionFor(app.db, (req.params as { id: string }).id, requireUser(req).worldScopes));

    app.get('/learning/dashboard', {
      config: { requires: ['learning.manage'] },
      schema: { tags: ['learning'], querystring: LearningDashboardQuerySchema, response: { 200: LearningDashboardSchema } },
    }, async (req) => repo.dashboard(app.db, (req.query as { world?: string }).world, requireUser(req).worldScopes));

    app.get('/documents/:id/learning', {
      config: { requires: ['docs.read'], scope: 'document' },
      schema: { tags: ['learning'], params: Id, response: { 200: DocumentLearningSchema } },
    }, async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      await assertVisibleDocument(app.db, id, user);
      return repo.documentLearning(app.db, id, user.id);
    });
  };
}
```
(`assertVisibleDocument` — confirm the export name and signature in `apps/api/src/lib/visibility.ts` (W2); use whatever it is. `requireUser(req).worldScopes` — confirm the field name on `AuthUser`.)

`index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import trackingRoutes from './routes.js';
import { startTrackingJobs } from './jobs.js';
import type { TrackingDeps } from './audiences.js';

/** V2 module. `deps` is a thunk so the notifier in force at call time is used (tests swap it). */
export default async function learningTrackingModule(app: FastifyInstance) {
  const deps = (): TrackingDeps => ({ db: app.db, notifier: app.notifier, events: app.events, log: app.log });
  await app.register(trackingRoutes(deps));
  app.addHook('onReady', async () => {
    await startTrackingJobs(app, deps);
  });
}
```
Until Task 6 exists, create `jobs.ts` with `export async function startTrackingJobs(): Promise<void> {}` and fill it in Task 6.

`modules/index.ts` — append `import learningTracking from './learning/tracking/index.js'; // wave 5 V2: assignments, attempts, refresh` and `learningTracking,` at the end of the list.

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/learning-tracking.test.ts` → all cases so far PASS; `pnpm typecheck` clean.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/learning/tracking apps/api/src/modules/index.ts apps/api/test/learning-tracking.test.ts
git commit -m "feat(api): wave 5 V2 — learning tracking routes and module registration"
```

---

### Task 6: Jobs — nightly audience re-resolution and reminders

**Files:**
- Modify: `apps/api/src/modules/learning/tracking/jobs.ts`
- Test: `apps/api/test/learning-tracking.test.ts` (append cases)

**Interfaces:**
- Produces: `runReminders(deps, settings): Promise<{ overdue: number; reminded: number }>`, `startTrackingJobs(app, deps)`.

- [ ] **Step 1: Append tests**
```ts
  it('nightly re-resolution assigns a user who joined the audience later', async () => {
    const { resolveAllAudiences } = await import('../src/modules/learning/tracking/audiences.js');
    await grantRole(agentB.id, 'agent', ['tech']);
    const r = await resolveAllAudiences({ db: db.pool, notifier: app.notifier, events: app.events, log: app.log });
    expect(r.assigned).toBeGreaterThanOrEqual(1);
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    expect([...mine.open, ...mine.completed].some((a: { itemId: string; reason: string }) => a.itemId === quizId && a.reason === 'audience')).toBe(true);
  });

  it('reminders mark overdue and notify once', async () => {
    const { runReminders } = await import('../src/modules/learning/tracking/jobs.js');
    const { getWorkflowSettings } = await import('../src/lib/workflowSettings.js');
    const late = await seedBriefing(db.pool, { documentIds: [docId], title: 'תדריך באיחור', worldSlug: null });
    await app.inject({ method: 'POST', url: `/api/v1/learning/items/${late}/assign`, headers: auth(manager), payload: { userIds: [agentB.id], dueDays: 1 } });
    await db.pool.query(`update learning_assignments set due_at = now() - interval '2 days' where item_id=$1`, [late]);
    const before = (await db.pool.query(`select count(*)::int n from notifications where user_id=$1 and kind='learning'`, [agentB.id])).rows[0].n;
    const settings = await getWorkflowSettings(db.pool);
    const r1 = await runReminders({ db: db.pool, notifier: app.notifier, events: app.events, log: app.log }, settings);
    expect(r1.overdue).toBeGreaterThanOrEqual(1);
    const r2 = await runReminders({ db: db.pool, notifier: app.notifier, events: app.events, log: app.log }, settings);
    expect(r2.reminded).toBe(0);
    const after = (await db.pool.query(`select count(*)::int n from notifications where user_id=$1 and kind='learning'`, [agentB.id])).rows[0].n;
    expect(after - before).toBe(1);
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentB) })).json();
    expect(mine.overdue.some((a: { itemId: string }) => a.itemId === late)).toBe(true);
  });
```

- [ ] **Step 2: Run to verify failure** — `runReminders` missing.

- [ ] **Step 3: Implement `jobs.ts`**
```ts
import type { FastifyInstance } from 'fastify';
import type { WorkflowSettings } from '@wecom/shared';
import { QUEUES } from '../../../plugins/boss.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { resolveAllAudiences, type TrackingDeps } from './audiences.js';
import { markOverdue } from './repo.js';

/**
 * Overdue marking is idempotent. A reminder goes out once per assignment (`reminded_at`) when
 * it is due within `reminderDaysBefore` days or already overdue.
 */
export async function runReminders(deps: TrackingDeps, settings: WorkflowSettings): Promise<{ overdue: number; reminded: number }> {
  const overdue = await markOverdue(deps.db);
  const due = await deps.db.query(
    `select a.id, a.user_id, a.due_at, a.status, i.title, i.kind
       from learning_assignments a join learning_items i on i.id=a.item_id
      where a.status in ('open','overdue') and a.reminded_at is null
        and a.due_at <= now() + ($1::int || ' days')::interval`,
    [settings.learning.reminderDaysBefore],
  );
  let reminded = 0;
  for (const r of due.rows) {
    const upd = await deps.db.query(`update learning_assignments set reminded_at=now() where id=$1 and reminded_at is null`, [r.id]);
    if (!upd.rowCount) continue;
    await deps.notifier.notify({
      userIds: [r.user_id as string],
      kind: 'learning',
      title: (r.status === 'overdue' ? 'משימת למידה באיחור: ' : 'תזכורת: משימת למידה מתקרבת: ') + (r.title as string),
      body: `מועד היעד: ${new Date(r.due_at as Date).toLocaleDateString('he-IL')}`,
      href: `/learning/${r.id as string}`,
      entityType: 'learning_assignment',
      entityId: r.id as string,
    });
    reminded++;
  }
  return { overdue, reminded };
}

/** Same shape as the feedback jobs: no-op without pg-boss or under NODE_ENV=test. */
export async function startTrackingJobs(app: FastifyInstance, deps: () => TrackingDeps): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.learningResolveAudiences, async () => {
    const r = await resolveAllAudiences(deps());
    app.log.info(r, 'learning audiences re-resolved');
  });
  await boss.work(QUEUES.learningReminders, async () => {
    const r = await runReminders(deps(), await getWorkflowSettings(deps().db));
    app.log.info(r, 'learning reminders sent');
  });
  for (const [q, cron] of [
    [QUEUES.learningResolveAudiences, '30 3 * * *'],
    [QUEUES.learningReminders, '30 8 * * *'],
  ] as const) {
    try {
      await boss.schedule(q, cron, {}, { tz: 'Asia/Jerusalem' });
    } catch (err) {
      app.log.warn({ err, q }, 'could not schedule learning job');
    }
  }
}
```

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `feat(api): wave 5 V2 — audience re-resolution and reminder jobs`

---

### Task 7: Refresh — change flag on publish, invalidation, refresh assignments

**Files:**
- Create: `apps/api/src/modules/learning/tracking/refresh.ts`
- Modify: `apps/api/src/modules/documents/routes.ts` (publish handler only)
- Test: `apps/api/test/learning-tracking.test.ts` (append cases)

**Interfaces:**
- Produces:
```ts
export interface ChangeFlagInput { documentId: string; version: number; before: Document; after: Document; blocks: Map<string, Block>; fieldNames: string[]; override?: boolean; actorId: string | null }
export async function applyChangeFlag(tx: Tx, deps: Pick<TrackingDeps, 'notifier' | 'events'>, i: ChangeFlagInput): Promise<ChangeFlag>
```
- V6 consumes: the publish-route hunk below and `detectSignificantChange` (Task 3) — the review-decision approve path in `collab/reviews.ts` publishes through the same route helper or must call `applyChangeFlag` itself (note for V6).

- [ ] **Step 1: Append tests**
```ts
  const republish = async (mutate: (s: typeof minimalStructure) => unknown, body: Record<string, unknown> = {}) => {
    const cur = (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(manager) })).json();
    const s = JSON.parse(JSON.stringify(minimalStructure)) as typeof minimalStructure;
    const payload = mutate(s) ?? s;
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/structure`, headers: { ...auth(manager), 'if-match': cur.etag }, payload });
    return (await app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/publish`, headers: auth(manager), payload: { label: 'עדכון', ...body } })).json();
  };

  it('a non-significant publish flags nothing and creates no refresh work', async () => {
    const r = await republish((s) => { s.phases[0].steps[0].title = 'כותרת חדשה'; });
    expect(r.changeFlag).toMatchObject({ significant: false, refreshAssignments: 0 });
    const flags = await db.pool.query(`select significant from document_change_flags where document_id=$1 order by version desc limit 1`, [docId]);
    expect(flags.rows[0].significant).toBe(false);
  });

  it('a significant publish invalidates completions and assigns a refresh with a due date', async () => {
    const r = await republish((s) => { s.phases[0].steps[0].outcomes = [{ kind: 'alert', text: 'עצור והסלם' }]; });
    expect(r.changeFlag.significant).toBe(true);
    expect(r.changeFlag.reasons.join(' ')).toMatch(/תוצאה/);
    expect(r.changeFlag.affectedItems).toBeGreaterThanOrEqual(2);
    const mine = (await app.inject({ method: 'GET', url: '/api/v1/learning/my', headers: auth(agentA) })).json();
    expect(mine.invalidated.some((a: { itemId: string }) => a.itemId === quizId)).toBe(true);
    const refresh = (mine.open as { id: string; itemId: string; reason: string; dueAt: string; refreshReason: string | null }[]).find((a) => a.itemId === quizId && a.reason === 'refresh');
    expect(refresh).toBeTruthy();
    expect(refresh!.refreshReason).toMatch(/שינוי מהותי/);
    const days = (new Date(refresh!.dueAt).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(6);
    expect(days).toBeLessThanOrEqual(7.01);
    expect((await port.needsUpdate(db.pool, [quizId])).get(quizId)).toBe(true);
    const stored = await db.pool.query(`select answers from learning_attempts where finished_at is not null order by finished_at desc limit 1`);
    expect(Object.values(stored.rows[0].answers as Record<string, { correct: boolean }>).every((v) => typeof v.correct === 'boolean')).toBe(true);
    const dl = (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/learning`, headers: auth(agentA) })).json();
    expect(dl.refreshRequired).toBe(true);
    expect(dl.refreshAssignmentId).toBe(refresh!.id);
    expect(dl.items.find((i: { id: string }) => i.id === quizId)?.needsUpdate).toBe(true);
    expect(dl.lastSignificantChange.reasons.length).toBeGreaterThan(0);
  });

  it('the publish dialog override wins in both directions', async () => {
    const forced = await republish((s) => { s.phases[0].steps[0].title = 'שינוי קטן נוסף'; }, { significantChange: true });
    expect(forced.changeFlag.significant).toBe(true);
    expect(forced.changeFlag.reasons).toContain('סומן כשינוי מהותי על ידי העורך');
    const suppressed = await republish((s) => { s.phases[0].steps[0].outcomes = [{ kind: 'ok', text: 'סיום' }]; }, { significantChange: false });
    expect(suppressed.changeFlag).toMatchObject({ significant: false, refreshAssignments: 0 });
  });

  it('completion and dashboard are world-scoped for managers', async () => {
    const billingLead = await makeUser(db.pool, { scopes: ['billing'], name: 'ראש צוות חיובים' });
    const c = (await app.inject({ method: 'GET', url: `/api/v1/learning/items/${quizId}/completion`, headers: auth(billingLead) })).json();
    expect(c.rows.every((r: { worldSlugs: string[] }) => r.worldSlugs.includes('billing'))).toBe(true);
    const d = (await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(billingLead) })).json();
    expect(d.totals.assigned).toBeGreaterThanOrEqual(1);
    const all = (await app.inject({ method: 'GET', url: '/api/v1/learning/dashboard', headers: auth(manager) })).json();
    expect(all.totals.assigned).toBeGreaterThanOrEqual(d.totals.assigned);
  });
```
(`minimalStructure` shape: read `apps/api/test/helpers/fixtures.ts:41+`; if steps do not carry `outcomes`/`title` at the paths used above, adjust the mutators to the real shape.)

- [ ] **Step 2: Run to verify failure** — `changeFlag` undefined in the publish response.

- [ ] **Step 3: Write `refresh.ts`**
```ts
import type { Block, ChangeFlag, Document } from '@wecom/shared';
import { makeEvent } from '@wecom/shared';
import type { Tx } from '../../../lib/sql.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { detectSignificantChange } from './changeDetector.js';
import { createAssignments, type TrackingDeps } from './audiences.js';
import { getPublishedItem, itemSourceVersions, listItemsReferencing } from './itemsPort.js';

export interface ChangeFlagInput {
  documentId: string;
  version: number;
  before: Document;
  after: Document;
  blocks: Map<string, Block>;
  fieldNames: string[];
  override?: boolean;
  actorId: string | null;
}

const OVERRIDE_REASON = 'סומן כשינוי מהותי על ידי העורך';

/**
 * Spec §1.5. Detection runs on every publish and is recorded; the editor's checkbox overrides the
 * verdict either way. A significant publish invalidates every assignment of a learning item whose
 * current version pins this document at an older version and hands each affected user a refresh
 * assignment (reason `refresh`) due in `learning.refreshDueDays`.
 */
export async function applyChangeFlag(tx: Tx, deps: Pick<TrackingDeps, 'notifier' | 'events'>, i: ChangeFlagInput): Promise<ChangeFlag> {
  const detected = detectSignificantChange(i.before, i.after, i.blocks, i.fieldNames);
  let significant = detected.significant;
  let reasons = detected.reasons;
  if (i.override === true) {
    significant = true;
    reasons = detected.significant ? [...detected.reasons, OVERRIDE_REASON] : [OVERRIDE_REASON];
  } else if (i.override === false) {
    significant = false;
    reasons = [];
  }
  await tx.query(
    `insert into document_change_flags(document_id, version, significant, reasons, decided_by) values ($1,$2,$3,$4,$5)
     on conflict (document_id, version) do update set significant=excluded.significant, reasons=excluded.reasons, decided_by=excluded.decided_by`,
    [i.documentId, i.version, significant, JSON.stringify(reasons), i.actorId],
  );
  if (!significant) return { significant, reasons, affectedItems: 0, refreshAssignments: 0 };

  const settings = await getWorkflowSettings(tx);
  // Published items whose current version pins this document below the version just published.
  const affected: { itemId: string; itemVersion: number }[] = [];
  for (const it of await listItemsReferencing(tx, i.documentId)) {
    if (it.status !== 'published') continue;
    const pins = await itemSourceVersions(tx, it.itemId, it.currentVersion);
    if (pins.some((p) => p.documentId === i.documentId && p.version < i.version))
      affected.push({ itemId: it.itemId, itemVersion: it.currentVersion });
  }
  const users = new Set<string>();
  let refreshAssignments = 0;
  const reason = `שינוי מהותי במסמך "${i.after.title}" (גרסה ${i.version})`;
  for (const it of affected) {
    const inv = await tx.query(
      `update learning_assignments set status='invalidated', invalidated_at=now(), invalidated_reason=$3
        where item_id=$1 and item_version=$2 and status in ('open','overdue','completed') returning user_id`,
      [it.itemId, it.itemVersion, reason],
    );
    const pub = await getPublishedItem(tx, it.itemId);
    if (!pub) continue;
    const userIds = [...new Set(inv.rows.map((r) => r.user_id as string))];
    const r = await createAssignments(tx, deps, {
      item: pub.item, userIds, reason: 'refresh', dueDays: settings.learning.refreshDueDays, refreshReason: reason, actorId: i.actorId,
    });
    refreshAssignments += r.assigned;
    for (const u of userIds) users.add(u);
  }
  await deps.events.publish(tx, makeEvent('learning.refresh_required', { documentId: i.documentId, version: i.version, affectedUsers: users.size }));
  return { significant, reasons, affectedItems: affected.length, refreshAssignments };
}
```
Note the unique key `(item_id, user_id, item_version, reason)`: a second significant publish of the same document while a refresh is still open for the same item version hits the conflict and is skipped — the user already has the refresh; the earlier assignment's `refresh_reason` stands.

- [ ] **Step 4: Wire the publish route** — in `apps/api/src/modules/documents/routes.ts`, publish handler, immediately after the `repo.publishDocument(...)` call and before the feedback block:
```ts
        // V2: knowledge refresh — record the change flag; a significant change fans out refresh assignments.
        const changeFlag = await applyChangeFlag(tx, { notifier: app.notifier, events: app.events }, {
          documentId: id, version, before, after: doc,
          blocks: await repo.loadBlocksMap(tx), fieldNames: await repo.loadFieldNames(tx),
          override: body.significantChange, actorId: user.id,
        });
```
and change the transaction's return to `return { document: doc, version, auditId, changeFlag };`. Add the import `import { applyChangeFlag } from '../learning/tracking/refresh.js'; // V2: knowledge refresh on publish`. Nine lines plus the import; nothing else in the file changes. (`loadBlocksMap` / `loadFieldNames` exist at `documents/repo.ts:543`, `:571`.)

- [ ] **Step 5: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/learning-tracking.test.ts test/documents.test.ts` → PASS (documents tests still green: `changeFlag` is optional in `PublishResponseSchema`).

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/learning/tracking/refresh.ts apps/api/src/modules/documents/routes.ts apps/api/test/learning-tracking.test.ts
git commit -m "feat(api): wave 5 V2 — change flag on publish, invalidation and refresh assignments"
```

---

### Task 8: OpenAPI, full gate, lane report

**Files:**
- Modify: `docs/api/openapi.json` (regenerate)
- Create: `.superpowers/sdd/program/V2-report.md` (git-ignored, worktree only)

- [ ] **Step 1: Regenerate and check** — root `pnpm openapi`; `git diff --stat docs/api/openapi.json` shows only the eleven V2 paths and `changeFlag`; the contract test in `apps/api/test/health.test.ts` passes.
- [ ] **Step 2: Gate** — `pnpm -r build`, `pnpm typecheck`, `pnpm --filter @wecom/shared test`, `cd apps/api && pnpm vitest run test/unit`, `RUN_INTEGRATION=1 pnpm test:int` (known flakes under load: `boss.test.ts`, `sources/routes.test.ts` — re-run in isolation before calling them red), `pnpm lint`.
- [ ] **Step 3: Report** — per task: status, commits, test counts; deviations; the D1–D5 decisions; **for V6**: the publish-route hunk (exact lines), `detectSignificantChange` signature, the `itemsPort` functions V6 re-points at V1 (`getPublishedItem`, `itemSourceVersions`, `listItemsReferencing`, `needsUpdateFor`, `documentSnapshotFor`) and the two V2-owned ones V1's `assembleCard` should call (`assignmentStats`, `needsUpdate`), the FKs 0042 must add (`learning_audiences.item_id`, `learning_assignments.item_id` → `learning_items`), the pinned `answers` object shape, that `collab/reviews.ts` approve path must call `applyChangeFlag` if it publishes without going through the documents publish route, and the mount points V4a needs (`/learning`, `/learning/:assignmentId`, article banner data from `GET /documents/:id/learning`).
- [ ] **Step 4: Commit** — `chore(api): regenerate OpenAPI for wave 5 V2 routes`

## Self-review

- Spec coverage: §1.3 audiences (Task 4/6), §1.4 acknowledgement + pass mark + unlimited retakes with an optional cap (Tasks 3/4/5), §1.5 detector + override + invalidation + refresh + due date + notification + event (Tasks 3/7), §1.8 `needsUpdate` on affected items (Task 7), §3 tables (Task 1), §4 all eleven Assignments routes plus the publish hook (Tasks 5/7), §5 player payload with pinned phases and `changedSinceAssigned` (Task 4), reminders (Task 6), world-scoped manager views (Task 4/7 test).
- Placeholders: none; the two SQL clean-ups in Task 4 are stated as instructions with the exact replacement query.
- Type consistency: `TrackingDeps` defined once in `audiences.ts` and imported everywhere; `PublishedItem`/`StoredQuestion` from `itemsPort.ts`; `AnswerInput` from `scoring.ts`; `applyChangeFlag` returns `ChangeFlag` exactly as `PublishResponseSchema.changeFlag` expects; route names match `CONTRACTS-wave5.md`; the port's V1-shaped exports match the coordinator's pins verbatim (`getPublishedItem → { item, version, sourceVersions }`, `listItemsReferencing → { itemId, kind, status, currentVersion }[]`, `needsUpdateFor`, `documentSnapshotFor`), `StartAttemptResponse` is `{ attemptId, attemptNo }` at 201, `answers` is the keyed object, `DocumentLearning.refreshAssignmentId` is filled.
- Not exposed: `GET /documents/:id/change-preview` (a dry-run of the detector for the publish dialog) — V4b can call `detectSignificantChange` only server-side; if the editor UI needs a live preview before publishing, V6 adds `GET /documents/:id/change-preview` returning `{ significant, reasons }` computed from the working structure vs the last published version (listed as a contract question).
