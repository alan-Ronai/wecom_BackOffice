# X3 — Suggestion Editing & Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an editor keep most of a suggestion and change a few rows (field-level structured editing with a stored diff), apply only part of a suggestion without silently dropping the rest (a remainder suggestion linked by `parent_id`), and measure how the pipeline is doing (acceptance analytics by type, source, model and prompt version).

**Architecture:** One pure module in `packages/shared/src/suggestions/structured.ts` turns every `SuggestionPayload` into stable, addressable rows (`rowsOf`), applies a `StructuredEdit` to a payload (`applyStructuredEdit` → new payload + diff) and splits a payload by selected row ids (`splitByParts` → applied payload + remainder). The API and X4a's structured editor both call the same functions, so the row ids the UI shows are the ids the server applies. The existing `SuggestionService` (`apps/api/src/modules/sources/suggestions.ts`) gains `editStructured` and a `parts`-aware `decide`; the existing `PUT /suggestions/:id/edit` route accepts either the legacy `editedPayload` or a `structuredEdit` (no second route). Analytics is one SQL aggregate over `suggestions` joined to `source_revisions`/`sources`, cached 60 s.

**Tech Stack:** TypeScript strict, zod 3, Fastify 5, pg 8, node-pg-migrate, vitest 2, `TtlCache` from `apps/api/src/modules/usage/cache.ts`, `hasColumn` probe from `apps/api/src/modules/feedback/repo.ts`.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` (§1.8 structured editing + partial apply, §1.9 acceptance analytics, §3 `suggestions` additive columns, §4.2). Contract: `docs/api/CONTRACTS-wave6.md`. Consumes the X0 plan `docs/superpowers/plans/2026-09-15-X0-wave6-contracts.md` (canonical names: `StructuredEditSchema`, `StructuredEditDiffSchema`, `AcceptSuggestionBodySchema`, `SuggestionAnalyticsQuerySchema`, `SuggestionAnalyticsSchema`, `SuggestionSchema.editDiff / appliedParts / affects / promptVersion / model`).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run from the repo root.
- Every request/response uses schemas from `@wecom/shared`; additive changes to `packages/shared/src/schemas/pipeline.ts` and `api.ts` only (`parentId` on `SuggestionSchema`, `structuredEdit` on the edit body). Never edit `stage45.ts`, `wave4.ts`, `wave5.ts`, `wave6.ts` beyond an appended export if X0 missed one (say so in the report).
- Migration for this lane: `apps/api/migrations/0053_wave6_suggestion_edits.js`. `checkOrder` is on; do not create any other number.
- X1 (parallel) adds `suggestions.affects`, `suggestions.prompt_version`, `suggestions.model` in 0051. X3 must be green **without** them: analytics probes the two columns with `hasColumn` and groups by `'—'` when absent. Never write those columns from X3.
- `apps/api/test/route-coverage.test.ts` fails for any OpenAPI operation no integration test names by path: `GET /suggestions/analytics` and the `accept` body must appear literally in `apps/api/test/sources/routes.test.ts` (or a new file under `apps/api/test/`).
- Isolation (spec §7): append-only touches to `apps/api/src/modules/index.ts` (none expected — the sources module is already registered), `packages/shared/src/schemas/index.ts` (one export line). Never edit `apps/web/**`, `app.ts`, other lanes' modules. The only existing files X3 modifies are `apps/api/src/modules/sources/suggestions.ts`, `apps/api/src/modules/sources/routes.ts`, `packages/shared/src/schemas/{pipeline,api}.ts`, `apps/api/test/migrations.test.ts`, `apps/api/test/sources/{suggestions,routes}.test.ts`.
- Hebrew for user-facing messages; English identifiers; conventional commits ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Docker is available for testcontainers; known full-suite flakes: `boss.test.ts`, `sources/routes.test.ts` (re-run in isolation before calling red).

## File structure

```
apps/api/migrations/0053_wave6_suggestion_edits.js        (new) edit_diff, applied_parts, parent_id, indexes
packages/shared/src/suggestions/structured.ts             (new) rowsOf, applyStructuredEdit, splitByParts, NotSplittableError
packages/shared/src/suggestions/index.ts                  (new) re-exports
packages/shared/src/index.ts                              (modify: export * from './suggestions/index.js')
packages/shared/src/schemas/pipeline.ts                   (modify: SuggestionSchema += parentId)
packages/shared/src/schemas/api.ts                        (modify: SuggestionDecisionBodySchema += structuredEdit)
packages/shared/test/suggestions-structured.test.ts       (new) one describe per payload type
apps/api/src/modules/sources/suggestions.ts               (modify: row(), editStructured, decide(parts), analytics)
apps/api/src/modules/sources/analytics.ts                 (new) suggestionAnalytics(q, query) — SQL + cache
apps/api/src/modules/sources/routes.ts                    (modify: edit body union, accept body, GET /suggestions/analytics)
apps/api/test/migrations.test.ts                          (modify: 0053 assertions)
apps/api/test/sources/suggestions.test.ts                 (modify: structured edit, partial apply, remainder)
apps/api/test/sources/routes.test.ts                      (modify: analytics route, accept-with-parts route)
docs/api/CONTRACTS-wave6.md                               (modify: X3 rows — route stays PUT, body union, NOT_SPLITTABLE)
```

## Decisions recorded in this plan

- **Route name:** spec §4.2 says `PATCH /suggestions/:id/edit`; the live route the web already calls is `PUT /suggestions/:id/edit` (`apps/api/src/modules/sources/routes.ts:186`). X3 keeps **PUT** and widens its body to `{ editedPayload? } | { structuredEdit? }` (exactly one required). No PATCH is added; the contract doc row is corrected. Cost if wrong: none — one route, one body.
- **Row id scheme** (stable across edits; X4a renders these):
  - `update-step`: `add-<i>` (one per `addActions[i]`, individually selectable), `rep-<action.id>` (one per `replaceActions[]`, **atomic group `replace`**), `branch` (the whole `branch`, single row), `out-<i>` (one per `outcomes[i]`, **atomic group `outcomes`**), `patch-<key>` (one per `patch` key, individually selectable).
  - `new-card`: `meta` (title, description, category, wave, priority — required, cannot be removed), `step-<p>-<s>` (one per step, individually selectable; a phase with no remaining steps is dropped).
  - `new-step`: `meta` (afterStepKey, title — required), `act-<i>`, `out-<i>` (both individually selectable; **at least one action must remain**).
  - `update-block`: `act-<action.id>` (**atomic group `actions`** — the payload is the block's full new action list, a subset would delete actions), `script`.
  - `deprecate-step`: `reason` (single, required).
  - `field-alert`: `alert` (single, required).
- **Atomic groups and splittability.** `splitByParts` refuses a `parts` selection that cuts through an atomic group or drops a required row with `NotSplittableError` → HTTP 400 `NOT_SPLITTABLE` (Hebrew message names the group). `deprecate-step` and `field-alert` are whole-or-nothing. `update-block` is whole-or-nothing except that `script` can be left out.
- **Partial apply mechanics.** `POST /suggestions/:id/accept` with `parts`: the original row's payload is narrowed to the selected rows (its `edited_payload` is set to the applied subset, `applied_parts` = the selected row ids) and it proceeds through the normal accepted → applied path; the unapplied rows become a **remainder suggestion**: a new `suggestions` row of the same type, revision, anchor, targets, `parent_id` = original, `status='pending'`, `title` = original title + ` (המשך)`, `payload` = the remainder payload. Nothing is silently dropped; the queue shows the remainder next to its parent. Cost if wrong: an editor sees one extra card per partial apply.
- **`edit_diff` is always derived on the server** from `payload` vs `edited_payload` via `applyStructuredEdit` (structured path) or a row-wise comparison (legacy full-payload path), so analytics can count "edited then accepted" without trusting the client.

## Cross-lane names consumed

- X0: `StructuredEditSchema` (`{ type: SuggestionType, rows: { rowId: string, op: 'keep'|'edit'|'remove', value?: unknown }[] }`, discriminated by `type`), `StructuredEditDiffSchema` (`{ rows: { rowId, op, before?, after? }[] }`), `AcceptSuggestionBodySchema` (`{ parts?: string[] }`), `SuggestionAnalyticsQuerySchema` (`{ from?, to?, sourceId?, type? }`), `SuggestionAnalyticsSchema` (`{ total, byType[], bySource[], byModel[], byPromptVersion[], rates { accepted, edited, rejected }, meanMinutesToDecision }`), `SuggestionSchema.editDiff?`, `.appliedParts?`.
- Existing: `SuggestionService` (`apps/api/src/modules/sources/suggestions.ts:79`), `row()` mapper (`:40`), `decide()` (`:181`), `edit()` (`:240`), `applyOne()` (`:253`), `publishAccepted()` (`:389`); routes at `apps/api/src/modules/sources/routes.ts:140-231`; `SuggestionDecisionBodySchema` (`packages/shared/src/schemas/api.ts:204`); `TtlCache` (`apps/api/src/modules/usage/cache.ts`); `hasColumn(q, table, column)` (`apps/api/src/modules/feedback/repo.ts`); test helpers `withDb`, `integration` (`apps/api/test/helpers/l5/db.ts`), `seedUser`, `seedDocument`, `seedBlock`, `seedField`, `contentStub`, `readDocument` (`apps/api/test/helpers/l5/stubs.ts`).

---

### Task 1: Migration 0053 — `edit_diff`, `applied_parts`, `parent_id`, indexes

**Files:**
- Create: `apps/api/migrations/0053_wave6_suggestion_edits.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: table `suggestions` from `0005_sources_pipeline.js` (`id, source_revision_id, anchor, type, title, target_*, payload, edited_payload, confidence, rationale, status, decided_by, decided_at, applied_version_id, created_at`).
- Produces: columns `suggestions.edit_diff jsonb null`, `suggestions.applied_parts jsonb null`, `suggestions.parent_id uuid null references suggestions(id) on delete set null`; indexes `suggestions_status_decided_idx (status, decided_at)`, `suggestions_parent_idx (parent_id)`.

- [ ] **Step 1: Add the assertion** to the existing integration `describe` in `apps/api/test/migrations.test.ts` (place it before the wave-4-only rollback case, which aborts mid-rollback — see the note V3 left there):

```ts
  it('0053 adds the structured-edit columns and indexes to suggestions', async () => {
    const cols = await pool.query(
      `select column_name, data_type, is_nullable from information_schema.columns
        where table_name='suggestions' and column_name in ('edit_diff','applied_parts','parent_id') order by 1`,
    );
    expect(cols.rows).toEqual([
      { column_name: 'applied_parts', data_type: 'jsonb', is_nullable: 'YES' },
      { column_name: 'edit_diff', data_type: 'jsonb', is_nullable: 'YES' },
      { column_name: 'parent_id', data_type: 'uuid', is_nullable: 'YES' },
    ]);
    const idx = await pool.query(
      `select indexname from pg_indexes where tablename='suggestions' and indexname in ('suggestions_status_decided_idx','suggestions_parent_idx') order by 1`,
    );
    expect(idx.rows.map((r) => r.indexname)).toEqual(['suggestions_parent_idx', 'suggestions_status_decided_idx']);
    const fk = await pool.query(
      `select confdeltype from pg_constraint where conname='suggestions_parent_id_fkey'`,
    );
    expect(fk.rows[0]?.confdeltype).toBe('n'); // on delete set null
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts -t "0053"`
Expected: FAIL — zero rows for the three columns.

- [ ] **Step 3: Write the migration**

`apps/api/migrations/0053_wave6_suggestion_edits.js`:
```js
/**
 * Wave 6 (X3): field-level suggestion editing and partial apply.
 *
 * `edit_diff` is the server-derived row diff between `payload` and `edited_payload`
 * (analytics counts "edited then accepted" from it, not from the client). `applied_parts`
 * records which row ids a partial accept applied. `parent_id` links a remainder suggestion
 * (the rows a partial accept left out, re-queued as a pending suggestion) to its original —
 * `on delete set null` so purging a parent never cascades into an editor's pending work.
 */
