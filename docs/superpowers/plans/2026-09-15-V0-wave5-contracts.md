# V0 — Wave 5 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land on `main`, before any wave 5 lane is dispatched, every shared name lanes V1–V6 consume: the reconciled `packages/shared/src/schemas/wave5.ts`, five permissions and the `approver` system role (code + database), four events, two notification kinds, three queues, a shared workflow-settings reader, the publish-body/response extension, and `docs/api/CONTRACTS-wave5.md`.

**Architecture:** Additive to the existing contract layer (ADR 0001). `wave5.ts` already exists on main (commit 4662248, written against the draft spec); this plan reconciles it to the approved spec rather than rewriting it. Runtime glue reuses wave 4's holders (`app.notifier`, `app.taxonomy`, `app.usage`) unchanged. A single `getWorkflowSettings(db)` reader in `apps/api/src/lib/workflowSettings.ts` gives V2 and V3 one source of truth for defaults stored in `app_settings` under key `workflow`.

**Tech Stack:** TypeScript strict, zod 3, Fastify 5, node-pg-migrate, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` (§1 rulings incl. owner decisions, §2 lanes, §3 data model, §4 API).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run from the repo root with `pnpm --filter <pkg> <script>`.
- Schemas only in `packages/shared/src/schemas/wave5.ts` (+ the two additive fields in `api.ts`); never duplicated in apps.
- Append-only edits to `permissions.ts`, `events.ts`, `stage45.ts` (`NotificationKindSchema` only), `apps/api/src/plugins/boss.ts`.
- Migration for this plan: `apps/api/migrations/0038_wave5_permissions_settings.js`. Lanes own 0039 (V1), 0040 (V2), 0041 (V3), 0042 (V6). The wave-3 session owns 0037.
- Hebrew for user-facing labels; English identifiers; conventional commits ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Canonical names produced by this plan (lanes import these; do not rename)

| Concern | Name |
|---|---|
| Permissions | `learning.read` (agent+), `learning.manage` (editor+), `learning.publish` (lead+, approver), `gaps.read` (editor+), `gaps.manage` (lead+) |
| Role | `DEFAULT_ROLES.approver = ['docs.read','docs.read_unpublished','notes.write','docs.publish','suggestions.apply','learning.publish']` (system role, seeded by 0038) |
| Events | `learning.assigned { assignmentId, userId, itemId }`, `learning.completed { assignmentId, userId, itemId, passed }`, `learning.refresh_required { documentId, version, affectedUsers }`, `gap.detected { gapId, kind }` |
| Notification kinds | `NotificationKindSchema` += `'learning'`, `'gap'` (check constraint widened in 0038) |
| Queues | `QUEUES.learningResolveAudiences = 'learning.resolve_audiences'`, `QUEUES.learningReminders = 'learning.reminders'`, `QUEUES.gapsDetect = 'gaps.detect'` |
| Settings | `app_settings.key = 'workflow'` → `WorkflowSettings` JSON; reader `getWorkflowSettings(db): Promise<WorkflowSettings>` and writer `putWorkflowSettings(db, patch, actorId)` in `apps/api/src/lib/workflowSettings.ts`; `WORKFLOW_SETTINGS_KEY = 'workflow'` exported from `wave5.ts` |
| Schemas added | `SourceVersionSchema { documentId, version }`; `LearningItemSchema.sourceVersions` (default `[]`); `LearningVersionSchema.sourceVersions`; `WorkflowSettingsSchema.learning.defaultMaxAttempts` nullable default `null`; `PublishBodySchema.significantChange?: boolean`; `PublishResponseSchema.changeFlag?: ChangeFlag`; type aliases for every exported schema (`BriefingEntry, QuestionOption, LearningItemsQuery, LearningItemCreate, LearningItemPatch, PutEntriesBody, PutQuestionsBody, GenerateQuestionsBody, GenerateQuestionsResponse, LearningVersion, Audience, AudienceCreate, AssignBody, AssignmentStatus, AssignmentReason, MyLearningResponse, PlayerQuestion, AttemptAnswers, CompletionRow, CompletionResponse, DocumentLearning, ChangeFlag, WorkflowSettingsPut, GapKind, GapStatus, GapsQuery, GapsResponse, GapDismissBody, GapResolveBody, GapDetectResult, SourceVersion`) |

---

### Task 1: Reconcile `wave5.ts` with the approved spec

**Files:**
- Modify: `packages/shared/src/schemas/wave5.ts`
- Test: `packages/shared/test/wave5.test.ts` (create)

**Interfaces:**
- Consumes: existing exports of `wave5.ts` (see `grep -n "^export const" packages/shared/src/schemas/wave5.ts`), `IdSchema` from `./common.js`.
- Produces: the schema additions and type aliases in the canonical table.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/wave5.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  LearningItemSchema, LearningVersionSchema, WorkflowSettingsSchema, SourceVersionSchema,
  WORKFLOW_SETTINGS_KEY, type LearningItemCreate, type Gap,
} from '../src/index.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = '2026-09-15T10:00:00.000Z';

describe('wave5 schemas (approved spec)', () => {
  it('pins referenced document versions on items and versions', () => {
    expect(SourceVersionSchema.parse({ documentId: U, version: 3 })).toEqual({ documentId: U, version: 3 });
    const item = LearningItemSchema.parse({
      id: U, kind: 'quiz', title: 'q', description: '', worldSlug: null, status: 'draft', currentVersion: 0,
      passMark: 80, maxAttempts: null, estimatedMinutes: null, entries: [], questions: [],
      createdAt: T, updatedAt: T, createdBy: null, updatedBy: null, publishedAt: null,
    });
    expect(item.sourceVersions).toEqual([]);
    const v = LearningVersionSchema.parse({ itemId: U, version: 1, label: 'v1', authorId: null, authorName: 'x', createdAt: T, sourceVersions: [{ documentId: U, version: 2 }] });
    expect(v.sourceVersions[0].version).toBe(2);
  });
  it('defaults quizzes to unlimited attempts and pass mark 80', () => {
    const s = WorkflowSettingsSchema.parse({ learning: {}, gaps: {} });
    expect(s.learning.defaultMaxAttempts).toBeNull();
    expect(s.learning.defaultPassMark).toBe(80);
    expect(s.requireApprover).toBe(false);
    expect(WORKFLOW_SETTINGS_KEY).toBe('workflow');
  });
  it('exports type aliases (compile-time check)', () => {
    const c: LearningItemCreate = { kind: 'briefing', title: 'b' } as LearningItemCreate;
    const g = { id: U } as unknown as Gap;
    expect(c.kind).toBe('briefing');
    expect(g.id).toBe(U);
  });
});
```
If `LearningItemSchema`'s required fields differ from the literal above, read the schema (`packages/shared/src/schemas/wave5.ts:36-53`) and adjust the literal to the minimal valid object — the assertions stay.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/shared test -- wave5` → FAIL (`SourceVersionSchema` not exported).

