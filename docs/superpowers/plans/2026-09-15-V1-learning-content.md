# V1 — Learning Content (API) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The authoring half of PRD §13 "למידה והדרכה": briefings and quizzes as standalone learning items derived from published documents, with rule-based + model-assisted question generation, curation, versioned publishing that pins the referenced document versions, and an agent-facing preview — every route of spec §4 "Learning content", against a real Postgres.

**Architecture:** One Fastify module `apps/api/src/modules/learning/` (registered by one line in `modules/index.ts`), the same shape as `modules/feedback/`: `repo.ts` (plain SQL through `pg`, assembles the shared `LearningItem`), `routes.ts` (zod-typed handlers, audit rows inside the write transaction), `fallback.ts` (pure, deterministic question generator over a `Document`), `generate.ts` (orchestrates rules + the local model), `index.ts`. Storage per spec §3: `learning_items`, `learning_item_versions` (jsonb snapshot with `sourceVersions`), `briefing_entries`, `quiz_questions`. Learners never read live rows — V2's player reads the latest published snapshot — so editing a published item is safe until the next publish. The model gets one additive optional method on `ModelClient` (`generateQuestions?`), implemented for Ollama with JSON mode + schema validation exactly like `proposeChanges`; when it is absent or fails, the rule generator is the answer and the response says `source: 'rules'`.

**Tech Stack:** Node 22, Fastify 5, fastify-type-provider-zod, pg 8, zod 3, `@wecom/shared` (`wave5.ts`), `@wecom/model`, vitest 2 + testcontainers.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md` §1.1, §1.2, §1.8, §3, §4 "Learning content", §5 "Builder". Contracts: `docs/superpowers/plans/2026-09-15-V0-wave5-contracts.md` (canonical names; V0 has landed on main) and `docs/api/CONTRACTS-wave5.md`.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root with `pnpm --filter <pkg> <script>`; integration tests need Docker (`RUN_INTEGRATION=1`).
- Schemas only from `@wecom/shared` (`wave5.ts`). The one addition this lane may make is **append-only** in `wave5.ts`: `LearningPreviewSchema` (Task 5). Nothing else in `packages/shared` is edited.
- Append-only touches to shared files: `apps/api/src/modules/index.ts` (one import + one list entry). Never edit `app.ts`, `stage45.ts`, anything under `apps/web/`.
- Migration for this lane: `apps/api/migrations/0039_learning_content.js` (V0 is 0038, V2 0040, V3 0041, V6 0042, the wave-3 session 0037).
- Permission strings only from `PERMISSIONS`: `learning.read`, `learning.manage`, `learning.publish`. Route config exactly `config: { requires: ['learning.manage'] }`.
- Every write runs inside `withTransaction` and writes an `audit()` row (`entityType: 'learning_item'`). No events (V2 owns `learning.*` events).
- Hebrew for user-facing strings, English identifiers; conventional commit per task ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Known flakes under a full parallel `test:int`: `boss.test.ts`, `sources/routes.test.ts` — re-run in isolation before calling them red.

## File structure

```
apps/api/migrations/0039_learning_content.js        four tables + indexes (new)
apps/api/src/modules/learning/repo.ts               SQL + assembly, publish snapshot, referencing helpers (new)
apps/api/src/modules/learning/fallback.ts           generateFromDocument(doc, perDocument, fieldNames) — pure (new)
apps/api/src/modules/learning/generate.ts           generateQuestions(deps, body) — rules + model merge (new)
apps/api/src/modules/learning/routes.ts             every §4 "Learning content" route (new)
apps/api/src/modules/learning/index.ts              module registration (new)
apps/api/src/modules/index.ts                       (modify: one import + list entry)
packages/model/src/contract.ts                      (modify, additive: QuestionContext, GeneratedQuestion, ModelClient.generateQuestions?)
packages/model/src/questions.ts                     prompt builder + parser for question generation (new)
packages/model/src/ollama.ts                        (modify: generateQuestions implementation)
packages/model/prompts/questions-v1.md              system prompt (new)
packages/shared/src/schemas/wave5.ts                (modify, append-only: LearningPreviewSchema)
apps/api/test/unit/learning-fallback.test.ts        (new)
apps/api/test/learning.test.ts                      integration (new)
apps/api/test/migrations.test.ts                    (modify: table assertions)
packages/model/test/questions.test.ts               (new)
```

## Canonical names this lane produces (V2/V4b/V6 consume; do not rename)

| Export | Signature |
|---|---|
| `getItem(q, id)` | `Promise<LearningItem \| null>` — live rows, any status, no visibility |
| `getPublishedItem(q, id)` | `Promise<{ item: LearningItem; version: number; sourceVersions: SourceVersion[] } \| null>` — the latest published **snapshot** (what learners see) |
| `itemSourceVersions(q, id, version)` | `Promise<SourceVersion[]>` — `sourceVersions` of one snapshot |
| `listItemsReferencing(q, documentId)` | `Promise<{ itemId: string; kind: 'briefing' \| 'quiz'; status: string; currentVersion: number }[]>` — items whose live entries/questions reference the document |
| `needsUpdateFor(q, itemIds)` | `Promise<Map<string, boolean>>` — the §1.8 status half; V2 extends it with its significant-change half |
| `assembleCard(q, id, viewer)` | `Promise<LearningItemCard>` — `assignedUsers`/`completionRate` are `0`/`null` until V2 fills them (V2 replaces the two subqueries in `cardSql`) |
| `documentSnapshotFor(q, entries)` | `Promise<PlayerEntry[]>` — entry + `documentTitle` + `phases` from the referenced document |
| `LearningPreviewSchema` | `PlayerItemSchema.omit({ assignment: true })` (shared, append-only) |
| Error codes | `400 DOCUMENT_NOT_PUBLISHED { documentId }`, `400 UNKNOWN_STEP { documentId, stepKey }`, `400 INVALID_QUIZ { reason }`, `400 EMPTY_BRIEFING`, `409 ITEM_ARCHIVED` |
| Audit actions | `learning.create`, `learning.patch`, `learning.entries`, `learning.questions`, `learning.publish`, `learning.archive`, `learning.delete` |

---

### Task 1: Migration 0039 — learning content tables

**Files:**
- Create: `apps/api/migrations/0039_learning_content.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: `documents`, `users`, `worlds(slug)` tables.
- Produces: `learning_items`, `learning_item_versions`, `briefing_entries`, `quiz_questions`.

- [ ] **Step 1: Add the failing assertion** (inside the existing `run('migrations', …)` block of `apps/api/test/migrations.test.ts`):

```ts
  it('creates the wave 5 learning content tables', async () => {
    const r = await pool.query(
      "select table_name from information_schema.tables where table_schema='public' and table_name in ('learning_items','learning_item_versions','briefing_entries','quiz_questions') order by 1",
    );
    expect(r.rows.map((x) => x.table_name)).toEqual(['briefing_entries', 'learning_item_versions', 'learning_items', 'quiz_questions']);
    const c = await pool.query(
      "select column_name from information_schema.columns where table_name='learning_items' and column_name in ('kind','status','pass_mark','max_attempts','world_slug','deleted_at') order by 1",
    );
    expect(c.rows.map((x) => x.column_name)).toEqual(['deleted_at', 'kind', 'max_attempts', 'pass_mark', 'status', 'world_slug']);
  });
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts` → FAIL (empty table list).

- [ ] **Step 3: Write the migration**