exports.up = (pgm) => {
  pgm.addColumns('suggestions', {
    edit_diff: { type: 'jsonb' },
    applied_parts: { type: 'jsonb' },
    parent_id: { type: 'uuid', references: 'suggestions', onDelete: 'SET NULL' },
  });
  pgm.createIndex('suggestions', ['status', 'decided_at'], { name: 'suggestions_status_decided_idx' });
  pgm.createIndex('suggestions', 'parent_id', { name: 'suggestions_parent_idx' });
};

exports.down = (pgm) => {
  pgm.dropIndex('suggestions', 'parent_id', { name: 'suggestions_parent_idx' });
  pgm.dropIndex('suggestions', ['status', 'decided_at'], { name: 'suggestions_status_decided_idx' });
  pgm.dropColumns('suggestions', ['edit_diff', 'applied_parts', 'parent_id']);
};
```
node-pg-migrate names the FK `suggestions_parent_id_fkey` by default; if the generated name differs, read it from `pg_constraint` in the test rather than renaming the constraint.

- [ ] **Step 4: Run**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts`
Expected: PASS, including the roll-back-to-empty case.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/0053_wave6_suggestion_edits.js apps/api/test/migrations.test.ts
git commit -m "feat(api): migration 0053 — suggestion edit_diff, applied_parts, parent_id"
```

---

### Task 2: Shared structured-edit module — `rowsOf`, `applyStructuredEdit`, `splitByParts`

**Files:**
- Create: `packages/shared/src/suggestions/structured.ts`, `packages/shared/src/suggestions/index.ts`
- Modify: `packages/shared/src/index.ts` (append `export * from './suggestions/index.js';`), `packages/shared/src/schemas/pipeline.ts` (`SuggestionSchema` += `parentId: IdSchema.nullable().optional()`), `packages/shared/src/schemas/api.ts` (`SuggestionDecisionBodySchema`)
- Test: `packages/shared/test/suggestions-structured.test.ts`

**Interfaces:**
- Consumes: `SuggestionPayload`, `SuggestionPayloadSchema`, `SuggestionType` from `./schemas/pipeline.js`; `StructuredEdit`, `StructuredEditDiff` from `./schemas/wave6.js`.
- Produces (X4a renders these; the API applies them):
```ts
export interface SuggestionRow {
  rowId: string;            // scheme in "Decisions recorded in this plan"
  group: string;            // 'add' | 'replace' | 'branch' | 'outcomes' | 'patch' | 'meta' | 'steps' | 'actions' | 'script' | 'reason' | 'alert'
  atomic: boolean;          // true → the whole group is applied or none of it
  required: boolean;        // true → cannot be removed / left out of parts
  label: string;            // Hebrew label for the editor ("הוראה חדשה", "אפשרות בהסתעפות", …)
  value: unknown;           // the row's editable value (string | Action | Outcome | Branch | Step | Record)
  editable: 'text' | 'action' | 'outcome' | 'branch' | 'step' | 'json' | 'none';
}
export function rowsOf(payload: SuggestionPayload): SuggestionRow[];
export function applyStructuredEdit(payload: SuggestionPayload, edit: StructuredEdit): { payload: SuggestionPayload; diff: StructuredEditDiff };
export function diffPayloads(before: SuggestionPayload, after: SuggestionPayload): StructuredEditDiff; // row-wise, for the legacy full-payload edit path
export class NotSplittableError extends Error { constructor(public readonly group: string, message: string) }
export function splitByParts(payload: SuggestionPayload, parts: string[]): { applied: SuggestionPayload; remainder: SuggestionPayload | null };
```
`StructuredEditDiff.rows[].op` is `'edit' | 'remove'` only (kept rows are not listed); `before`/`after` carry the row values.

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/suggestions-structured.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  rowsOf,
  applyStructuredEdit,
  diffPayloads,
  splitByParts,
  NotSplittableError,
  type SuggestionPayload,
} from '../src/index.js';

const updateStep: SuggestionPayload = {
  type: 'update-step',
  addActions: ['ודא ניתוק מ-Wi-Fi', 'הרץ Speedtest'],
  replaceActions: [{ id: 'a1', text: 'בדוק APN' }, { id: 'a2', text: 'אתחל מכשיר' }],
  branch: { q: 'יש קליטה?', options: [{ kind: 'if', label: 'כן', text: 'המשך', goto: 's2' }] },
  outcomes: [{ kind: 'ok', text: 'נפתר' }, { kind: 'next', text: 'המשך', goto: 's9' }],
  patch: { hint: 'טיפ חדש', tone: 'alert' },
};
const newCard: SuggestionPayload = {
  type: 'new-card', title: 'כרטיס', description: '', category: 'tech', wave: 1, priority: 'h',
  phases: [{ id: 'p1', label: '', steps: [
    { key: 's1', num: '1', title: 'שלב א', actions: [{ id: 'a1', text: 'עשה' }], outcomes: [], blockRefs: [], deps: [] },
    { key: 's2', num: '2', title: 'שלב ב', actions: [{ id: 'a1', text: 'עוד' }], outcomes: [], blockRefs: [], deps: [] },
  ] }],
};
const newStep: SuggestionPayload = { type: 'new-step', afterStepKey: 's3', title: 'שלב חדש', actions: ['א', 'ב'], outcomes: [{ kind: 'ok', text: 'סיום' }] };
const updateBlock: SuggestionPayload = { type: 'update-block', actions: [{ id: 'b1', text: 'ראשון' }, { id: 'b2', text: 'שני' }], script: 'תסריט' };
const deprecate: SuggestionPayload = { type: 'deprecate-step', reason: 'בוטל' };
const alert: SuggestionPayload = { type: 'field-alert', fieldName: 'sim block lbl', issue: 'unknown' };

describe('rowsOf', () => {
  it('update-step rows follow the id scheme and mark atomic groups', () => {
    const rows = rowsOf(updateStep);
    expect(rows.map((r) => r.rowId)).toEqual(['add-0', 'add-1', 'rep-a1', 'rep-a2', 'branch', 'out-0', 'out-1', 'patch-hint', 'patch-tone']);
    expect(rows.find((r) => r.rowId === 'rep-a1')).toMatchObject({ group: 'replace', atomic: true, required: false });
    expect(rows.find((r) => r.rowId === 'out-1')).toMatchObject({ group: 'outcomes', atomic: true });
    expect(rows.find((r) => r.rowId === 'add-1')).toMatchObject({ group: 'add', atomic: false, editable: 'text', value: 'הרץ Speedtest' });
  });
  it('new-card has a required meta row and one row per step', () => {
    expect(rowsOf(newCard).map((r) => r.rowId)).toEqual(['meta', 'step-0-0', 'step-0-1']);
    expect(rowsOf(newCard)[0]).toMatchObject({ required: true, editable: 'json' });
  });
  it('new-step, update-block, deprecate-step, field-alert', () => {
    expect(rowsOf(newStep).map((r) => r.rowId)).toEqual(['meta', 'act-0', 'act-1', 'out-0']);
    expect(rowsOf(updateBlock).map((r) => r.rowId)).toEqual(['act-b1', 'act-b2', 'script']);
    expect(rowsOf(updateBlock)[0]).toMatchObject({ group: 'actions', atomic: true });
    expect(rowsOf(deprecate)).toMatchObject([{ rowId: 'reason', required: true }]);
    expect(rowsOf(alert)).toMatchObject([{ rowId: 'alert', required: true }]);
  });
});

describe('applyStructuredEdit', () => {
  it('edits and removes rows of an update-step and reports the diff', () => {
    const { payload, diff } = applyStructuredEdit(updateStep, {
      type: 'update-step',
      rows: [
        { rowId: 'add-0', op: 'edit', value: 'ודא ניתוק מ-Wi-Fi לפני הבדיקה' },
        { rowId: 'add-1', op: 'remove' },
        { rowId: 'patch-tone', op: 'remove' },
        { rowId: 'out-0', op: 'edit', value: { kind: 'ok', text: 'נפתר – תעד' } },
      ],
    });
    if (payload.type !== 'update-step') throw new Error('type');
    expect(payload.addActions).toEqual(['ודא ניתוק מ-Wi-Fi לפני הבדיקה']);
    expect(payload.patch).toEqual({ hint: 'טיפ חדש' });
    expect(payload.outcomes?.[0]).toEqual({ kind: 'ok', text: 'נפתר – תעד' });
    expect(payload.replaceActions).toEqual(updateStep.type === 'update-step' ? updateStep.replaceActions : []);
    expect(diff.rows.map((r) => [r.rowId, r.op])).toEqual([['add-0', 'edit'], ['add-1', 'remove'], ['out-0', 'edit'], ['patch-tone', 'remove']]);
    expect(diff.rows[0]).toMatchObject({ before: 'ודא ניתוק מ-Wi-Fi', after: 'ודא ניתוק מ-Wi-Fi לפני הבדיקה' });
  });
  it('rejects removing a required row, an unknown row id, and a type mismatch', () => {
    expect(() => applyStructuredEdit(deprecate, { type: 'deprecate-step', rows: [{ rowId: 'reason', op: 'remove' }] })).toThrow(/required/);
    expect(() => applyStructuredEdit(newStep, { type: 'new-step', rows: [{ rowId: 'act-9', op: 'edit', value: 'x' }] })).toThrow(/unknown row/);
    expect(() => applyStructuredEdit(newStep, { type: 'update-step', rows: [] } as never)).toThrow(/type/);
  });
  it('new-step keeps at least one action', () => {
    expect(() => applyStructuredEdit(newStep, { type: 'new-step', rows: [{ rowId: 'act-0', op: 'remove' }, { rowId: 'act-1', op: 'remove' }] })).toThrow(/at least one action/);
  });
  it('validates edited values against the payload schema', () => {
    expect(() => applyStructuredEdit(updateStep, { type: 'update-step', rows: [{ rowId: 'out-0', op: 'edit', value: { kind: 'nope', text: 'x' } }] })).toThrow();
  });
  it('is idempotent: applying an all-keep edit returns an equal payload and an empty diff', () => {
    const { payload, diff } = applyStructuredEdit(newCard, { type: 'new-card', rows: rowsOf(newCard).map((r) => ({ rowId: r.rowId, op: 'keep' as const })) });
    expect(payload).toEqual(newCard);
    expect(diff.rows).toEqual([]);
  });
});

describe('diffPayloads (legacy full-payload edit)', () => {
  it('reports row-wise edits between two payloads of the same type', () => {
    const after: SuggestionPayload = { ...updateBlock, actions: [{ id: 'b1', text: 'ראשון!' }, { id: 'b2', text: 'שני' }] } as SuggestionPayload;
    expect(diffPayloads(updateBlock, after).rows).toEqual([{ rowId: 'act-b1', op: 'edit', before: { id: 'b1', text: 'ראשון' }, after: { id: 'b1', text: 'ראשון!' } }]);
  });
});

describe('splitByParts', () => {
  it('splits an update-step into applied and remainder, respecting atomic groups', () => {
    const { applied, remainder } = splitByParts(updateStep, ['add-0', 'patch-hint']);
    if (applied.type !== 'update-step' || remainder?.type !== 'update-step') throw new Error('type');
    expect(applied).toEqual({ type: 'update-step', addActions: ['ודא ניתוק מ-Wi-Fi'], patch: { hint: 'טיפ חדש' } });
    expect(remainder.addActions).toEqual(['הרץ Speedtest']);
    expect(remainder.replaceActions).toHaveLength(2);
    expect(remainder.branch).toBeTruthy();
    expect(remainder.outcomes).toHaveLength(2);
    expect(remainder.patch).toEqual({ tone: 'alert' });
  });
  it('a whole atomic group may be selected; a partial one may not', () => {
    expect(() => splitByParts(updateStep, ['rep-a1'])).toThrow(NotSplittableError);
    const { applied } = splitByParts(updateStep, ['rep-a1', 'rep-a2']);
    if (applied.type !== 'update-step') throw new Error('type');
    expect(applied.replaceActions).toHaveLength(2);
    expect(applied.addActions).toEqual([]);
  });
  it('new-card: meta is always applied; unselected steps become the remainder', () => {
    const { applied, remainder } = splitByParts(newCard, ['step-0-1']);
    if (applied.type !== 'new-card' || remainder?.type !== 'new-card') throw new Error('type');
    expect(applied.phases[0].steps.map((s) => s.key)).toEqual(['s2']);
    expect(remainder.phases[0].steps.map((s) => s.key)).toEqual(['s1']);
  });
  it('selecting every row yields no remainder; whole-or-nothing types refuse subsets', () => {
    expect(splitByParts(deprecate, ['reason']).remainder).toBeNull();
    expect(() => splitByParts(updateBlock, ['act-b1'])).toThrow(NotSplittableError);
    expect(splitByParts(updateBlock, ['act-b1', 'act-b2']).remainder).toEqual({ type: 'update-block', actions: [], script: 'תסריט' });
    expect(() => splitByParts(alert, [])).toThrow(NotSplittableError);
  });
  it('new-step: the applied part keeps meta and at least one action', () => {
    expect(() => splitByParts(newStep, ['out-0'])).toThrow(/at least one action/);
    const { applied, remainder } = splitByParts(newStep, ['act-0']);
    if (applied.type !== 'new-step') throw new Error('type');
    expect(applied.actions).toEqual(['א']);
    expect(remainder).toMatchObject({ type: 'new-step', actions: ['ב'], outcomes: [{ kind: 'ok', text: 'סיום' }] });
  });
});
```
(`update-block` with `script` left out: the remainder is `{ actions: [], script }` — an actions-less update-block is rejected by `splitByParts` as a *remainder that cannot be applied*; the test above documents the shape and Task 4's service turns an unappliable remainder into "no remainder, note in audit". Adjust the expectation to `null` if you implement that in shared instead — state which in the report.)

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- suggestions-structured`
Expected: FAIL — `rowsOf` is not exported.

- [ ] **Step 3: Implement `packages/shared/src/suggestions/structured.ts`**

```ts
import { SuggestionPayloadSchema, type SuggestionPayload } from '../schemas/pipeline.js';
import type { StructuredEdit, StructuredEditDiff } from '../schemas/wave6.js';
import type { Action, Outcome, Branch, Step, Phase } from '../schemas/content.js';

export interface SuggestionRow {
  rowId: string;
  group: string;
  atomic: boolean;
  required: boolean;
  label: string;
  value: unknown;
  editable: 'text' | 'action' | 'outcome' | 'branch' | 'step' | 'json' | 'none';
}

export class NotSplittableError extends Error {
  constructor(
    public readonly group: string,
    message: string,
  ) {
    super(message);
    this.name = 'NotSplittableError';
  }
}

const L = {
  add: 'הוראה חדשה',
  replace: 'הוראה (החלפה מלאה)',
  branch: 'הסתעפות',
  outcomes: 'תוצאה',
  patch: 'שדה',
  meta: 'פרטי הכרטיס',
  step: 'שלב',
  action: 'הוראה',
  actions: 'הוראת בלוק',
  script: 'תסריט',
  reason: 'סיבת ההוצאה משימוש',
  alert: 'התראת שדה',
};

/** Every payload becomes an ordered list of addressable rows. Ids are stable across edits. */
export function rowsOf(p: SuggestionPayload): SuggestionRow[] {
  const rows: SuggestionRow[] = [];
  const push = (r: SuggestionRow) => rows.push(r);
  switch (p.type) {
    case 'update-step':
      p.addActions.forEach((t, i) => push({ rowId: `add-${i}`, group: 'add', atomic: false, required: false, label: L.add, value: t, editable: 'text' }));
      (p.replaceActions ?? []).forEach((a) => push({ rowId: `rep-${a.id}`, group: 'replace', atomic: true, required: false, label: L.replace, value: a, editable: 'action' }));
      if (p.branch !== undefined) push({ rowId: 'branch', group: 'branch', atomic: false, required: false, label: L.branch, value: p.branch, editable: 'branch' });
      (p.outcomes ?? []).forEach((o, i) => push({ rowId: `out-${i}`, group: 'outcomes', atomic: true, required: false, label: L.outcomes, value: o, editable: 'outcome' }));
      Object.entries(p.patch).forEach(([k, v]) => push({ rowId: `patch-${k}`, group: 'patch', atomic: false, required: false, label: `${L.patch} ${k}`, value: v, editable: 'json' }));
      return rows;
    case 'new-card':
      push({ rowId: 'meta', group: 'meta', atomic: false, required: true, label: L.meta, value: { title: p.title, description: p.description, category: p.category, wave: p.wave, priority: p.priority }, editable: 'json' });
      p.phases.forEach((ph, pi) => ph.steps.forEach((s, si) => push({ rowId: `step-${pi}-${si}`, group: 'steps', atomic: false, required: false, label: `${L.step} ${s.num || si + 1}`, value: s, editable: 'step' })));
      return rows;
    case 'new-step':
      push({ rowId: 'meta', group: 'meta', atomic: false, required: true, label: L.meta, value: { afterStepKey: p.afterStepKey, title: p.title }, editable: 'json' });
      p.actions.forEach((t, i) => push({ rowId: `act-${i}`, group: 'actions', atomic: false, required: false, label: L.action, value: t, editable: 'text' }));
      p.outcomes.forEach((o, i) => push({ rowId: `out-${i}`, group: 'outcomes', atomic: false, required: false, label: L.outcomes, value: o, editable: 'outcome' }));
      return rows;
    case 'update-block':
      p.actions.forEach((a) => push({ rowId: `act-${a.id}`, group: 'actions', atomic: true, required: false, label: L.actions, value: a, editable: 'action' }));
      if (p.script !== undefined) push({ rowId: 'script', group: 'script', atomic: false, required: false, label: L.script, value: p.script, editable: 'text' });
      return rows;
    case 'deprecate-step':
      return [{ rowId: 'reason', group: 'reason', atomic: false, required: true, label: L.reason, value: p.reason, editable: 'text' }];
    case 'field-alert':
      return [{ rowId: 'alert', group: 'alert', atomic: false, required: true, label: L.alert, value: { fieldName: p.fieldName, issue: p.issue }, editable: 'json' }];
  }
}

type RowOp = { rowId: string; op: 'keep' | 'edit' | 'remove'; value?: unknown };

/** Rebuilds a payload from a decision per row. `keep` for absent rows; unknown ids and required removals throw. */
function rebuild(p: SuggestionPayload, decide: (row: SuggestionRow) => { op: 'keep' | 'edit' | 'remove'; value?: unknown }): SuggestionPayload {
  const rows = rowsOf(p);
  const d = new Map(rows.map((r) => [r.rowId, decide(r)] as const));
  const keep = (id: string) => d.get(id)?.op !== 'remove';
  const val = <T>(id: string, orig: T): T => {
    const x = d.get(id);
    return x?.op === 'edit' ? (x.value as T) : orig;
  };
  for (const r of rows) if (r.required && d.get(r.rowId)?.op === 'remove') throw new Error(`required row cannot be removed: ${r.rowId}`);
  let out: SuggestionPayload;
  switch (p.type) {
    case 'update-step': {
      const patch: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(p.patch)) if (keep(`patch-${k}`)) patch[k] = val(`patch-${k}`, v);
      out = {
        type: 'update-step',
        addActions: p.addActions.map((t, i) => [`add-${i}`, t] as const).filter(([id]) => keep(id)).map(([id, t]) => val(id, t)),
        ...(p.replaceActions ? { replaceActions: p.replaceActions.filter((a) => keep(`rep-${a.id}`)).map((a) => val(`rep-${a.id}`, a)) } : {}),
        ...(p.branch !== undefined && keep('branch') ? { branch: val('branch', p.branch) } : {}),
        ...(p.outcomes ? { outcomes: p.outcomes.map((o, i) => [`out-${i}`, o] as const).filter(([id]) => keep(id)).map(([id, o]) => val(id, o)) } : {}),
        patch,
      };
      break;
    }
    case 'new-card': {
      const meta = val('meta', { title: p.title, description: p.description, category: p.category, wave: p.wave, priority: p.priority });
      const phases: Phase[] = p.phases
        .map((ph, pi) => ({ ...ph, steps: ph.steps.map((s, si) => [`step-${pi}-${si}`, s] as const).filter(([id]) => keep(id)).map(([id, s]) => val(id, s)) }))
        .filter((ph) => ph.steps.length > 0);
      out = { type: 'new-card', ...meta, phases };
      break;
    }
    case 'new-step': {
      const meta = val('meta', { afterStepKey: p.afterStepKey, title: p.title });
      const actions = p.actions.map((t, i) => [`act-${i}`, t] as const).filter(([id]) => keep(id)).map(([id, t]) => val(id, t));
      if (actions.length === 0) throw new Error('new-step must keep at least one action');
      out = { type: 'new-step', ...meta, actions, outcomes: p.outcomes.map((o, i) => [`out-${i}`, o] as const).filter(([id]) => keep(id)).map(([id, o]) => val(id, o)) };
      break;
    }
    case 'update-block':
      out = {
        type: 'update-block',
        actions: p.actions.filter((a) => keep(`act-${a.id}`)).map((a) => val(`act-${a.id}`, a)),
        ...(p.script !== undefined && keep('script') ? { script: val('script', p.script) } : {}),
      };
      break;
    case 'deprecate-step':
      out = { type: 'deprecate-step', reason: val('reason', p.reason) };
      break;
    case 'field-alert':
      out = { type: 'field-alert', ...val('alert', { fieldName: p.fieldName, issue: p.issue }) };
      break;
  }
  return SuggestionPayloadSchema.parse(out); // edited values must satisfy the payload schema
}