- [ ] **Step 3: Implement**

In `wave5.ts`, after the imports:
```ts
export const WORKFLOW_SETTINGS_KEY = 'workflow' as const;
/** A referenced document pinned at the version the learner saw (owner decision, spec §1.1). */
export const SourceVersionSchema = z.object({ documentId: IdSchema, version: z.number().int().nonnegative() });
export type SourceVersion = z.infer<typeof SourceVersionSchema>;
```
- `LearningItemSchema`: add `sourceVersions: z.array(SourceVersionSchema).default([])`.
- `LearningVersionSchema`: add `sourceVersions: z.array(SourceVersionSchema).default([])`.
- `WorkflowSettingsSchema.learning.defaultMaxAttempts`: `z.number().int().min(1).max(10).nullable().default(null)`.
- `LearningItemCreateSchema` / `LearningItemPatchSchema`: `maxAttempts` stays `nullable().optional()`; `passMark` optional (server fills from settings).
- Append `export type X = z.infer<typeof XSchema>` for every schema in the canonical table's alias list that lacks one (check `grep -n "^export type" wave5.ts`).

- [ ] **Step 4: Run** — `pnpm --filter @wecom/shared test` → PASS.
- [ ] **Step 5: Commit** — `feat(shared): wave 5 contracts reconciled to the approved spec (source versions, unlimited attempts, aliases)`

---

### Task 2: Permissions, approver role, events, notification kinds

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/events.ts`, `packages/shared/src/schemas/stage45.ts` (NotificationKindSchema only)
- Test: `packages/shared/test/permissions.test.ts`, `packages/shared/test/events.test.ts`

- [ ] **Step 1: Extend the expected lists** — permissions test: append `'learning.read','learning.manage','learning.publish','gaps.read','gaps.manage'` after `'analytics.read'`; add:
```ts
  it('wave 5 grants and the approver role', () => {
    expect(DEFAULT_ROLES.agent).toContain('learning.read');
    expect(DEFAULT_ROLES.editor).toEqual(expect.arrayContaining(['learning.manage', 'gaps.read']));
    expect(DEFAULT_ROLES.editor).not.toContain('learning.publish');
    expect(DEFAULT_ROLES.lead).toEqual(expect.arrayContaining(['learning.publish', 'gaps.manage']));
    expect([...DEFAULT_ROLES.approver]).toEqual(['docs.read', 'docs.read_unpublished', 'notes.write', 'docs.publish', 'suggestions.apply', 'learning.publish']);
    expect(DEFAULT_ROLES.approver).not.toContain('docs.edit');
  });
