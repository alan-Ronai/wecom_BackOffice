# X1 — Generation Quality Implementation Plan (api + model + deploy)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the source-change pipeline impact-aware, briefed and measurable: every proposal call sees the change's blast radius (shared blocks, CRM fields, inbound links, topic siblings, related documents by embedding), a system prompt v3 that knows the company and the knowledge architecture, few-shot examples mined from accepted suggestions, embedding-based paragraph→step mapping, an offline evaluation harness with a committed Hebrew case set, calibrated confidence, a `bge-m3` (1024-dim) embedder with a rebuild migration and a resumable reindex job, and the deploy/tier wiring that lets an operator pick a model tier without a code change.

**Architecture:** Additive inside `packages/model` (prompt v3 file, `embedBatch`, calibration, eval runner) and `apps/api/src/modules/sources` (`impact.ts`, mapping upgrade, `ProposalService` enrichment). Impact is computed by reusing the wave-3 graph queries (`inboundFor`) plus three small SQL counts; related documents come from `documents.embedding` cosine. The prompt stays a single `buildMessages(ctx)` — X0 already widened `ProposalContext` with `brief`, `style`, `impact`, `examples`, so the model package needs no new signature; the api fills those fields. Suggestions record `affects`, `prompt_version`, `model` at insert time. The embedding column is rebuilt to `vector(EMBED_DIMENSION)` by migration 0051 reading the same env the boot check reads, and a new `step_embeddings` table backs the mapping. `ai.reindex` re-embeds documents and steps in batches, resumable by `updated_at` watermark, and refuses to run when the model's reported width differs from the column. The eval harness is a plain vitest-free script (`pnpm --filter @wecom/model eval`) over `packages/model/eval/cases/*.json`, and an api job (`ai.eval`) records runs in `ai_eval_runs` for the admin page.

**Tech Stack:** Node 22, TypeScript strict, Fastify 5, zod 3, pg 8 + pgvector, pg-boss 10, Ollama HTTP API (`/api/chat`, `/api/embed`, `/api/tags`, `/api/show`), vitest 2, bash (deploy scripts).

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` §1.2, §1.6, §1.7, §1.9, §1.10, §3, §4.1, §5 "Generation", §6. Contract: `docs/api/CONTRACTS-wave6.md` (written by X0). Canonical names: `docs/superpowers/plans/2026-09-15-X0-wave6-contracts.md`.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run from the repo root with `pnpm --filter <pkg> <script>`.
- Consume X0 names verbatim: `ProposalContext.brief/style/impact/examples`, `ImpactSet`, `FewShotExample`, `ModelClient.embedBatch`, `resolveModelSlots(config)`, `getAiSettings(q)`, `currentPromptVersion(settings)`, `QUEUES.aiEval`, `QUEUES.aiReindex`, `EvalCaseSchema`, `EvalRunSchema`, `EvalRunsResponseSchema`, `ModelTestBodySchema`, `ModelTestResultSchema`, `AffectsItemSchema`, `AI_SETTINGS_KEYS`. No new schema outside `packages/shared/src/schemas/wave6.ts` (additive appends only) and no duplicate schema in apps.
- Migration for this lane: `apps/api/migrations/0051_wave6_embeddings_affects.js`, and nothing else in 0050–0054 (X0 0050, X2 0052, X3 0053, X6 0054). `checkOrder` is on; 0043–0045 belong to the other session and are already applied on main.
- **Peer constraints (binding):** the boot check `assertEmbeddingDimension(app.db, config.EMBED_DIMENSION)` stays; migration 0051 reads `process.env.EMBED_DIMENSION` exactly like `config.ts` does (empty string = unset, default 1024 *inside the migration* — see Task 1 for why); `instrumentEmbedding` must wrap `embedBatch` as well as `embed`; `guardedFetch` (`packages/connectors/src/guards.ts`) is the only sanctioned outbound fetch — but Ollama is a same-network service already reached through `OllamaModel.req`, keep that path (no new fetches elsewhere); `apps/api/test/route-coverage.test.ts` requires an integration test naming every new operation's path literally; no inline scripts; `deploy` tag assertions compare tags literally (`:latest` matters).
- Append-only touches allowed outside this lane's files: `apps/api/src/modules/admin/routes.ts` (one import + one `register` line), `apps/api/src/jobs/index.ts` (worker registrations), `apps/api/src/plugins/boss.ts` (nothing — X0 added the queues), `packages/model/src/index.ts` (exports), `packages/model/package.json` (`eval` script), `packages/shared/src/schemas/wave6.ts` (additive). Never edit `apps/web/**`, `apps/api/src/app.ts`, `stage45.ts`, `documents/routes.ts`, other lanes' modules.
- Behaviour on main must not change until an operator sets `MODEL_TIER` (or the slots): with the legacy defaults the pipeline produces the same suggestions as before plus `affects`, `prompt_version`, `model` columns filled.
- Hebrew for every user-facing string (prompt, rationales, log summaries shown in the admin page); English identifiers and logs.
- Conventional commits ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; commit after every task.

## File structure

```
apps/api/migrations/0051_wave6_embeddings_affects.js     rebuild documents.embedding, step_embeddings, suggestions.affects/prompt_version/model, ai_eval_runs
apps/api/src/modules/sources/impact.ts                  ImpactService: impactForSteps, impactForDocument, affectsFor, formatImpact
apps/api/src/modules/sources/fewshot.ts                 fewShotExamples(q, { sourceId, worldSlugs, types, limit })
apps/api/src/modules/sources/embeddings.ts              embedText/embedMany helpers, step text builder, cosine SQL helpers
apps/api/src/modules/sources/mapping.ts                 (modify) embedding-based proposeInitialMapping with trigram fallback
apps/api/src/modules/sources/proposal.ts                (modify) brief/style/impact/examples in ProposalContext
apps/api/src/modules/sources/suggestions.ts             (modify) insert affects/prompt_version/model; row() maps them
apps/api/src/modules/sources/index.ts                   (modify) construct ImpactService, pass settings reader
apps/api/src/jobs/pipeline.ts                           (modify) pass prompt version/model into createFromProposals
apps/api/src/jobs/ai.ts                                 ai.reindex + ai.eval workers (registered from jobs/index.ts)
apps/api/src/modules/ai/admin.ts                        POST /admin/ai/models/test, POST /admin/ai/reindex, POST /admin/ai/eval, GET /admin/ai/eval/runs
apps/api/src/modules/ai/reindex.ts                      reindexEmbeddings(deps, opts) — resumable batches
apps/api/src/modules/ai/evalRunner.ts                   runEvalCases(model, cases) → scores; recordEvalRun(q, …)
apps/api/src/lib/embedStatus.ts                         (modify) instrumentEmbedding wraps embedBatch too
packages/model/prompts/propose-v3.md                    system prompt v3 (task rules only; brief/architecture/style are injected)
packages/model/prompts/architecture-v1.md               knowledge-architecture block (worlds, topics, 7 types, governance)
packages/model/src/prompt.ts                            (modify) PROMPT_VERSION 'propose-v3', buildMessages renders brief/architecture/style/impact/examples within a char budget
packages/model/src/ollama.ts                            (modify) embedBatch via /api/embed, showModel via /api/show, per-call model override
packages/model/src/calibration.ts                       CALIBRATION table + confidenceFor(type, raw)
packages/model/src/eval.ts                              scoring: hitTarget/hitType/contentOverlap for one case
packages/model/eval/cases/*.json                        ≥ 8 Hebrew cases (EvalCaseSchema)
packages/model/eval/run.ts                              CLI: `pnpm --filter @wecom/model eval [--model tag] [--rules]`
packages/model/test/{prompt-v3,calibration,eval,embed}.test.ts
apps/api/test/sources/{impact,mapping-embeddings,fewshot}.test.ts
apps/api/test/int/{ai-admin,ai-reindex,suggestions-affects}.test.ts
apps/api/test/migrations.test.ts                        (modify) 0051 assertions
deploy/ollama-pull.sh, deploy/ollama-pull-check.sh, deploy/smoke.sh, deploy/.env.example, deploy/e2e.env, deploy/ci.env, deploy/docker-compose.yml (ollama-pull env), scripts/e2e-compose.mjs
```

## Cross-lane interfaces (authoritative for X2/X3/X6)

- `ImpactService` (`apps/api/src/modules/sources/impact.ts`):
  - `new ImpactService(pool: pg.Pool)`
  - `impactForSteps(steps: { documentId: string; stepKey: string; blockId?: string }[], opts?: { relatedK?: number; scopes?: string[] | null }): Promise<ImpactSet>`
  - `impactForDocument(documentId: string, opts?: { relatedK?: number; scopes?: string[] | null }): Promise<ImpactSet>` — what X2's `read_impact` tool calls.
  - `affectsFor(impact: ImpactSet, suggestion: ProposedSuggestion): AffectsItem[]` — the per-suggestion subset.
  - `formatImpact(impact: ImpactSet, maxChars: number): string` — Hebrew bullet text; X2 reuses it for chat context.
- `fewShotExamples(q, { sourceId, worldSlugs, types, limit }): Promise<FewShotExample[]>` (`fewshot.ts`).
- `@wecom/model`: `PROMPT_VERSION = 'propose-v3'`, `buildMessages(ctx: ProposalContext)` (unchanged signature; renders the new optional fields), `renderArchitecture()`, `confidenceFor(type, raw, table?)`, `CALIBRATION_DEFAULTS`, `scoreCase(caseSpec, items)`, `OllamaModel.embedBatch(texts)`, `OllamaModel.showModel(tag)`, `OllamaOptions.suggestModel` (alias of `model`) — X2 constructs its own `OllamaModel({ model: slots.chatModel })` for chat.
- `reindexEmbeddings(deps, { batch?: number; since?: string | null }): Promise<{ documents: number; steps: number; skipped: number; dimension: number }>` (`apps/api/src/modules/ai/reindex.ts`), queue `QUEUES.aiReindex` payload `{ since?: string }`.
- Suggestion rows carry `affects`, `prompt_version`, `model` (columns) → `SuggestionSchema.affects/promptVersion/model` (X0 added the fields).

---

### Task 1: Migration 0051, `embedBatch`, and the instrumented proxy

**Files:**
- Create: `apps/api/migrations/0051_wave6_embeddings_affects.js`
- Modify: `packages/model/src/ollama.ts` (add `embedBatch`, `showModel`), `apps/api/src/lib/embedStatus.ts` (wrap `embedBatch`), `apps/api/test/migrations.test.ts`
- Test: `packages/model/test/embed.test.ts`, `apps/api/test/unit/embedStatus.test.ts` (extend)

**Interfaces:**
- Consumes: `ModelClient.embedBatch?` (X0), `EmbedStatusTracker`, `assertEmbeddingDimension`, `readEmbeddingDimension` (existing).
- Produces: tables/columns above; `OllamaModel.embedBatch(texts: string[]): Promise<number[][]>`; `OllamaModel.showModel(tag: string): Promise<{ family?: string; parameterSize?: string; quantization?: string; embeddingLength?: number } | null>`.

Why the migration reads the env: `plugins/model.ts` refuses to boot when `EMBED_DIMENSION` ≠ `atttypmod`. If 0051 hard-coded 1024 while an operator kept `EMBED_DIMENSION=768` (tier 0), the API would never come up again. Reading the same variable makes the column follow the configuration; the default inside the migration is **1024** because the migration only exists to move to the multilingual embedder, and a deployment that wants to stay at 768 sets `EMBED_DIMENSION=768` explicitly (which `deploy/e2e.env` and `ci.env` do — Task 7).

- [ ] **Step 1: Write the failing migration assertions** (append inside the existing `run('migrations', …)` block of `apps/api/test/migrations.test.ts`, before `'rolls back cleanly'`):

```ts
  it('0051 rebuilds documents.embedding to EMBED_DIMENSION, adds step_embeddings, suggestion provenance and ai_eval_runs', async () => {
    const dim = Number(process.env.EMBED_DIMENSION || 1024);
    const col = await pool.query(
      `select atttypmod from pg_attribute where attrelid='documents'::regclass and attname='embedding'`,
    );
    expect(col.rows[0].atttypmod).toBe(dim);
    const se = await pool.query(
      `select atttypmod from pg_attribute where attrelid='step_embeddings'::regclass and attname='embedding'`,
    );
    expect(se.rows[0].atttypmod).toBe(dim);
    const cols = await pool.query(
      `select column_name, column_default from information_schema.columns where table_name='suggestions' and column_name in ('affects','prompt_version','model') order by 1`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual(['affects', 'model', 'prompt_version']);
    expect(cols.rows[0].column_default).toContain("'[]'");
    const runs = await pool.query(`select to_regclass('ai_eval_runs') r`);
    expect(runs.rows[0].r).toBe('ai_eval_runs');
    const idx = await pool.query(`select indexname from pg_indexes where tablename='step_embeddings'`);
    expect(idx.rows.map((r) => r.indexname)).toContain('step_embeddings_document_idx');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts -t 0051`
Expected: FAIL — `atttypmod` is 768 and `step_embeddings` is null.

- [ ] **Step 3: Write the migration**

`apps/api/migrations/0051_wave6_embeddings_affects.js`:
```js
/**
 * Wave 6 (X1): a multilingual embedder and impact-aware suggestions.
 *
 * `documents.embedding` was `vector(768)` since 0003 (nomic-embed-text). `bge-m3` returns 1024,
 * and `plugins/model.ts` refuses to boot when EMBED_DIMENSION disagrees with the column's own
 * atttypmod — so the column must follow the configured width, not a number typed here. The
 * variable is read exactly as `config.ts` reads it (empty = unset), and the default is 1024
 * because this migration exists for the switch; a deployment staying on 768 sets it explicitly.
 *
 * Rebuilding drops every stored vector: `ai.reindex` recomputes them (Task 6), and search falls
 * back to lexical ranking until it has run — the same degradation an empty EMBED_MODEL gives.
 */