export function applyStructuredEdit(p: SuggestionPayload, edit: StructuredEdit): { payload: SuggestionPayload; diff: StructuredEditDiff } {
  if (edit.type !== p.type) throw new Error(`type mismatch: payload ${p.type}, edit ${edit.type}`);
  const known = new Set(rowsOf(p).map((r) => r.rowId));
  for (const r of edit.rows as RowOp[]) if (!known.has(r.rowId)) throw new Error(`unknown row: ${r.rowId}`);
  const ops = new Map((edit.rows as RowOp[]).map((r) => [r.rowId, r]));
  const payload = rebuild(p, (row) => ops.get(row.rowId) ?? { op: 'keep' });
  return { payload, diff: diffPayloads(p, payload) };
}

/** Row-wise diff of two payloads of the same type (removed rows and value changes; kept rows omitted). */
export function diffPayloads(before: SuggestionPayload, after: SuggestionPayload): StructuredEditDiff {
  const b = new Map(rowsOf(before).map((r) => [r.rowId, r.value]));
  const a = new Map(rowsOf(after).map((r) => [r.rowId, r.value]));
  const rows: StructuredEditDiff['rows'] = [];
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  // Position-based ids (add-i, out-i, act-i, step-p-s) shift when a row is removed; compare by value
  // membership for those groups so a removal is reported as `remove` rather than as N edits.
  const positional = /^(add|out|act|step)-/;
  const afterValues = [...a.entries()];
  for (const [id, v] of b) {
    if (positional.test(id)) {
      const hit = afterValues.find(([, w]) => same(v, w));
      if (hit) afterValues.splice(afterValues.indexOf(hit), 1);
      else rows.push({ rowId: id, op: 'remove', before: v });
    } else if (!a.has(id)) rows.push({ rowId: id, op: 'remove', before: v });
    else if (!same(v, a.get(id))) rows.push({ rowId: id, op: 'edit', before: v, after: a.get(id) });
  }
  // Positional rows left in `afterValues` are edits of removed-and-recreated rows: report as edits at their id.
  for (const [id, w] of afterValues) if (positional.test(id) && b.has(id)) rows.push({ rowId: id, op: 'edit', before: b.get(id), after: w });
  rows.sort((x, y) => x.rowId.localeCompare(y.rowId));
  return { rows };
}