```
events test: append `'learning.assigned','learning.completed','learning.refresh_required','gap.detected'` after `'taxonomy.changed'`; add a `makeEvent('learning.completed', { assignmentId: id, userId: id, itemId: id, passed: true })` parse case and a negative case for `learning.refresh_required` missing `affectedUsers`.

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/shared test -- permissions events`.

- [ ] **Step 3: Implement**

`permissions.ts`: append the five names to `PERMISSIONS`; `agent` += `'learning.read'`; `editor` += `'learning.manage', 'gaps.read'`; `lead` += `'learning.publish', 'gaps.manage'`; add
```ts
/** System role switched on by `workflow.requireApprover` (spec §1.6); no editing rights. */
const approver: Permission[] = ['docs.read', 'docs.read_unpublished', 'notes.write', 'docs.publish', 'suggestions.apply', 'learning.publish'];
export const DEFAULT_ROLES = { agent, editor, lead, approver, admin: [...PERMISSIONS] } as const satisfies Record<string, readonly Permission[]>;
```
`events.ts`: append names and payloads:
```ts
  'learning.assigned': z.object({ assignmentId: IdSchema, userId: IdSchema, itemId: IdSchema }),
  'learning.completed': z.object({ assignmentId: IdSchema, userId: IdSchema, itemId: IdSchema, passed: z.boolean() }),
  'learning.refresh_required': z.object({ documentId: IdSchema, version: z.number().int(), affectedUsers: z.number().int() }),
  'gap.detected': z.object({ gapId: IdSchema, kind: z.string() }),
```
`stage45.ts`: append `'learning', 'gap'` to `NotificationKindSchema`.

- [ ] **Step 4: Run** — `pnpm --filter @wecom/shared test` → PASS (check `admin` equality test still passes since admin = all permissions).
- [ ] **Step 5: Commit** — `feat(shared): wave 5 permissions, approver role, events, notification kinds`

---

### Task 3: Queues and the workflow-settings reader

**Files:**
- Modify: `apps/api/src/plugins/boss.ts`
- Create: `apps/api/src/lib/workflowSettings.ts`
- Test: `apps/api/test/unit/workflowSettings.test.ts`

**Interfaces:**
- Produces: `QUEUES.learningResolveAudiences`, `QUEUES.learningReminders`, `QUEUES.gapsDetect`; `getWorkflowSettings(q: Q): Promise<WorkflowSettings>` (reads `app_settings` where `key = 'workflow'`, parses `value` through `WorkflowSettingsSchema` so defaults fill missing keys, returns pure defaults when the row is absent); `putWorkflowSettings(tx: Tx, patch: WorkflowSettingsPut, actorId: string | null): Promise<WorkflowSettings>` (deep-merges into the stored value, validates, upserts, returns the effective settings).