```js
/** Wave 5 (V1): learning items (briefings, quizzes), their versions, entries and questions. Spec §3. */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const now = (pgm) => ({ type: 'timestamptz', notNull: true, default: pgm.func('now()') });

exports.up = (pgm) => {
  pgm.createTable('learning_items', {
    id: id(pgm),
    kind: { type: 'text', notNull: true, check: "kind in ('briefing','quiz')" },
    title: { type: 'text', notNull: true },
    description: { type: 'text', notNull: true, default: '' },
    world_slug: { type: 'text', references: 'worlds(slug)', onUpdate: 'cascade' },
    status: { type: 'text', notNull: true, default: 'draft', check: "status in ('draft','published','archived')" },
    current_version: { type: 'integer', notNull: true, default: 0 },
    pass_mark: { type: 'integer', check: 'pass_mark between 1 and 100' },
    max_attempts: { type: 'integer', check: 'max_attempts between 1 and 10' }, // null = unlimited (owner decision)
    estimated_minutes: 'integer',
    created_by: { type: 'uuid', references: 'users' },
    updated_by: { type: 'uuid', references: 'users' },
    created_at: now(pgm),
    updated_at: now(pgm),
    published_at: 'timestamptz',
    deleted_at: 'timestamptz',
  });
  pgm.createIndex('learning_items', ['kind', 'status']);
  pgm.createIndex('learning_items', 'world_slug');

  pgm.createTable('learning_item_versions', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true, references: 'learning_items', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    snapshot: { type: 'jsonb', notNull: true }, // { item: LearningItem, sourceVersions: [{documentId, version}] }
    author_id: { type: 'uuid', references: 'users' },
    label: { type: 'text', notNull: true, default: '' },
    created_at: now(pgm),
  });
  pgm.addConstraint('learning_item_versions', 'learning_item_versions_unique', { unique: ['item_id', 'version'] });

  pgm.createTable('briefing_entries', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true, references: 'learning_items', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    document_id: { type: 'uuid', notNull: true, references: 'documents' },
    step_key: 'text',
    note: { type: 'text', notNull: true, default: '' },
  });
  pgm.createIndex('briefing_entries', 'item_id');
  pgm.createIndex('briefing_entries', 'document_id');

  pgm.createTable('quiz_questions', {
    id: id(pgm),
    item_id: { type: 'uuid', notNull: true, references: 'learning_items', onDelete: 'cascade' },
    position: { type: 'integer', notNull: true },
    document_id: { type: 'uuid', notNull: true, references: 'documents' },
    step_key: 'text',
    stem: { type: 'text', notNull: true },
    kind: { type: 'text', notNull: true, check: "kind in ('single','multi','order','free')" },
    options: { type: 'jsonb', notNull: true, default: '[]' }, // [{ id, text, correct }]
    explanation: { type: 'text', notNull: true, default: '' },
    generated: { type: 'boolean', notNull: true, default: false },
    model_conf: 'numeric(4,3)',
  });
  pgm.createIndex('quiz_questions', 'item_id');
  pgm.createIndex('quiz_questions', 'document_id');
};

exports.down = (pgm) => {
  pgm.dropTable('quiz_questions');
  pgm.dropTable('briefing_entries');
  pgm.dropTable('learning_item_versions');
  pgm.dropTable('learning_items');
};
```
`documents` rows are never hard-deleted while referenced (`references: 'documents'` without cascade is deliberate: an archived document keeps its entries so §1.8's flag can be computed; the trash purge already skips once-published documents, and a never-published draft cannot be referenced — Task 4 enforces "published only").

- [ ] **Step 4: Run** — `RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts` → PASS (up, assertions, down-to-empty).

- [ ] **Step 5: Commit** — `git add apps/api/migrations/0039_learning_content.js apps/api/test/migrations.test.ts && git commit -m "feat(api): migration 0039 — learning items, versions, briefing entries, quiz questions"`

---

### Task 2: Rule-based question generator (pure)

**Files:**
- Create: `apps/api/src/modules/learning/fallback.ts`
- Test: `apps/api/test/unit/learning-fallback.test.ts`

**Interfaces:**
- Consumes: `Document`, `Step`, `Phase` from `@wecom/shared`; `QuizQuestion` from `@wecom/shared`.
- Produces: `generateFromDocument(doc: Document, perDocument: number, fieldNames: readonly string[] = []): QuizQuestion[]`, `allSteps(doc): Step[]`, `optionId(i): string`.

Rules (spec §1.2), all deterministic — no randomness, so tests assert exact output:
1. **Branch step** → one `single` question per branch option: stem `בשלב "{step.title}", אם {option.label} — מה עושים?`, options = the texts of all branch options in document order, `correct` on the option matching this `option.text`, explanation = the branch question `q`. Skip a branch with fewer than 2 options.
2. **Outcome with `goto`** → `single`: stem `מה השלב הבא לאחר "{outcome.text}" בשלב "{step.title}"?`, options = titles of the goto step (correct) plus up to 3 other steps that follow in document order (wrapping around), explanation empty. Skip when the document has fewer than 2 steps.
3. **CRM field step** — an action whose text matches `/↗\s*שדה\s*"([^"]+)"/` or contains a name from `fieldNames` → `single`: stem `באיזה שדה CRM בודקים בשלב "{step.title}"?`, correct = the field, distractors = up to 3 other field names (first from `fieldNames`, then from other steps' matches), skip when fewer than 2 options in total.
4. **Ordering** — once per document when it has ≥3 steps: `order` question, stem `סדר את השלבים הבאים לפי סדר הביצוע ב"{doc.title}"`, options = the first four steps' titles in correct order, all `correct: true` (the player shuffles; scoring compares the submitted `optionIds` order to option order).
5. `kind: 'text'` documents (no phases) → `[]`.
Priority when capping to `perDocument`: branch → goto → field → order, stable by step position. Every question has `documentId = doc.id`, `stepKey` = the step (null for the order question), `generated: true`, `modelConf: null`. Option ids are `o1`, `o2`, … per question.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import type { Document } from '@wecom/shared';
import { generateFromDocument } from '../../src/modules/learning/fallback.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = '2026-09-15T10:00:00.000Z';
const base = { id: U, slug: 'r-01', title: 'ניתוק גלישה', description: '', category: 'tech', wave: 1, priority: 'h', kind: 'steps', status: 'published', currentVersion: 2, phases: [], related: [], createdAt: T, updatedAt: T } as unknown as Document;

const doc: Document = {
  ...base,
  phases: [
    {
      id: 'p1', label: 'סינון', steps: [
        { key: 's1', num: '1', title: 'בדיקת חסימה', actions: [{ id: 'a1', text: 'CRM ↗ שדה "גלישה בארץ"' }], outcomes: [{ kind: 'ok', text: 'לא חסום', goto: 's2' }], blockRefs: [], deps: [] },
        { key: 's2', num: '2', title: 'סוג מכשיר', actions: [], outcomes: [], blockRefs: [], deps: [],
          branch: { q: 'איזה מכשיר ללקוח?', options: [ { kind: 'if', label: 'אייפון', text: 'עבור לשלב 3', goto: 's3' }, { kind: 'if', label: 'אנדרואיד', text: 'בדוק APN', goto: 's4' } ] } },
        { key: 's3', num: '3', title: 'איפוס רשת', actions: [{ id: 'a1', text: 'הגדרות ↗ איפוס' }], outcomes: [{ kind: 'ok', text: 'סיום' }], blockRefs: [], deps: [] },
        { key: 's4', num: '4', title: 'הגדרת APN', actions: [{ id: 'a1', text: 'CRM ↗ שדה "APN"' }], outcomes: [{ kind: 'ok', text: 'סיום' }], blockRefs: [], deps: [] },
      ],
    },
  ],
} as Document;

describe('rule-based question generation', () => {
  it('turns a branch into one question per option with the branch texts as options', () => {
    const qs = generateFromDocument(doc, 10);
    const branch = qs.filter((q) => q.stepKey === 's2');
    expect(branch).toHaveLength(2);
    expect(branch[0].stem).toBe('בשלב "סוג מכשיר", אם אייפון — מה עושים?');
    expect(branch[0].options.map((o) => o.text)).toEqual(['עבור לשלב 3', 'בדוק APN']);
    expect(branch[0].options.map((o) => o.correct)).toEqual([true, false]);
    expect(branch[1].options.map((o) => o.correct)).toEqual([false, true]);
    expect(branch[0].explanation).toBe('איזה מכשיר ללקוח?');
  });
  it('turns a goto outcome into a next-step question with the goto step correct', () => {
    const q = generateFromDocument(doc, 10).find((x) => x.stepKey === 's1' && x.stem.startsWith('מה השלב הבא'))!;
    expect(q.options[0]).toEqual({ id: 'o1', text: 'סוג מכשיר', correct: true });
    expect(q.options.map((o) => o.text)).toEqual(['סוג מכשיר', 'איפוס רשת', 'הגדרת APN', 'בדיקת חסימה']);
  });
  it('asks which CRM field with other fields as distractors', () => {
    const q = generateFromDocument(doc, 10).find((x) => x.stepKey === 's1' && x.stem.startsWith('באיזה שדה'))!;
    expect(q.options.find((o) => o.correct)?.text).toBe('גלישה בארץ');
    expect(q.options.map((o) => o.text)).toContain('APN');
  });
  it('adds one ordering question for documents with three or more steps', () => {
    const q = generateFromDocument(doc, 10).find((x) => x.kind === 'order')!;
    expect(q.stepKey).toBeNull();
    expect(q.options.map((o) => o.text)).toEqual(['בדיקת חסימה', 'סוג מכשיר', 'איפוס רשת', 'הגדרת APN']);
    expect(q.options.every((o) => o.correct)).toBe(true);
  });
  it('caps per document in priority order and marks everything generated', () => {
    const qs = generateFromDocument(doc, 2);
    expect(qs).toHaveLength(2);
    expect(qs.every((q) => q.generated && q.modelConf === null && q.documentId === U)).toBe(true);
    expect(qs[0].stepKey).toBe('s2'); // branch first
  });
  it('returns nothing for a text document', () => {
    expect(generateFromDocument({ ...base, kind: 'text', phases: [] } as Document, 3)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd apps/api && pnpm vitest run test/unit/learning-fallback.test.ts` → FAIL (module missing).

- [ ] **Step 3: Implement `fallback.ts`**

```ts
import type { Document, QuizQuestion, Step } from '@wecom/shared';

export const optionId = (i: number) => 'o' + (i + 1);
export const allSteps = (doc: Document): Step[] => doc.phases.flatMap((p) => p.steps);
const FIELD_RE = /↗\s*שדה\s*"([^"]+)"/;

const opts = (texts: string[], correctIdx: number[]) =>
  texts.map((text, i) => ({ id: optionId(i), text, correct: correctIdx.includes(i) }));
const base = (doc: Document, stepKey: string | null, stem: string, kind: QuizQuestion['kind']) => ({
  documentId: doc.id,
  stepKey,
  stem,
  kind,
  explanation: '',
  generated: true,
  modelConf: null as number | null,
});

const fieldOf = (s: Step): string | null => {
  for (const a of s.actions) {
    const m = FIELD_RE.exec(a.text);
    if (m) return m[1];
  }
  return null;
};

/** Deterministic questions from a document's structure (spec §1.2). Priority: branch → goto → field → order. */
export function generateFromDocument(doc: Document, perDocument: number, fieldNames: readonly string[] = []): QuizQuestion[] {
  if (doc.kind === 'text') return [];
  const steps = allSteps(doc);
  const titleOf = new Map(steps.map((s) => [s.key, s.title]));
  const branch: QuizQuestion[] = [];
  const gotos: QuizQuestion[] = [];
  const fields: QuizQuestion[] = [];
  const docFields = steps.map(fieldOf).filter((f): f is string => !!f);

  steps.forEach((s, idx) => {
    if (s.branch && s.branch.options.length >= 2) {
      const texts = s.branch.options.map((o) => o.text);
      s.branch.options.forEach((o, i) =>
        branch.push({ ...base(doc, s.key, `בשלב "${s.title}", אם ${o.label} — מה עושים?`, 'single'), options: opts(texts, [i]), explanation: s.branch!.q }),
      );
    }
    if (steps.length >= 2)
      for (const o of s.outcomes) {
        if (!o.goto || !titleOf.has(o.goto)) continue;
        const others: string[] = [];
        for (let k = 1; k < steps.length && others.length < 3; k++) {
          const cand = steps[(idx + k) % steps.length];
          if (cand.key !== o.goto && cand.key !== s.key) others.push(cand.title);
        }
        gotos.push({ ...base(doc, s.key, `מה השלב הבא לאחר "${o.text}" בשלב "${s.title}"?`, 'single'), options: opts([titleOf.get(o.goto)!, ...others], [0]) });
      }
    const f = fieldOf(s) ?? (fieldNames.find((n) => s.actions.some((a) => a.text.includes(n))) ?? null);
    if (f) {
      const distractors = [...new Set([...fieldNames, ...docFields])].filter((n) => n !== f).slice(0, 3);
      if (distractors.length >= 1)
        fields.push({ ...base(doc, s.key, `באיזה שדה CRM בודקים בשלב "${s.title}"?`, 'single'), options: opts([f, ...distractors], [0]) });
    }
  });

  const order: QuizQuestion[] = [];
  if (steps.length >= 3) {
    const first = steps.slice(0, 4).map((s) => s.title);
    order.push({ ...base(doc, null, `סדר את השלבים הבאים לפי סדר הביצוע ב"${doc.title}"`, 'order'), options: opts(first, first.map((_, i) => i)) });
  }
  return [...branch, ...gotos, ...fields, ...order].slice(0, perDocument);
}
```

- [ ] **Step 4: Run** — PASS (6 tests). Adjust nothing in the test; if the goto distractor order differs, fix the wrap loop, not the assertion.
- [ ] **Step 5: Commit** — `feat(api): deterministic quiz question generator over document structure`

---

### Task 3: Model-assisted generation (`@wecom/model`, additive)

**Files:**
- Modify: `packages/model/src/contract.ts`, `packages/model/src/ollama.ts`, `packages/model/src/index.ts`
- Create: `packages/model/src/questions.ts`, `packages/model/prompts/questions-v1.md`
- Test: `packages/model/test/questions.test.ts` (uses the existing `test/fixtures/ollama-stub.ts` — read it for the stub's shape)

**Interfaces:**
- Produces (contract, additive):
```ts
export interface QuestionContextStep { key: string; num: string; title: string; actions: string[]; outcomes: { text: string; gotoTitle?: string }[]; branch?: { q: string; options: { label: string; text: string }[] } }
export interface QuestionContext { documents: { id: string; title: string; steps: QuestionContextStep[] }[]; perDocument: number; seeds: GeneratedQuestion[] }
export interface GeneratedQuestion { documentId: string; stepKey: string | null; stem: string; kind: 'single' | 'multi' | 'order' | 'free'; options: { id: string; text: string; correct: boolean }[]; explanation: string; modelConf: number | null }
export interface ModelClient { …; generateQuestions?(ctx: QuestionContext): Promise<GeneratedQuestion[]> }
```
`RuleBasedModel` does **not** implement it (the api's `fallback.ts` owns the rules); `OllamaModel.generateQuestions` mirrors `proposeChanges`: JSON mode with `QUESTIONS_RESPONSE_FORMAT`, `MAX_ATTEMPTS = 2`, parse with `parseQuestions`, and **throws** on failure (no fallback here — the api decides).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { OllamaModel, buildQuestionMessages, parseQuestions } from '../src/index.js';

const ctx = {
  perDocument: 2,
  seeds: [],
  documents: [{ id: '11111111-1111-4111-8111-111111111111', title: 'ניתוק גלישה', steps: [
    { key: 's1', num: '1', title: 'בדיקת חסימה', actions: ['CRM ↗ שדה "גלישה בארץ"'], outcomes: [{ text: 'לא חסום', gotoTitle: 'סוג מכשיר' }] },
  ] }],
};
const good = JSON.stringify({ questions: [{ documentId: ctx.documents[0].id, stepKey: 's1', stem: 'מה בודקים תחילה?', kind: 'single', options: [{ id: 'o1', text: 'חסימה', correct: true }, { id: 'o2', text: 'APN', correct: false }], explanation: '', modelConf: 0.8 }] });

describe('question generation via Ollama', () => {
  it('builds messages that carry every step and the per-document cap', () => {
    const m = buildQuestionMessages(ctx);
    expect(m[0].role).toBe('system');
    expect(m[1].content).toContain('בדיקת חסימה');
    expect(m[1].content).toContain('"perDocument":2');
  });
  it('parses and validates the envelope', () => {
    expect(parseQuestions(good)).toMatchObject({ ok: true });
    expect(parseQuestions('{"questions":[{"stem":"x"}]}').ok).toBe(false);
    expect(parseQuestions('```json\n' + good + '\n```').ok).toBe(true);
  });
  it('retries once on bad JSON, then throws', async () => {
    let calls = 0;
    const fetchImpl = (async () => { calls++; return new Response(JSON.stringify({ message: { content: 'not json' } }), { status: 200 }); }) as unknown as typeof fetch;
    const m = new OllamaModel({ url: 'http://x', model: 'm', fetchImpl });
    await expect(m.generateQuestions!(ctx)).rejects.toThrow(/model failed/);
    expect(calls).toBe(2);
  });
  it('returns validated questions on success', async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ message: { content: good } }), { status: 200 })) as unknown as typeof fetch;
    const m = new OllamaModel({ url: 'http://x', model: 'm', fetchImpl });
    const qs = await m.generateQuestions!(ctx);
    expect(qs).toHaveLength(1);
    expect(qs[0].options[0].correct).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/model test -- questions` → FAIL.

- [ ] **Step 3: Implement**

`packages/model/prompts/questions-v1.md`:
```
אתה עוזר לצוות ההדרכה של wecom. מקבלים מבנה של מסמכי נוהל (שלבים, פעולות, תוצאות, הסתעפויות) ומחזירים שאלות ידע לבוחן.
החזר אך ורק JSON בפורמט: {"questions":[...]} כאשר כל שאלה היא אובייקט עם השדות:
documentId (uuid מתוך הקלט), stepKey (מפתח שלב מתוך הקלט או null), stem (שאלה בעברית, קצרה וברורה), kind (single | multi | order | free),
options (מערך של {id, text, correct} — ב-single בדיוק תשובה אחת נכונה, ב-multi לפחות אחת, ב-order כל האפשרויות correct=true בסדר הנכון, ב-free מערך ריק),
explanation (משפט הסבר בעברית), modelConf (0..1).
כללים:
- אל תמציא עובדות: כל תשובה נכונה חייבת להופיע בטקסט השלב או בתוצאה/הסתעפות שלו.
- מסיחים חייבים להיות סבירים אך שגויים לפי המסמך.
- לא יותר מ-perDocument שאלות לכל מסמך; העדף שלבים עם הסתעפות או תוצאה עם מעבר.
- אם ניתנו seeds (שאלות שנוצרו מכללים), שפר את הניסוח שלהן במקום לחזור עליהן.
```
`packages/model/src/questions.ts`:
```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { GeneratedQuestion, QuestionContext } from './contract.js';

export const QUESTIONS_PROMPT_VERSION = 'questions-v1';
const promptPath = fileURLToPath(new URL('../prompts/questions-v1.md', import.meta.url));
export const QUESTIONS_SYSTEM_PROMPT = readFileSync(promptPath, 'utf8');

const OptionSchema = z.object({ id: z.string().min(1), text: z.string().min(1), correct: z.boolean() });
export const GeneratedQuestionSchema = z
  .object({
    documentId: z.string().uuid(),
    stepKey: z.string().nullable(),
    stem: z.string().min(3),
    kind: z.enum(['single', 'multi', 'order', 'free']),
    options: z.array(OptionSchema),
    explanation: z.string().default(''),
    modelConf: z.number().min(0).max(1).nullable().default(null),
  })
  .refine((q) => q.kind !== 'single' || q.options.filter((o) => o.correct).length === 1, { message: 'single needs exactly one correct option' })
  .refine((q) => q.kind !== 'multi' || q.options.some((o) => o.correct), { message: 'multi needs a correct option' })
  .refine((q) => q.kind !== 'order' || (q.options.length >= 2 && q.options.every((o) => o.correct)), { message: 'order options must all be correct' });
const EnvelopeSchema = z.object({ questions: z.array(GeneratedQuestionSchema) });

export const QUESTIONS_RESPONSE_FORMAT = {
  type: 'object',
  properties: { questions: { type: 'array', items: { type: 'object' } } },
  required: ['questions'],
} as const;

export function buildQuestionMessages(ctx: QuestionContext): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: QUESTIONS_SYSTEM_PROMPT },
    { role: 'user', content: JSON.stringify({ perDocument: ctx.perDocument, documents: ctx.documents, seeds: ctx.seeds }) },
  ];
}

export function parseQuestions(text: string): { ok: true; items: GeneratedQuestion[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
  } catch (e) {
    return { ok: false, error: 'invalid json: ' + (e as Error).message };
  }
  const r = EnvelopeSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') };
  return { ok: true, items: r.data.questions };
}
```
`contract.ts`: append the three interfaces above and `generateQuestions?(ctx: QuestionContext): Promise<GeneratedQuestion[]>;` to `ModelClient`. `index.ts`: `export * from './questions.js';`.
`ollama.ts` — add after `proposeChanges`:
```ts
  async generateQuestions(ctx: QuestionContext): Promise<GeneratedQuestion[]> {
    const started = Date.now();
    const messages = buildQuestionMessages(ctx);
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const r = await this.req('/api/chat', {
          model: this.o.model,
          stream: false,
          format: QUESTIONS_RESPONSE_FORMAT,
          options: { temperature: 0.2, num_ctx: 8192 },
          messages: attempt === 1 ? messages : [...messages, { role: 'user', content: 'התשובה הקודמת לא הייתה JSON תקין (' + lastError + '). החזר JSON תקין בלבד.' }],
        });
        if (!r.ok) { lastError = 'http ' + r.status; continue; }
        const data = (await r.json()) as { message?: { content?: string } };
        const parsed = parseQuestions(data.message?.content ?? '');
        if (parsed.ok) {
          this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started };
          return parsed.items;
        }
        lastError = parsed.error;
      } catch (e) {
        lastError = (e as Error).message;
      }
    }
    throw new Error('model failed: ' + lastError);
  }
```
(with the matching imports from `./questions.js` and `./contract.js`).

- [ ] **Step 4: Run** — `pnpm --filter @wecom/model test` → PASS (existing 12 + 4); `pnpm --filter @wecom/model build`.
- [ ] **Step 5: Commit** — `feat(model): optional generateQuestions on ModelClient with an Ollama implementation (JSON mode, schema-validated)`

---

### Task 4: Repository — items, entries, questions, publish snapshot, referencing

**Files:**
- Create: `apps/api/src/modules/learning/repo.ts`
- Test: covered by Task 6's integration tests (the repo has no I/O-free surface worth a unit test beyond Task 2)

**Interfaces:**
- Consumes: `Q`, `Tx` from `../../lib/sql.js` (`Q` = `pg.Pool | Tx`, as `documents/repo.ts:27` defines it — import the type from there or redeclare `type Q = Queryable`), `getDocument(q, id)` from `../documents/repo.js`, `iso` from `../documents/repo.js`, `getWorkflowSettings(q)` from `../../lib/workflowSettings.js`, `httpError` from `../../lib/http.js`, `HttpError` codes above.
- Produces: the canonical exports table plus `createItem`, `patchItem`, `replaceEntries`, `replaceQuestions`, `publishItem`, `archiveItem`, `softDeleteItem`, `listCards`, `listVersions`, `getVersionSnapshot`, `validateReferences`.

- [ ] **Step 1: Write `repo.ts`** (complete; the SQL is the contract V2 builds on)

```ts
import type { BriefingEntry, LearningItem, LearningItemCard, LearningItemsQuery, LearningItemCreate, LearningItemPatch, QuizQuestion, SourceVersion } from '@wecom/shared';
import type pg from 'pg';
import type { Tx } from '../../lib/sql.js';
import { httpError } from '../../lib/http.js';
import { getDocument, iso } from '../documents/repo.js';
import { getWorkflowSettings } from '../../lib/workflowSettings.js';
import type { ReqUser } from '../../lib/user.js';

export type Q = pg.Pool | Tx;
type Row = Record<string, unknown>;

export interface Viewer { user: ReqUser; manage: boolean }
export const viewerOf = (user: ReqUser): Viewer => ({ user, manage: user.permissions.has('learning.manage') });

/* ── assembly ─────────────────────────────────────────────────────────── */
const toEntry = (r: Row): BriefingEntry => ({ id: r.id as string, documentId: r.document_id as string, stepKey: (r.step_key as string | null) ?? null, note: (r.note as string) ?? '' });
const toQuestion = (r: Row): QuizQuestion => ({
  id: r.id as string, documentId: r.document_id as string, stepKey: (r.step_key as string | null) ?? null,
  stem: r.stem as string, kind: r.kind as QuizQuestion['kind'], options: (r.options as QuizQuestion['options']) ?? [],
  explanation: (r.explanation as string) ?? '', generated: !!r.generated, modelConf: r.model_conf === null ? null : Number(r.model_conf),
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
  const by = <T>(rs: Row[], f: (r: Row) => T) => { const m = new Map<string, T[]>(); for (const r of rs) { const k = r.item_id as string; (m.get(k) ?? m.set(k, []).get(k)!).push(f(r)); } return m; };
  const entries = by(e.rows, toEntry), questions = by(qs.rows, toQuestion);
  const versions = new Map(sv.rows.map((r) => [r.item_id as string, (r.sv as SourceVersion[]) ?? []]));
  return rows.map((r) => ({
    id: r.id as string, kind: r.kind as LearningItem['kind'], title: r.title as string, description: (r.description as string) ?? '',
    worldSlug: (r.world_slug as string | null) ?? null, status: r.status as LearningItem['status'], currentVersion: r.current_version as number,
    passMark: (r.pass_mark as number | null) ?? null, maxAttempts: (r.max_attempts as number | null) ?? null, estimatedMinutes: (r.estimated_minutes as number | null) ?? null,
    entries: entries.get(r.id as string) ?? [], questions: questions.get(r.id as string) ?? [],
    sourceVersions: versions.get(r.id as string) ?? [],
    needsUpdate: needsUpdate.get(r.id as string) ?? false,
    createdBy: (r.created_by as string | null) ?? null, updatedAt: iso(r.updated_at as Date)!, publishedAt: iso(r.published_at as Date | null),
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

/* ── cards & list ──────────────────────────────────────────────────────── */
/** V2 replaces the two `0`/`null` subqueries with counts from learning_assignments. */
const cardSql = `
  select li.*, (select count(*)::int from briefing_entries e where e.item_id = li.id) entry_count,
         (select count(*)::int from quiz_questions x where x.item_id = li.id) question_count,
         0::int assigned_users, null::numeric completion_rate
  from learning_items li`;
const toCard = (r: Row, needsUpdate: boolean): LearningItemCard => ({
  id: r.id as string, kind: r.kind as LearningItemCard['kind'], title: r.title as string, description: (r.description as string) ?? '',
  worldSlug: (r.world_slug as string | null) ?? null, status: r.status as LearningItemCard['status'], currentVersion: r.current_version as number,
  estimatedMinutes: (r.estimated_minutes as number | null) ?? null, needsUpdate, updatedAt: iso(r.updated_at as Date)!, publishedAt: iso(r.published_at as Date | null),
  entryCount: r.entry_count as number, questionCount: r.question_count as number, assignedUsers: r.assigned_users as number,
  completionRate: r.completion_rate === null ? null : Number(r.completion_rate),
});
export async function assembleCard(q: Q, id: string): Promise<LearningItemCard | null> {
  const r = await q.query(cardSql + ' where li.id=$1 and li.deleted_at is null', [id]);
  if (!r.rowCount) return null;
  return toCard(r.rows[0], (await needsUpdateFor(q, [id])).get(id) ?? false);
}
export async function listCards(q: Q, query: LearningItemsQuery, v: Viewer): Promise<{ items: LearningItemCard[]; total: number }> {
  const params: unknown[] = [];
  const p = (x: unknown) => { params.push(x); return '$' + params.length; };
  const where = ['li.deleted_at is null'];
  if (!v.manage) where.push(`li.status = 'published'`);
  if (query.kind) where.push(`li.kind = ${p(query.kind)}`);
  if (query.status) where.push(`li.status = ${p(query.status)}`);
  if (query.world) where.push(`li.world_slug = ${p(query.world)}`);
  if (query.q) where.push(`(li.title ilike '%' || ${p(query.q)} || '%' or li.description ilike '%' || $${params.length} || '%')`);
  if (v.user.worldScopes !== null)
    where.push(`(li.world_slug is null and not exists (select 1 from briefing_entries e where e.item_id = li.id union select 1 from quiz_questions x where x.item_id = li.id)
      or li.world_slug = any(${p(v.user.worldScopes)})
      or exists (select 1 from (select item_id, document_id from briefing_entries union select item_id, document_id from quiz_questions) ref
                 join document_worlds dw on dw.document_id = ref.document_id where ref.item_id = li.id and dw.world_slug = any($${params.length})))`);
  const w = ' where ' + where.join(' and ');
  const total = (await q.query(`select count(*)::int n from learning_items li${w}`, params)).rows[0].n as number;
  params.push(query.pageSize, (query.page - 1) * query.pageSize);
  const r = await q.query(`${cardSql}${w} order by li.updated_at desc limit $${params.length - 1} offset $${params.length}`, params);
  const flags = await needsUpdateFor(q, r.rows.map((x) => x.id as string));
  return { items: r.rows.map((x) => toCard(x, flags.get(x.id as string) ?? false)), total };
}

/* ── writes ────────────────────────────────────────────────────────────── */
export async function createItem(tx: Tx, body: LearningItemCreate, userId: string): Promise<LearningItem> {
  const r = await tx.query(
    `insert into learning_items(kind, title, description, world_slug, pass_mark, max_attempts, estimated_minutes, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$8) returning id`,
    [body.kind, body.title, body.description ?? '', body.worldSlug ?? null, body.passMark ?? null, body.maxAttempts ?? null, body.estimatedMinutes ?? null, userId],
  );
  return (await getItem(tx, r.rows[0].id as string))!;
}
const PATCH_COLUMNS: Record<keyof LearningItemPatch, string> = { title: 'title', description: 'description', worldSlug: 'world_slug', passMark: 'pass_mark', maxAttempts: 'max_attempts', estimatedMinutes: 'estimated_minutes' };
export async function patchItem(tx: Tx, id: string, body: LearningItemPatch, userId: string): Promise<LearningItem> {
  const sets: string[] = []; const params: unknown[] = [id];
  for (const [k, col] of Object.entries(PATCH_COLUMNS) as [keyof LearningItemPatch, string][])
    if (body[k] !== undefined) { params.push(body[k]); sets.push(`${col} = $${params.length}`); }
  params.push(userId);
  await tx.query(`update learning_items set ${[...sets, `updated_by = $${params.length}`, 'updated_at = now()'].join(', ')} where id=$1 and deleted_at is null`, params);
  return (await getItem(tx, id))!;
}

/** Only published documents may be referenced, and a stepKey must exist in the document. */
export async function validateReferences(q: Q, refs: { documentId: string; stepKey: string | null }[]): Promise<void> {
  for (const ref of [...new Map(refs.map((r) => [r.documentId + '#' + ref_key(r.stepKey), r])).values()]) {
    const doc = await getDocument(q, ref.documentId);
    if (!doc || !['published', 'partial'].includes(doc.status))
      throw httpError(400, 'DOCUMENT_NOT_PUBLISHED', 'ניתן לקשר רק מסמכים שפורסמו', { documentId: ref.documentId });
    if (ref.stepKey && !doc.phases.some((p) => p.steps.some((s) => s.key === ref.stepKey)))
      throw httpError(400, 'UNKNOWN_STEP', 'השלב אינו קיים במסמך', { documentId: ref.documentId, stepKey: ref.stepKey });
  }
}
const ref_key = (s: string | null) => s ?? '';

export async function replaceEntries(tx: Tx, id: string, entries: BriefingEntry[], userId: string): Promise<LearningItem> {
  await validateReferences(tx, entries);
  await tx.query('delete from briefing_entries where item_id=$1', [id]);
  for (const [i, e] of entries.entries())
    await tx.query('insert into briefing_entries(item_id, position, document_id, step_key, note) values ($1,$2,$3,$4,$5)', [id, i, e.documentId, e.stepKey ?? null, e.note ?? '']);
  await tx.query('update learning_items set updated_by=$2, updated_at=now() where id=$1', [id, userId]);
  return (await getItem(tx, id))!;
}
export async function replaceQuestions(tx: Tx, id: string, questions: QuizQuestion[], userId: string): Promise<LearningItem> {
  await validateReferences(tx, questions);
  for (const qn of questions) {
    if (qn.kind === 'single' && qn.options.filter((o) => o.correct).length !== 1) throw httpError(400, 'INVALID_QUIZ', 'בשאלה עם תשובה אחת חייבת להיות בדיוק תשובה נכונה אחת', { reason: 'single', stem: qn.stem });
    if (qn.kind === 'multi' && !qn.options.some((o) => o.correct)) throw httpError(400, 'INVALID_QUIZ', 'בשאלה מרובת תשובות חייבת להיות לפחות תשובה נכונה אחת', { reason: 'multi', stem: qn.stem });
    if (qn.kind === 'order' && (qn.options.length < 2 || !qn.options.every((o) => o.correct))) throw httpError(400, 'INVALID_QUIZ', 'בשאלת סדר כל האפשרויות מסומנות כנכונות, לפי הסדר', { reason: 'order', stem: qn.stem });
  }
  await tx.query('delete from quiz_questions where item_id=$1', [id]);
  for (const [i, qn] of questions.entries())
    await tx.query(
      'insert into quiz_questions(item_id, position, document_id, step_key, stem, kind, options, explanation, generated, model_conf) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
      [id, i, qn.documentId, qn.stepKey ?? null, qn.stem, qn.kind, JSON.stringify(qn.options), qn.explanation ?? '', !!qn.generated, qn.modelConf ?? null],
    );
  await tx.query('update learning_items set updated_by=$2, updated_at=now() where id=$1', [id, userId]);
  return (await getItem(tx, id))!;
}

/* ── publish ───────────────────────────────────────────────────────────── */
export async function publishItem(tx: Tx, id: string, label: string, userId: string): Promise<{ item: LearningItem; version: number }> {
  const cur = await tx.query('select status, kind from learning_items where id=$1 and deleted_at is null for update', [id]);
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'פריט הלמידה לא נמצא');
  if (cur.rows[0].status === 'archived') throw httpError(409, 'ITEM_ARCHIVED', 'פריט בארכיון אינו ניתן לפרסום');
  const live = (await getItem(tx, id))!;
  if (live.kind === 'briefing' && live.entries.length === 0) throw httpError(400, 'EMPTY_BRIEFING', 'תדריך חייב לכלול לפחות פריט ידע אחד');
  if (live.kind === 'quiz' && live.questions.length === 0) throw httpError(400, 'INVALID_QUIZ', 'בוחן חייב לכלול לפחות שאלה אחת', { reason: 'empty' });
  const refs = [...live.entries, ...live.questions].map((r) => r.documentId);
  await validateReferences(tx, [...live.entries, ...live.questions]);
  const settings = await getWorkflowSettings(tx);
  const passMark = live.kind === 'quiz' ? (live.passMark ?? settings.learning.defaultPassMark) : null;
  const versions = await tx.query('select id, current_version from documents where id = any($1)', [[...new Set(refs)]]);
  const sourceVersions: SourceVersion[] = versions.rows.map((r) => ({ documentId: r.id as string, version: r.current_version as number }));
  const version = live.currentVersion + 1;
  const snapshotItem: LearningItem = { ...live, status: 'published', currentVersion: version, passMark, sourceVersions };
  await tx.query('insert into learning_item_versions(item_id, version, snapshot, author_id, label) values ($1,$2,$3,$4,$5)', [id, version, JSON.stringify({ item: snapshotItem, sourceVersions }), userId, label]);
  await tx.query(
    `update learning_items set status='published', current_version=$2, pass_mark=$3, published_at=now(), updated_by=$4, updated_at=now() where id=$1`,
    [id, version, passMark, userId],
  );
  return { item: (await getItem(tx, id))!, version };
}
export async function archiveItem(tx: Tx, id: string, userId: string): Promise<void> {
  await tx.query(`update learning_items set status='archived', updated_by=$2, updated_at=now() where id=$1 and deleted_at is null`, [id, userId]);
}
export async function softDeleteItem(tx: Tx, id: string, userId: string): Promise<void> {
  await tx.query(`update learning_items set deleted_at=now(), updated_by=$2 where id=$1`, [id, userId]);
}

/* ── snapshots (what learners see) ─────────────────────────────────────── */
export async function getVersionSnapshot(q: Q, id: string, version: number): Promise<{ item: LearningItem; sourceVersions: SourceVersion[] } | null> {
  const r = await q.query('select snapshot from learning_item_versions where item_id=$1 and version=$2', [id, version]);
  return r.rowCount ? (r.rows[0].snapshot as { item: LearningItem; sourceVersions: SourceVersion[] }) : null;
}
export async function getPublishedItem(q: Q, id: string): Promise<{ item: LearningItem; version: number; sourceVersions: SourceVersion[] } | null> {
  const r = await q.query(`select version, snapshot from learning_item_versions where item_id=$1 order by version desc limit 1`, [id]);
  if (!r.rowCount) return null;
  const s = r.rows[0].snapshot as { item: LearningItem; sourceVersions: SourceVersion[] };
  return { item: s.item, version: r.rows[0].version as number, sourceVersions: s.sourceVersions ?? [] };
}
export const itemSourceVersions = async (q: Q, id: string, version: number): Promise<SourceVersion[]> => (await getVersionSnapshot(q, id, version))?.sourceVersions ?? [];
export async function listVersions(q: Q, id: string) {
  const r = await q.query(
    `select v.version, v.label, coalesce(u.display_name,'מערכת') author_name, v.created_at, v.snapshot->'sourceVersions' sv
     from learning_item_versions v left join users u on u.id=v.author_id where v.item_id=$1 order by v.version desc`,
    [id],
  );
  return r.rows.map((x) => ({ version: x.version as number, label: x.label as string, authorName: x.author_name as string, createdAt: iso(x.created_at as Date)!, sourceVersions: (x.sv as SourceVersion[]) ?? [] }));
}
export async function listItemsReferencing(q: Q, documentId: string) {
  const r = await q.query(
    `select distinct li.id item_id, li.kind, li.status, li.current_version from learning_items li
     join (select item_id, document_id from briefing_entries union select item_id, document_id from quiz_questions) ref on ref.item_id = li.id
     where ref.document_id=$1 and li.deleted_at is null`,
    [documentId],
  );
  return r.rows.map((x) => ({ itemId: x.item_id as string, kind: x.kind as 'briefing' | 'quiz', status: x.status as string, currentVersion: x.current_version as number }));
}

/** Entry + the referenced document's title and phases (agent view, preview and V2's player). */
export async function documentSnapshotFor(q: Q, entries: BriefingEntry[]) {
  const out = [];
  for (const e of entries) {
    const doc = await getDocument(q, e.documentId);
    out.push({ ...e, documentTitle: doc?.title ?? '—', phases: doc?.phases ?? [], changedSinceAssigned: false });
  }
  return out;
}
```
Notes for the implementer: `getDocument` returns the assembled `Document` with `status`, `phases`, `title` (read `documents/repo.ts:247`). If `iso` is not exported from the documents repo, copy its 3-line definition locally. Keep `viewerOf`/`canSee` as the single visibility decision so routes cannot diverge.

- [ ] **Step 2: Typecheck** — `pnpm --filter @wecom/api typecheck` (or `pnpm typecheck`) clean.
- [ ] **Step 3: Commit** — `feat(api): learning repo — items, entries, questions, publish snapshot with source versions, referencing helpers`

---

### Task 5: Generation orchestrator, routes, module registration, preview schema

**Files:**
- Create: `apps/api/src/modules/learning/generate.ts`, `apps/api/src/modules/learning/routes.ts`, `apps/api/src/modules/learning/index.ts`
- Modify: `apps/api/src/modules/index.ts`, `packages/shared/src/schemas/wave5.ts` (append `LearningPreviewSchema`)

**Interfaces:**
- Consumes: `app.model` (decorated by `plugins/model.ts` on the `/api/v1` scope — read it lazily inside the handler as `search/routes.ts` does, never at registration), `getWorkflowSettings`, repo functions from Task 4, `generateFromDocument` from Task 2, `loadFieldNames(q)` from `../documents/repo.js` (CRM field names for distractors).
- Produces: routes below; `generateQuestions(deps, body)` where `deps = { db, model: ModelClient | null, log }`.

- [ ] **Step 1: Append to `wave5.ts`** (append-only, after `PlayerItemSchema`):
```ts
/** V1 preview: the player payload without an assignment (managers previewing a draft or published item). */
export const LearningPreviewSchema = PlayerItemSchema.omit({ assignment: true });
export type LearningPreview = z.infer<typeof LearningPreviewSchema>;
```
Build shared: `pnpm --filter @wecom/shared build`.

- [ ] **Step 2: Write `generate.ts`**
```ts
import type { FastifyBaseLogger } from 'fastify';
import type { ModelClient, QuestionContext, QuestionContextStep } from '@wecom/model';
import type { Document, GenerateQuestionsBody, GenerateQuestionsResponse, QuizQuestion } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import { getDocument, loadFieldNames } from '../documents/repo.js';
import { generateFromDocument, allSteps } from './fallback.js';
import type { Q } from './repo.js';

export interface GenerateDeps { db: Q; model: ModelClient | null; log: FastifyBaseLogger }

const toCtxSteps = (doc: Document): QuestionContextStep[] => {
  const titles = new Map(allSteps(doc).map((s) => [s.key, s.title]));
  return allSteps(doc).map((s) => ({
    key: s.key, num: s.num, title: s.title, actions: s.actions.map((a) => a.text),
    outcomes: s.outcomes.map((o) => ({ text: o.text, gotoTitle: o.goto ? titles.get(o.goto) : undefined })),
    branch: s.branch ? { q: s.branch.q, options: s.branch.options.map((o) => ({ label: o.label, text: o.text })) } : undefined,
  }));
};

/** Rules always run; the model, when present and available, rewrites/extends and is merged first. Never throws for model failures. */
export async function generateQuestions(deps: GenerateDeps, body: GenerateQuestionsBody): Promise<GenerateQuestionsResponse> {
  const started = Date.now();
  const fieldNames = await loadFieldNames(deps.db);
  const docs: Document[] = [];
  for (const id of body.documentIds) {
    const d = await getDocument(deps.db, id);
    if (!d || !['published', 'partial'].includes(d.status)) throw httpError(400, 'DOCUMENT_NOT_PUBLISHED', 'ניתן ליצור שאלות רק ממסמכים שפורסמו', { documentId: id });
    docs.push(d);
  }
  const rules = docs.flatMap((d) => generateFromDocument(d, body.perDocument, fieldNames));
  let modelQs: QuizQuestion[] = [];
  let source: 'model' | 'rules' = 'rules';
  if (deps.model?.generateQuestions && (await deps.model.available().catch(() => false))) {
    const ctx: QuestionContext = { perDocument: body.perDocument, seeds: rules, documents: docs.map((d) => ({ id: d.id, title: d.title, steps: toCtxSteps(d) })) };
    try {
      const allowed = new Set(docs.map((d) => d.id));
      modelQs = (await deps.model.generateQuestions(ctx))
        .filter((q) => allowed.has(q.documentId))
        .map((q) => ({ ...q, generated: true, modelConf: q.modelConf ?? null, explanation: q.explanation ?? '' }));
      if (modelQs.length) source = 'model';
    } catch (err) {
      deps.log.warn({ err }, 'question generation: model failed, using rules');
    }
  }
  // Per document: model questions first, then rules, capped at perDocument.
  const out: QuizQuestion[] = [];
  for (const d of docs) {
    const m = modelQs.filter((q) => q.documentId === d.id);
    const r = rules.filter((q) => q.documentId === d.id);
    out.push(...[...m, ...r].slice(0, body.perDocument));
  }
  return { questions: out, source, tookMs: Date.now() - started };
}
```

- [ ] **Step 3: Write `routes.ts`** — one handler per contract row. Shape (write every handler fully; this is the pattern, with the repo calls named):

| Route | config | Handler |
|---|---|---|
| `GET /learning/items` | `requires: ['learning.read']`, query `LearningItemsQuerySchema`, 200 `LearningItemsResponseSchema` | `repo.listCards(app.db, query, viewerOf(user))` → `{ items, total, page, pageSize }` |
| `POST /learning/items` | `['learning.manage']`, body `LearningItemCreateSchema`, 201 `LearningItemSchema` | if `body.worldSlug && !hasScope(user, body.worldSlug)` → `forbidden()`; `withTransaction`: `createItem` + `audit('learning.create')` |
| `GET /learning/items/:id` | `['learning.read']`, 200 `LearningItemSchema` | `getItem` → 404 `notFound('פריט הלמידה')`; `if (!(await canSee(app.db, item, viewer))) throw notFound(...)` (404, not 403 — same reasoning as documents) |
| `PATCH /learning/items/:id` | `['learning.manage']`, body `LearningItemPatchSchema` | load, scope check on current + new `worldSlug`, `patchItem` + audit `learning.patch` (before/after title, worldSlug, passMark, maxAttempts) |
| `DELETE /learning/items/:id` | `['learning.manage']`, 204 | published → `archiveItem` (audit `learning.archive`); draft → `softDeleteItem` (audit `learning.delete`); archived → 204 no-op |
| `PUT /learning/items/:id/entries` | `['learning.manage']`, body `PutEntriesBodySchema`, 200 `LearningItemSchema` | 400 if item kind ≠ briefing (`INVALID_QUIZ`-style: `httpError(400,'WRONG_KIND','הפעולה מתאימה לתדריך בלבד')`), 409 if archived, `replaceEntries` + audit `learning.entries` (count) |
| `PUT /learning/items/:id/questions` | `['learning.manage']`, body `PutQuestionsBodySchema` | mirror for quizzes, `replaceQuestions` + audit `learning.questions` |
| `POST /learning/items/:id/generate` | `['learning.manage']`, body `GenerateQuestionsBodySchema`, 200 `GenerateQuestionsResponseSchema` | item must be a quiz; `generateQuestions({ db: app.db, model: (app as { model?: ModelClient }).model ?? null, log: app.log }, body)`; nothing is saved |
| `POST /learning/items/:id/publish` | `['learning.publish']`, body `LearningPublishBodySchema`, 200 `z.object({ item: LearningItemSchema, version: z.number().int() })` (declare this inline as `LearningPublishResponseSchema` in `wave5.ts`, append-only, if it does not exist) | scope check on the item's worlds (`worldsOfItem`), `publishItem` + audit `learning.publish` (`{ version, label, sourceVersions }`) |
| `GET /learning/items/:id/versions` | `['learning.read']`, 200 `z.object({ items: z.array(LearningVersionSchema) })` | visibility via `canSee`; `listVersions` |
| `GET /learning/items/:id/preview` | `['learning.read']`, 200 `LearningPreviewSchema` | managers: live item; others: `getPublishedItem` snapshot (404 if none); `entries: documentSnapshotFor(...)`, `questions` with `correct` stripped from options |

Every 4xx uses `httpError` codes from the canonical table. Register in `index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import learningRoutes from './routes.js';
/** V1 module (wave 5): learning content. V2 registers assignments/tracking in the same prefix from its own module. */
export default async function learningModule(app: FastifyInstance) {
  await app.register(learningRoutes);
}
```
and in `modules/index.ts` add `import learning from './learning/index.js'; // wave 5 V1: learning content` and `learning,` after `usage,`.

- [ ] **Step 4: Typecheck + boot** — `pnpm typecheck`; `RUN_INTEGRATION=1 pnpm --filter @wecom/api vitest run test/int/wiring.test.ts` (the app still boots with the new module).
- [ ] **Step 5: Commit** — `feat(api): learning routes, question generation orchestrator, preview schema, module registration`

---

### Task 6: Integration tests

**Files:**
- Create: `apps/api/test/learning.test.ts`

**Interfaces:**
- Consumes: `startTestDb`, `integration` from `./helpers/db.js`; `buildTestApp`; `makeUser`, `auth`, `minimalStructure` from `./helpers/fixtures.js`.

- [ ] **Step 1: Write the tests** (all against the injected app; the model is `RuleBasedModel` in tests because `NODE_ENV=test` builds without Ollama — check `plugins/model.ts`; if `MODEL_DISABLED` is needed set it in `buildTestApp`'s config for this file via `buildApp({ config: { …, MODEL_DISABLED: true } })`):

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
const branchStructure = {
  phases: [{ id: 'p1', label: 'סינון', steps: [
    { key: 's1', num: '1', title: 'בדיקת חסימה', actions: [{ id: 'a1', text: 'CRM ↗ שדה "גלישה בארץ"' }], outcomes: [{ kind: 'ok', text: 'לא חסום', goto: 's2' }] },
    { key: 's2', num: '2', title: 'סוג מכשיר', actions: [], outcomes: [], branch: { q: 'איזה מכשיר?', options: [{ kind: 'if', label: 'אייפון', text: 'איפוס רשת', goto: 's3' }, { kind: 'if', label: 'אנדרואיד', text: 'בדוק APN', goto: 's3' }] } },
    { key: 's3', num: '3', title: 'סיום', actions: [{ id: 'a1', text: 'סכם שיחה' }], outcomes: [{ kind: 'ok', text: 'סיום' }] },
  ] }],
};

run('learning content', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;
  let scopedEditor: Awaited<ReturnType<typeof makeUser>>;
  let pubDoc: string; let draftDoc: string;

  const createDoc = async (structure: unknown, publish: boolean, category = 'tech') => {
    const c = (await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(lead), payload: { title: 'מסמך ' + Math.random(), category, wave: 1, priority: 'm', kind: 'steps' } })).json();
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${c.id}/structure`, headers: { ...auth(lead), 'if-match': c.etag }, payload: structure });
    if (publish) await app.inject({ method: 'POST', url: `/api/v1/documents/${c.id}/publish`, headers: auth(lead), payload: { label: 'v1' } });
    return c.id as string;
  };
  const createItem = async (kind: 'briefing' | 'quiz', who = editor, extra: Record<string, unknown> = {}) =>
    (await app.inject({ method: 'POST', url: '/api/v1/learning/items', headers: auth(who), payload: { kind, title: kind === 'quiz' ? 'בוחן' : 'תדריך', ...extra } })).json();

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    lead = await makeUser(db.pool, { name: 'ענבר' });
    editor = await makeUser(db.pool, { name: 'עורך', perms: ['docs.read', 'docs.read_unpublished', 'learning.read', 'learning.manage'] });
    agent = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read', 'learning.read'] });
    scopedEditor = await makeUser(db.pool, { name: 'עורך סים', perms: ['docs.read', 'docs.read_unpublished', 'learning.read', 'learning.manage'], scopes: ['sim'] });
    pubDoc = await createDoc(branchStructure, true);
    draftDoc = await createDoc(minimalStructure, false);
  }, 120000);
  afterAll(async () => { await app.close(); await db.stop(); });

  it('creates, lists and reads a draft item for managers only', async () => {
    const item = await createItem('briefing');
    expect(item.status).toBe('draft');
    const forAgent = await app.inject({ method: 'GET', url: `/api/v1/learning/items/${item.id}`, headers: auth(agent) });
    expect(forAgent.statusCode).toBe(404);
    const list = (await app.inject({ method: 'GET', url: '/api/v1/learning/items', headers: auth(agent) })).json();
    expect(list.items.find((x: { id: string }) => x.id === item.id)).toBeUndefined();
    const listMgr = (await app.inject({ method: 'GET', url: '/api/v1/learning/items?kind=briefing', headers: auth(editor) })).json();
    expect(listMgr.items.some((x: { id: string }) => x.id === item.id)).toBe(true);
  });
  it('denies authoring without learning.manage and publishing without learning.publish', async () => {
    expect((await app.inject({ method: 'POST', url: '/api/v1/learning/items', headers: auth(agent), payload: { kind: 'quiz', title: 'x' } })).statusCode).toBe(403);
    const item = await createItem('quiz');
    expect((await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/publish`, headers: auth(editor), payload: { label: 'v1' } })).statusCode).toBe(403);
  });
  it('rejects references to unpublished documents and unknown steps', async () => {
    const item = await createItem('briefing');
    const r1 = await app.inject({ method: 'PUT', url: `/api/v1/learning/items/${item.id}/entries`, headers: auth(editor), payload: { entries: [{ documentId: draftDoc }] } });
    expect(r1.statusCode).toBe(400); expect(r1.json().code).toBe('DOCUMENT_NOT_PUBLISHED'); expect(r1.json().details.documentId).toBe(draftDoc);
    const r2 = await app.inject({ method: 'PUT', url: `/api/v1/learning/items/${item.id}/entries`, headers: auth(editor), payload: { entries: [{ documentId: pubDoc, stepKey: 'nope' }] } });
    expect(r2.json().code).toBe('UNKNOWN_STEP');
  });
  it('generates questions from rules when no model is available', async () => {
    const item = await createItem('quiz');
    const r = await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/generate`, headers: auth(editor), payload: { documentIds: [pubDoc], perDocument: 5 } });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.source).toBe('rules');
    expect(body.questions.length).toBeGreaterThanOrEqual(3);
    expect(body.questions[0].stem).toContain('סוג מכשיר');
    expect(body.questions.every((q: { generated: boolean }) => q.generated)).toBe(true);
    const bad = await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/generate`, headers: auth(editor), payload: { documentIds: [draftDoc] } });
    expect(bad.json().code).toBe('DOCUMENT_NOT_PUBLISHED');
  });
  it('validates quiz questions on save', async () => {
    const item = await createItem('quiz');
    const r = await app.inject({ method: 'PUT', url: `/api/v1/learning/items/${item.id}/questions`, headers: auth(editor), payload: { questions: [{ documentId: pubDoc, stepKey: 's1', stem: 'מה?', kind: 'single', options: [{ id: 'o1', text: 'א', correct: false }, { id: 'o2', text: 'ב', correct: false }] }] } });
    expect(r.statusCode).toBe(400); expect(r.json().code).toBe('INVALID_QUIZ');
  });
  it('publishes with a snapshot that pins document versions and defaults the pass mark', async () => {
    const item = await createItem('quiz');
    await app.inject({ method: 'PUT', url: `/api/v1/learning/items/${item.id}/questions`, headers: auth(editor), payload: { questions: [{ documentId: pubDoc, stepKey: 's1', stem: 'מה בודקים?', kind: 'single', options: [{ id: 'o1', text: 'חסימה', correct: true }, { id: 'o2', text: 'APN', correct: false }], explanation: 'כי כן' }] } });
    const pub = await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/publish`, headers: auth(lead), payload: { label: 'גרסה 1' } });
    expect(pub.statusCode).toBe(200);
    const { item: published, version } = pub.json();
    expect(version).toBe(1); expect(published.status).toBe('published'); expect(published.passMark).toBe(80); expect(published.maxAttempts).toBeNull();
    expect(published.sourceVersions).toEqual([{ documentId: pubDoc, version: 1 }]);
    const versions = (await app.inject({ method: 'GET', url: `/api/v1/learning/items/${item.id}/versions`, headers: auth(agent) })).json();
    expect(versions.items[0]).toMatchObject({ version: 1, label: 'גרסה 1', sourceVersions: [{ documentId: pubDoc, version: 1 }] });
    // learners see the snapshot, without correct flags
    const prev = (await app.inject({ method: 'GET', url: `/api/v1/learning/items/${item.id}/preview`, headers: auth(agent) })).json();
    expect(prev.item.id).toBe(item.id);
    expect(prev.questions[0].options[0]).toEqual({ id: 'o1', text: 'חסימה' });
    // republish after editing a document bumps the pinned version
    const doc = (await app.inject({ method: 'GET', url: `/api/v1/documents/${pubDoc}`, headers: auth(lead) })).json();
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${pubDoc}/structure`, headers: { ...auth(lead), 'if-match': doc.etag }, payload: branchStructure });
    await app.inject({ method: 'POST', url: `/api/v1/documents/${pubDoc}/publish`, headers: auth(lead), payload: { label: 'v2' } });
    const pub2 = (await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/publish`, headers: auth(lead), payload: { label: 'גרסה 2' } })).json();
    expect(pub2.item.sourceVersions).toEqual([{ documentId: pubDoc, version: 2 }]);
  });
  it('refuses to publish an empty briefing and an archived item', async () => {
    const item = await createItem('briefing');
    const r = await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/publish`, headers: auth(lead), payload: { label: 'x' } });
    expect(r.json().code).toBe('EMPTY_BRIEFING');
    await app.inject({ method: 'PUT', url: `/api/v1/learning/items/${item.id}/entries`, headers: auth(editor), payload: { entries: [{ documentId: pubDoc, note: 'קרא בעיון' }] } });
    await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/publish`, headers: auth(lead), payload: { label: 'x' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/learning/items/${item.id}`, headers: auth(editor) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/learning/items/${item.id}`, headers: auth(editor) })).json().status).toBe('archived');
    expect((await app.inject({ method: 'POST', url: `/api/v1/learning/items/${item.id}/publish`, headers: auth(lead), payload: { label: 'y' } })).json().code).toBe('ITEM_ARCHIVED');
  });
  it('flags needsUpdate when a referenced document becomes invalid', async () => {
    const d = await createDoc(minimalStructure, true);
    const item = await createItem('briefing');
    await app.inject({ method: 'PUT', url: `/api/v1/learning/items/${item.id}/entries`, headers: auth(editor), payload: { entries: [{ documentId: d }] } });
    await app.inject({ method: 'POST', url: `/api/v1/documents/${d}/status`, headers: auth(lead), payload: { status: 'invalid', reason: 'הוחלף' } });
    const got = (await app.inject({ method: 'GET', url: `/api/v1/learning/items/${item.id}`, headers: auth(editor) })).json();
    expect(got.needsUpdate).toBe(true);
  });
  it('applies world scope to managers', async () => {
    const techItem = await createItem('briefing', editor, { worldSlug: 'tech' });
    const r = await app.inject({ method: 'GET', url: `/api/v1/learning/items/${techItem.id}`, headers: auth(scopedEditor) });
    expect(r.statusCode).toBe(404);
    const c = await app.inject({ method: 'POST', url: '/api/v1/learning/items', headers: auth(scopedEditor), payload: { kind: 'quiz', title: 'x', worldSlug: 'tech' } });
    expect(c.statusCode).toBe(403);
    const list = (await app.inject({ method: 'GET', url: '/api/v1/learning/items', headers: auth(scopedEditor) })).json();
    expect(list.items.some((x: { id: string }) => x.id === techItem.id)).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — `RUN_INTEGRATION=1 pnpm --filter @wecom/api vitest run test/learning.test.ts` → PASS (9 tests). Fix the implementation, not the assertions, unless an assertion contradicts the spec.
- [ ] **Step 3: Commit** — `test(api): learning content integration coverage`

---

### Task 7: OpenAPI, full gate, lane report

**Files:**
- Modify: `docs/api/openapi.json` (regenerated), `apps/web/src/api/schema.d.ts` (regenerated by the same script if it is tracked; check `git status`)

- [ ] **Step 1** — `pnpm openapi` (root script) → the diff adds only the eleven `/api/v1/learning/...` paths; `git add` the generated files.
- [ ] **Step 2** — Gate: `pnpm -r build && pnpm typecheck && pnpm --filter @wecom/shared test && pnpm --filter @wecom/model test && pnpm --filter @wecom/api test && RUN_INTEGRATION=1 pnpm --filter @wecom/api test:int && pnpm lint`. Do not run the web suite (web lanes own it).
- [ ] **Step 3** — Commit `docs(contract): openapi with learning content routes`.
- [ ] **Step 4** — Write `.superpowers/sdd/program/V1-report.md` in the worktree (git-ignored): per-task status, commits, test counts, deviations, the canonical exports table with final signatures, and notes for V2 (`cardSql` subqueries to replace, `needsUpdateFor` to extend, `getPublishedItem` shape) and V4b (error codes and the preview shape).

## Self-review

- **Spec coverage:** §1.1 (standalone items over any published documents, versions pinned at publish) → Task 4 `publishItem`; §1.2 (rules + model, editors curate) → Tasks 2, 3, 5; §1.8 (published-only references, needsUpdate) → Tasks 4, 6; §3 tables → Task 1; §4 "Learning content" eleven routes → Task 5; §5 builder semantics (generate not saved until PUT, preview) → Task 5. Owner decision "unlimited attempts" → `max_attempts` nullable default null (Task 1) and asserted in Task 6.
- **Placeholders:** none. Where the implementer must read a file (`plugins/model.ts` for `MODEL_DISABLED`, `iso` export) the step says what to look for and what to do in each case.
- **Type consistency:** `getPublishedItem` / `itemSourceVersions` / `listItemsReferencing` / `needsUpdateFor` / `assembleCard` / `documentSnapshotFor` signatures match between the canonical table, Task 4 and Task 5; `LearningPreviewSchema` is defined once (Task 5) and used by the preview route and Task 6; error codes in Task 6 equal the canonical table.
- **Out of scope, noted:** `LearningPublishResponseSchema` is a small append to `wave5.ts` if V0 did not add one — flagged as a contract question below.