/**
 * Partial apply: `parts` = row ids to apply now. Atomic groups are all-or-nothing, required rows are
 * always applied, and a remainder that could not itself be applied (e.g. an update-block with no
 * actions) is returned as `null`. Whole-or-nothing types (deprecate-step, field-alert) require all rows.
 */
export function splitByParts(p: SuggestionPayload, parts: string[]): { applied: SuggestionPayload; remainder: SuggestionPayload | null } {
  const rows = rowsOf(p);
  const sel = new Set(parts);
  const known = new Set(rows.map((r) => r.rowId));
  for (const id of sel) if (!known.has(id)) throw new NotSplittableError('unknown', `שורה לא מוכרת: ${id}`);
  if (p.type === 'deprecate-step' || p.type === 'field-alert') {
    if (!rows.every((r) => sel.has(r.rowId))) throw new NotSplittableError(p.type, 'הצעה מסוג זה מיושמת בשלמותה בלבד');
    return { applied: p, remainder: null };
  }
  for (const r of rows) if (r.required) sel.add(r.rowId);
  const groups = new Map<string, SuggestionRow[]>();
  for (const r of rows) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
  for (const [g, rs] of groups) {
    if (!rs[0].atomic) continue;
    const n = rs.filter((r) => sel.has(r.rowId)).length;
    if (n !== 0 && n !== rs.length) throw new NotSplittableError(g, `הקבוצה "${rs[0].label}" מיושמת בשלמותה או לא בכלל`);
  }
  if (p.type === 'update-block' && !groups.get('actions')?.every((r) => sel.has(r.rowId)))
    throw new NotSplittableError('actions', 'עדכון בלוק מחליף את כל ההוראות – יש לבחור את כולן');
  const applied = rebuild(p, (r) => ({ op: sel.has(r.rowId) ? 'keep' : 'remove' }));
  const allSelected = rows.every((r) => sel.has(r.rowId));
  if (allSelected) return { applied, remainder: null };
  let remainder: SuggestionPayload | null;
  try {
    remainder = rebuild(p, (r) => ({ op: sel.has(r.rowId) && !r.required ? 'remove' : 'keep' }));
  } catch {
    remainder = null; // e.g. new-step whose every action was applied: nothing appliable is left
  }
  if (remainder && rowsOf(remainder).every((r) => r.required)) remainder = null; // only meta left
  if (remainder?.type === 'update-block' && remainder.actions.length === 0) remainder = null;
  return { applied, remainder };
}
```
`packages/shared/src/suggestions/index.ts`: `export * from './structured.js';`. Append `export * from './suggestions/index.js';` to `packages/shared/src/index.ts`.

`pipeline.ts`: inside `SuggestionSchema`'s object add `parentId: IdSchema.nullable().optional(),` (X0 already added `affects`, `promptVersion`, `model`, `editDiff`, `appliedParts`; if any is missing, add it here and say so in the report).

`api.ts`:
```ts
import { StructuredEditSchema } from './wave6.js';
export const SuggestionDecisionBodySchema = z
  .object({ editedPayload: SuggestionPayloadSchema.optional(), structuredEdit: StructuredEditSchema.optional() })
  .refine((b) => (b.editedPayload ? 1 : 0) + (b.structuredEdit ? 1 : 0) === 1, { message: 'exactly one of editedPayload / structuredEdit' });