- [ ] **Step 1: Write the failing test** (unit, with a fake `q` object):
```ts
import { describe, it, expect } from 'vitest';
import { getWorkflowSettings, putWorkflowSettings } from '../../src/lib/workflowSettings.js';
import { QUEUES } from '../../src/plugins/boss.js';

const fakeDb = (rows: unknown[]) => {
  const calls: { text: string; values?: unknown[] }[] = [];
  return { calls, query: async (text: string, values?: unknown[]) => { calls.push({ text, values }); return { rows, rowCount: rows.length }; } };
};
describe('workflow settings', () => {
  it('returns schema defaults when no row exists', async () => {
    const s = await getWorkflowSettings(fakeDb([]) as never);
    expect(s.requireApprover).toBe(false);
    expect(s.learning.defaultMaxAttempts).toBeNull();
    expect(s.gaps.staleDays).toBe(180);
  });
  it('fills missing keys from defaults', async () => {
    const s = await getWorkflowSettings(fakeDb([{ value: { requireApprover: true, learning: { defaultPassMark: 70 } } }]) as never);
    expect(s.requireApprover).toBe(true);
    expect(s.learning.defaultPassMark).toBe(70);
    expect(s.learning.refreshDueDays).toBe(7);
  });
  it('deep-merges a patch and upserts under key workflow', async () => {
    const db = fakeDb([{ value: { requireApprover: false, learning: { defaultPassMark: 70 } } }]);
    const s = await putWorkflowSettings(db as never, { gaps: { staleDays: 90 } }, null);
    expect(s.learning.defaultPassMark).toBe(70);
    expect(s.gaps.staleDays).toBe(90);
    const upsert = db.calls.find((c) => /insert into app_settings/i.test(c.text));
    expect(upsert?.values?.[0]).toBe('workflow');
  });
  it('registers the wave 5 queues', () => {
    expect(QUEUES.learningResolveAudiences).toBe('learning.resolve_audiences');
    expect(QUEUES.learningReminders).toBe('learning.reminders');
    expect(QUEUES.gapsDetect).toBe('gaps.detect');
  });
});
```
- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm vitest run test/unit/workflowSettings.test.ts`.
- [ ] **Step 3: Implement**

`boss.ts` `QUEUES` append:
```ts
  learningResolveAudiences: 'learning.resolve_audiences', // V2: nightly re-resolve audiences → assignments
  learningReminders: 'learning.reminders', // V2: due-soon / overdue reminders
  gapsDetect: 'gaps.detect', // V3: nightly gap heuristics
```
`apps/api/src/lib/workflowSettings.ts`:
```ts
import { WORKFLOW_SETTINGS_KEY, WorkflowSettingsSchema, type WorkflowSettings, type WorkflowSettingsPut } from '@wecom/shared';
import type { Q, Tx } from './sql.js';

const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out: Record<string, unknown> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue;
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
      ? deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  }
  return out;
};

/** Effective workflow settings: stored JSON (key `workflow`) parsed through the schema so defaults fill every gap. */
export async function getWorkflowSettings(q: Q): Promise<WorkflowSettings> {
  const r = await q.query('select value from app_settings where key=$1', [WORKFLOW_SETTINGS_KEY]);
  const raw = (r.rows[0]?.value as Record<string, unknown> | undefined) ?? {};
  return WorkflowSettingsSchema.parse({ learning: {}, gaps: {}, ...raw });
}

export async function putWorkflowSettings(tx: Tx, patch: WorkflowSettingsPut, actorId: string | null): Promise<WorkflowSettings> {
  const r = await tx.query('select value from app_settings where key=$1 for update', [WORKFLOW_SETTINGS_KEY]);
  const stored = (r.rows[0]?.value as Record<string, unknown> | undefined) ?? {};
  const merged = deepMerge(stored, patch as Record<string, unknown>);
  const effective = WorkflowSettingsSchema.parse({ learning: {}, gaps: {}, ...merged });
  await tx.query(
    `insert into app_settings(key, value, updated_at, updated_by) values ($1, $2, now(), $3)
     on conflict (key) do update set value = excluded.value, updated_at = now(), updated_by = excluded.updated_by`,
    [WORKFLOW_SETTINGS_KEY, JSON.stringify(merged), actorId],
  );
  return effective;
}
```
(`Q`/`Tx` types: read `apps/api/src/lib/sql.ts`; `Q` is the pool-or-client query shape used across repos. If `for update` is not accepted by the fake in the unit test it is fine — the fake ignores SQL.)

- [ ] **Step 4: Run** — unit test PASS; `pnpm --filter @wecom/api typecheck` (or `pnpm typecheck`) clean.
- [ ] **Step 5: Commit** — `feat(api): wave 5 queues and workflow-settings reader/writer`

---

### Task 4: Migration 0038

**Files:**
- Create: `apps/api/migrations/0038_wave5_permissions_settings.js`
- Modify: `apps/api/test/migrations.test.ts`

- [ ] **Step 1: Add the assertion** (inside the existing integration describe):
```ts
  it('seeds wave 5 permissions, the approver role, and widens notification kinds', async () => {
    const p = await pool.query("select name from permissions where name in ('learning.read','learning.manage','learning.publish','gaps.read','gaps.manage') order by 1");
    expect(p.rows.map((r) => r.name)).toEqual(['gaps.manage', 'gaps.read', 'learning.manage', 'learning.publish', 'learning.read']);
    const role = await pool.query("select system from roles where name='approver'");
    expect(role.rows[0]?.system).toBe(true);
    const rp = await pool.query(`select rp.permission from role_permissions rp join roles r on r.id=rp.role_id where r.name='approver' order by 1`);
    expect(rp.rows.map((x) => x.permission)).toEqual(['docs.publish', 'docs.read', 'docs.read_unpublished', 'learning.publish', 'notes.write', 'suggestions.apply']);
    await pool.query(`insert into notifications(id, user_id, kind, title, body, href, entity_type, entity_id) select gen_random_uuid(), u.id, 'learning', 't', '', null, null, null from users u limit 1`).catch((e) => { throw new Error('learning kind rejected: ' + e.message); });
    const ws = await pool.query("select value from app_settings where key='workflow'");
    expect(ws.rowCount).toBe(1);
  });