const dim = (() => {
  const raw = process.env.EMBED_DIMENSION;
  const n = raw === undefined || raw === '' ? 1024 : Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`EMBED_DIMENSION must be a positive integer, got ${raw}`);
  return n;
})();

exports.up = (pgm) => {
  pgm.sql(`alter table documents drop column embedding`);
  pgm.sql(`alter table documents add column embedding vector(${dim})`);
  pgm.createTable('step_embeddings', {
    step_id: { type: 'uuid', primaryKey: true, references: 'steps', onDelete: 'cascade' },
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    embedding: { type: `vector(${dim})`, notNull: true },
    text_hash: { type: 'text', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createIndex('step_embeddings', 'document_id', { name: 'step_embeddings_document_idx' });
  pgm.addColumns('suggestions', {
    affects: { type: 'jsonb', notNull: true, default: '[]' },
    prompt_version: 'text',
    model: 'text',
  });
  pgm.createTable('ai_eval_runs', {
    id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') },
    model: { type: 'text', notNull: true },
    prompt_version: { type: 'text', notNull: true },
    embed_model: { type: 'text', notNull: true, default: '' },
    started_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    finished_at: 'timestamptz',
    cases: { type: 'integer', notNull: true, default: 0 },
    hit_target: { type: 'real', notNull: true, default: 0 },
    hit_type: { type: 'real', notNull: true, default: 0 },
    content_overlap: { type: 'real', notNull: true, default: 0 },
    notes: { type: 'text', notNull: true, default: '' },
    started_by: { type: 'uuid', references: 'users' },
  });
  pgm.createIndex('ai_eval_runs', 'started_at');
};

exports.down = (pgm) => {
  pgm.dropTable('ai_eval_runs');
  pgm.dropColumns('suggestions', ['affects', 'prompt_version', 'model']);
  pgm.dropTable('step_embeddings');
  pgm.sql(`alter table documents drop column embedding`);
  pgm.sql(`alter table documents add column embedding vector(768)`);
};
```

- [ ] **Step 4: `embedBatch` and `showModel` on the Ollama client**

In `packages/model/src/ollama.ts`, add after `embed`:
```ts
  /**
   * Wave 6 (X1). `/api/embed` accepts an array and returns one vector per input, so a reindex
   * of 5,000 documents is 5,000/`batch` round trips instead of 5,000. Empty input → [] without a
   * call. A model that ignores the batch form (older Ollama) answers with one vector for the
   * first input only; we detect the short answer and fall back to one `embed` per text.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    const r = await this.req('/api/embed', { model: this.o.embedModel ?? 'nomic-embed-text', input: texts });
    if (!r.ok) throw new Error('embed http ' + r.status);
    const data = (await r.json()) as { embeddings?: number[][] };
    if (Array.isArray(data.embeddings) && data.embeddings.length === texts.length) return data.embeddings;
    const out: number[][] = [];
    for (const t of texts) out.push(await this.embed(t));
    return out;
  }

  /** `/api/show` for one tag: family, parameter size, quantization and (for embedders) the vector width. */
  async showModel(tag: string): Promise<{ family?: string; parameterSize?: string; quantization?: string; embeddingLength?: number } | null> {
    try {
      const r = await this.req('/api/show', { model: tag });
      if (!r.ok) return null;
      const d = (await r.json()) as { details?: { family?: string; parameter_size?: string; quantization_level?: string }; model_info?: Record<string, unknown> };
      const info = d.model_info ?? {};
      const lenKey = Object.keys(info).find((k) => k.endsWith('.embedding_length'));
      return {
        family: d.details?.family,
        parameterSize: d.details?.parameter_size,
        quantization: d.details?.quantization_level,
        embeddingLength: lenKey ? Number(info[lenKey]) : undefined,
      };
    } catch {
      return null;
    }
  }
```
Also change `name` to reflect the slot: `this.name = 'ollama:' + o.model;` stays (it is the suggest model); `OllamaOptions` gains nothing here.

- [ ] **Step 5: Wrap `embedBatch` in the instrumented proxy**

In `apps/api/src/lib/embedStatus.ts`, extend `instrumentEmbedding`: after the `embed` closure add
```ts
  const embedBatch = model.embedBatch
    ? async (texts: string[]): Promise<number[][]> => {
        let vecs: number[][];
        try {
          vecs = await model.embedBatch!(texts);
        } catch (err) {
          tracker.recordError(err instanceof Error ? err.message : String(err));
          throw err;
        }
        const bad = vecs.find((v) => v.length !== tracker.expected);
        if (bad) {
          const mismatch = new EmbedDimensionMismatchError(tracker.model, bad.length, tracker.expected);
          log.warn({ embedModel: tracker.model, dimension: bad.length, expected: tracker.expected, migration: EMBEDDING_COLUMN_MIGRATION }, mismatch.message);
          tracker.recordError(mismatch.message, bad.length);
          throw mismatch;
        }
        if (vecs.length) tracker.recordOk(vecs[0].length);
        return vecs;
      }
    : undefined;
```
and in the Proxy `get`: `if (prop === 'embedBatch' && embedBatch) return embedBatch;`. Update `EMBEDDING_COLUMN_MIGRATION` to `'apps/api/migrations/0051_wave6_embeddings_affects.js'` (the column is now created there).

- [ ] **Step 6: Tests**

`packages/model/test/embed.test.ts` (use the existing `test/fixtures/ollama-stub.ts` pattern — read it first; if it is a fetch stub, extend it to answer `/api/embed` and `/api/show`):
```ts
import { describe, it, expect } from 'vitest';
import { OllamaModel } from '../src/ollama.js';

const fetchStub = (routes: Record<string, (body: any) => unknown>) =>
  (async (url: string, init?: RequestInit) => {
    const path = new URL(url).pathname;
    const body = init?.body ? JSON.parse(init.body as string) : undefined;
    const h = routes[path];
    if (!h) return new Response('nf', { status: 404 });
    return new Response(JSON.stringify(h(body)), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;

describe('OllamaModel embeddings (wave 6)', () => {
  it('embedBatch returns one vector per input from /api/embed', async () => {
    const m = new OllamaModel({ url: 'http://x', model: 'm', embedModel: 'bge-m3', fetchImpl: fetchStub({
      '/api/embed': (b) => ({ embeddings: b.input.map((_: string, i: number) => [i, i]) }),
    }) });
    expect(await m.embedBatch(['a', 'b', 'c'])).toEqual([[0, 0], [1, 1], [2, 2]]);
    expect(await m.embedBatch([])).toEqual([]);
  });
  it('falls back to per-text embed when the server answers a single vector', async () => {
    let single = 0;
    const m = new OllamaModel({ url: 'http://x', model: 'm', embedModel: 'e', fetchImpl: fetchStub({
      '/api/embed': () => ({ embeddings: [[9]] }),
      '/api/embeddings': () => { single++; return { embedding: [7] }; },
    }) });
    expect(await m.embedBatch(['a', 'b'])).toEqual([[7], [7]]);
    expect(single).toBe(2);
  });
  it('showModel reads family, size, quantization and embedding length', async () => {
    const m = new OllamaModel({ url: 'http://x', model: 'm', fetchImpl: fetchStub({
      '/api/show': () => ({ details: { family: 'bert', parameter_size: '567M', quantization_level: 'F16' }, model_info: { 'bert.embedding_length': 1024 } }),
    }) });
    expect(await m.showModel('bge-m3')).toEqual({ family: 'bert', parameterSize: '567M', quantization: 'F16', embeddingLength: 1024 });
  });
});
```
Extend `apps/api/test/unit/embedStatus.test.ts` (read the existing cases): a fake model with `embedBatch` returning one wrong-width vector among three → the proxy throws `EmbedDimensionMismatchError` and `tracker.lastError` names the width; a correct batch → `tracker.lastOk` set once.

- [ ] **Step 7: Run**

Run: `pnpm --filter @wecom/model test && cd apps/api && pnpm vitest run test/unit/embedStatus.test.ts && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts`
Expected: PASS (the down-to-empty case included — `down` restores `vector(768)`).

- [ ] **Step 8: Commit**

```bash
git add apps/api/migrations/0051_wave6_embeddings_affects.js packages/model/src/ollama.ts packages/model/test/embed.test.ts apps/api/src/lib/embedStatus.ts apps/api/test/unit/embedStatus.test.ts apps/api/test/migrations.test.ts
git commit -m "feat(api,model): migration 0051 (EMBED_DIMENSION column rebuild, step_embeddings, suggestion provenance, ai_eval_runs); embedBatch + showModel; instrumented batch embeds"
```

---

### Task 2: `ImpactService`

**Files:**
- Create: `apps/api/src/modules/sources/impact.ts`
- Test: `apps/api/test/sources/impact.test.ts`

**Interfaces:**
- Consumes: `inboundFor(q, ref, scopes, readUnpublished)` and `NodeRef` from `../graph/repo.js`; tables `steps`, `step_field_refs`, `blocks`, `document_topics`, `topics`, `document_worlds`, `documents.embedding`.
- Produces: `ImpactService` (see Cross-lane interfaces), `AffectsItem` rows.

Impact of a changed step set = union over steps of: the step's shared block (if any) with the count of documents using it; the CRM fields referenced by the step with their user counts; documents with inbound links / goto to the step's document (via `inboundFor({kind:'document', key})`); topic siblings of the document; top-k related documents by embedding cosine to the step's document (skip when the document has no embedding).

- [ ] **Step 1: Write the failing test** (`apps/api/test/sources/impact.test.ts`, real Postgres via `withDb` from `../helpers/l5/db.js`; seed with `seedDocument`, `seedBlock`, `seedField` from `../helpers/l5/stubs.js` — read those helpers for the exact `Document` literal shape they accept):

```ts
import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument, seedBlock, seedField } from '../helpers/l5/stubs.js';
import { ImpactService } from '../../src/modules/sources/impact.js';
import type { Document, Block } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BLK = '44444444-4444-4444-8444-444444444444';

run('ImpactService', () => {
  it('collects shared blocks, CRM fields, inbound links and topic siblings for a changed step', async () =>
    withDb(async (pool) => {
      const uid = await seedUser(pool, { displayName: 'ע' });
      const block: Block = { id: BLK, slug: 'sim-refresh', title: 'ריענון SIM', kind: 'step',
        actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }], outcomes: [], currentVersion: 1, updatedAt: '2026-01-01T00:00:00.000Z' };
      await seedBlock(pool, block);
      await seedField(pool, { name: 'sim block lbl' });
      const base = (id: string, title: string, phases: Document['phases']): Document => ({
        id, slug: id.slice(0, 8), title, description: '', category: 'tech', wave: 1, priority: 'h', kind: 'steps',
        status: 'published', currentVersion: 1, phases, related: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
      } as Document);
      await seedDocument(pool, base(A, 'איטיות גלישה', [{ id: 'p1', label: '', steps: [
        { key: 's1', num: '1', title: 'ריענון', blockId: BLK, blockRefs: [], deps: [], actions: [], outcomes: [] },
        { key: 's2', num: '2', title: 'בדיקת APN', blockRefs: [], deps: [], actions: [{ id: 'a', text: 'CRM ← apn field ← ערוך' }], outcomes: [] },
      ] }]), uid);
      await seedDocument(pool, base(B, 'ניתוקים', [{ id: 'p1', label: '', steps: [
        { key: 's1', num: '1', title: 'קישור', blockRefs: [], deps: [], actions: [], outcomes: [{ kind: 'next', text: 'ראה איטיות', goto: 's2' }] },
      ] }]), uid);
      await pool.query(`insert into document_links(from_document_id, from_step_key, to_document_id, type, origin) values ($1,'s1',$2,'link','explicit')`, [B, A]);
      await pool.query(`insert into topics(world_id, slug, name) select id, 'apn', 'APN' from worlds where slug='tech' returning id`);
      const topicId = (await pool.query(`select id from topics where slug='apn'`)).rows[0].id;
      await pool.query(`insert into document_topics(document_id, topic_id) values ($1,$3),($2,$3)`, [A, B, topicId]);

      const impact = await new ImpactService(pool).impactForSteps([{ documentId: A, stepKey: 's1', blockId: BLK }, { documentId: A, stepKey: 's2' }]);
      expect(impact.blocks).toEqual([{ id: BLK, title: 'ריענון SIM', usedBy: 1 }]);
      expect(impact.fields.map((f) => f.name).sort()).toEqual(['apn field', 'sim block lbl']);
      expect(impact.documents.map((d) => d.id)).toContain(B);
      expect(impact.documents.find((d) => d.id === B)?.why).toMatch(/קישור|link/);
      expect(impact.topics).toEqual([{ id: topicId, name: 'APN' }]);
      expect(impact.related).toEqual([]); // no embeddings seeded
    }));

  it('affectsFor narrows the set to what one suggestion touches and formatImpact respects the budget', async () =>
    withDb(async (pool) => {
      const svc = new ImpactService(pool);
      const impact = { documents: [{ id: B, title: 'ניתוקים', why: 'קישור משלב 1' }], blocks: [{ id: BLK, title: 'ריענון SIM', usedBy: 3 }], fields: [{ name: 'apn field', usedBy: 2 }], topics: [], related: [] };
      const aff = svc.affectsFor(impact, { anchor: '§1', type: 'update-block', title: 't', targetDocumentId: A, targetStepKey: 's1', targetBlockId: BLK, payload: { type: 'update-block', actions: ['x'] }, confidence: 0.8, rationale: '' });
      expect(aff.map((a) => a.kind)).toEqual(['block', 'document']);
      const text = svc.formatImpact(impact, 80);
      expect(text.length).toBeLessThanOrEqual(80);
      expect(text).toMatch(/בלוק/);
    }));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sources/impact.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `impact.ts`**

```ts
import type pg from 'pg';
import type { ImpactSet, ProposedSuggestion } from '@wecom/model';
import type { AffectsItem } from '@wecom/shared';
import { inboundFor } from '../graph/repo.js';

export interface StepRef { documentId: string; stepKey: string; blockId?: string }
export interface ImpactOptions { relatedK?: number; scopes?: string[] | null }

/**
 * Wave 6 (X1): the blast radius of a change, so the model (and the editor) see what else a
 * suggestion touches. Everything here is a read over tables other lanes own; nothing is cached
 * because a proposal runs once per revision and a chat tool call is already a round trip.
 */
export class ImpactService {
  constructor(private readonly pool: pg.Pool) {}

  async impactForSteps(steps: StepRef[], opts: ImpactOptions = {}): Promise<ImpactSet> {
    const docIds = [...new Set(steps.map((s) => s.documentId))];
    const stepKeys = steps.map((s) => s.stepKey);
    const impact: ImpactSet = { documents: [], blocks: [], fields: [], topics: [], related: [] };
    if (!docIds.length) return impact;

    // Shared blocks: the step's own block plus block_refs, with how many live documents use each.
    const blocks = await this.pool.query(
      `with touched as (
         select distinct coalesce(s.block_id, r.ref) as block_id
           from steps s left join lateral unnest(s.block_refs) r(ref) on true
          where s.document_id = any($1::uuid[]) and s.step_key = any($2::text[])
            and coalesce(s.block_id, r.ref) is not null)
       select b.id, b.title,
              (select count(distinct s2.document_id) from steps s2
                 join documents d2 on d2.id = s2.document_id and d2.deleted_at is null
                where s2.block_id = b.id or b.id = any(s2.block_refs))::int as used_by
         from touched t join blocks b on b.id = t.block_id and b.deleted_at is null
        order by b.title`,
      [docIds, stepKeys],
    );
    impact.blocks = blocks.rows.map((r) => ({ id: r.id as string, title: r.title as string, usedBy: r.used_by as number }));

    // CRM fields referenced by the steps, with how many live documents reference each.
    const fields = await this.pool.query(
      `select f.field_name as name,
              (select count(distinct s3.document_id) from step_field_refs f3
                 join steps s3 on s3.id = f3.step_id
                 join documents d3 on d3.id = s3.document_id and d3.deleted_at is null
                where f3.field_name = f.field_name)::int as used_by
         from step_field_refs f join steps s on s.id = f.step_id
        where s.document_id = any($1::uuid[]) and s.step_key = any($2::text[])
        group by f.field_name order by 1`,
      [docIds, stepKeys],
    );
    impact.fields = fields.rows.map((r) => ({ name: r.name as string, usedBy: r.used_by as number }));

    // Documents pointing at the changed documents (links, goto, related, shares_block…), via the graph.
    const seen = new Map<string, { id: string; title: string; why: string }>();
    for (const id of docIds) {
      const rows = await inboundFor(this.pool, { kind: 'document', key: id }, opts.scopes ?? null, true);
      for (const r of rows)
        if (!docIds.includes(r.documentId) && !seen.has(r.documentId))
          seen.set(r.documentId, { id: r.documentId, title: r.title, why: WHY[r.type] ?? r.type });
    }
    impact.documents = [...seen.values()];

    // Topic siblings.
    const topics = await this.pool.query(
      `select distinct t.id, t.name from document_topics dt join topics t on t.id = dt.topic_id and t.active
        where dt.document_id = any($1::uuid[]) order by t.name`,
      [docIds],
    );
    impact.topics = topics.rows.map((r) => ({ id: r.id as string, name: r.name as string }));

    // Related by embedding (cosine), excluding the changed documents themselves.
    const k = opts.relatedK ?? 5;
    const related = await this.pool.query(
      `select d.id, d.title, 1 - (d.embedding <=> src.embedding) as sim
         from documents src, documents d
        where src.id = $1 and src.embedding is not null and d.embedding is not null
          and d.deleted_at is null and d.status in ('published','partial') and d.id <> all($2::uuid[])
        order by d.embedding <=> src.embedding limit $3`,
      [docIds[0], docIds, k],
    );
    impact.related = related.rows.map((r) => ({ id: r.id as string, title: r.title as string, similarity: Number(r.sim) }));
    return impact;
  }

  async impactForDocument(documentId: string, opts: ImpactOptions = {}): Promise<ImpactSet> {
    const steps = await this.pool.query(
      `select step_key, block_id from steps where document_id=$1 order by position`,
      [documentId],
    );
    return this.impactForSteps(
      steps.rows.map((r) => ({ documentId, stepKey: r.step_key as string, blockId: (r.block_id as string | null) ?? undefined })),
      opts,
    );
  }

  /** The subset of the impact set a single suggestion actually touches. */
  affectsFor(impact: ImpactSet, s: ProposedSuggestion): AffectsItem[] {
    const out: AffectsItem[] = [];
    if (s.targetBlockId) {
      const b = impact.blocks.find((x) => x.id === s.targetBlockId);
      if (b) out.push({ kind: 'block', id: b.id, title: b.title, why: `בלוק משותף ב-${b.usedBy} מסמכים` });
    }
    if (s.type === 'field-alert') {
      const name = (s.payload as { field?: string }).field;
      const f = impact.fields.find((x) => x.name === name);
      if (f) out.push({ kind: 'field', id: f.name, title: f.name, why: `שדה CRM ב-${f.usedBy} מסמכים` });
    }
    for (const d of impact.documents) out.push({ kind: 'document', id: d.id, title: d.title, why: d.why });
    for (const t of impact.topics) out.push({ kind: 'topic', id: t.id, title: t.name, why: 'נושא משותף' });
    return out;
  }

  /** Hebrew bullets for the prompt / chat, cut to `maxChars` on a line boundary. */
  formatImpact(impact: ImpactSet, maxChars: number): string {
    const lines: string[] = [];
    for (const b of impact.blocks) lines.push(`- בלוק משותף "${b.title}" (blockId=${b.id}) בשימוש ב-${b.usedBy} מסמכים`);
    for (const f of impact.fields) lines.push(`- שדה CRM "${f.name}" בשימוש ב-${f.usedBy} מסמכים`);
    for (const d of impact.documents) lines.push(`- מסמך "${d.title}" (documentId=${d.id}) — ${d.why}`);
    for (const t of impact.topics) lines.push(`- נושא "${t.name}"`);
    for (const r of impact.related) lines.push(`- מסמך קרוב "${r.title}" (documentId=${r.id}, דמיון ${r.similarity.toFixed(2)})`);
    let out = '';
    for (const l of lines) {
      if (out.length + l.length + 1 > maxChars) { out += '\n- …'; break; }
      out += (out ? '\n' : '') + l;
    }
    return out.length > maxChars ? out.slice(0, maxChars) : out;
  }
}

const WHY: Record<string, string> = {
  link: 'קישור מפורש',
  next: 'מעבר (goto) לשלב',
  prerequisite: 'תנאי מקדים',
  shares_block: 'משתמש באותו בלוק',
  same_field: 'משתמש באותו שדה CRM',
  related: 'מסמך קשור',
  derived_from_source: 'נגזר מאותו מקור',
};
```
If `inboundFor`'s `type` union (`LinkType`) contains other values, add Hebrew for them. `AffectsItem` is X0's `z.infer<typeof AffectsItemSchema>`; if X0 did not export the alias, export it in `wave6.ts` (additive) in this task.

- [ ] **Step 4: Run** → PASS. **Step 5: Commit** `feat(api): ImpactService — blast radius of a source change (blocks, fields, inbound links, topics, related by embedding)`.

---

### Task 3: Prompt v3, brief/style/architecture, few-shot bank, provenance on suggestions

**Files:**
- Create: `packages/model/prompts/propose-v3.md`, `packages/model/prompts/architecture-v1.md`, `apps/api/src/modules/sources/fewshot.ts`
- Modify: `packages/model/src/prompt.ts`, `packages/model/src/index.ts` (export `renderArchitecture`), `apps/api/src/modules/sources/proposal.ts`, `apps/api/src/modules/sources/suggestions.ts`, `apps/api/src/modules/sources/index.ts`, `apps/api/src/jobs/pipeline.ts`
- Test: `packages/model/test/prompt-v3.test.ts`, `apps/api/test/sources/fewshot.test.ts`, `apps/api/test/int/suggestions-affects.test.ts`

**Interfaces:**
- Consumes: `getAiSettings(q)` + `currentPromptVersion(settings)` (X0), `AI_SETTINGS_KEYS`, `ImpactService`, `ProposalContext.brief/style/impact/examples`.
- Produces: `PROMPT_VERSION = 'propose-v3'`; `buildMessages(ctx)` rendering order: system = `[brief]\n\n[architecture]\n\n[style]\n\n[task rules v3]`; user = source header, impact, examples, sections, diffs, linkedSteps, blocks, fields; `renderArchitecture(): string`; `ProposalService.buildContext(revision, diffs)` fills the new fields; `SuggestionService.createFromProposals(revisionId, items, meta?: { promptVersion?: string; model?: string; affects?: (s) => AffectsItem[] })`; `fewShotExamples(q, opts)`.

- [ ] **Step 1: Write the prompt files**

`packages/model/prompts/architecture-v1.md` (Hebrew; this is data, injected verbatim):
```md
ארכיטקטורת הידע של wecom:
- היררכיה: עולם תוכן ← נושא ← פריטי ידע. פריט יכול להשתייך לכמה עולמות ונושאים; אין עותקים — מקור אמת אחד וקישורים אליו.
- סוגי פריטים: M אבחון (נקודת כניסה, שאלות אבחון, ניתוב למסלול), R מסלול טיפול (טיפול מלא בתרחיש), O תפעול (הוראות לפעולה במערכת/מכשיר), E הסלמה (מתי מפסיקים, למי מעבירים, מה מתעדים), S מסלול מומחה, T תסריט שיחה (ניסוחים ללקוח), I מידע.
- לא כל נושא מכיל את כל הסוגים; מבנה נפוץ לתקלה מורכבת: M → R → O/E/S/T. קיימים גם I בלבד, O בלבד, R → O.
- שתי שכבות לכל פריט: מסמך מקור (מנוהל על ידי בעל התוכן) ותצוגת עבודה (שלבים קצרים לנציג). שינוי במקור לעולם אינו משנה את תצוגת העבודה אוטומטית — הוא מייצר הצעות שעורך מאשר.
- בלוק משותף: שלב שמוטמע במסמכים רבים. שינוי בו משפיע על כולם — הצע update-block ולא update-step.
- שדות CRM: שמות שדות מוסכמים; שם לא מוכר = field-alert.
- סטטוסים: טיוטה, ממתין לאישור, פורסם, לא בתוקף, ארכיון. רק "פורסם" מוצג לנציגים.
- שינוי מהותי (שינוי תוצאה/הסתעפות/שדה CRM/מחיקת שלב/מעל 40% מטקסט השלב) גורר רענון ידע לנציגים שהשלימו למידה — ציין זאת ב-rationale כשהוא רלוונטי.
```

`packages/model/prompts/propose-v3.md` — start from `propose-v2.md` verbatim and add, before "כללים:", the block:
```md
לפני שאתה מציע, קרא את "השפעה" (impact): מסמכים אחרים, בלוקים משותפים, שדות CRM ונושאים שהשינוי נוגע בהם. הצעה טובה:
- מתייחסת לכל המקומות שהשינוי משפיע עליהם (אם בלוק משותף השתנה — update-block אחד ולא update-step לכל מסמך).
- מנוסחת בעברית תפעולית קצרה בסגנון הבית ("סגנון"), פעולה אחת בכל שורה, בלי הסברים מיותרים.
- מציינת ב-rationale על אילו מסמכים/בלוקים/שדות היא משפיעה ומדוע.
- אינה ממציאה מזהים ואינה משנה שלבים שהשינוי אינו נוגע בהם.
- אם "דוגמאות מאושרות" מצורפות, שמור על אותה רמת פירוט ואותו ניסוח.
```
Keep every existing rule and the example; the JSON contract is unchanged.

- [ ] **Step 2: Write the failing prompt test** (`packages/model/test/prompt-v3.test.ts`):
```ts
import { describe, it, expect } from 'vitest';
import { buildMessages, PROMPT_VERSION, renderArchitecture } from '../src/index.js';
import type { ProposalContext } from '../src/index.js';

const base: ProposalContext = {
  source: { id: 's', title: 'נהלי SIM' },
  diffs: [{ ref: '4.8', kind: 'changed', before: 'מעל 5 מגה', after: 'מעל 6 מגה', similarity: 0.9 }],
  paragraphs: [],
  linkedSteps: [{ documentId: 'D', documentTitle: 'איטיות', stepKey: 's8', stepNum: '8', stepTitle: 'בדיקת מהירות', anchor: '4.8', actions: ['הרץ Speedtest'] }],
  fields: [], blocks: [],
};
describe('prompt v3', () => {
  it('is versioned v3 and injects brief, architecture and style into the system message', () => {
    expect(PROMPT_VERSION).toBe('propose-v3');
    const [sys, user] = buildMessages({ ...base, brief: 'wecom היא חברת סלולר', style: 'פעולה אחת בשורה' });
    expect(sys.role).toBe('system');
    expect(sys.content.indexOf('wecom היא חברת סלולר')).toBeLessThan(sys.content.indexOf('ארכיטקטורת הידע'));
    expect(sys.content).toContain('פעולה אחת בשורה');
    expect(sys.content).toContain(renderArchitecture().slice(0, 40));
    expect(user.content).toContain('§4.8');
  });
  it('renders impact and examples in the user message, within budget', () => {
    const [, user] = buildMessages({
      ...base,
      impact: { documents: [{ id: 'X', title: 'ניתוקים', why: 'קישור' }], blocks: [{ id: 'B', title: 'ריענון SIM', usedBy: 3 }], fields: [], topics: [], related: [] },
      examples: [{ diff: '§2 changed: 3 → 4', suggestion: { anchor: '§2', type: 'update-step', title: 'ת', targetDocumentId: 'D', targetStepKey: 's2', targetBlockId: null, payload: { type: 'update-step', addActions: ['x'], patch: {} }, confidence: 0.9, rationale: 'r' } }],
      maxContextChars: 6000,
    } as ProposalContext & { maxContextChars: number });
    expect(user.content).toContain('השפעה');
    expect(user.content).toContain('ריענון SIM');
    expect(user.content).toContain('דוגמאות מאושרות');
    expect(user.content.length).toBeLessThan(6000);
  });
  it('drops examples before impact, and impact before diffs, when over budget', () => {
    const big = 'א'.repeat(3000);
    const [, user] = buildMessages({ ...base, brief: big, impact: { documents: [{ id: 'X', title: big, why: 'w' }], blocks: [], fields: [], topics: [], related: [] },
      examples: [{ diff: big, suggestion: { anchor: '§1', type: 'deprecate-step', title: 't', targetDocumentId: 'D', targetStepKey: 's1', targetBlockId: null, payload: { type: 'deprecate-step', reason: 'x' }, confidence: 0.5, rationale: '' } }],
      maxContextChars: 4000 } as ProposalContext & { maxContextChars: number });
    expect(user.content).not.toContain('דוגמאות מאושרות');
    expect(user.content).toContain('§4.8'); // diffs always survive
  });
});
```
`maxContextChars` is an optional field: add `maxContextChars?: number` to `ProposalContext` in `packages/model/src/contract.ts` (additive; X0 did not define it — record it in the lane report).

- [ ] **Step 3: Implement in `prompt.ts`**

```ts
export const PROMPT_VERSION = 'propose-v3';
const archPath = fileURLToPath(new URL('../prompts/architecture-v1.md', import.meta.url));
export const ARCHITECTURE_PROMPT = readFileSync(archPath, 'utf8');
export const renderArchitecture = (): string => ARCHITECTURE_PROMPT;
const DEFAULT_MAX_CONTEXT_CHARS = 24_000;

function systemMessage(ctx: ProposalContext): string {
  return [ctx.brief?.trim(), ARCHITECTURE_PROMPT.trim(), ctx.style ? 'סגנון הבית:\n' + ctx.style.trim() : '', SYSTEM_PROMPT.trim()]
    .filter(Boolean)
    .join('\n\n');
}
```
In `buildMessages`, after computing `fields`, build three optional blocks:
```ts
  const impactText = ctx.impact ? formatImpactForPrompt(ctx.impact) : '';
  const examplesText = (ctx.examples ?? [])
    .slice(0, 3)
    .map((e, i) => `דוגמה ${i + 1} — שינוי: ${e.diff}\nהצעה מאושרת: ${JSON.stringify(e.suggestion)}`)
    .join('\n\n');
  const budget = ctx.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const sys = systemMessage(ctx);
  const fixedParts = [`מסמך מקור: ${ctx.source.title}`, ...(ctx.source.singleDocument ? [...] : []), ...(sections ? [...] : []), '', 'שינויים:', diffs || '- אין', '', 'שלבים ממופים (linkedSteps):', steps || '- אין', '', 'בלוקים משותפים:', blocks || '- אין', '', `שדות CRM מוכרים: ${fields || 'אין'}`, '', 'החזר JSON בלבד.'];
  let optional: string[] = [];
  const withImpact = impactText ? ['', 'השפעה (impact) — מה עוד השינוי נוגע בו:', impactText] : [];
  const withExamples = examplesText ? ['', 'דוגמאות מאושרות (שמור על אותה רמת פירוט):', examplesText] : [];
  const size = (parts: string[]) => sys.length + parts.join('\n').length;
  optional = [...withImpact, ...withExamples];
  if (size([...fixedParts, ...optional]) > budget) optional = [...withImpact];
  if (size([...fixedParts, ...optional]) > budget) optional = [];
  const user = [...fixedParts.slice(0, 1), ...optional, ...fixedParts.slice(1)].join('\n');
  return [{ role: 'system', content: sys }, { role: 'user', content: user }];
```
where `formatImpactForPrompt` is a local pure function mirroring `ImpactService.formatImpact` (the model package cannot import the api; keep both under 30 lines and identical in output shape; cap at 4000 chars). Keep the existing `diffs`/`steps`/`blocks`/`sections` code untouched.

- [ ] **Step 4: Few-shot bank** (`apps/api/src/modules/sources/fewshot.ts`):
```ts
import type pg from 'pg';
import type { FewShotExample, ProposedSuggestion } from '@wecom/model';

/**
 * Accepted (or applied) suggestions of the same types, preferring the same source, then the same
 * worlds. The stored `edited_payload` wins over `payload`: what the editor kept is the example,
 * not what the model first said. Newest first, `limit` total.
 */
export async function fewShotExamples(
  q: Pick<pg.Pool, 'query'>,
  opts: { sourceId: string; worldSlugs: string[]; types: string[]; limit?: number },
): Promise<FewShotExample[]> {
  const limit = opts.limit ?? 3;
  const r = await q.query(
    `select s.anchor, s.type, s.title, s.target_document_id, s.target_step_key, s.target_block_id,
            coalesce(s.edited_payload, s.payload) as payload, s.confidence, s.rationale,
            (select string_agg(format('§%s %s: %s → %s', d->>'ref', d->>'kind', d->>'before', d->>'after'), '; ')
               from jsonb_array_elements(sr.meta->'diffs') d where d->>'ref' = regexp_replace(s.anchor,'^§','')) as diff,
            (sr.source_id = $1) as same_source
       from suggestions s
       join source_revisions sr on sr.id = s.source_revision_id
       left join documents doc on doc.id = s.target_document_id
      where s.status in ('accepted','applied') and s.type = any($3::text[])
        and (sr.source_id = $1 or doc.category = any($2::text[]) or exists (
              select 1 from document_worlds dw where dw.document_id = doc.id and dw.world_slug = any($2::text[])))
      order by same_source desc, s.decided_at desc nulls last limit $4`,
    [opts.sourceId, opts.worldSlugs, opts.types, limit],
  );
  return r.rows.map((x) => ({
    diff: (x.diff as string | null) ?? `§${String(x.anchor).replace(/^§/, '')}`,
    suggestion: {
      anchor: x.anchor, type: x.type, title: x.title, targetDocumentId: x.target_document_id, targetStepKey: x.target_step_key,
      targetBlockId: x.target_block_id, payload: x.payload, confidence: Number(x.confidence), rationale: x.rationale,
    } as ProposedSuggestion,
  }));
}
```
`source_revisions.meta->'diffs'` must exist: `processRevision` does not store diffs today. Add to `processRevision` (Task 3 Step 6) a one-line `update source_revisions set meta = coalesce(meta,'{}'::jsonb) || jsonb_build_object('diffs', $2::jsonb) where id=$1` with the non-`same` diffs, so future revisions have examples with real diff text; older rows fall back to the anchor.

- [ ] **Step 5: Enrich `ProposalService.buildContext`**

Constructor gains `impact: ImpactService` and `settings: () => Promise<AiSettings>` (pass `() => getAiSettings(app.db)` from `sources/index.ts`). After `linkedSteps` is known:
```ts
      const [settings, impact] = await Promise.all([
        this.settings(),
        this.impact.impactForSteps(linkedSteps.map((s) => ({ documentId: s.documentId, stepKey: s.stepKey, blockId: s.blockId }))),
      ]);
      const worldSlugs = [...new Set((await this.pool.query(
        `select world_slug from document_worlds where document_id = any($1::uuid[])`,
        [[...new Set(linkedSteps.map((s) => s.documentId))]],
      )).rows.map((r) => r.world_slug as string))];
      const types = [...new Set(diffs.filter((d) => d.kind !== 'same').map((d) => (d.kind === 'removed' ? 'deprecate-step' : linkedSteps.some((s) => s.anchor === d.ref.replace(/^§/, '')) ? 'update-step' : 'new-card')))];
      const examples = await fewShotExamples(this.pool, { sourceId: revision.sourceId, worldSlugs, types, limit: 3 });
      return {
        source: { … as today … },
        diffs, paragraphs: revision.paragraphs, linkedSteps,
        fields: …, blocks: …,
        brief: settings.brief.text || undefined,
        style: settings.style.text || undefined,
        impact,
        examples,
        maxContextChars: settings.limits.maxContextChars,
      };
```
- [ ] **Step 6: Provenance on suggestions**

`SuggestionService.createFromProposals(revisionId, items, meta: { promptVersion?: string; model?: string; affects?: (s: ProposedSuggestion) => AffectsItem[] } = {})`: extend the insert to `(…, rationale, affects, prompt_version, model) values (…, $11, $12, $13)` with `JSON.stringify(meta.affects?.(it) ?? [])`, `meta.promptVersion ?? null`, `meta.model ?? null`; `row()` maps `affects`, `promptVersion`, `model`. In `processRevision`: after `buildContext`, compute `const settings = await deps.proposal.currentSettings()` (add that accessor) and pass `{ promptVersion: currentPromptVersion(settings), model: model.name, affects: (s) => deps.proposal.impactService.affectsFor(ctx.impact!, s) }`; also persist the diffs into `source_revisions.meta` (Step 4). Wire `ImpactService` in `sources/index.ts` (`const impact = new ImpactService(app.db)`; `new ProposalService(app.db, mapping, content, impact, () => getAiSettings(app.db))`) and expose it on `PipelineDeps` as `impact` for X2.

- [ ] **Step 7: Tests**

`apps/api/test/sources/fewshot.test.ts` (integration): seed a source, two accepted suggestions (one `update-step` on the same source with `edited_payload` set, one `deprecate-step` on another source in world `tech`), one rejected; `fewShotExamples({ sourceId, worldSlugs: ['tech'], types: ['update-step','deprecate-step'] })` returns 2, same-source first, edited payload used, rejected excluded.
`apps/api/test/int/suggestions-affects.test.ts`: build an app (`buildTestApp`), seed a document whose step uses a shared block and a CRM field, upload a docx revision that changes the mapped paragraph (reuse the flow in `test/sources/routes.test.ts`), run `processRevision` with the `RuleBasedModel`; assert every created suggestion has `prompt_version = 'propose-v3'`, `model = 'rules'`, and the `update-block`/`update-step` suggestion's `affects` contains the block with `usedBy ≥ 1`; `GET /api/v1/suggestions?sourceId=` returns `affects` in the JSON.

- [ ] **Step 8: Run** — `pnpm --filter @wecom/model test && cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sources test/int/suggestions-affects.test.ts` → PASS (existing `prompt.test.ts` may assert `PROMPT_VERSION === 'propose-v2'` — update it to v3 and keep the v2 assertions that still hold).
- [ ] **Step 9: Commit** `feat(model,api): prompt v3 with brief/architecture/style, impact and few-shot context; suggestions record affects, prompt version and model`.

---

### Task 4: Embedding-based mapping

**Files:**
- Create: `apps/api/src/modules/sources/embeddings.ts`
- Modify: `apps/api/src/modules/sources/mapping.ts`, `apps/api/src/modules/documents/repo.ts` (one call: refresh step embeddings after `saveStructure` — **allowed as the same "one small hunk" rule other lanes used; keep it to a single line calling `refreshStepEmbeddings(pool, id, model)` outside the transaction, next to the existing `updateEmbedding` call in `search/repo.ts`'s reindex path** — read where `updateEmbedding` is invoked after publish and mirror that placement)
- Test: `apps/api/test/sources/mapping-embeddings.test.ts`

**Interfaces:**
- Produces: `stepText(step: { title: string; actions: string[] }): string`, `embedMany(model, texts, batch = 32): Promise<number[][]>`, `refreshStepEmbeddings(q, documentId, model): Promise<number>` (skips steps whose `text_hash` is unchanged), `MappingService` constructor gains optional `model?: ModelClient | null`; `proposeInitialMapping` uses cosine over `step_embeddings` when `model?.embed` exists and the table has rows for candidate documents, else the existing trigram loop; `EMBED_MAP_THRESHOLD = 0.78` (calibrated in Task 5; exported).

- [ ] **Step 1: Failing test** (integration): seed two documents with distinct steps; seed `step_embeddings` rows directly with hand-made unit vectors (dimension from `EMBED_DIMENSION`, default 1024 in the test DB after 0051 — build vectors as `[1,0,0,…]` and `[0,1,0,…]`); a fake model whose `embed(text)` returns `[1,0,…]` for text containing "APN" and `[0,1,…]` otherwise; `proposeInitialMapping(sourceId, [paragraph 'הגדרת APN…', paragraph 'ריענון SIM…'])` maps paragraph 1 → the APN step and 2 → the SIM step with `score ≥ 0.78`; with `model: null` it falls back to trigram and still maps when titles overlap textually.
- [ ] **Step 2: Implement** — `embeddings.ts`:
```ts
import { createHash } from 'node:crypto';
import type { ModelClient } from '@wecom/model';
import type { Queryable } from '../../lib/sql.js';

export const stepText = (s: { title: string; actions: string[] }): string => [s.title, ...s.actions].filter(Boolean).join('. ').slice(0, 2000);
export const textHash = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 32);

export async function embedMany(model: ModelClient, texts: string[], batch = 32): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    out.push(...(model.embedBatch ? await model.embedBatch(slice) : await Promise.all(slice.map((t) => model.embed!(t)))));
  }
  return out;
}

/** Re-embeds the document's steps whose text changed. Best-effort like `updateEmbedding`: never throws. */
export async function refreshStepEmbeddings(q: Queryable, documentId: string, model: ModelClient | null | undefined): Promise<number> {
  if (!model?.embed) return 0;
  const r = await q.query(
    `select s.id, s.title, coalesce((select array_agg(a.text order by a.position) from step_actions a where a.step_id=s.id),'{}') actions, e.text_hash
       from steps s left join step_embeddings e on e.step_id = s.id where s.document_id=$1`,
    [documentId],
  );
  const todo = r.rows.map((x) => ({ id: x.id as string, text: stepText({ title: x.title, actions: x.actions }), old: x.text_hash as string | null }))
    .map((x) => ({ ...x, hash: textHash(x.text) })).filter((x) => x.hash !== x.old && x.text);
  if (!todo.length) return 0;
  try {
    const vecs = await embedMany(model, todo.map((t) => t.text));
    for (let i = 0; i < todo.length; i++)
      await q.query(
        `insert into step_embeddings(step_id, document_id, embedding, text_hash) values ($1,$2,$3::vector,$4)
         on conflict (step_id) do update set embedding=excluded.embedding, text_hash=excluded.text_hash, updated_at=now()`,
        [todo[i].id, documentId, JSON.stringify(vecs[i]), todo[i].hash],
      );
    return todo.length;
  } catch {
    return 0;
  }
}
```
In `mapping.ts`: `export const EMBED_MAP_THRESHOLD = 0.78;` and in `proposeInitialMapping`, before the trigram loop:
```ts
    if (this.model?.embed) {
      const texts = paragraphs.map((p) => stripFmt(paragraphText(p)));
      let vecs: number[][] = [];
      try { vecs = await embedMany(this.model, texts); } catch { vecs = []; }
      if (vecs.length === paragraphs.length) {
        const out: MappingProposal[] = [];
        for (let i = 0; i < paragraphs.length; i++) {
          const best = await this.pool.query(
            `select e.document_id, s.step_key, 1 - (e.embedding <=> $1::vector) as score
               from step_embeddings e join steps s on s.id = e.step_id
               join documents d on d.id = e.document_id and d.deleted_at is null
              where not exists (select 1 from document_links l where l.from_document_id=d.id and l.to_source_id=$2)
              order by e.embedding <=> $1::vector limit 1`,
            [JSON.stringify(vecs[i]), sourceId],
          );
          const b = best.rows[0];
          if (b && Number(b.score) >= EMBED_MAP_THRESHOLD)
            out.push({ ref: paragraphs[i].ref, documentId: b.document_id, stepKey: b.step_key, score: Number(b.score) });
        }
        if (out.length) return out; // else fall through to trigram
      }
    }
```
Constructor: `constructor(private readonly pool: pg.Pool, private readonly model: ModelClient | null = null)`; `sources/index.ts` passes `app.model`. Call `refreshStepEmbeddings` from the same place `updateEmbedding` runs after a structure save/publish (find it: `grep -n updateEmbedding apps/api/src/modules -r`), and from the reindex job (Task 6).
- [ ] **Step 3: Run** → PASS. **Step 4: Commit** `feat(api): embedding-based paragraph→step mapping with trigram fallback; step embeddings refreshed on save`.

---

### Task 5: Eval harness, case set, calibration

**Files:**
- Create: `packages/model/src/eval.ts`, `packages/model/src/calibration.ts`, `packages/model/eval/run.ts`, `packages/model/eval/cases/{01..08}-*.json`
- Modify: `packages/model/package.json` (`"eval": "tsx eval/run.ts"` — add `tsx` as a devDependency, pinned after `npm view tsx version`), `packages/model/src/index.ts` (export `eval.js`, `calibration.js`), `packages/model/src/rules.ts` (use `confidenceFor`)
- Test: `packages/model/test/eval.test.ts`, `packages/model/test/calibration.test.ts`

**Interfaces:**
- Produces: `scoreCase(c: EvalCase, items: ProposedSuggestion[]): { hitTarget: number; hitType: number; contentOverlap: number }` (each 0..1: fraction of `expected` entries matched — target = same `targetDocumentId` + `targetStepKey`; type = same `type` on the matched target; overlap = share of `mustContain` strings present in the suggestion's payload JSON, case-insensitive); `aggregate(scores)`; `CALIBRATION_DEFAULTS: Record<SuggestionType, number>` (= today's rule constants: update-step 0.8/0.55 split → 0.7, deprecate-step 0.7, new-card 0.6, new-step 0.65, update-block 0.75, field-alert 0.8); `confidenceFor(type, raw?, table = CALIBRATION_DEFAULTS)` → `raw` clamped to `[table[type] - 0.15, table[type] + 0.15]` when a raw value is given, else `table[type]`; `loadCases(dir)`; CLI `pnpm --filter @wecom/model eval [--rules] [--model <tag>] [--url http://…] [--json out.json]` prints a table (case, hitTarget, hitType, overlap, ms) and the aggregate.

- [ ] **Step 1: Write 8 cases** under `packages/model/eval/cases/` following `EvalCaseSchema` (X0). Each is realistic Hebrew from the telecom support domain, ids as fixed uuids, and covers: (1) numeric threshold change in a mapped paragraph → `update-step` with the new number in `mustContain`; (2) new instruction sentence appended → `update-step` addActions; (3) paragraph removed → `deprecate-step`; (4) paragraph mapped to a step embedded from a shared block (`blockId` set) → `update-block` (the shared-block case); (5) CRM field renamed in the text (`sim block lbl` → `sim status`) → `field-alert` with issue unknown; (6) brand-new source with three headings → three `new-card` (or one with `singleDocument`); (7) new paragraph under an existing mapped section → `new-step`; (8) a change whose impact lists a second document via a goto → `update-step` whose rationale must mention the other document title (`mustContain` on rationale is allowed: extend `scoreCase` to search `title + rationale + payload`). Include an `impact` object in the case's context when relevant so the model is tested with the same input shape as production.
- [ ] **Step 2: Failing tests** — `eval.test.ts`: `scoreCase` on a hand-built perfect answer → 1/1/1; on a wrong target → 0 target, type still scored 0 (type only counts on a matched target), overlap computed; `loadCases` parses all 8 files through `EvalCaseSchema`; `RuleBasedModel` scores `hitTarget ≥ 0.6` over the set (the fixed floor that protects the fallback). `calibration.test.ts`: `confidenceFor('update-step')` equals the default; `confidenceFor('update-step', 0.99)` is clamped; unknown type throws.
- [ ] **Step 3: Implement** `eval.ts`, `calibration.ts`, `eval/run.ts` (reads cases, builds a `ProposalContext` per case — `paragraphs` synthesised from the diffs' `after` text with the anchors as refs — runs `RuleBasedModel` and, unless `--rules`, `new OllamaModel({ url, model, timeoutMs: 180000 })` *without* fallback so a model failure is visible; prints with `console.table`; writes `--json`). Replace the hard-coded confidences in `rules.ts` with `confidenceFor(type, <the old value>)` so the numbers stay identical today and become table-driven.
- [ ] **Step 4: Run** `pnpm --filter @wecom/model test && pnpm --filter @wecom/model eval --rules` → PASS and a printed table. **Step 5: Commit** `feat(model): offline eval harness with 8 Hebrew cases, scoring and calibration table`.

---

### Task 6: Reindex job, eval job, admin routes

**Files:**
- Create: `apps/api/src/modules/ai/reindex.ts`, `apps/api/src/modules/ai/evalRunner.ts`, `apps/api/src/modules/ai/admin.ts`, `apps/api/src/jobs/ai.ts`
- Modify: `apps/api/src/jobs/index.ts` (register the two workers + nothing scheduled), `apps/api/src/modules/admin/routes.ts` (one import + `await app.register(aiAdmin)`), `apps/api/src/plugins/model.ts` (pass `slots.suggestModel` / `slots.embedModel` from `resolveModelSlots` — X0 said this is allowed here)
- Test: `apps/api/test/int/ai-admin.test.ts`, `apps/api/test/int/ai-reindex.test.ts`

**Interfaces:**
- Routes (all `ai.manage`, under the `/admin` prefix): `POST /admin/ai/models/test` body `ModelTestBodySchema` → `ModelTestResultSchema` (resolves the slot's tag from `getAiSettings().models` falling back to `resolveModelSlots(config)`, `GET /api/tags` presence, `showModel` details, and for `embed` a one-text embed measuring `dims`; for chat/suggest a 20-token generation measuring `tokensPerSec`; never throws — `reachable:false` + `error`); `POST /admin/ai/reindex` body `{ since?: IsoDate }` → `{ queued: true }` (sends `QUEUES.aiReindex`, `singletonKey: 'ai.reindex'`); `POST /admin/ai/eval` body `{ useRules?: boolean }` → `{ queued: true, runId }` (inserts the `ai_eval_runs` row with `finished_at null`, sends `QUEUES.aiEval { runId, useRules }`); `GET /admin/ai/eval/runs` → `EvalRunsResponseSchema` (last 50).
- `reindexEmbeddings(deps: { db: pg.Pool; model: ModelClient; expectedDim: number; log }, opts: { batch?: number; since?: string | null })`: refuses (`{ skipped: -1 }` + warn) when `model.embed` is absent or a probe embed's width ≠ `expectedDim`; iterates documents ordered by `updated_at, id` (where `since` filters `updated_at >= since`) in batches, `updateEmbedding` semantics for documents (reuse the text assembly from `search/repo.ts` by exporting `documentEmbeddingText(q, id)` from there — one additive export), then `refreshStepEmbeddings` per document; returns counts.
- `runEvalCases(model, cases)` + `recordEvalRun(q, runId, result)`.

- [ ] **Step 1: Failing tests** — `ai-reindex.test.ts`: seed 3 documents with steps; fake model with `embed`/`embedBatch` returning unit vectors of the column width (read it with `readEmbeddingDimension`); `reindexEmbeddings` → `documents: 3`, `step_embeddings` rows = step count; run again → `documents: 3` but `steps: 0` (hashes unchanged); fake model returning the wrong width → `skipped: -1`, no rows written. `ai-admin.test.ts` (via `buildTestApp`): 403 without `ai.manage`; `POST /api/v1/admin/ai/models/test { slot: 'embed' }` with `MODEL_DISABLED` app → `reachable: false`; `POST /api/v1/admin/ai/eval { useRules: true }` → 202 with `runId`, then call the worker body directly (`runEvalJob(app, { runId, useRules: true })`) and `GET /api/v1/admin/ai/eval/runs` shows `cases: 8`, `hitTarget > 0`, `finished_at` set; `POST /api/v1/admin/ai/reindex` → 202 (boss disabled in tests: assert the route answers `{ queued: false, reason: 'queue unavailable' }` and 503 — pick one and test it).
- [ ] **Step 2: Implement** the four files; workers in `jobs/ai.ts`:
```ts
export async function startAiJobs(app: FastifyInstance): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.aiReindex, async (job) => {
    try {
      const res = await reindexEmbeddings({ db: app.db, model: app.model, expectedDim: app.config.EMBED_DIMENSION, log: app.log }, { since: (job.data as { since?: string }).since ?? null });
      app.log.info(res, 'ai.reindex done');
    } catch (err) { await reportFailure(app, QUEUES.aiReindex, err); throw err; }
  });
  await boss.work(QUEUES.aiEval, async (job) => {
    try { await runEvalJob(app, job.data as { runId: string; useRules?: boolean }); }
    catch (err) { await reportFailure(app, QUEUES.aiEval, err); throw err; }
  });
}
```
(`reportFailure` is not exported from `jobs/index.ts` — export it, additive.) Call `startAiJobs(app)` from `startJobs` (one line). `plugins/model.ts`: `const slots = resolveModelSlots(app.config)`; use `slots.suggestModel` and `slots.embedModel`; the tracker gets `slots.embedModel` and `app.config.EMBED_DIMENSION` (unchanged check).
- [ ] **Step 3: Run** the two int tests + `route-coverage.test.ts` (all four operations appear literally in `ai-admin.test.ts`). **Step 4: Commit** `feat(api): ai.reindex and ai.eval workers, admin AI routes (models/test, reindex, eval, eval/runs)`.

---

### Task 7: Deploy and tier wiring

**Files:**
- Modify: `deploy/ollama-pull.sh`, `deploy/ollama-pull-check.sh`, `deploy/smoke.sh`, `deploy/docker-compose.yml` (ollama-pull `environment`), `deploy/.env.example`, `deploy/e2e.env`, `deploy/ci.env`, `scripts/e2e-compose.mjs`, `docs/operations.md` (tier section)

- [ ] **Step 1: `ollama-pull.sh`** — build `wanted` from `SUGGEST_MODEL:-$MODEL_NAME`, `CHAT_MODEL:-$MODEL_NAME`, `EMBED_MODEL` (skip empty), de-duplicated in order; log which slot each tag serves. Keep the existing readiness/present logic. Compose passes `SUGGEST_MODEL: "${SUGGEST_MODEL:-}"`, `CHAT_MODEL: "${CHAT_MODEL:-}"`, `MODEL_TIER: "${MODEL_TIER:-}"` to `ollama-pull` (and the api service already gets the whole env — verify `MODEL_TIER`, `SUGGEST_MODEL`, `CHAT_MODEL` reach the api container; add them if the compose file enumerates variables).
- [ ] **Step 2: `ollama-pull-check.sh`** — add `expect_pulls` cases: three distinct slots pull three tags in order; `SUGGEST_MODEL` equal to `MODEL_NAME` and `CHAT_MODEL` unset pull once; embed tag shared with chat pulls once.
- [ ] **Step 3: `smoke.sh`** — `embed_check` reads `EMBED_MODEL` as today; add `slot_check` that, when `SUGGEST_MODEL`/`CHAT_MODEL` are set and differ from `MODEL_NAME`, asserts each tag is in the Ollama listing (reuse the listing code path); print the resolved tier line `models: tier=${MODEL_TIER:-legacy} suggest=… chat=… embed=… (dims …)`.
- [ ] **Step 4: env files** — `.env.example`: document `MODEL_TIER` with the §6 table (copy the table verbatim as comments), `SUGGEST_MODEL`, `CHAT_MODEL`, and change the shipped defaults to tier 1 (`MODEL_TIER=1`, `EMBED_MODEL=bge-m3:latest`, `EMBED_DIMENSION=1024`, `SUGGEST_MODEL`/`CHAT_MODEL` commented with the tier-1 tags so the preset applies). `e2e.env` and `ci.env` stay on the small tags **and keep `EMBED_DIMENSION=768` with `EMBED_MODEL=nomic-embed-text:latest`** so CI does not pull bge-m3 (~1.2 GB); add the comment that 0051 reads `EMBED_DIMENSION`, so these stacks keep a 768 column.
- [ ] **Step 5: `scripts/e2e-compose.mjs`** — the tag assertion loops over `['MODEL_NAME','SUGGEST_MODEL','CHAT_MODEL','EMBED_MODEL']`, skipping keys absent from the env file (only `MODEL_NAME` and `EMBED_MODEL` are required as today), comparing literally.
- [ ] **Step 6: `docs/operations.md`** — "Model tiers" section: the §6 table, how to change tier (set env, `docker compose up -d ollama-pull api`, run `POST /admin/ai/models/test` per slot, then `POST /admin/ai/reindex` after changing the embedder + `EMBED_DIMENSION` **together with a fresh DB or a rerun of 0051 on a maintenance window** — state that changing the embedder on a live DB requires `migrate down` to 0050 and up again, which drops vectors only).
- [ ] **Step 7: Run** `bash deploy/ollama-pull-check.sh`, `bash deploy/compose-check.sh` (exists on main), `bash deploy/nginx-check.sh`; `node --check scripts/e2e-compose.mjs`. **Step 8: Commit** `chore(deploy): model tiers and slots — pull/check/smoke/env/compose wiring`.

---

### Task 8: Gate, OpenAPI, tier-1 evaluation note, lane report

- [ ] **Step 1:** `pnpm -r build && pnpm typecheck && pnpm lint`; `pnpm --filter @wecom/shared test && pnpm --filter @wecom/model test`; `cd apps/api && pnpm vitest run test/unit && RUN_INTEGRATION=1 pnpm test:int` (known flakes `boss.test.ts`, `sources/routes.test.ts` — re-run in isolation before calling red); `pnpm openapi` + contract test + `route-coverage.test.ts`.
- [ ] **Step 2:** If Ollama is reachable on this machine (`curl -s localhost:11434/api/tags`), run `pnpm --filter @wecom/model eval --rules` and, if the tier-1 tag exists locally, `--model <tag>`; paste both tables into the report. If not reachable, say so — X6 runs the tier-1 evaluation on the VM.
- [ ] **Step 3:** Write `.superpowers/sdd/program/X1-report.md` (git-ignored): per-task status, commits, test counts, deviations (e.g. `maxContextChars` added to `ProposalContext`, `reportFailure` exported, `documentEmbeddingText` exported), the exact exports for X2 (`ImpactService`, `formatImpact`, `fewShotExamples`, `confidenceFor`, `PipelineDeps.impact`), the migration filename, and the deploy checklist X6 must run on the VM (`MODEL_TIER=1`, pull, reindex, eval).

## Self-review

- Spec coverage: §1.6 impact (Task 2 + 3), §1.7 brief/architecture/style + prompt version (Task 3), §1.9 eval + calibration + provenance (Tasks 3, 5, 6), §1.10 embedding mapping (Task 4), §1.2 slots/tiers + embedder swap (Tasks 1, 6, 7), §3 columns/tables (Task 1), §4.1 admin routes (Task 6), §6 tiers (Task 7). Acceptance analytics (`GET /suggestions/analytics`) is X3's and structured edits are X3's — not here.
- Placeholders: none; every SQL, script and test is written out or names the exact existing code to mirror.
- Type consistency: `ImpactSet`/`AffectsItem`/`FewShotExample` come from X0; `ImpactService` method names match the Cross-lane table and the tests; `createFromProposals`' third argument is the one `processRevision` passes; `EMBED_MAP_THRESHOLD`, `confidenceFor`, `PROMPT_VERSION`, `renderArchitecture`, `reindexEmbeddings`, `runEvalJob` are each defined once and used by name elsewhere in this plan.