```
(check for an import cycle: `wave6.ts` must not import `api.ts`; it imports `pipeline.ts`/`common.ts` only.)

Fix the test expectation for the update-block remainder to `toBeNull()` (the implementation above returns `null` for an actions-less remainder) and keep the comment in the test explaining why.

- [ ] **Step 4: Run** — `pnpm --filter @wecom/shared test` → PASS (all files, including `pipeline.test.ts` and `api.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/suggestions packages/shared/src/index.ts packages/shared/src/schemas/pipeline.ts packages/shared/src/schemas/api.ts packages/shared/test/suggestions-structured.test.ts
git commit -m "feat(shared): structured suggestion rows — rowsOf, applyStructuredEdit, splitByParts, parentId"
```

---

### Task 3: `editStructured` in the service and the widened `PUT /suggestions/:id/edit`

**Files:**
- Modify: `apps/api/src/modules/sources/suggestions.ts` (`row()`, `edit()`, new `editStructured()`), `apps/api/src/modules/sources/routes.ts:186-211`
- Test: `apps/api/test/sources/suggestions.test.ts`, `apps/api/test/sources/routes.test.ts`

**Interfaces:**
- Produces: `SuggestionService.editStructured(id: string, edit: StructuredEdit, actorId: string): Promise<Suggestion>`; `edit()` now also stores `edit_diff` (from `diffPayloads(payload, edited)`); `row()` maps `edit_diff → editDiff`, `applied_parts → appliedParts`, `parent_id → parentId`. Error codes: 400 `TYPE_MISMATCH` (existing), 400 `UNKNOWN_ROW`, 400 `REQUIRED_ROW`, 409 `ALREADY_APPLIED` (existing).

- [ ] **Step 1: Write the failing service test** (append to the `run('SuggestionService', …)` block in `suggestions.test.ts`; reuse the file's seeding of `src`, `rev`, `uid`, `contentStub` pattern — read lines 1–120 for the exact helpers):

```ts
  it(
    'edits a suggestion field by field and records the diff',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const src = (await pool.query(`insert into sources(kind, title) values ('docx','נהלים') returning id`)).rows[0].id as string;
        const rev = (await pool.query(`insert into source_revisions(source_id, hash, paragraphs) values ($1,'h1','[]') returning id`, [src])).rows[0].id as string;
        const svc = new SuggestionService(pool, contentStub, { publish: async () => undefined });
        const [s] = await svc.createFromProposals(rev, [
          {
            anchor: '§4.8', type: 'update-step', title: 'סף', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null,
            payload: { type: 'update-step', addActions: ['א', 'ב'], patch: { hint: 'טיפ' } }, confidence: 0.9, rationale: 'r',
          },
        ]);
        const e = await svc.editStructured(s.id, { type: 'update-step', rows: [{ rowId: 'add-1', op: 'remove' }, { rowId: 'patch-hint', op: 'edit', value: 'טיפ מעודכן' }] }, uid);
        expect(e.editedPayload).toEqual({ type: 'update-step', addActions: ['א'], patch: { hint: 'טיפ מעודכן' } });
        expect(e.editDiff?.rows.map((r) => [r.rowId, r.op])).toEqual([['add-1', 'remove'], ['patch-hint', 'edit']]);
        // a second structured edit starts from the ORIGINAL payload, not the previous edit (ids stay stable)
        const e2 = await svc.editStructured(s.id, { type: 'update-step', rows: [{ rowId: 'add-0', op: 'edit', value: 'א!' }] }, uid);
        expect(e2.editedPayload).toEqual({ type: 'update-step', addActions: ['א!', 'ב'], patch: { hint: 'טיפ' } });
        await expect(svc.editStructured(s.id, { type: 'update-step', rows: [{ rowId: 'nope', op: 'remove' }] }, uid)).rejects.toMatchObject({ code: 'UNKNOWN_ROW' });
        await expect(svc.editStructured(s.id, { type: 'new-step', rows: [] } as never, uid)).rejects.toMatchObject({ code: 'TYPE_MISMATCH' });
        // legacy full-payload edit still works and now derives a diff too
        const e3 = await svc.edit(s.id, { type: 'update-step', addActions: ['א', 'ג'], patch: {} }, uid);
        expect(e3.editDiff?.rows.map((r) => r.rowId).sort()).toEqual(['add-1', 'patch-hint']);
      }),
    60_000,
  );
```
Note the decision encoded in the test: **every structured edit is applied to the original `payload`** (the UI always shows the original rows with the current edited values overlaid), so row ids never shift between edits. `edit_diff` therefore always means "original → current edited payload".

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sources/suggestions.test.ts -t "field by field"` → FAIL (`editStructured` is not a function).