```
(If the notifications table has no `users` row in this test DB, insert a throwaway user first the way neighbouring tests do — read `apps/api/test/migrations.test.ts` for the pattern; the point is that kind `learning` passes the check constraint.)

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts`.

- [ ] **Step 3: Write the migration**
```js
/** Wave 5 (V0): learning/gaps permissions, the `approver` system role, notification kinds, workflow settings row. */
const NEW = [['learning.read','learning'],['learning.manage','learning'],['learning.publish','learning'],['gaps.read','gaps'],['gaps.manage','gaps']];
const GRANTS = {
  agent: ['learning.read'],
  editor: ['learning.read', 'learning.manage', 'gaps.read'],
  lead: ['learning.read', 'learning.manage', 'gaps.read', 'learning.publish', 'gaps.manage'],
  admin: ['learning.read', 'learning.manage', 'gaps.read', 'learning.publish', 'gaps.manage'],
  approver: ['docs.read', 'docs.read_unpublished', 'notes.write', 'docs.publish', 'suggestions.apply', 'learning.publish'],
};
exports.up = (pgm) => {
  for (const [name, resource] of NEW)
    pgm.sql(`insert into permissions(name, resource) values ('${name}', '${resource}') on conflict (name) do nothing`);
  pgm.sql(`insert into roles(name, description, system) values ('approver', 'מאשר תוכן — מפרסם ללא זכויות עריכה', true) on conflict (name) do nothing`);
  for (const [role, perms] of Object.entries(GRANTS))
    for (const p of perms)
      pgm.sql(`insert into role_permissions(role_id, permission) select id, '${p}' from roles where name='${role}' on conflict do nothing`);
  pgm.dropConstraint('notifications', 'notifications_kind_check', { ifExists: true });
  pgm.addConstraint('notifications', 'notifications_kind_check', {
    check: "kind in ('suggestion','sync','mention','review','publish','system','feedback','source','learning','gap')",
  });
  pgm.sql(`insert into app_settings(key, value) values ('workflow', '{}'::jsonb) on conflict (key) do nothing`);
};
exports.down = (pgm) => {
  pgm.sql(`delete from app_settings where key='workflow'`);
  pgm.dropConstraint('notifications', 'notifications_kind_check', { ifExists: true });
  pgm.addConstraint('notifications', 'notifications_kind_check', {
    check: "kind in ('suggestion','sync','mention','review','publish','system','feedback','source')",
  });
  const list = NEW.map(([n]) => `'${n}'`).join(',');
  pgm.sql(`delete from role_permissions where permission in (${list})`);
  pgm.sql(`delete from role_permissions where role_id in (select id from roles where name='approver')`);
  pgm.sql(`delete from user_roles where role_id in (select id from roles where name='approver')`);
  pgm.sql(`delete from roles where name='approver'`);
  pgm.sql(`delete from permissions where name in (${list})`);
};
```
Verify against the real tables first: `roles` columns (`0002_identity.js`: name unique? description? system?), the exact current name of the notifications kind check constraint (`0026_notification_kinds.js` / `0035_wave4_fixups.js`), and the kinds it currently allows — copy the current list verbatim and append the two new ones; `down` restores exactly the current list.

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts` → PASS (including the down-to-empty case).
- [ ] **Step 5: Commit** — `feat(api): migration 0038 — wave 5 permissions, approver role, notification kinds, workflow settings`

---

### Task 5: Publish body/response, contracts document, plan index, gate

**Files:**
- Modify: `packages/shared/src/schemas/api.ts` (`PublishBodySchema`, `PublishResponseSchema`), `docs/superpowers/plans/README.md`, `docs/api/openapi.json` (regenerate)
- Create: `docs/api/CONTRACTS-wave5.md`
- Test: `packages/shared/test/wave5.test.ts` (add one case)

- [ ] **Step 1: Test** — add to `wave5.test.ts`:
```ts
  it('publish carries significantChange and returns changeFlag', () => {
    expect(PublishBodySchema.parse({ label: 'v', significantChange: true }).significantChange).toBe(true);
    expect(PublishResponseSchema.shape.changeFlag.isOptional()).toBe(true);
  });