- [ ] **Step 3: Implement**

In `suggestions.ts`:
```ts
import { applyStructuredEdit, diffPayloads, splitByParts, NotSplittableError, type StructuredEdit } from '@wecom/shared';
// row(): add after appliedVersionId
  editDiff: (r.edit_diff as Suggestion['editDiff']) ?? undefined,
  appliedParts: (r.applied_parts as string[] | null) ?? undefined,
  parentId: (r.parent_id as string | null) ?? null,
```
Replace `edit()` and add `editStructured()`:
```ts
  async edit(id: string, editedPayload: SuggestionPayload, actorId: string): Promise<Suggestion> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    const parsed = SuggestionPayloadSchema.parse(editedPayload);
    if (parsed.type !== cur.type) throw httpErr(400, 'TYPE_MISMATCH', 'סוג ההצעה אינו ניתן לשינוי (type)');
    return this.storeEdit(id, parsed, diffPayloads(cur.payload, parsed), actorId);
  }

  /** Field-level edit: always applied to the ORIGINAL payload so row ids stay stable across edits. */
  async editStructured(id: string, edit: StructuredEdit, actorId: string): Promise<Suggestion> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    if (edit.type !== cur.type) throw httpErr(400, 'TYPE_MISMATCH', 'סוג ההצעה אינו ניתן לשינוי (type)');
    let applied: ReturnType<typeof applyStructuredEdit>;
    try {
      applied = applyStructuredEdit(cur.payload, edit);
    } catch (e) {
      const m = (e as Error).message;
      if (/unknown row/.test(m)) throw httpErr(400, 'UNKNOWN_ROW', 'שורה לא מוכרת בהצעה: ' + m.split(': ')[1]);
      if (/required row/.test(m)) throw httpErr(400, 'REQUIRED_ROW', 'לא ניתן להסיר שורת חובה');
      if (/at least one action/.test(m)) throw httpErr(400, 'REQUIRED_ROW', 'שלב חדש חייב לכלול לפחות הוראה אחת');
      throw httpErr(400, 'VALIDATION', 'ערך לא תקין בשורה: ' + m);
    }
    return this.storeEdit(id, applied.payload, applied.diff, actorId);
  }

  private async storeEdit(id: string, payload: SuggestionPayload, diff: StructuredEditDiff, actorId: string): Promise<Suggestion> {
    const r = await this.pool.query(
      `update suggestions set edited_payload=$2, edit_diff=$3, decided_by=coalesce(decided_by,$4) where id=$1 returning *`,
      [id, JSON.stringify(payload), JSON.stringify(diff), actorId],
    );
    return row(r.rows[0]);
  }
```
(`StructuredEditDiff` type import from `@wecom/shared`.)

Route (`routes.ts:186-211`): keep the path and method, replace the handler body:
```ts
      async (req) => {
        const before = await deps.suggestions.get(req.params.id);
        const s = req.body.structuredEdit
          ? await deps.suggestions.editStructured(req.params.id, req.body.structuredEdit, actorId(req))
          : await deps.suggestions.edit(req.params.id, req.body.editedPayload!, actorId(req));
        await app.audit(req, 'suggestions.edit', 'suggestion', s.id,
          { payload: before.editedPayload ?? before.payload },
          { payload: s.editedPayload, diff: s.editDiff, structured: !!req.body.structuredEdit });
        return s;
      },
```
(The refine in `SuggestionDecisionBodySchema` guarantees exactly one of the two is present, so the `!` is safe; drop the old `if (!req.body.editedPayload) throw …` line.)

- [ ] **Step 4: Route test** — in `routes.test.ts` add a case that `PUT /api/v1/suggestions/${id}/edit` with `{ structuredEdit: { type: 'update-step', rows: [{ rowId: 'add-0', op: 'edit', value: 'x' }] } }` → 200 with `editDiff.rows[0].rowId === 'add-0'`, and that a body with both `editedPayload` and `structuredEdit` → 400 with the Hebrew `VALIDATION` envelope. Read how that file creates suggestions (it uploads a docx and processes it with `MODEL_DISABLED: true`; pick the first pending `update-step` or seed one directly through `SuggestionService.createFromProposals` as `suggestions.test.ts` does).

- [ ] **Step 5: Run** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sources/suggestions.test.ts test/sources/routes.test.ts` → PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sources/suggestions.ts apps/api/src/modules/sources/routes.ts apps/api/test/sources/suggestions.test.ts apps/api/test/sources/routes.test.ts
git commit -m "feat(api): structured suggestion edits with a stored diff on PUT /suggestions/:id/edit"
```

---

### Task 4: Partial apply — `POST /suggestions/:id/accept` with `parts` and the remainder suggestion

**Files:**
- Modify: `apps/api/src/modules/sources/suggestions.ts` (`decide()` signature, new `acceptParts()`), `apps/api/src/modules/sources/routes.ts:155-184` (the accept/reject/reset loop)
- Test: `apps/api/test/sources/suggestions.test.ts`, `apps/api/test/sources/routes.test.ts`

**Interfaces:**
- Consumes: `splitByParts`, `NotSplittableError` (Task 2); `AcceptSuggestionBodySchema` (X0).
- Produces: `SuggestionService.acceptParts(id: string, parts: string[], actorId: string): Promise<{ accepted: Suggestion; remainder: Suggestion | null }>`; `POST /suggestions/:id/accept` body `AcceptSuggestionBodySchema` (optional; absent or `parts` omitted = today's behaviour); response gains nothing — the remainder is a normal pending suggestion returned by `GET /suggestions` (with `parentId`); error 400 `NOT_SPLITTABLE { group }`.

- [ ] **Step 1: Write the failing service test** (append):

```ts
  it(
    'accepts part of a suggestion and re-queues the rest as a remainder',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const src = (await pool.query(`insert into sources(kind, title) values ('docx','נהלים') returning id`)).rows[0].id as string;
        const rev = (await pool.query(`insert into source_revisions(source_id, hash, paragraphs) values ($1,'h2','[]') returning id`, [src])).rows[0].id as string;
        const events: Event[] = [];
        const svc = new SuggestionService(pool, contentStub, { publish: async (_tx, e) => void events.push(e) });
        const [s] = await svc.createFromProposals(rev, [
          {
            anchor: '§4.8', type: 'update-step', title: 'סף', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null,
            payload: { type: 'update-step', addActions: ['א', 'ב'], outcomes: [{ kind: 'ok', text: 'נפתר' }], patch: { hint: 'טיפ' } }, confidence: 0.9, rationale: 'r',
          },
        ]);
        await expect(svc.acceptParts(s.id, ['out-0', 'add-0'], uid)).resolves.toBeTruthy(); // whole outcomes group + one add → fine
        const again = await svc.get(s.id);
        expect(again.status).toBe('accepted');
        expect(again.appliedParts).toEqual(['add-0', 'out-0']);
        expect(again.editedPayload).toEqual({ type: 'update-step', addActions: ['א'], outcomes: [{ kind: 'ok', text: 'נפתר' }], patch: {} });
        const list = await svc.list({ sourceId: src, page: 1, pageSize: 50 });
        const rem = list.items.find((x) => x.parentId === s.id)!;
        expect(rem).toMatchObject({ status: 'pending', type: 'update-step', anchor: '§4.8', targetDocumentId: D, targetStepKey: 's8', title: 'סף (המשך)' });
        expect(rem.payload).toEqual({ type: 'update-step', addActions: ['ב'], patch: { hint: 'טיפ' } });
        expect(events.filter((e) => e.name === 'suggestion.created')).toHaveLength(2); // original + remainder
        // not splittable: a partial atomic group
        const [s2] = await svc.createFromProposals(rev, [{ anchor: '§5', type: 'update-block', title: 'בלוק', targetDocumentId: null, targetStepKey: null, targetBlockId: B, payload: { type: 'update-block', actions: [{ id: 'b1', text: 'x' }, { id: 'b2', text: 'y' }] }, confidence: 0.8, rationale: 'r' }]);
        await expect(svc.acceptParts(s2.id, ['act-b1'], uid)).rejects.toMatchObject({ code: 'NOT_SPLITTABLE' });
        expect((await svc.get(s2.id)).status).toBe('pending');
        // selecting everything = a normal accept, no remainder
        const r3 = await svc.acceptParts(s2.id, ['act-b1', 'act-b2'], uid);
        expect(r3.remainder).toBeNull();
        expect((await svc.get(s2.id)).appliedParts).toBeUndefined();
        // publishAccepted applies the narrowed payload only
        await svc.publishAccepted(src, uid);
        const doc = await readDocument(pool, D);
        const st = doc.phases.flatMap((p) => p.steps).find((x) => x.key === 's8')!;
        expect(st.actions.map((a) => a.text)).toContain('א');
        expect(st.actions.map((a) => a.text)).not.toContain('ב');
      }),
    60_000,
  );
```
(`D`, `B`, `readDocument` and the seeded document come from the file's existing first test — seed the document again inside this test with `seedDocument(pool, doc)` using the same `doc` literal, or lift that literal to module scope; the block `B` must be seeded via `seedBlock` for the update-block case.)

- [ ] **Step 2: Run to verify failure** — `RUN_INTEGRATION=1 pnpm vitest run test/sources/suggestions.test.ts -t "remainder"` → FAIL.

- [ ] **Step 3: Implement `acceptParts`** in `suggestions.ts` (after `decide`):

```ts
  /**
   * Partial accept. The original row keeps the selected rows as its `edited_payload` (so the
   * normal accepted → applied path applies exactly those) and records `applied_parts`; the
   * unselected rows are re-queued as a pending remainder suggestion linked by `parent_id`, so
   * nothing an editor did not explicitly reject disappears from the queue.
   */
  async acceptParts(id: string, parts: string[], actorId: string): Promise<{ accepted: Suggestion; remainder: Suggestion | null }> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    const base = cur.editedPayload ?? cur.payload;
    let split: ReturnType<typeof splitByParts>;
    try {
      split = splitByParts(base, parts);
    } catch (e) {
      if (e instanceof NotSplittableError) {
        const err = httpErr(400, 'NOT_SPLITTABLE', e.message) as Error & { details?: unknown };
        err.details = { group: e.group };
        throw err;
      }
      throw e;
    }
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const allRows = split.remainder === null && JSON.stringify(split.applied) === JSON.stringify(base);
      const upd = await client.query(
        `update suggestions set status='accepted', decided_by=$2, decided_at=now(),
                edited_payload=$3, edit_diff=$4, applied_parts=$5 where id=$1 returning *`,
        [
          id,
          actorId,
          JSON.stringify(split.applied),
          JSON.stringify(diffPayloads(cur.payload, split.applied)),
          allRows ? null : JSON.stringify([...new Set(parts)].sort()),
        ],
      );
      const accepted = row(upd.rows[0]);
      let remainder: Suggestion | null = null;
      if (split.remainder) {
        const ins = await client.query(
          `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, target_block_id, payload, confidence, rationale, status, parent_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending',$11) returning *`,
          [cur.sourceRevisionId, cur.anchor, cur.type, cur.title + ' (המשך)', cur.targetDocumentId, cur.targetStepKey, cur.targetBlockId,
           JSON.stringify(split.remainder), cur.confidence, 'שארית של הצעה שיושמה חלקית · ' + cur.rationale, id],
        );
        remainder = row(ins.rows[0]);
        await this.events.publish(client, makeEvent('suggestion.created', { suggestionId: remainder.id, sourceId: (await client.query('select source_id from source_revisions where id=$1', [cur.sourceRevisionId])).rows[0].source_id, targetDocumentId: cur.targetDocumentId, type: cur.type }));
      }
      await this.events.publish(client, makeEvent('suggestion.decided', { suggestionId: id, status: 'accepted', actorId }));
      await client.query('commit');
      return { accepted, remainder };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }
```
Check `makeEvent('suggestion.created', …)`'s payload shape in `packages/shared/src/events.ts` (`{ suggestionId, sourceId, targetDocumentId, type }`) and match it exactly. If X1 has added `affects`/`prompt_version`/`model` columns by merge time, the remainder should copy them — add `, affects, prompt_version, model` to the insert **only** behind a `hasColumn` probe, or leave it to X6 (say which in the report).

Route: in the `for (const [action, status] …)` loop in `routes.ts`, give the `accept` registration a body schema and branch on `parts`:
```ts
        {
          schema: {
            tags: ['suggestions'],
            params: z.object({ id: IdSchema }),
            ...(action === 'accept' ? { body: AcceptSuggestionBodySchema.optional() } : {}),
            response: { 200: SuggestionSchema },
          },
          config: { requires: ['suggestions.review'] },
        },
        async (req) => {
          const before = await deps.suggestions.get(req.params.id);
          const parts = action === 'accept' ? (req.body as { parts?: string[] } | undefined)?.parts : undefined;
          const s = parts?.length
            ? (await deps.suggestions.acceptParts(req.params.id, parts, actorId(req))).accepted
            : await deps.suggestions.decide(req.params.id, status, actorId(req));
          await app.audit(req, 'suggestions.review', 'suggestion', s.id,
            { status: before.status },
            { status: s.status, type: s.type, targetDocumentId: s.targetDocumentId, ...(parts?.length ? { parts } : {}) });
          return s;
        },
```
(Fastify rejects an undefined body schema on POST only if configured to; a `.optional()` zod body accepts an empty body. If the type provider complains, register `accept` as its own `app.post` outside the loop with the body schema, and keep `reject`/`reset` in the loop.)

- [ ] **Step 4: Route test** — in `routes.test.ts`: `POST /api/v1/suggestions/${id}/accept` with `{ parts: ['add-0'] }` → 200, then `GET /api/v1/suggestions?sourceId=…` lists a pending row with `parentId === id`; `POST …/accept` with `{ parts: ['nope'] }` → 400 `NOT_SPLITTABLE`; `POST …/accept` with no body → 200 (legacy).

- [ ] **Step 5: Run** — both test files green; `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sources/suggestions.ts apps/api/src/modules/sources/routes.ts apps/api/test/sources/suggestions.test.ts apps/api/test/sources/routes.test.ts
git commit -m "feat(api): partial suggestion apply with a remainder suggestion (parent_id)"
```

---

### Task 5: Acceptance analytics — `GET /suggestions/analytics`

**Files:**
- Create: `apps/api/src/modules/sources/analytics.ts`
- Modify: `apps/api/src/modules/sources/routes.ts` (new route before `/suggestions/:id/*` registrations is not required — distinct path), `docs/api/CONTRACTS-wave6.md` (X3 rows)
- Test: `apps/api/test/sources/routes.test.ts`

**Interfaces:**
- Consumes: `SuggestionAnalyticsQuerySchema`, `SuggestionAnalyticsSchema` (X0); `TtlCache` (`apps/api/src/modules/usage/cache.ts` — read its constructor signature); `hasColumn` (`apps/api/src/modules/feedback/repo.ts`).
- Produces: `suggestionAnalytics(q: Queryable, query: SuggestionAnalyticsQuery): Promise<SuggestionAnalytics>`; route `GET /suggestions/analytics` (`suggestions.review`), 60 s cache keyed by the parsed query.

Definitions (state them in the file header — they are the contract for X4a's analytics tab):
- **decided** = `status in ('accepted','rejected','applied')`; **accepted** = `status in ('accepted','applied')`; **edited** = accepted **and** (`edit_diff` has ≥1 row **or** `applied_parts is not null`); **rejected** = `status='rejected'`.
- `rates.accepted = accepted / decided`, `rates.edited = edited / decided`, `rates.rejected = rejected / decided` (all `0` when `decided = 0`).
- `meanMinutesToDecision = avg(extract(epoch from decided_at - created_at) / 60)` over decided rows.
- Remainder rows (`parent_id is not null`) **count as suggestions in their own right** (they are decisions the editor still has to make); the `total` includes them.

- [ ] **Step 1: Write the failing route test** (in `routes.test.ts`, a new `it`): seed one source, one revision, three suggestions via `SuggestionService.createFromProposals` (two `update-step`, one `field-alert`); `PUT …/edit` the first with a structured edit then `POST …/accept` it; `POST …/reject` the second; leave the third pending; `GET /api/v1/suggestions/analytics?sourceId=<src>` → 200 with `total 3`, `rates { accepted: 0.5, edited: 0.5, rejected: 0.5 }`, `byType` containing `{ type: 'update-step', total: 2, accepted: 1, edited: 1, rejected: 1, pending: 0 }` and `{ type: 'field-alert', total: 1, pending: 1 }`, `bySource[0].sourceId === src`, `byModel` and `byPromptVersion` each a single bucket keyed `'—'` when X1's columns are absent, `meanMinutesToDecision` a number ≥ 0. Also assert a caller with only `docs.read` gets 403. Use the literal path string `'/api/v1/suggestions/analytics'` so `route-coverage.test.ts` sees it.

- [ ] **Step 2: Run to verify failure** — 404.

- [ ] **Step 3: Implement `analytics.ts`**

```ts
import type { SuggestionAnalytics, SuggestionAnalyticsQuery } from '@wecom/shared';
import type { Queryable } from '../../lib/sql.js';
import { hasColumn } from '../feedback/repo.js';
import { TtlCache } from '../usage/cache.js';

/**
 * Acceptance analytics for the suggestion pipeline (spec §1.9).
 * decided = accepted|rejected|applied; accepted = accepted|applied;
 * edited = accepted AND (edit_diff has rows OR applied_parts set); rates are over decided rows.
 * Remainder suggestions (parent_id set) count like any other row.
 * `model` / `prompt_version` are X1's columns; until 0051 is applied they bucket under '—'.
 */