```
- [ ] **Step 2: Implement** — in `api.ts`: `PublishBodySchema` += `significantChange: z.boolean().optional()`; `PublishResponseSchema` += `changeFlag: ChangeFlagSchema.optional()` (import from `./wave5.js`; confirm no import cycle: `wave5.ts` must import only `common.js`/`content.js`).
- [ ] **Step 3: Write `docs/api/CONTRACTS-wave5.md`** — same shape as `CONTRACTS-wave4.md`: header (schemas file, spec path), migrations table (0038 V0, 0039 V1, 0040 V2, 0041 V3, 0042 V6; 0037 wave-3 cleanup), the append-only shared-file list from wave 4 plus `stage45.ts NotificationKindSchema` (V0 only), the never-edit list (shell, ArticlePage, EditorPage, LibraryPage, ReviewsPage, IdentityPage — V6 mounts), then the route tables copied from spec §4 grouped by lane with `Requires` column:
  - V1: `GET /learning/items` (learning.read; non-managers see published only), `POST /learning/items` (learning.manage), `GET/PATCH/DELETE /learning/items/:id`, `PUT /learning/items/:id/entries`, `PUT /learning/items/:id/questions`, `POST /learning/items/:id/generate` (learning.manage), `POST /learning/items/:id/publish` (learning.publish; snapshots `sourceVersions`), `GET /learning/items/:id/versions`, `GET /learning/items/:id/preview` (learning.read).
  - V2: `POST /learning/items/:id/audiences`, `DELETE /learning/audiences/:id`, `POST /learning/items/:id/assign` (learning.manage); `GET /learning/my`, `GET /learning/my/:assignmentId`, `POST /learning/my/:assignmentId/acknowledge`, `POST /learning/my/:assignmentId/attempts`, `PUT /learning/attempts/:id` (learning.read, own assignment only); `GET /learning/items/:id/completion`, `GET /learning/dashboard?world` (learning.manage, world-scoped); `GET /documents/:id/learning` (docs.read); publish hook `significantChange` → `changeFlag`.
  - V3: `GET/PUT /admin/workflow` (system.admin), `GET /gaps` (gaps.read), `POST /gaps/:id/dismiss`, `POST /gaps/:id/resolve`, `POST /gaps/detect` (gaps.manage); review-decision returns 403 `APPROVER_REQUIRED` when `requireApprover` is on and the caller lacks the approver role.
  - Web routes: `/learning`, `/learning/:assignmentId`, `/learning/manage`, `/learning/manage/new`, `/learning/manage/:id`, `/gaps`; workflow section on `/admin/identity`; mounts by V6 (sidebar entries, article banners, publish dialog checkbox, review queue approver hint).
- [ ] **Step 4: Plan index** — append a "Wave 5" table to `docs/superpowers/plans/README.md` listing V0–V6 plan files (`2026-09-15-V0-wave5-contracts.md`, `V1-learning-content.md`, `V2-assignments-tracking.md`, `V3-approver-gaps.md`, `V4a-agent-web.md`, `V4b-editor-web.md`, `V6-integration.md`).
- [ ] **Step 5: Gate** — `pnpm -r build && pnpm typecheck && pnpm -r test` (web with `--minWorkers=1 --maxWorkers=4` if run directly) and `RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int`; regenerate OpenAPI with the root `pnpm openapi` script and confirm the contract test passes and the diff is only the two publish fields.
- [ ] **Step 6: Commit** — `docs(contracts): wave 5 route/migration contract; publish significantChange/changeFlag; plan index`, then append `Wave 5 V0 on main (<sha>)` to `.superpowers/sdd/program/progress.md` (git-ignored; do not commit it).

## Self-review
- Spec coverage: every V0 row of spec §2 has a task; §4 routes are fixed in the contract doc; owner decisions (unlimited attempts, source versions) are Task 1.
- Placeholders: none; where a value must be read from the repo (constraint name, roles columns) the step says exactly what to read and what to do with it.
- Type consistency: `SourceVersionSchema`, `WORKFLOW_SETTINGS_KEY`, `getWorkflowSettings/putWorkflowSettings`, queue keys and permission names match the canonical table.