const cache = new TtlCache<SuggestionAnalytics>(60_000, 200); // adapt to TtlCache's real constructor

const EDITED = `(g.status in ('accepted','applied') and (jsonb_array_length(coalesce(g.edit_diff->'rows','[]'::jsonb)) > 0 or g.applied_parts is not null))`;

export async function suggestionAnalytics(q: Queryable, query: SuggestionAnalyticsQuery): Promise<SuggestionAnalytics> {
  const key = JSON.stringify([query.from ?? null, query.to ?? null, query.sourceId ?? null, query.type ?? null]);
  const hit = cache.get(key);
  if (hit) return hit;
  const [hasModel, hasPrompt] = await Promise.all([hasColumn(q, 'suggestions', 'model'), hasColumn(q, 'suggestions', 'prompt_version')]);
  const params: unknown[] = [];
  const p = (v: unknown) => { params.push(v); return '$' + params.length; };
  const where: string[] = ['true'];
  if (query.from) where.push(`g.created_at >= ${p(query.from)}`);
  if (query.to) where.push(`g.created_at < ${p(query.to)}`);
  if (query.sourceId) where.push(`sr.source_id = ${p(query.sourceId)}`);
  if (query.type) where.push(`g.type = ${p(query.type)}`);
  const base = `from suggestions g join source_revisions sr on sr.id = g.source_revision_id join sources s on s.id = sr.source_id where ${where.join(' and ')}`;
  const agg = `count(*)::int total,
    count(*) filter (where g.status in ('accepted','applied'))::int accepted,
    count(*) filter (where ${EDITED})::int edited,
    count(*) filter (where g.status='rejected')::int rejected,
    count(*) filter (where g.status='pending')::int pending`;
  const modelExpr = hasModel ? `coalesce(g.model, '—')` : `'—'`;
  const promptExpr = hasPrompt ? `coalesce(g.prompt_version, '—')` : `'—'`;
  const [totals, byType, bySource, byModel, byPrompt] = await Promise.all([
    q.query(`select ${agg}, avg(extract(epoch from (g.decided_at - g.created_at))/60) filter (where g.decided_at is not null) mean_min ${base}`, params),
    q.query(`select g.type, ${agg} ${base} group by g.type order by g.type`, params),
    q.query(`select s.id source_id, s.title, ${agg} ${base} group by s.id, s.title order by total desc limit 50`, params),
    q.query(`select ${modelExpr} model, ${agg} ${base} group by 1 order by total desc`, params),
    q.query(`select ${promptExpr} prompt_version, ${agg} ${base} group by 1 order by total desc`, params),
  ]);
  const t = totals.rows[0] as { total: number; accepted: number; edited: number; rejected: number; pending: number; mean_min: string | null };
  const decided = t.accepted + t.rejected;
  const rate = (n: number) => (decided ? n / decided : 0);
  const bucket = (r: Record<string, unknown>) => ({ total: r.total as number, accepted: r.accepted as number, edited: r.edited as number, rejected: r.rejected as number, pending: r.pending as number });
  const out: SuggestionAnalytics = {
    total: t.total,
    byType: byType.rows.map((r) => ({ type: r.type, ...bucket(r) })),
    bySource: bySource.rows.map((r) => ({ sourceId: r.source_id, title: r.title, ...bucket(r) })),
    byModel: byModel.rows.map((r) => ({ model: r.model, ...bucket(r) })),
    byPromptVersion: byPrompt.rows.map((r) => ({ promptVersion: r.prompt_version, ...bucket(r) })),
    rates: { accepted: rate(t.accepted), edited: rate(t.edited), rejected: rate(t.rejected) },
    meanMinutesToDecision: t.mean_min === null ? null : Number(t.mean_min),
  };
  cache.set(key, out);
  return out;
}
export const resetSuggestionAnalyticsCache = () => cache.clear();
```
Read X0's `SuggestionAnalyticsSchema` and make the bucket field names match it exactly (if X0 named them differently — e.g. `promptVersion` vs `prompt_version` — the schema wins). If `SuggestionAnalyticsSchema.meanMinutesToDecision` is not nullable, return `0` instead of `null`.

Route (add near the `GET /suggestions` registration; the path has no `:id` so ordering does not matter):
```ts
    app.get(
      '/suggestions/analytics',
      {
        schema: { tags: ['suggestions'], querystring: SuggestionAnalyticsQuerySchema, response: { 200: SuggestionAnalyticsSchema } },
        config: { requires: ['suggestions.review'] },
      },
      async (req) => suggestionAnalytics(app.db, req.query),
    );
```
Call `resetSuggestionAnalyticsCache()` in the route test between mutations.

- [ ] **Step 4: Contract doc** — in `docs/api/CONTRACTS-wave6.md`, X3 rows: `PUT /suggestions/:id/edit` body `SuggestionDecisionBodySchema` (`editedPayload` **or** `structuredEdit`, exactly one) — note "spec §4.2 says PATCH; the live route is PUT and stays PUT"; `POST /suggestions/:id/accept` body `AcceptSuggestionBodySchema` (400 `NOT_SPLITTABLE { group }`; a remainder pending suggestion with `parentId` may be created); `GET /suggestions/analytics` (`suggestions.review`, 60 s cache) with the definitions above; `SuggestionSchema` += `parentId`; the row id scheme table from "Decisions recorded in this plan" (X4a renders it).

- [ ] **Step 5: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/sources/routes.test.ts test/route-coverage.test.ts` → PASS; `pnpm typecheck` clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/sources/analytics.ts apps/api/src/modules/sources/routes.ts apps/api/test/sources/routes.test.ts docs/api/CONTRACTS-wave6.md
git commit -m "feat(api): suggestion acceptance analytics (GET /suggestions/analytics)"
```

---

### Task 6: OpenAPI, full gate, lane report

**Files:**
- Modify: `docs/api/openapi.json`, `apps/web/src/api/schema.d.ts` (regenerated by the script only)
- Create: `.superpowers/sdd/program/X3-report.md` (git-ignored)

- [ ] **Step 1: Regenerate OpenAPI** — `pnpm openapi` (root script); confirm the diff adds exactly `GET /api/v1/suggestions/analytics`, the accept body, the widened edit body and `parentId`/`editDiff`/`appliedParts` on the suggestion schema, and nothing else.
- [ ] **Step 2: Gate** — `pnpm -r build && pnpm typecheck && pnpm lint`, `pnpm --filter @wecom/shared test`, `cd apps/api && pnpm vitest run test/unit` and `RUN_INTEGRATION=1 pnpm test:int` (re-run `boss.test.ts` / `sources/routes.test.ts` in isolation if they flake), `pnpm vitest run test/route-coverage.test.ts test/health.test.ts` (contract). Do **not** run the web suite (no web changes; `schema.d.ts` regen is enough for `pnpm typecheck`).
- [ ] **Step 3: Report** — `.superpowers/sdd/program/X3-report.md`: per-task status and commits, test counts, deviations (PUT vs PATCH; remainder null-cases; whether the remainder copies X1's columns), the exact exports for X4a (`rowsOf`, `applyStructuredEdit`, `splitByParts`, `NotSplittableError`, `SuggestionRow` shape, the row id scheme table, error codes `UNKNOWN_ROW`/`REQUIRED_ROW`/`NOT_SPLITTABLE`, the analytics definitions), and mount notes for X6 (the `/sources` page's card menu should offer "ערוך שורות" and a parts checklist on accept — X4a ships the components).
- [ ] **Step 4: Commit** — `docs(contract): openapi with suggestion analytics and structured edit bodies`.

---

## Self-review

- **Spec coverage:** §1.8 field-level editing (Task 2–3), partial apply with nothing dropped (Task 4, remainder + `parent_id`), stored original/edited/diff (`edit_diff`, Task 1/3); §1.9 acceptance analytics by type/source/model/prompt version with edited-accept separate (Task 5); §3 columns (Task 1); §4.2 routes (Tasks 3–5, with the PUT-not-PATCH decision recorded in the contract doc).
- **Placeholders:** none. The one behaviour left to the implementer's judgement (whether the remainder copies X1's `affects`/`model`/`prompt_version`) has both options stated and must be reported.
- **Type consistency:** row ids (`add-i`, `rep-<id>`, `branch`, `out-i`, `patch-<key>`, `meta`, `step-p-s`, `act-i`/`act-<id>`, `script`, `reason`, `alert`) are identical in `rowsOf`, `rebuild`, the tests and the contract doc; `NotSplittableError.group` feeds `details.group`; `acceptParts` returns `{ accepted, remainder }` and the route returns `accepted` only, as the contract says.
- **Isolation:** only the files in the File structure are touched; no web, no `app.ts`, no other lane's module; migration number 0053 only.
