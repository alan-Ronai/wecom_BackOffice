# L5 — Source Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real source-document ingestion (`.docx` with tracked changes, `.txt/.md`), paragraph diffing, a local Ollama model (with rule-based fallback) that proposes card changes, and a suggestion queue whose accepted items are applied to the library as real versions.

**Architecture:** `packages/model` gains `OllamaModel` (HTTP to Ollama, JSON-mode, schema-validated, retry → `RuleBasedModel`). `apps/api/src/modules/sources/` holds parsers (`docx.ts`, `text.ts`), services (`revisions.ts`, `diff.ts`, `mapping.ts`, `proposal.ts`, `suggestions.ts`), routes, and pg-boss jobs (`pipeline.process`, `sources.watch`). Applying suggestions calls L2's `publishDocument` / `publishBlock` so versions, links and search stay consistent.

**Tech Stack:** Node 22, TypeScript strict, Fastify 5 + fastify-type-provider-zod, `@fastify/multipart` 9, `jszip` 3, `fast-xml-parser` 4, `pg` 8, `pg-boss` 10, `chokidar` 4 (watch folder), vitest 2, `@testcontainers/postgresql`, `undici`/global `fetch` for Ollama.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` §6 (contracts 6–7), §7 (stage 2); `docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` §2 (sources/pipeline tables), §4 (sources & suggestions routes). Contract names come from `docs/superpowers/plans/2026-09-13-L0-contracts-and-scaffold.md`.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`.
- All user-facing strings (rationales, titles, toasts) in Hebrew; code, logs, commits in English.
- Contract names are used verbatim from L0: `ParagraphSchema`, `Paragraph`, `Run`, `ParagraphDiff`, `SourceContent` (from `@wecom/connectors`), `SuggestionPayloadSchema`, `SuggestionSchema`, `SuggestionTypeSchema`, `ProposalContext`, `ProposedSuggestion`, `ModelClient`, `RuleBasedModel`, `makeEvent`, `similarity`, `stripFmt`.
- Table/column names verbatim from L0 migrations: `sources(kind, connector_id, external_id, title, ext, mapping, sync_state, last_hash, last_synced_at)`, `source_revisions(id, source_id, hash, raw, paragraphs, meta, imported_at, imported_by, accepted)`, `suggestions(id, source_revision_id, anchor, type, title, target_document_id, target_step_key, target_block_id, payload, edited_payload, confidence, rationale, status, decided_by, decided_at, applied_version_id, created_at)`, `steps(step_key, source_ref, block_id, tone …)`, `document_links(type='derived_from_source', to_source_id, from_step_key)`, `crm_fields(name, status, renamed_to, path)`.
- Model: default `MODEL_NAME=qwen2.5:3b-instruct-q4_K_M`, `EMBED_MODEL=nomic-embed-text`, `MODEL_URL=http://localhost:11434`; CPU only → job concurrency 1, per-call timeout 120 s.
- Model output is never trusted unvalidated: every proposal passes `SuggestionPayloadSchema` before storage.
- Permissions: `sources.manage` for upload/process, `suggestions.review` for decide/edit, `suggestions.apply` for publish (route `config.requires` per L3's middleware; until L3 lands, tests inject `req.user` via the `authStub` plugin defined in Task 9).
- Commit after every task; commit messages end with the session's attribution lines.

## Interfaces expected from other lanes (used, not built, here)

```ts
// L2 apps/api/src/modules/content/documents.ts
export function publishDocument(client: pg.PoolClient, doc: Document, opts: { actorId: string | null; label: string; suggestionId?: string | null; kind?: 'published' | 'sync' }): Promise<{ document: Document; versionId: string; version: number }>;
export function getDocument(client: pg.PoolClient, id: string): Promise<Document | null>;
export function createDocument(client: pg.PoolClient, input: z.infer<typeof CreateDocumentBodySchema> & { sourceId?: string; sourceRef?: string }, actorId: string | null): Promise<Document>;
export function listDocumentRefs(client: pg.PoolClient): Promise<{ id: string; title: string; code?: string }[]>;
// L2 apps/api/src/modules/content/blocks.ts
export function getBlock(client: pg.PoolClient, id: string): Promise<Block | null>;
export function publishBlock(client: pg.PoolClient, block: Block, opts: { actorId: string | null; label: string }): Promise<{ block: Block; version: number }>;
export function listBlocks(client: pg.PoolClient): Promise<Block[]>;
// L2 apps/api/src/modules/content/fields.ts
export function listFields(client: pg.PoolClient): Promise<CrmField[]>;
export function upsertField(client: pg.PoolClient, input: z.infer<typeof UpsertFieldBodySchema>, actorId: string | null): Promise<CrmField>;
// L2 apps/api/src/plugins/events.ts
declare module 'fastify' { interface FastifyInstance { events: { publish(e: Event): void } } }
// L1/L2 apps/api/src/plugins/boss.ts
declare module 'fastify' { interface FastifyInstance { boss: PgBoss } }
// L3 apps/api/src/plugins/auth.ts — req.user: { id: string; permissions: Set<string>; displayName: string }
```
If a lane has not landed, Task 9 provides `test/helpers/stubs.ts` implementing these signatures against the DB directly (test-only; never shipped).

## File structure produced by this plan

```
packages/model/
  prompts/propose-v1.md                  Hebrew system prompt + few-shot examples (versioned)
  src/ollama.ts                          OllamaModel implements ModelClient
  src/prompt.ts                          buildMessages(ctx), parseProposals(text)
  src/index.ts                           + exports
  test/ollama.test.ts, test/prompt.test.ts, test/fixtures/ollama-stub.ts
apps/api/src/modules/sources/
  docx.ts                                parseDocx(buffer) → SourceContent
  text.ts                                parseText(name, text) → SourceContent
  parsers.ts                             parseUpload(filename, buffer) dispatch
  revisions.ts                           SourceRevisionService
  diff.ts                                DiffService
  mapping.ts                             MappingService
  proposal.ts                            ProposalService
  suggestions.ts                         SuggestionService (create/decide/edit/apply/publish)
  jobs.ts                                registerPipelineJobs(app): pipeline.process, sources.watch
  routes.ts                              /sources, /suggestions
  index.ts                               registerSourcesModule(app)
apps/api/src/plugins/model.ts            app.model: ModelClient (Ollama or rules)
apps/api/test/sources/fixtures/docx-builder.ts
apps/api/test/sources/docx.test.ts, text.test.ts, diff.test.ts, mapping.test.ts, proposal.test.ts, suggestions.test.ts, routes.test.ts, jobs.test.ts
apps/api/test/helpers/stubs.ts, apps/api/test/helpers/db.ts
```


## Cross-lane reconciliation (authoritative — added after the eight plans were reviewed together)

These names win over anything else in this file. They are the L0-owned contract for runtime glue (ADR 0001).

- **Job queues**: import `QUEUES` from `apps/api/src/plugins/boss.ts` (owned by L1) and never spell queue names inline. Catalogue: `pipeline.process` (L5, concurrency 1), `sources.watch` (L5), `connector.run` (L6, one cron schedule per connector, job key = connector id), `connector.webhook` (L6), `identity.sync` (L3), `trash.purge` (L2), `search.reindex` (L2), `system.backup-check` (L1). The decorator is `app.boss: PgBoss | null`; there is no `plugins/jobs.ts`.
- **Audit**: low-level `audit(tx, { actorId, action, entityType, entityId, before, after, requestId, ip }): Promise<string>` lives in `apps/api/src/lib/audit.ts` (owned by L2; L3 creates it with this exact signature only if L2 has not landed). L3's auth plugin additionally decorates the convenience wrapper `app.audit(req, action, entityType, entityId, before, after)` which fills `actorId = req.user?.id ?? null`, `requestId = req.id`, `ip = req.ip` and runs on `app.db`. L6 uses the wrapper; L2/L5 use the low-level function inside their transactions.
- **Events**: `app.events: EventBus` from `apps/api/src/lib/events.ts` (L2) with `publish(tx, event)` where `event = makeEvent(name, payload)` from `@wecom/shared`. No lane creates `plugins/events.ts`.
- **Auth**: `apps/api/src/plugins/auth.ts` (L3) sets `req.user: AuthUser = { id, displayName, roles, permissions: Set<string>, categoryScopes: string[] | null, sessionId }` (`displayName` is an additive field L3 includes) and enforces route `config: { requires: Permission[], scope?: 'document' }`. No lane adds a `requires()` preHandler or `plugins/authz.ts`; until L3 lands, tests use the `x-test-user` header plugin from L2 (`apps/api/test/helpers/fakeAuth.ts`) or `buildApp({ testUser })` — both must set the same `AuthUser` shape.
- **Module registration**: every `/api/v1` module registers inside the single `v1` callback in `apps/api/src/app.ts` via `registerModules(v1)` from `apps/api/src/modules/index.ts` (L2); other lanes add one line there.
- **For this lane**: delete every reference to `plugins/authz.ts` and the `requires()` preHandler — routes declare `config: { requires: ['sources.manage'] }` / `['suggestions.review']` / `['suggestions.apply']` and rely on L3's hook (or the test shim). Read the actor's name from `req.user.displayName`. Publish events with `app.events.publish(tx, makeEvent(...))`, not a `plugins/events.ts`. Enqueue with `app.boss.send(QUEUES.pipelineProcess, …)` and register the watcher on `QUEUES.sourcesWatch`. Health probing of the model belongs to L1's health route; expose `app.model` from `plugins/model.ts` (this lane) and L1 reads `app.model.available()`.

---

### Task 1: Prompt templates and message builder

**Files:**
- Create: `packages/model/prompts/propose-v1.md`, `packages/model/src/prompt.ts`
- Modify: `packages/model/src/index.ts` (add `export * from './prompt.js';`)
- Test: `packages/model/test/prompt.test.ts`

**Interfaces:**
- Produces: `PROMPT_VERSION = 'propose-v1'`, `buildMessages(ctx: ProposalContext): { role: 'system' | 'user'; content: string }[]`, `parseProposals(text: string): { ok: true; items: ProposedSuggestion[] } | { ok: false; error: string }`, `RESPONSE_FORMAT` (JSON schema object passed to Ollama's `format`).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { buildMessages, parseProposals, PROMPT_VERSION } from '../src/index.js';
import type { ProposalContext } from '../src/index.js';

const D = '11111111-1111-4111-8111-111111111111';
const ctx: ProposalContext = {
  source: { id: 'src', title: 'נהלי תמיכה טכנית' }, paragraphs: [],
  diffs: [{ ref: '4.8', kind: 'changed', before: 'מעל 5 מגה – תקין.', after: 'מעל 6 מגה – תקין.', similarity: 0.9 }],
  linkedSteps: [{ documentId: D, documentTitle: 'איטיות גלישה', stepKey: 's8', stepNum: '8', stepTitle: 'בדיקת מהירות גלישה', anchor: '4.8', actions: ['בקש מהלקוח להריץ Speedtest'] }],
  fields: [{ name: 'גלישה בארץ', status: 'ok' }], blocks: [],
};

describe('prompt', () => {
  it('builds a system prompt from the versioned file and a user message with the diff', () => {
    const msgs = buildMessages(ctx);
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('update-step');
    expect(msgs[1].content).toContain('§4.8');
    expect(msgs[1].content).toContain('s8');
    expect(PROMPT_VERSION).toBe('propose-v1');
  });
  it('parses and validates model JSON', () => {
    const text = JSON.stringify({ suggestions: [{ anchor: '§4.8', type: 'update-step', title: 'סף Speedtest', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null, payload: { type: 'update-step', addActions: ['ודא ניתוק Wi-Fi'], patch: {} }, confidence: 0.9, rationale: 'ערך שונה' }] });
    const r = parseProposals(text);
    expect(r.ok && r.items[0].targetStepKey).toBe('s8');
  });
  it('rejects mismatched payload type and non-json', () => {
    const bad = JSON.stringify({ suggestions: [{ anchor: '§1', type: 'new-card', title: 'x', targetDocumentId: null, targetStepKey: null, targetBlockId: null, payload: { type: 'update-step', addActions: [], patch: {} }, confidence: 0.5, rationale: '' }] });
    expect(parseProposals(bad).ok).toBe(false);
    expect(parseProposals('not json').ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/model test`
Expected: FAIL (`buildMessages` not exported).

- [ ] **Step 3: Write the prompt file**

`packages/model/prompts/propose-v1.md`:
```md
אתה עוזר לצוות הידע של wecom. מקבלים שינויים במסמך מקור (נהלים) ומחזירים הצעות מובנות לעדכון כרטיסי ידע.
החזר אך ורק JSON בפורמט: {"suggestions":[...]} כאשר כל הצעה היא אובייקט עם השדות:
anchor (מחרוזת, למשל "§4.8"), type (אחד מ: update-step, new-card, new-step, update-block, deprecate-step, field-alert),
title (עברית, קצר), targetDocumentId (uuid או null), targetStepKey (מחרוזת או null), targetBlockId (uuid או null),
payload (אובייקט שה-type שלו זהה ל-type של ההצעה), confidence (0..1), rationale (משפט בעברית).
כללים:
- שינוי ערך/סף/הוראה בפסקה שממופה לשלב → update-step עם addActions (הוראות חדשות בלבד) ו/או branch מעודכן.
- פסקה חדשה ללא שלב ממופה → new-card עם phases/steps מלאים (כל משפט פעולה = שלב, outcomes: next→הבא, האחרון ok).
- פסקה שממופה לשלב שמוטמע מבלוק משותף (blockId קיים) → update-block עם רשימת actions מלאה ומעודכנת.
- פסקה שנמחקה → deprecate-step עם reason.
- שם שדה CRM שאינו ברשימת השדות → field-alert עם issue "unknown".
- אל תמציא מזהים: השתמש רק ב-documentId/stepKey/blockId שמופיעים ב-linkedSteps/blocks.
דוגמה:
קלט: diff §4.8 changed: "מעל 5 מגה – תקין" → "מעל 6 מגה – תקין. יש לוודא ניתוק מ-Wi-Fi." linkedSteps: [{documentId:"D",stepKey:"s8",stepTitle:"בדיקת מהירות גלישה"}]
פלט: {"suggestions":[{"anchor":"§4.8","type":"update-step","title":"סף Speedtest 5 → 6 מגה + ניתוק Wi-Fi","targetDocumentId":"D","targetStepKey":"s8","targetBlockId":null,"payload":{"type":"update-step","addActions":["ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה"],"patch":{}},"confidence":0.95,"rationale":"ערך מספרי שונה והוראה חדשה בפסקה 4.8."}]}
```

- [ ] **Step 4: Implement `prompt.ts`**

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SuggestionSchema, SuggestionPayloadSchema, SuggestionTypeSchema } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';

export const PROMPT_VERSION = 'propose-v1';
const promptPath = fileURLToPath(new URL(`../prompts/${PROMPT_VERSION}.md`, import.meta.url));
export const SYSTEM_PROMPT = readFileSync(promptPath, 'utf8');

export const RESPONSE_FORMAT = {
  type: 'object',
  properties: { suggestions: { type: 'array', items: { type: 'object', required: ['anchor', 'type', 'title', 'payload', 'confidence', 'rationale'], properties: { anchor: { type: 'string' }, type: { type: 'string', enum: SuggestionTypeSchema.options }, title: { type: 'string' }, targetDocumentId: { type: ['string', 'null'] }, targetStepKey: { type: ['string', 'null'] }, targetBlockId: { type: ['string', 'null'] }, payload: { type: 'object' }, confidence: { type: 'number' }, rationale: { type: 'string' } } } } },
  required: ['suggestions'],
} as const;

export function buildMessages(ctx: ProposalContext): { role: 'system' | 'user'; content: string }[] {
  const diffs = ctx.diffs.filter((d) => d.kind !== 'same').map((d) => `- §${d.ref.replace(/^§/, '')} ${d.kind}: לפני: ${JSON.stringify(d.before ?? '')} אחרי: ${JSON.stringify(d.after ?? '')}`).join('\n');
  const steps = ctx.linkedSteps.map((s) => `- anchor §${s.anchor.replace(/^§/, '')}: documentId=${s.documentId} ("${s.documentTitle}") stepKey=${s.stepKey} מספר ${s.stepNum} "${s.stepTitle}"${s.blockId ? ` blockId=${s.blockId}` : ''} פעולות: ${JSON.stringify(s.actions)}`).join('\n');
  const blocks = ctx.blocks.map((b) => `- blockId=${b.id} "${b.title}" פעולות: ${JSON.stringify(b.actions)}`).join('\n');
  const fields = ctx.fields.map((f) => `${f.name} (${f.status})`).join(', ');
  const user = `מסמך מקור: ${ctx.source.title}\n\nשינויים:\n${diffs || '- אין'}\n\nשלבים ממופים (linkedSteps):\n${steps || '- אין'}\n\nבלוקים משותפים:\n${blocks || '- אין'}\n\nשדות CRM מוכרים: ${fields || 'אין'}\n\nהחזר JSON בלבד.`;
  return [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: user }];
}

const ProposedSchema = SuggestionSchema.innerType().omit({ id: true, sourceRevisionId: true, status: true, createdAt: true, decidedBy: true, decidedAt: true, appliedVersionId: true, editedPayload: true })
  .refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' });
const EnvelopeSchema = z.object({ suggestions: z.array(ProposedSchema) });

export function parseProposals(text: string): { ok: true; items: ProposedSuggestion[] } | { ok: false; error: string } {
  let json: unknown;
  try { json = JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { return { ok: false, error: 'invalid json: ' + (e as Error).message }; }
  const r = EnvelopeSchema.safeParse(json);
  if (!r.success) return { ok: false, error: r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') };
  for (const s of r.data.suggestions) SuggestionPayloadSchema.parse(s.payload);
  return { ok: true, items: r.data.suggestions as ProposedSuggestion[] };
}
```
Add `"files": ["dist", "prompts"]` to `packages/model/package.json` so prompts ship.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @wecom/model test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/model && git commit -m "feat(model): versioned Hebrew prompt, message builder, proposal parser"
```

---

### Task 2: `OllamaModel` client with retry and rule fallback

**Files:**
- Create: `packages/model/src/ollama.ts`, `packages/model/test/fixtures/ollama-stub.ts`
- Modify: `packages/model/src/index.ts` (add `export * from './ollama.js';`)
- Test: `packages/model/test/ollama.test.ts`

**Interfaces:**
- Produces: `class OllamaModel implements ModelClient { constructor(opts: { url: string; model: string; embedModel?: string; timeoutMs?: number; fallback?: ModelClient; fetchImpl?: typeof fetch }) ; name: string; available(): Promise<boolean>; proposeChanges(ctx): Promise<ProposedSuggestion[]>; embed(text): Promise<number[]>; lastRun: { used: 'ollama' | 'fallback'; attempts: number; ms: number } | null }`.

- [ ] **Step 1: Write the stub server helper**

`packages/model/test/fixtures/ollama-stub.ts`:
```ts
import { createServer, type Server } from 'node:http';
export interface StubScript { chat: (string | { error: number })[]; tags?: boolean; embeddings?: number[] }
export async function startOllamaStub(script: StubScript): Promise<{ url: string; calls: { path: string; body: unknown }[]; close: () => Promise<void> }> {
  const calls: { path: string; body: unknown }[] = [];
  let chatIdx = 0;
  const server: Server = createServer((req, res) => {
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : null; calls.push({ path: req.url ?? '', body });
      if (req.url === '/api/tags') { res.writeHead(script.tags === false ? 500 : 200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ models: [{ name: 'qwen2.5:3b-instruct-q4_K_M' }] })); }
      if (req.url === '/api/embeddings') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ embedding: script.embeddings ?? [0.1, 0.2] })); }
      if (req.url === '/api/chat') {
        const next = script.chat[Math.min(chatIdx++, script.chat.length - 1)];
        if (typeof next === 'object') { res.writeHead(next.error); return res.end('error'); }
        res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ message: { role: 'assistant', content: next }, done: true }));
      }
      res.writeHead(404); res.end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, calls, close: () => new Promise((r) => server.close(() => r())) };
}
```

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect, afterEach } from 'vitest';
import { OllamaModel, RuleBasedModel, type ProposalContext } from '../src/index.js';
import { startOllamaStub } from './fixtures/ollama-stub.js';

const D = '11111111-1111-4111-8111-111111111111';
const ctx: ProposalContext = { source: { id: 's', title: 't' }, paragraphs: [], diffs: [{ ref: '4.8', kind: 'changed', before: 'a. b.', after: 'a. b. c.', similarity: 0.9 }], linkedSteps: [{ documentId: D, documentTitle: 'x', stepKey: 's8', stepNum: '8', stepTitle: 'y', anchor: '4.8', actions: [] }], fields: [], blocks: [] };
const good = JSON.stringify({ suggestions: [{ anchor: '§4.8', type: 'update-step', title: 't', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null, payload: { type: 'update-step', addActions: ['c.'], patch: {} }, confidence: 0.9, rationale: 'r' }] });
let stop: (() => Promise<void>) | null = null;
afterEach(async () => { await stop?.(); stop = null; });

describe('OllamaModel', () => {
  it('returns validated proposals from /api/chat with format json', async () => {
    const s = await startOllamaStub({ chat: [good] }); stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm' });
    const out = await m.proposeChanges(ctx);
    expect(out[0].targetStepKey).toBe('s8');
    const chat = s.calls.find((c) => c.path === '/api/chat')!.body as { format: unknown; model: string; stream: boolean };
    expect(chat.model).toBe('m'); expect(chat.stream).toBe(false); expect(chat.format).toBeTruthy();
    expect(m.lastRun?.used).toBe('ollama');
  });
  it('retries once on invalid json then succeeds', async () => {
    const s = await startOllamaStub({ chat: ['garbage', good] }); stop = s.close;
    const out = await new OllamaModel({ url: s.url, model: 'm' }).proposeChanges(ctx);
    expect(out).toHaveLength(1); expect(s.calls.filter((c) => c.path === '/api/chat')).toHaveLength(2);
  });
  it('falls back to rules after two invalid answers or http error', async () => {
    const s = await startOllamaStub({ chat: ['garbage', '{"suggestions":[{"type":"nope"}]}'] }); stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm', fallback: new RuleBasedModel() });
    const out = await m.proposeChanges(ctx);
    expect(m.lastRun?.used).toBe('fallback'); expect(out[0].type).toBe('update-step');
  });
  it('reports availability and embeds', async () => {
    const s = await startOllamaStub({ chat: [], embeddings: [1, 2, 3] }); stop = s.close;
    const m = new OllamaModel({ url: s.url, model: 'm' });
    expect(await m.available()).toBe(true); expect(await m.embed('x')).toEqual([1, 2, 3]);
    expect(await new OllamaModel({ url: 'http://127.0.0.1:1', model: 'm', timeoutMs: 300 }).available()).toBe(false);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @wecom/model test` — Expected: FAIL (`OllamaModel` missing).

- [ ] **Step 4: Implement `ollama.ts`**

```ts
import type { ModelClient, ProposalContext, ProposedSuggestion } from './contract.js';
import { buildMessages, parseProposals, RESPONSE_FORMAT } from './prompt.js';

export interface OllamaOptions { url: string; model: string; embedModel?: string; timeoutMs?: number; fallback?: ModelClient; fetchImpl?: typeof fetch }

export class OllamaModel implements ModelClient {
  name: string;
  lastRun: { used: 'ollama' | 'fallback'; attempts: number; ms: number; error?: string } | null = null;
  private readonly f: typeof fetch;
  constructor(private readonly o: OllamaOptions) { this.name = 'ollama:' + o.model; this.f = o.fetchImpl ?? fetch; }

  private async req(path: string, body?: unknown): Promise<Response> {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), this.o.timeoutMs ?? 120_000);
    try { return await this.f(this.o.url.replace(/\/$/, '') + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: ctl.signal }); }
    finally { clearTimeout(t); }
  }

  async available(): Promise<boolean> {
    try { const r = await this.req('/api/tags'); return r.ok; } catch { return false; }
  }

  async proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]> {
    const started = Date.now(); const messages = buildMessages(ctx); let lastError = '';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const r = await this.req('/api/chat', { model: this.o.model, stream: false, format: RESPONSE_FORMAT, options: { temperature: 0.1, num_ctx: 8192 }, messages: attempt === 1 ? messages : [...messages, { role: 'user', content: 'התשובה הקודמת לא הייתה JSON תקין (' + lastError + '). החזר JSON תקין בלבד.' }] });
        if (!r.ok) { lastError = 'http ' + r.status; continue; }
        const data = (await r.json()) as { message?: { content?: string } };
        const parsed = parseProposals(data.message?.content ?? '');
        if (parsed.ok) { this.lastRun = { used: 'ollama', attempts: attempt, ms: Date.now() - started }; return parsed.items; }
        lastError = parsed.error;
      } catch (e) { lastError = (e as Error).message; }
    }
    if (!this.o.fallback) throw new Error('model failed: ' + lastError);
    const items = await this.o.fallback.proposeChanges(ctx);
    this.lastRun = { used: 'fallback', attempts: 2, ms: Date.now() - started, error: lastError };
    return items;
  }

  async embed(text: string): Promise<number[]> {
    const r = await this.req('/api/embeddings', { model: this.o.embedModel ?? 'nomic-embed-text', prompt: text });
    if (!r.ok) throw new Error('embeddings http ' + r.status);
    return ((await r.json()) as { embedding: number[] }).embedding;
  }
}
```

- [ ] **Step 5: Run tests** — Expected: PASS (4 tests). Also `pnpm --filter @wecom/model typecheck`.

- [ ] **Step 6: Commit**

```bash
git add packages/model && git commit -m "feat(model): Ollama client with JSON mode, retry and rule fallback"
```

---

### Task 3: docx fixture builder and `parseDocx`

**Files:**
- Create: `apps/api/test/sources/fixtures/docx-builder.ts`, `apps/api/src/modules/sources/docx.ts`
- Test: `apps/api/test/sources/docx.test.ts`
- Modify: `apps/api/package.json` (add `jszip ^3.10.1`, `fast-xml-parser ^4.5.0`)

**Interfaces:**
- Produces: `parseDocx(buffer: Buffer): Promise<SourceContent>` where `SourceContent.paragraphs: Paragraph[]` (ref from leading `d+(.d+)*` or numbering, `heading` = text after ref up to first period when a heading style is present or ref exists, `level` from `Heading1..6` styles, runs with `add/del/author/date`, `comments`), `SourceContent.hash` = sha256 hex of normalized paragraph JSON, `SourceContent.title` from `docProps/core.xml` `dc:title` or first heading, `meta.trackedChanges: number`.
- Fixture: `buildDocx(spec: DocxSpec): Promise<Buffer>` with `DocxSpec = { title?: string; paragraphs: DocxPara[] }`, `DocxPara = { style?: string; numText?: string; runs: DocxRun[]; comment?: { author: string; text: string } }`, `DocxRun = { t: string; ins?: { author: string; date: string }; del?: { author: string; date: string }; moveTo?: boolean; moveFrom?: boolean }`, plus `table?: string[][]` paragraphs.

- [ ] **Step 1: Write the fixture builder**

```ts
import JSZip from 'jszip';
export interface DocxRun { t: string; ins?: { author: string; date: string }; del?: { author: string; date: string }; moveTo?: boolean; moveFrom?: boolean }
export interface DocxPara { style?: string; runs?: DocxRun[]; comment?: { author: string; text: string }; table?: string[][] }
export interface DocxSpec { title?: string; paragraphs: DocxPara[] }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const runXml = (r: DocxRun, id: number) => {
  const inner = r.del ? `<w:r><w:delText xml:space="preserve">${esc(r.t)}</w:delText></w:r>` : `<w:r><w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
  if (r.ins) return `<w:ins w:id="${id}" w:author="${esc(r.ins.author)}" w:date="${r.ins.date}">${inner}</w:ins>`;
  if (r.del) return `<w:del w:id="${id}" w:author="${esc(r.del.author)}" w:date="${r.del.date}">${inner}</w:del>`;
  if (r.moveTo) return `<w:moveTo w:id="${id}" w:author="מערכת" w:date="2025-06-12T00:00:00Z">${inner}</w:moveTo>`;
  if (r.moveFrom) return `<w:moveFrom w:id="${id}" w:author="מערכת" w:date="2025-06-12T00:00:00Z">${inner}</w:moveFrom>`;
  return inner;
};
export async function buildDocx(spec: DocxSpec): Promise<Buffer> {
  let id = 1; const comments: string[] = [];
  const body = spec.paragraphs.map((p) => {
    if (p.table) return `<w:tbl>${p.table.map((row) => `<w:tr>${row.map((c) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r></w:p></w:tc>`).join('')}</w:tr>`).join('')}</w:tbl>`;
    const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : '';
    let runs = (p.runs ?? []).map((r) => runXml(r, id++)).join('');
    if (p.comment) { const cid = comments.length; comments.push(`<w:comment w:id="${cid}" w:author="${esc(p.comment.author)}" w:date="2025-06-12T12:48:00Z"><w:p><w:r><w:t>${esc(p.comment.text)}</w:t></w:r></w:p></w:comment>`); runs = `<w:commentRangeStart w:id="${cid}"/>${runs}<w:commentRangeEnd w:id="${cid}"/>`; }
    return `<w:p>${pPr}${runs}</w:p>`;
  }).join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`);
  if (comments.length) zip.file('word/comments.xml', `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${comments.join('')}</w:comments>`);
  if (spec.title) zip.file('docProps/core.xml', `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(spec.title)}</dc:title></cp:coreProperties>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}
```

- [ ] **Step 2: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { buildDocx } from './fixtures/docx-builder.js';
import { parseDocx } from '../../src/modules/sources/docx.js';
import { paragraphText } from '@wecom/shared';

describe('parseDocx', () => {
  it('extracts numbered paragraphs, headings and title', async () => {
    const buf = await buildDocx({ title: 'נהלי תמיכה טכנית', paragraphs: [
      { style: 'Heading1', runs: [{ t: 'פרק 4 · איטיות גלישה' }] },
      { runs: [{ t: '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest.' }] },
    ] });
    const c = await parseDocx(buf);
    expect(c.title).toBe('נהלי תמיכה טכנית');
    expect(c.paragraphs[0]).toMatchObject({ level: 1, heading: 'פרק 4 · איטיות גלישה' });
    expect(c.paragraphs[1]).toMatchObject({ ref: '4.8', heading: 'בדיקת מהירות גלישה' });
    expect(paragraphText(c.paragraphs[1])).toContain('Speedtest');
    expect(c.hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('maps tracked insertions, deletions and moves to runs', async () => {
    const buf = await buildDocx({ paragraphs: [{ runs: [
      { t: '4.8 בדיקת מהירות. ' }, { t: 'מעל 5 מגה', del: { author: 'ענבר ל.', date: '2025-06-12T12:48:00Z' } }, { t: 'מעל 6 מגה', ins: { author: 'ענבר ל.', date: '2025-06-12T12:48:00Z' } }, { t: ' – תקין.' },
    ] }, { runs: [{ t: 'טקסט שהוזז', moveTo: true }] }, { runs: [{ t: 'טקסט שהוזז', moveFrom: true }] }] });
    const c = await parseDocx(buf);
    const runs = c.paragraphs[0].runs;
    expect(runs.find((r) => r.del)).toMatchObject({ t: 'מעל 5 מגה', author: 'ענבר ל.' });
    expect(runs.find((r) => r.add)).toMatchObject({ t: 'מעל 6 מגה', date: '2025-06-12T12:48:00.000Z' });
    expect(paragraphText(c.paragraphs[0])).toBe('4.8 בדיקת מהירות. מעל 6 מגה – תקין.');
    expect(c.paragraphs[1].runs[0].add).toBe(true);
    expect(c.paragraphs[2].runs[0].del).toBe(true);
    expect(c.meta?.trackedChanges).toBe(4);
  });
  it('attaches comments and flattens tables', async () => {
    const buf = await buildDocx({ paragraphs: [
      { runs: [{ t: '4.11 ריענון SIM.' }], comment: { author: 'דנה ר.', text: 'לבדוק סף חדש' } },
      { table: [['שדה', 'ערך'], ['APN', 'WE']] },
    ] });
    const c = await parseDocx(buf);
    expect(c.paragraphs[0].comments).toEqual([{ author: 'דנה ר.', text: 'לבדוק סף חדש', date: '2025-06-12T12:48:00.000Z' }]);
    expect(paragraphText(c.paragraphs[1])).toBe('שדה | ערך');
    expect(paragraphText(c.paragraphs[2])).toBe('APN | WE');
  });
  it('produces the same hash for the same content', async () => {
    const spec = { paragraphs: [{ runs: [{ t: 'x' }] }] };
    expect((await parseDocx(await buildDocx(spec))).hash).toBe((await parseDocx(await buildDocx(spec))).hash);
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @wecom/api test -- sources/docx` — Expected: FAIL (module missing).

- [ ] **Step 4: Implement `docx.ts`**

```ts
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import type { Paragraph, Run } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', preserveOrder: true, trimValues: false });
type Node = Record<string, unknown> & { ':@'?: Record<string, string> };
const REF_RE = /^\s*(\d+(?:\.\d+)*)\.?\s+/;

const kids = (n: Node, name: string): Node[] => (n[name] as Node[] | undefined) ?? [];
const nodeName = (n: Node) => Object.keys(n).find((k) => k !== ':@') ?? '';
const attr = (n: Node, a: string) => n[':@']?.[a];
const isoDate = (d?: string) => { if (!d) return undefined; const t = Date.parse(d); return isNaN(t) ? undefined : new Date(t).toISOString(); };

function collectRuns(nodes: Node[], out: Run[], flags: Partial<Run>, stats: { tracked: number }, comments: { starts: string[] }) {
  for (const n of nodes) {
    const name = nodeName(n); const children = (n[name] as Node[]) ?? [];
    if (name === 'w:t' || name === 'w:delText') { const text = children.map((c) => String((c as Node)['#text'] ?? '')).join(''); if (text) out.push({ t: text, ...flags }); continue; }
    if (name === 'w:tab') { out.push({ t: '\t', ...flags }); continue; }
    if (name === 'w:commentRangeStart') { const id = attr(n, '@w:id'); if (id) comments.starts.push(id); continue; }
    if (name === 'w:ins' || name === 'w:moveTo') { stats.tracked++; collectRuns(children, out, { add: true, author: attr(n, '@w:author'), date: isoDate(attr(n, '@w:date')) }, stats, comments); continue; }
    if (name === 'w:del' || name === 'w:moveFrom') { stats.tracked++; collectRuns(children, out, { del: true, author: attr(n, '@w:author'), date: isoDate(attr(n, '@w:date')) }, stats, comments); continue; }
    if (name === 'w:r' || name === 'w:hyperlink' || name === 'w:smartTag' || name === 'w:sdt' || name === 'w:sdtContent') { collectRuns(children, out, flags, stats, comments); }
  }
}
const mergeRuns = (runs: Run[]): Run[] => runs.reduce<Run[]>((acc, r) => { const p = acc[acc.length - 1]; if (p && !!p.add === !!r.add && !!p.del === !!r.del && p.author === r.author && p.date === r.date) p.t += r.t; else acc.push({ ...r }); return acc; }, []);

function paragraphFrom(p: Node, stats: { tracked: number }, commentMap: Map<string, { author: string; text: string; date?: string }>, index: number): Paragraph {
  const body = (p['w:p'] as Node[]) ?? [];
  const pPr = body.find((c) => nodeName(c) === 'w:pPr');
  const styleNode = pPr ? kids(pPr, 'w:pPr').find((c) => nodeName(c) === 'w:pStyle') : undefined;
  const style = styleNode ? attr(styleNode, '@w:val') ?? '' : '';
  const level = /^Heading(\d)$/.exec(style)?.[1];
  const runs: Run[] = []; const cm = { starts: [] as string[] };
  collectRuns(body.filter((c) => nodeName(c) !== 'w:pPr'), runs, {}, stats, cm);
  const merged = mergeRuns(runs);
  const text = merged.filter((r) => !r.del).map((r) => r.t).join('');
  const m = REF_RE.exec(text);
  const para: Paragraph = { ref: m ? m[1] : String(index + 1), runs: merged };
  if (level) { para.level = Number(level); para.heading = text.trim(); }
  else if (m) { const rest = text.slice(m[0].length); const head = rest.split(/[.:](\s|$)/)[0]; if (head && head.length <= 80) para.heading = head.trim(); }
  if (merged.length && merged.every((r) => r.add)) para.isNew = true;
  if (merged.length && merged.every((r) => r.del)) para.isDeleted = true;
  const comments = cm.starts.map((id) => commentMap.get(id)).filter((c): c is { author: string; text: string; date?: string } => !!c);
  if (comments.length) para.comments = comments;
  return para;
}

function walkBody(nodes: Node[], out: Paragraph[], stats: { tracked: number }, commentMap: Map<string, { author: string; text: string; date?: string }>) {
  for (const n of nodes) {
    const name = nodeName(n);
    if (name === 'w:p') out.push(paragraphFrom(n, stats, commentMap, out.length));
    else if (name === 'w:tbl') for (const tr of kids(n, 'w:tbl').filter((c) => nodeName(c) === 'w:tr')) {
      const cells = kids(tr, 'w:tr').filter((c) => nodeName(c) === 'w:tc').map((tc) => { const ps: Paragraph[] = []; walkBody(kids(tc, 'w:tc'), ps, stats, commentMap); return ps.map((p) => p.runs.filter((r) => !r.del).map((r) => r.t).join('')).join(' ').trim(); });
      out.push({ ref: String(out.length + 1), runs: [{ t: cells.join(' | ') }] });
    } else if (name === 'w:sdt' || name === 'w:sdtContent' || name === 'w:body') walkBody((n[name] as Node[]) ?? [], out, stats, commentMap);
  }
}

function parseComments(xml: string | null): Map<string, { author: string; text: string; date?: string }> {
  const map = new Map<string, { author: string; text: string; date?: string }>(); if (!xml) return map;
  const root = parser.parse(xml) as Node[];
  const comments = root.flatMap((n) => nodeName(n) === 'w:comments' ? kids(n, 'w:comments') : []);
  for (const c of comments) { if (nodeName(c) !== 'w:comment') continue; const runs: Run[] = []; const ps: Paragraph[] = []; walkBody(kids(c, 'w:comment'), ps, { tracked: 0 }, new Map()); void runs; map.set(attr(c, '@w:id') ?? '', { author: attr(c, '@w:author') ?? '', text: ps.map((p) => p.runs.map((r) => r.t).join('')).join('\n').trim(), date: isoDate(attr(c, '@w:date')) }); }
  return map;
}

export const contentHash = (paragraphs: Paragraph[]) => createHash('sha256').update(JSON.stringify(paragraphs.map((p) => [p.ref, p.runs.map((r) => [r.t, !!r.add, !!r.del])]))).digest('hex');

export async function parseDocx(buffer: Buffer): Promise<SourceContent> {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('not a docx: word/document.xml missing');
  const commentMap = parseComments((await zip.file('word/comments.xml')?.async('string')) ?? null);
  const root = parser.parse(docXml) as Node[];
  const stats = { tracked: 0 }; const paragraphs: Paragraph[] = [];
  walkBody(root.flatMap((n) => nodeName(n) === 'w:document' ? kids(n, 'w:document') : []), paragraphs, stats, commentMap);
  const nonEmpty = paragraphs.filter((p) => p.runs.some((r) => r.t.trim()));
  const core = await zip.file('docProps/core.xml')?.async('string');
  const title = /<dc:title>([^<]*)<\/dc:title>/.exec(core ?? '')?.[1] ?? nonEmpty.find((p) => p.level)?.heading ?? 'מסמך ללא שם';
  return { title, paragraphs: nonEmpty, hash: contentHash(nonEmpty), meta: { trackedChanges: stats.tracked, comments: commentMap.size } };
}
```

- [ ] **Step 5: Run tests** — Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/api && git commit -m "feat(api): docx parser with tracked changes, comments and tables"
```

---

### Task 4: Text/markdown parser and upload dispatcher

**Files:**
- Create: `apps/api/src/modules/sources/text.ts`, `apps/api/src/modules/sources/parsers.ts`
- Test: `apps/api/test/sources/text.test.ts`

**Interfaces:**
- Produces: `parseText(name: string, text: string): SourceContent` (numbered paragraphs `^(\d+(\.\d+)*)\.?\s+(title)[.:]` → `ref`/`heading`, each paragraph `isNew: true` when `opts.allNew`), `parseUpload(filename: string, buffer: Buffer): Promise<SourceContent & { kind: 'docx' | 'text' | 'json' | 'csv' }>` (json/csv become one paragraph per row/object with `ref = row index`, text `title: desc …`).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { parseText } from '../../src/modules/sources/text.js';
import { parseUpload } from '../../src/modules/sources/parsers.js';
import { paragraphText } from '@wecom/shared';

describe('parseText', () => {
  it('splits numbered paragraphs and derives refs/headings', () => {
    const c = parseText('נהלים.md', '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest.\n\n4.14 בעיות גלישה ברכב. אם הלקוח מדווח על איטיות רק ברכב.\n');
    expect(c.paragraphs.map((p) => [p.ref, p.heading])).toEqual([['4.8', 'בדיקת מהירות גלישה'], ['4.14', 'בעיות גלישה ברכב']]);
    expect(c.title).toBe('נהלים');
  });
  it('uses running numbers when no refs', () => {
    expect(parseText('a.txt', 'פסקה ראשונה ארוכה מספיק כדי להיחשב.\n\nפסקה שנייה ארוכה מספיק כדי להיחשב.').paragraphs.map((p) => p.ref)).toEqual(['1', '2']);
  });
});
describe('parseUpload', () => {
  it('dispatches by extension', async () => {
    const j = await parseUpload('topics.json', Buffer.from(JSON.stringify([{ title: 'א', desc: 'ב' }])));
    expect(j.kind).toBe('json'); expect(paragraphText(j.paragraphs[0])).toBe('א: ב');
    const c = await parseUpload('t.csv', Buffer.from('title,desc\nx,y\n'));
    expect(c.kind).toBe('csv'); expect(paragraphText(c.paragraphs[0])).toBe('x: y');
    await expect(parseUpload('x.exe', Buffer.from(''))).rejects.toThrow(/unsupported/);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`text.ts`:
```ts
import { createHash } from 'node:crypto';
import type { Paragraph } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';
const HEAD_RE = /^(\d+(?:\.\d+)*)\.?\s+([^.:\n]{3,80})[.:]?\s*/;
export function parseText(name: string, text: string, opts: { allNew?: boolean } = {}): SourceContent {
  const chunks = text.replace(/\r\n/g, '\n').split(/\n\s*\n|\n(?=\s*\d+(?:\.\d+)*\.?\s)/).map((p) => p.trim()).filter((p) => p.length > 20);
  const paragraphs: Paragraph[] = chunks.map((p, i) => {
    const m = HEAD_RE.exec(p);
    const para: Paragraph = { ref: m ? m[1] : String(i + 1), runs: [{ t: p, ...(opts.allNew ? { add: true } : {}) }] };
    if (m) para.heading = m[2].trim();
    if (opts.allNew) para.isNew = true;
    return para;
  });
  const hash = createHash('sha256').update(JSON.stringify(paragraphs.map((p) => [p.ref, p.runs[0].t]))).digest('hex');
  return { title: name.replace(/\.[^.]+$/, ''), paragraphs, raw: text, hash, meta: { trackedChanges: 0 } };
}
```
`parsers.ts`:
```ts
import { parseDocx } from './docx.js';
import { parseText } from './text.js';
import type { SourceContent } from '@wecom/connectors';
import { createHash } from 'node:crypto';
export type UploadKind = 'docx' | 'text' | 'json' | 'csv';
const rows2content = (name: string, rows: Record<string, string>[]): SourceContent => {
  const paragraphs = rows.map((r, i) => { const vals = Object.values(r).map((v) => String(v ?? '').trim()).filter(Boolean); return { ref: String(i + 1), heading: vals[0]?.slice(0, 80), runs: [{ t: vals.slice(0, 2).join(': ') + (vals.length > 2 ? ' · ' + vals.slice(2).join(' · ') : '') }] }; });
  return { title: name.replace(/\.[^.]+$/, ''), paragraphs, hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'), meta: { rows: rows.length, columns: Object.keys(rows[0] ?? {}) } };
};
const parseCsv = (text: string): Record<string, string>[] => { const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.trim()); const head = (lines.shift() ?? '').split(',').map((h) => h.trim()); return lines.map((l) => Object.fromEntries(l.split(',').map((c, i) => [head[i] ?? 'col' + i, c.trim().replace(/^"|"$/g, '')]))); };
export async function parseUpload(filename: string, buffer: Buffer): Promise<SourceContent & { kind: UploadKind }> {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (ext === 'docx') return { ...(await parseDocx(buffer)), kind: 'docx' };
  if (ext === 'txt' || ext === 'md') return { ...parseText(filename, buffer.toString('utf8'), { allNew: true }), kind: 'text' };
  if (ext === 'json') { const j = JSON.parse(buffer.toString('utf8')) as unknown; const rows = Array.isArray(j) ? j : (j as { docs?: unknown[]; topics?: unknown[] }).docs ?? (j as { topics?: unknown[] }).topics ?? []; return { ...rows2content(filename, rows as Record<string, string>[]), kind: 'json' }; }
  if (ext === 'csv') return { ...rows2content(filename, parseCsv(buffer.toString('utf8'))), kind: 'csv' };
  throw Object.assign(new Error('unsupported file type: ' + ext), { statusCode: 400, code: 'UNSUPPORTED_FILE' });
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): text/json/csv source parsers and upload dispatcher"`.

---

### Task 5: `DiffService.paragraphDiff`

**Files:**
- Create: `apps/api/src/modules/sources/diff.ts`
- Test: `apps/api/test/sources/diff.test.ts`

**Interfaces:**
- Produces: `paragraphDiff(prev: Paragraph[] | null, next: Paragraph[]): ParagraphDiff[]` — pairs by identical `ref` first; unmatched pairs by `similarity(before, after) ≥ 0.6` (best match, greedy by score); paragraphs whose runs carry `add`/`del` are `changed` with `before` = text without `add` runs and `after` = text without `del` runs, regardless of `prev`; result order follows `next`, removed ones appended; `same` when texts are equal.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { paragraphDiff } from '../../src/modules/sources/diff.js';
import type { Paragraph } from '@wecom/shared';
const P = (ref: string, t: string): Paragraph => ({ ref, runs: [{ t }] });

describe('paragraphDiff', () => {
  it('aligns by ref and classifies', () => {
    const d = paragraphDiff([P('4.8', 'מעל 5 מגה'), P('4.9', 'x'), P('4.10', 'ישן')], [P('4.8', 'מעל 6 מגה'), P('4.9', 'x'), P('4.14', 'חדש לגמרי')]);
    expect(d.map((x) => [x.ref, x.kind])).toEqual([['4.8', 'changed'], ['4.9', 'same'], ['4.14', 'added'], ['4.10', 'removed']]);
  });
  it('aligns renumbered paragraphs by similarity', () => {
    const d = paragraphDiff([P('4.8', 'בקש מהלקוח להריץ Speedtest מעל 5 מגה תקין')], [P('4.9', 'בקש מהלקוח להריץ Speedtest מעל 6 מגה תקין')]);
    expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ ref: '4.9', kind: 'changed' }); expect(d[0].similarity).toBeGreaterThanOrEqual(0.6);
  });
  it('uses tracked-change runs directly', () => {
    const next: Paragraph[] = [{ ref: '4.8', runs: [{ t: 'מעל ' }, { t: '5', del: true }, { t: '6', add: true }, { t: ' מגה' }] }];
    const d = paragraphDiff(null, next);
    expect(d[0]).toMatchObject({ kind: 'changed', before: 'מעל 5 מגה', after: 'מעל 6 מגה' });
  });
  it('treats everything as added on first import', () => {
    expect(paragraphDiff(null, [P('1', 'a'), P('2', 'b')]).every((x) => x.kind === 'added')).toBe(true);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
import { similarity, paragraphText, type Paragraph, type ParagraphDiff } from '@wecom/shared';
const beforeText = (p: Paragraph) => p.runs.filter((r) => !r.add).map((r) => r.t).join('').trim();
const afterText = (p: Paragraph) => paragraphText(p).trim();
const tracked = (p: Paragraph) => p.runs.some((r) => r.add || r.del);
export const SIM_THRESHOLD = 0.6;

export function paragraphDiff(prev: Paragraph[] | null, next: Paragraph[]): ParagraphDiff[] {
  const out: ParagraphDiff[] = [];
  const prevList = prev ?? []; const usedPrev = new Set<number>();
  const byRef = new Map<string, number>(); prevList.forEach((p, i) => byRef.set(p.ref, i));
  const pending: { i: number; p: Paragraph }[] = [];
  next.forEach((p, i) => {
    if (tracked(p)) { out.push({ ref: p.ref, kind: p.isDeleted ? 'removed' : p.isNew ? 'added' : 'changed', before: p.isNew ? null : beforeText(p), after: p.isDeleted ? null : afterText(p), similarity: similarity(beforeText(p), afterText(p)) }); const j = byRef.get(p.ref); if (j != null) usedPrev.add(j); return; }
    const j = byRef.get(p.ref);
    if (j != null && !usedPrev.has(j)) { usedPrev.add(j); const b = afterText(prevList[j]), a = afterText(p); out.push({ ref: p.ref, kind: a === b ? 'same' : 'changed', before: b, after: a, similarity: a === b ? 1 : similarity(b, a) }); return; }
    pending.push({ i, p });
  });
  // similarity pass for unmatched next paragraphs
  const cands = pending.flatMap(({ p }) => prevList.map((q, j) => ({ p, j, s: usedPrev.has(j) ? -1 : similarity(afterText(q), afterText(p)) })).filter((c) => c.s >= SIM_THRESHOLD)).sort((a, b) => b.s - a.s);
  const matched = new Map<Paragraph, number>();
  for (const c of cands) { if (matched.has(c.p) || usedPrev.has(c.j)) continue; matched.set(c.p, c.j); usedPrev.add(c.j); }
  for (const { p } of pending) { const j = matched.get(p); if (j == null) out.push({ ref: p.ref, kind: 'added', before: null, after: afterText(p), similarity: 0 }); else out.push({ ref: p.ref, kind: 'changed', before: afterText(prevList[j]), after: afterText(p), similarity: similarity(afterText(prevList[j]), afterText(p)) }); }
  prevList.forEach((q, j) => { if (!usedPrev.has(j)) out.push({ ref: q.ref, kind: 'removed', before: afterText(q), after: null, similarity: 0 }); });
  // keep next order first, removed last
  const order = new Map(next.map((p, i) => [p.ref, i]));
  return out.sort((a, b) => (a.kind === 'removed' ? 1 : 0) - (b.kind === 'removed' ? 1 : 0) || (order.get(a.ref) ?? 0) - (order.get(b.ref) ?? 0));
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): paragraph diff with ref/similarity alignment and tracked changes"`.

---

### Task 6: Test DB helpers and lane stubs

**Files:**
- Create: `apps/api/test/helpers/db.ts`, `apps/api/test/helpers/stubs.ts`

**Interfaces:**
- Produces: `withDb(fn: (pool: pg.Pool, uri: string) => Promise<void>)` (testcontainers `pgvector/pgvector:pg16`, runs migrations); `seedUser(pool, {displayName, source}) → userId`; `seedDocument(pool, doc: Document, actorId) → Document` (inserts documents + phases + steps + step_actions + step_outcomes + branches, links of type `derived_from_source` from `step.sourceRef` when `doc.sourceId`), `seedBlock(pool, block)`, `seedField(pool, field)`; `contentStub` = object implementing the L2 signatures listed above using plain SQL (used only when `apps/api/src/modules/content` does not exist: `const content = await loadContent()` tries the real module first).

- [ ] **Step 1: Write `db.ts`**

```ts
import { PostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
export const integration = process.env.RUN_INTEGRATION === '1';
export async function withDb(fn: (pool: pg.Pool, uri: string) => Promise<void>): Promise<void> {
  const c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  const uri = c.getConnectionUri(); const pool = new pg.Pool({ connectionString: uri });
  try { await runner({ databaseUrl: uri, dir: 'migrations', direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined }); await fn(pool, uri); }
  finally { await pool.end(); await c.stop(); }
}
```

- [ ] **Step 2: Write `stubs.ts`** (seeders + content stub with the exact L2 signatures)

```ts
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Block, CrmField, Document } from '@wecom/shared';

export async function seedUser(pool: pg.Pool, u: { displayName: string; source?: 'entra' | 'paloalto' | 'local' }): Promise<string> {
  const r = await pool.query(`insert into users(subject, source, display_name, initials) values ($1,$2,$3,$4) returning id`, [randomUUID(), u.source ?? 'local', u.displayName, u.displayName[0]]);
  return r.rows[0].id as string;
}
export async function seedField(pool: pg.Pool, f: Partial<CrmField> & { name: string }) { await pool.query(`insert into crm_fields(name, status, renamed_to, path) values ($1,$2,$3,$4) on conflict (name) do update set status=$2, renamed_to=$3`, [f.name, f.status ?? 'ok', f.renamedTo ?? null, f.path ?? '']); }
export async function seedBlock(pool: pg.Pool, b: Block): Promise<void> {
  await pool.query(`insert into blocks(id, slug, title, kind, description, script, current_version) values ($1,$2,$3,$4,$5,$6,$7)`, [b.id, b.slug, b.title, b.kind, b.description ?? null, b.script ?? null, b.currentVersion]);
  for (const [i, a] of b.actions.entries()) await pool.query(`insert into block_actions(block_id, position, text) values ($1,$2,$3)`, [b.id, i, a.text]);
  for (const [i, o] of b.outcomes.entries()) await pool.query(`insert into block_outcomes(block_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)`, [b.id, i, o.kind, o.text, o.goto ?? null]);
}
export async function writeStructure(client: pg.PoolClient | pg.Pool, doc: Document): Promise<void> {
  await client.query(`delete from phases where document_id=$1`, [doc.id]);
  for (const [pi, ph] of doc.phases.entries()) {
    const p = await client.query(`insert into phases(document_id, position, phase_key, label, note, route) values ($1,$2,$3,$4,$5,$6) returning id`, [doc.id, pi, ph.id, ph.label, ph.note ?? null, ph.route ?? null]);
    for (const [si, s] of ph.steps.entries()) {
      const st = await client.query(`insert into steps(phase_id, document_id, position, step_key, num, title, description, hint, tone, block_id, block_refs, script, source_ref, deps, extras) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`, [p.rows[0].id, doc.id, si, s.key, s.num, s.title, s.description ?? null, s.hint ?? null, s.tone ?? null, s.blockId ?? null, s.blockRefs, s.script ?? null, s.sourceRef ?? null, s.deps, s.extras ? JSON.stringify(s.extras) : null]);
      for (const [ai, a] of s.actions.entries()) await client.query(`insert into step_actions(step_id, position, action_key, text) values ($1,$2,$3,$4)`, [st.rows[0].id, ai, a.id, a.text]);
      for (const [oi, o] of s.outcomes.entries()) await client.query(`insert into step_outcomes(step_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)`, [st.rows[0].id, oi, o.kind, o.text, o.goto ?? null]);
      if (s.branch) { const b = await client.query(`insert into step_branches(step_id, question) values ($1,$2) returning id`, [st.rows[0].id, s.branch.q]); for (const [bi, o] of s.branch.options.entries()) await client.query(`insert into step_branch_options(branch_id, position, kind, label, text, goto_step_key) values ($1,$2,$3,$4,$5,$6)`, [b.rows[0].id, bi, o.kind, o.label, o.text, o.goto ?? null]); }
      if (doc.sourceId && s.sourceRef) await client.query(`insert into document_links(from_document_id, from_step_key, to_source_id, type, origin) values ($1,$2,$3,'derived_from_source','explicit')`, [doc.id, s.key, doc.sourceId]);
    }
  }
}
export async function seedDocument(pool: pg.Pool, doc: Document, actorId: string | null): Promise<Document> {
  await pool.query(`insert into documents(id, slug, code, title, description, category, wave, priority, kind, status, current_version, source_id, source_ref, related, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`, [doc.id, doc.slug, doc.code ?? null, doc.title, doc.description, doc.category, doc.wave, doc.priority, doc.kind, doc.status, doc.currentVersion, doc.sourceId ?? null, doc.sourceRef ?? null, JSON.stringify(doc.related), actorId]);
  await writeStructure(pool, doc);
  return doc;
}

/** Reads a document back from the normalized tables (used by the stub and by tests). */
export async function readDocument(client: pg.PoolClient | pg.Pool, id: string): Promise<Document | null> {
  const d = await client.query(`select * from documents where id=$1 and deleted_at is null`, [id]); if (!d.rowCount) return null; const row = d.rows[0];
  const phases = await client.query(`select * from phases where document_id=$1 order by position`, [id]);
  const out: Document = { id, slug: row.slug, code: row.code ?? undefined, title: row.title, description: row.description, category: row.category, wave: row.wave, priority: row.priority, kind: row.kind, status: row.status, currentVersion: row.current_version, sourceId: row.source_id, sourceRef: row.source_ref ?? undefined, related: row.related, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), etag: row.etag, phases: [] };
  for (const ph of phases.rows) {
    const steps = await client.query(`select * from steps where phase_id=$1 order by position`, [ph.id]);
    const phase = { id: ph.phase_key as string, label: ph.label as string, note: ph.note ?? undefined, route: ph.route ?? undefined, steps: [] as Document['phases'][number]['steps'] };
    for (const s of steps.rows) {
      const acts = await client.query(`select action_key, text from step_actions where step_id=$1 order by position`, [s.id]);
      const outs = await client.query(`select kind, text, goto_step_key from step_outcomes where step_id=$1 order by position`, [s.id]);
      const br = await client.query(`select id, question from step_branches where step_id=$1`, [s.id]);
      let branch: Document['phases'][number]['steps'][number]['branch'];
      if (br.rowCount) { const opts = await client.query(`select kind, label, text, goto_step_key from step_branch_options where branch_id=$1 order by position`, [br.rows[0].id]); branch = { q: br.rows[0].question, options: opts.rows.map((o) => ({ kind: o.kind, label: o.label, text: o.text, goto: o.goto_step_key ?? undefined })) }; }
      phase.steps.push({ key: s.step_key, num: s.num, title: s.title, description: s.description ?? undefined, hint: s.hint ?? undefined, tone: s.tone ?? undefined, blockId: s.block_id ?? undefined, blockRefs: s.block_refs, script: s.script ?? undefined, sourceRef: s.source_ref ?? undefined, deps: s.deps, actions: acts.rows.map((a) => ({ id: a.action_key, text: a.text })), outcomes: outs.rows.map((o) => ({ kind: o.kind, text: o.text, goto: o.goto_step_key ?? undefined })), branch, extras: s.extras ?? undefined });
    }
    out.phases.push(phase);
  }
  return out;
}

export const contentStub = {
  async getDocument(client: pg.PoolClient, id: string) { return readDocument(client, id); },
  async publishDocument(client: pg.PoolClient, doc: Document, opts: { actorId: string | null; label: string; suggestionId?: string | null; kind?: 'published' | 'sync' }) {
    const v = doc.currentVersion + 1; const next = { ...doc, currentVersion: v, status: doc.status === 'draft' ? 'published' : doc.status } as Document;
    await client.query(`update documents set title=$2, description=$3, category=$4, wave=$5, priority=$6, status=$7, current_version=$8, related=$9, updated_by=$10, updated_at=now(), etag=gen_random_uuid()::text where id=$1`, [doc.id, next.title, next.description, next.category, next.wave, next.priority, next.status, v, JSON.stringify(next.related), opts.actorId]);
    await writeStructure(client, next);
    const r = await client.query(`insert into document_versions(document_id, version, snapshot, author_id, label, kind, suggestion_id) values ($1,$2,$3,$4,$5,$6,$7) returning id`, [doc.id, v, JSON.stringify(next), opts.actorId, opts.label, opts.kind ?? 'published', opts.suggestionId ?? null]);
    return { document: next, versionId: r.rows[0].id as string, version: v };
  },
  async createDocument(client: pg.PoolClient, input: { title: string; description: string; category: Document['category']; wave: Document['wave']; priority: Document['priority']; kind: Document['kind']; slug?: string; phases?: Document['phases']; sourceId?: string; sourceRef?: string }, actorId: string | null) {
    const id = randomUUID(); const slug = input.slug ?? 'doc-' + id.slice(0, 8);
    const now = new Date().toISOString();
    const doc: Document = { id, slug, title: input.title, description: input.description, category: input.category, wave: input.wave, priority: input.priority, kind: input.kind, status: 'draft', currentVersion: 0, sourceId: input.sourceId ?? null, sourceRef: input.sourceRef, related: [], phases: input.phases ?? [], createdAt: now, updatedAt: now };
    await client.query(`insert into documents(id, slug, title, description, category, wave, priority, kind, status, current_version, source_id, source_ref, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',0,$9,$10,$11,$11)`, [id, slug, doc.title, doc.description, doc.category, doc.wave, doc.priority, doc.kind, doc.sourceId, doc.sourceRef ?? null, actorId]);
    await writeStructure(client, doc); return doc;
  },
  async listDocumentRefs(client: pg.PoolClient) { const r = await client.query(`select id, title, code from documents where deleted_at is null`); return r.rows.map((x) => ({ id: x.id, title: x.title, code: x.code ?? undefined })); },
  async getBlock(client: pg.PoolClient, id: string): Promise<Block | null> {
    const b = await client.query(`select * from blocks where id=$1 and deleted_at is null`, [id]); if (!b.rowCount) return null;
    const a = await client.query(`select text from block_actions where block_id=$1 order by position`, [id]); const o = await client.query(`select kind, text, goto_step_key from block_outcomes where block_id=$1 order by position`, [id]);
    return { id, slug: b.rows[0].slug, title: b.rows[0].title, kind: b.rows[0].kind, description: b.rows[0].description ?? undefined, script: b.rows[0].script ?? undefined, actions: a.rows.map((x, i) => ({ id: 'b' + (i + 1), text: x.text })), outcomes: o.rows.map((x) => ({ kind: x.kind, text: x.text, goto: x.goto_step_key ?? undefined })), currentVersion: b.rows[0].current_version, updatedAt: b.rows[0].updated_at.toISOString() };
  },
  async publishBlock(client: pg.PoolClient, block: Block, opts: { actorId: string | null; label: string }) {
    const v = block.currentVersion + 1;
    await client.query(`update blocks set title=$2, script=$3, current_version=$4, updated_by=$5, updated_at=now() where id=$1`, [block.id, block.title, block.script ?? null, v, opts.actorId]);
    await client.query(`delete from block_actions where block_id=$1`, [block.id]);
    for (const [i, a] of block.actions.entries()) await client.query(`insert into block_actions(block_id, position, text) values ($1,$2,$3)`, [block.id, i, a.text]);
    await client.query(`insert into block_versions(block_id, version, snapshot, author_id, label) values ($1,$2,$3,$4,$5)`, [block.id, v, JSON.stringify({ ...block, currentVersion: v }), opts.actorId, opts.label]);
    return { block: { ...block, currentVersion: v }, version: v };
  },
  async listBlocks(client: pg.PoolClient): Promise<Block[]> { const r = await client.query(`select id from blocks where deleted_at is null`); const out: Block[] = []; for (const x of r.rows) { const b = await contentStub.getBlock(client, x.id); if (b) out.push(b); } return out; },
  async listFields(client: pg.PoolClient): Promise<CrmField[]> { const r = await client.query(`select * from crm_fields where deleted_at is null`); return r.rows.map((f) => ({ name: f.name, status: f.status, renamedTo: f.renamed_to ?? undefined, path: f.path, updatedAt: f.updated_at.toISOString() })); },
  async upsertField(client: pg.PoolClient, input: { name: string; status: CrmField['status']; renamedTo?: string; path: string; note?: string }, actorId: string | null): Promise<CrmField> {
    const r = await client.query(`insert into crm_fields(name, status, renamed_to, path, note, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$6) on conflict (name) do update set status=$2, renamed_to=$3, path=$4, note=$5, updated_by=$6, updated_at=now() returning *`, [input.name, input.status, input.renamedTo ?? null, input.path, input.note ?? null, actorId]);
    const f = r.rows[0]; return { name: f.name, status: f.status, renamedTo: f.renamed_to ?? undefined, path: f.path, note: f.note ?? undefined, updatedAt: f.updated_at.toISOString() };
  },
};
export type ContentApi = typeof contentStub;
export async function loadContent(): Promise<ContentApi> {
  try { const d = await import('../../src/modules/content/documents.js'); const b = await import('../../src/modules/content/blocks.js'); const f = await import('../../src/modules/content/fields.js'); return { ...contentStub, ...d, ...b, ...f } as ContentApi; } catch { return contentStub; }
}
```

- [ ] **Step 3: Typecheck** — `pnpm --filter @wecom/api typecheck` — PASS.
- [ ] **Step 4: Commit** — `git add apps/api/test/helpers && git commit -m "test(api): testcontainers db helper, seeders and content stubs for pipeline tests"`.

---

### Task 7: `SourceRevisionService` (ingest with hash dedupe and job enqueue)

**Files:**
- Create: `apps/api/src/modules/sources/revisions.ts`
- Test: `apps/api/test/sources/revisions.test.ts` (integration)

**Interfaces:**
- Produces:
```ts
export interface JobQueue { send(name: 'pipeline.process', data: { revisionId: string }, opts?: { singletonKey?: string }): Promise<string | null> }
export class SourceRevisionService {
  constructor(private pool: pg.Pool, private queue: JobQueue) {}
  createSource(input: { kind: SourceKind; title: string; ext?: string; connectorId?: string | null; externalId?: string | null; mapping?: Record<string,string> }, actorId: string | null): Promise<{ id: string }>
  ingest(sourceId: string, content: SourceContent, actorId: string | null, raw?: Buffer): Promise<{ revisionId: string; duplicate: boolean }>
  latestAccepted(sourceId: string): Promise<SourceRevision | null>
  getRevision(id: string): Promise<SourceRevision | null>
  listSources(): Promise<Source[]>
}
```
- `ingest`: same `hash` as an existing revision of the source → `{ duplicate: true }` and nothing written; else insert revision (`accepted=false`), set `sources.sync_state='pending'`, `last_hash`, enqueue `pipeline.process` with `singletonKey = revisionId`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/db.js';
import { seedUser } from '../helpers/stubs.js';
import { SourceRevisionService } from '../../src/modules/sources/revisions.js';
import { parseText } from '../../src/modules/sources/text.js';

const run = integration ? describe : describe.skip;
run('SourceRevisionService', () => {
  it('ingests, dedupes by hash and enqueues processing', async () => withDb(async (pool) => {
    const sent: unknown[] = []; const svc = new SourceRevisionService(pool, { send: async (name, data) => { sent.push([name, data]); return 'job1'; } });
    const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
    const { id } = await svc.createSource({ kind: 'text', title: 'נהלים' }, uid);
    const content = parseText('נהלים.md', '4.8 בדיקת מהירות. בקש מהלקוח להריץ Speedtest.');
    const a = await svc.ingest(id, content, uid, Buffer.from('raw'));
    expect(a.duplicate).toBe(false); expect(sent).toEqual([['pipeline.process', { revisionId: a.revisionId }]]);
    const b = await svc.ingest(id, content, uid);
    expect(b.duplicate).toBe(true); expect(b.revisionId).toBe(a.revisionId); expect(sent).toHaveLength(1);
    const src = (await svc.listSources()).find((s) => s.id === id)!;
    expect(src.syncState).toBe('pending'); expect(src.lastHash).toBe(content.hash);
    expect((await svc.getRevision(a.revisionId))?.paragraphs[0].ref).toBe('4.8');
    expect(await svc.latestAccepted(id)).toBeNull();
  }), 120000);
});
```

- [ ] **Step 2: Run** — `pnpm --filter @wecom/api test:int -- sources/revisions` — FAIL. **Step 3: Implement**

```ts
import pg from 'pg';
import type { Source, SourceRevision, SourceKindSchema } from '@wecom/shared';
import type { z } from 'zod';
import type { SourceContent } from '@wecom/connectors';
export type SourceKind = z.infer<typeof SourceKindSchema>;
export interface JobQueue { send(name: 'pipeline.process', data: { revisionId: string }, opts?: { singletonKey?: string }): Promise<string | null> }

const rowToSource = (r: Record<string, unknown>): Source => ({ id: r.id as string, kind: r.kind as Source['kind'], connectorId: (r.connector_id as string) ?? null, externalId: (r.external_id as string) ?? null, title: r.title as string, ext: (r.ext as string) ?? undefined, mapping: (r.mapping as Record<string, string>) ?? undefined, syncState: r.sync_state as Source['syncState'], lastHash: (r.last_hash as string) ?? null, lastSyncedAt: r.last_synced_at ? (r.last_synced_at as Date).toISOString() : null, linkedDocuments: Number(r.linked_documents ?? 0), pendingSuggestions: Number(r.pending_suggestions ?? 0), updatedAt: (r.updated_at as Date).toISOString() });
const rowToRevision = (r: Record<string, unknown>): SourceRevision => ({ id: r.id as string, sourceId: r.source_id as string, hash: r.hash as string, paragraphs: r.paragraphs as SourceRevision['paragraphs'], importedAt: (r.imported_at as Date).toISOString(), importedBy: (r.imported_by as string) ?? null, accepted: r.accepted as boolean, meta: (r.meta as Record<string, unknown>) ?? undefined });

export class SourceRevisionService {
  constructor(private readonly pool: pg.Pool, private readonly queue: JobQueue) {}
  async createSource(input: { kind: SourceKind; title: string; ext?: string; connectorId?: string | null; externalId?: string | null; mapping?: Record<string, string> }, actorId: string | null) {
    const r = await this.pool.query(`insert into sources(kind, title, ext, connector_id, external_id, mapping, created_by, updated_by) values ($1,$2,$3,$4,$5,$6,$7,$7) returning id`, [input.kind, input.title, input.ext ?? null, input.connectorId ?? null, input.externalId ?? null, input.mapping ? JSON.stringify(input.mapping) : null, actorId]);
    return { id: r.rows[0].id as string };
  }
  async ingest(sourceId: string, content: SourceContent, actorId: string | null, raw?: Buffer) {
    const dup = await this.pool.query(`select id from source_revisions where source_id=$1 and hash=$2`, [sourceId, content.hash]);
    if (dup.rowCount) return { revisionId: dup.rows[0].id as string, duplicate: true };
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(`insert into source_revisions(source_id, hash, raw, paragraphs, meta, imported_by) values ($1,$2,$3,$4,$5,$6) returning id`, [sourceId, content.hash, raw ?? (content.raw ? Buffer.from(content.raw) : null), JSON.stringify(content.paragraphs), JSON.stringify({ ...(content.meta ?? {}), title: content.title }), actorId]);
      await client.query(`update sources set sync_state='pending', last_hash=$2, updated_at=now(), updated_by=$3 where id=$1`, [sourceId, content.hash, actorId]);
      await client.query('commit');
      const revisionId = r.rows[0].id as string;
      await this.queue.send('pipeline.process', { revisionId }, { singletonKey: revisionId });
      return { revisionId, duplicate: false };
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
  }
  async latestAccepted(sourceId: string) { const r = await this.pool.query(`select * from source_revisions where source_id=$1 and accepted order by imported_at desc limit 1`, [sourceId]); return r.rowCount ? rowToRevision(r.rows[0]) : null; }
  async getRevision(id: string) { const r = await this.pool.query(`select * from source_revisions where id=$1`, [id]); return r.rowCount ? rowToRevision(r.rows[0]) : null; }
  async listSources() {
    const r = await this.pool.query(`select s.*, (select count(distinct from_document_id) from document_links l where l.to_source_id=s.id) as linked_documents, (select count(*) from suggestions g join source_revisions sr on sr.id=g.source_revision_id where sr.source_id=s.id and g.status='pending') as pending_suggestions from sources s where s.deleted_at is null order by s.updated_at desc`);
    return r.rows.map(rowToSource);
  }
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): source revisions service with hash dedupe and job enqueue"`.

---

### Task 8: `MappingService` and `ProposalService.buildContext`

**Files:**
- Create: `apps/api/src/modules/sources/mapping.ts`, `apps/api/src/modules/sources/proposal.ts`
- Test: `apps/api/test/sources/mapping.test.ts` (integration)

**Interfaces:**
- Produces:
```ts
export class MappingService {
  constructor(private pool: pg.Pool) {}
  linkedSteps(sourceId: string): Promise<LinkedStep[]>   // from document_links(type derived_from_source, to_source_id) joined with steps(source_ref) → anchor = source_ref without '§'
  proposeInitialMapping(sourceId: string, paragraphs: Paragraph[]): Promise<{ ref: string; documentId: string; stepKey: string; score: number }[]>  // similarity(paragraph text, step text) ≥ 0.6 across documents that have no links to this source yet
  confirmMapping(sourceId: string, pairs: { ref: string; documentId: string; stepKey: string }[]): Promise<void>  // writes document_links + steps.source_ref='§ref'
}
export class ProposalService {
  constructor(private pool: pg.Pool, private mapping: MappingService, private content: ContentApi) {}
  buildContext(revision: SourceRevision, diffs: ParagraphDiff[]): Promise<ProposalContext>
}
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/db.js';
import { seedUser, seedDocument, seedBlock, seedField, contentStub } from '../helpers/stubs.js';
import { MappingService } from '../../src/modules/sources/mapping.js';
import { ProposalService } from '../../src/modules/sources/proposal.js';
import { paragraphDiff } from '../../src/modules/sources/diff.js';
import type { Document, Block } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111', B = '44444444-4444-4444-8444-444444444444';
const block: Block = { id: B, slug: 'sim-refresh', title: 'ריענון SIM', kind: 'step', actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }], outcomes: [], currentVersion: 2, updatedAt: '2025-06-12T00:00:00.000Z' };
const doc = (sourceId: string): Document => ({ id: D, slug: 'browsing', title: 'איטיות גלישה', description: '', category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7, sourceId, related: [], createdAt: '2025-06-12T00:00:00.000Z', updatedAt: '2025-06-12T00:00:00.000Z',
  phases: [{ id: 'p1', label: 'מסלול 2', steps: [
    { key: 's8', num: '8', title: 'בדיקת מהירות גלישה', sourceRef: '§4.8', actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ Speedtest' }], outcomes: [], blockRefs: [], deps: [] },
    { key: 's11', num: '11', title: 'ריענון SIM', sourceRef: '§4.11', blockId: B, actions: [], outcomes: [], blockRefs: [], deps: [] },
  ] }] });

run('mapping + proposal context', () => {
  it('lists linked steps, proposes and confirms mappings, builds context', async () => withDb(async (pool) => {
    const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
    const src = await pool.query(`insert into sources(kind, title) values ('docx','נהלי תמיכה טכנית') returning id`); const sourceId = src.rows[0].id as string;
    await seedBlock(pool, block); await seedField(pool, { name: 'sim block lbl' }); await seedDocument(pool, doc(sourceId), uid);
    const m = new MappingService(pool);
    const linked = await m.linkedSteps(sourceId);
    expect(linked.map((s) => [s.anchor, s.stepKey, s.blockId ?? null])).toEqual([['4.8', 's8', null], ['4.11', 's11', B]]);
    expect(linked[1].actions).toEqual(['CRM ← sim block lbl ← שמור']);
    // a second document without links gets a proposal by similarity
    const other = { ...doc(sourceId), id: '55555555-5555-4555-8555-555555555555', slug: 'other', sourceId: null, phases: [{ id: 'p1', label: '', steps: [{ key: 's1', num: '1', title: 'x', actions: [{ id: 'a', text: 'בקש מהלקוח להריץ Speedtest מעל 6 מגה תקין' }], outcomes: [], blockRefs: [], deps: [] }] }] } as Document;
    await seedDocument(pool, other, uid);
    const props = await m.proposeInitialMapping(sourceId, [{ ref: '9.1', runs: [{ t: 'בקש מהלקוח להריץ Speedtest מעל 6 מגה תקין' }] }]);
    expect(props[0]).toMatchObject({ ref: '9.1', documentId: other.id, stepKey: 's1' });
    await m.confirmMapping(sourceId, props);
    expect((await m.linkedSteps(sourceId)).some((s) => s.documentId === other.id && s.anchor === '9.1')).toBe(true);
    const ps = new ProposalService(pool, m, contentStub);
    const revision = { id: '66666666-6666-4666-8666-666666666666', sourceId, hash: 'h', paragraphs: [{ ref: '4.8', runs: [{ t: 'מעל 6 מגה' }] }], importedAt: new Date().toISOString(), importedBy: uid, accepted: false };
    const ctx = await ps.buildContext(revision, paragraphDiff(null, revision.paragraphs));
    expect(ctx.source.title).toBe('נהלי תמיכה טכנית'); expect(ctx.linkedSteps).toHaveLength(3); expect(ctx.blocks[0].id).toBe(B); expect(ctx.fields[0].name).toBe('sim block lbl');
  }), 120000);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`mapping.ts`:
```ts
import pg from 'pg';
import { similarity, stripFmt, type Paragraph, paragraphText } from '@wecom/shared';
import type { LinkedStep } from '@wecom/model';
const anchor = (ref: string) => ref.replace(/^§/, '');
export class MappingService {
  constructor(private readonly pool: pg.Pool) {}
  async linkedSteps(sourceId: string): Promise<LinkedStep[]> {
    const r = await this.pool.query(`select d.id as document_id, d.title as document_title, s.step_key, s.num, s.title, s.source_ref, s.block_id,
        coalesce((select array_agg(text order by position) from step_actions a where a.step_id=s.id), '{}') as actions,
        coalesce((select array_agg(text order by position) from block_actions ba where ba.block_id=s.block_id), '{}') as block_actions
      from document_links l join documents d on d.id=l.from_document_id and d.deleted_at is null join steps s on s.document_id=d.id and s.step_key=l.from_step_key
      where l.to_source_id=$1 and l.type='derived_from_source' and s.source_ref is not null order by d.title, s.position`, [sourceId]);
    return r.rows.map((x) => ({ documentId: x.document_id, documentTitle: x.document_title, stepKey: x.step_key, stepNum: x.num, stepTitle: x.title, anchor: anchor(x.source_ref), actions: (x.block_id ? x.block_actions : x.actions) as string[], blockId: x.block_id ?? undefined }));
  }
  async proposeInitialMapping(sourceId: string, paragraphs: Paragraph[]) {
    const r = await this.pool.query(`select d.id as document_id, s.step_key, s.title, coalesce((select string_agg(text, ' ' order by position) from step_actions a where a.step_id=s.id), '') as actions
      from steps s join documents d on d.id=s.document_id and d.deleted_at is null where not exists (select 1 from document_links l where l.from_document_id=d.id and l.to_source_id=$1)`, [sourceId]);
    const out: { ref: string; documentId: string; stepKey: string; score: number }[] = [];
    for (const p of paragraphs) {
      const text = stripFmt(paragraphText(p)); let best: { documentId: string; stepKey: string; score: number } | null = null;
      for (const s of r.rows) { const score = similarity(text, stripFmt(s.title + ' ' + s.actions)); if (score >= 0.6 && (!best || score > best.score)) best = { documentId: s.document_id, stepKey: s.step_key, score }; }
      if (best) out.push({ ref: p.ref, ...best });
    }
    return out;
  }
  async confirmMapping(sourceId: string, pairs: { ref: string; documentId: string; stepKey: string }[]) {
    for (const p of pairs) {
      await this.pool.query(`update steps set source_ref=$3 where document_id=$1 and step_key=$2`, [p.documentId, p.stepKey, '§' + anchor(p.ref)]);
      await this.pool.query(`insert into document_links(from_document_id, from_step_key, to_source_id, type, origin) select $1,$2,$3,'derived_from_source','explicit' where not exists (select 1 from document_links where from_document_id=$1 and from_step_key=$2 and to_source_id=$3 and type='derived_from_source')`, [p.documentId, p.stepKey, sourceId]);
      await this.pool.query(`update documents set source_id=coalesce(source_id,$2) where id=$1`, [p.documentId, sourceId]);
    }
  }
}
```
`proposal.ts`:
```ts
import pg from 'pg';
import type { ParagraphDiff, SourceRevision } from '@wecom/shared';
import type { ProposalContext } from '@wecom/model';
import type { MappingService } from './mapping.js';
import type { ContentApi } from '../../../test/helpers/stubs.js'; // replaced by '../content/index.js' when L2 lands (same shape)
export class ProposalService {
  constructor(private readonly pool: pg.Pool, private readonly mapping: MappingService, private readonly content: ContentApi) {}
  async buildContext(revision: SourceRevision, diffs: ParagraphDiff[]): Promise<ProposalContext> {
    const src = await this.pool.query(`select title from sources where id=$1`, [revision.sourceId]);
    const client = await this.pool.connect();
    try {
      const [linkedSteps, blocks, fields] = await Promise.all([this.mapping.linkedSteps(revision.sourceId), this.content.listBlocks(client), this.content.listFields(client)]);
      return { source: { id: revision.sourceId, title: src.rows[0]?.title ?? '' }, diffs, paragraphs: revision.paragraphs, linkedSteps, fields: fields.map((f) => ({ name: f.name, status: f.status })), blocks: blocks.map((b) => ({ id: b.id, title: b.title, actions: b.actions.map((a) => a.text) })) };
    } finally { client.release(); }
  }
}
```
Note for implementers: `ContentApi` must be imported from `apps/api/src/modules/content/index.ts` once L2 exists; until then create `apps/api/src/modules/content/index.ts` exporting `export type { ContentApi } from '../../../test/helpers/stubs.js'` is **not** allowed in product code — instead define the interface in `apps/api/src/modules/sources/content-api.ts` (copy the signatures from this plan's "Interfaces expected" block) and have both `stubs.ts` and L2 satisfy it.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): source↔step mapping and proposal context"`.

---

### Task 9: `SuggestionService` (create, decide, edit, apply, publish)

**Files:**
- Create: `apps/api/src/modules/sources/suggestions.ts`, `apps/api/src/modules/sources/content-api.ts`
- Test: `apps/api/test/sources/suggestions.test.ts` (integration)

**Interfaces:**
- Produces:
```ts
export class SuggestionService {
  constructor(private pool: pg.Pool, private content: ContentApi, private events: { publish(e: Event): void })
  createFromProposals(revisionId: string, items: ProposedSuggestion[]): Promise<Suggestion[]>   // emits suggestion.created per row
  list(q: { status?: SuggestionStatus; sourceId?: string; page: number; pageSize: number }): Promise<{ items: Suggestion[]; total: number }>
  decide(id: string, status: 'accepted' | 'rejected' | 'pending', actorId: string): Promise<Suggestion>   // emits suggestion.decided
  edit(id: string, editedPayload: SuggestionPayload, actorId: string): Promise<Suggestion>   // validates type equality
  applyOne(client: pg.PoolClient, s: Suggestion, actorId: string): Promise<{ versionId: string | null }>
  publishAccepted(sourceId: string, actorId: string): Promise<{ applied: number; versions: string[] }>  // one transaction; marks revision accepted, source synced; emits document.published events after commit
}
```
- Apply semantics per payload type:
  - `update-step`: load document, find step by `targetStepKey`, append `addActions` as `{id: 'a'+n, text}`, set `branch`/`outcomes` when provided, shallow-merge `patch`; `publishDocument(label: 'ממסמך מקור · <source title> <anchor> · <suggestion title>', suggestionId)`.
  - `new-card`: `createDocument({...payload, kind:'steps', sourceId, sourceRef: anchor})`, then `publishDocument` (status published), then `document_links` `derived_from_source` for every step with `sourceRef`.
  - `new-step`: insert step after `afterStepKey` (or at end of last phase) with key `'s' + (max numeric key + 1)`, renumber `num` for numeric steps, publish.
  - `update-block`: `getBlock` → replace `actions`/`script` → `publishBlock(label)`; no document version (blocks embed live).
  - `deprecate-step`: set `tone: 'alert'`, `hint: 'הוצא משימוש במקור'`, prepend outcome `{kind:'alert', text:'⚑ השלב הוצא משימוש – ' + reason}`; publish.
  - `field-alert`: `upsertField({name, status: issue === 'unknown' ? 'new' : issue === 'renamed' ? 'renamed' : 'retired', path: ''})`; no version.
  - After apply: `suggestions.status='applied'`, `applied_version_id`.

- [ ] **Step 1: Write `content-api.ts`** (interface only — the exact signatures from the "Interfaces expected" block, as `export interface ContentApi { … }`), and change `test/helpers/stubs.ts` to `export const contentStub: ContentApi = {...}` importing the type from `../../src/modules/sources/content-api.js`.

- [ ] **Step 2: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/db.js';
import { seedUser, seedDocument, seedBlock, seedField, contentStub, readDocument } from '../helpers/stubs.js';
import { SuggestionService } from '../../src/modules/sources/suggestions.js';
import type { Block, Document, Event } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111', B = '44444444-4444-4444-8444-444444444444';
run('SuggestionService', () => {
  it('creates, decides, edits and applies every payload type', async () => withDb(async (pool) => {
    const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
    const src = (await pool.query(`insert into sources(kind, title) values ('docx','נהלי תמיכה טכנית') returning id`)).rows[0].id as string;
    const rev = (await pool.query(`insert into source_revisions(source_id, hash, paragraphs) values ($1,'h','[]') returning id`, [src])).rows[0].id as string;
    const block: Block = { id: B, slug: 'sim-refresh', title: 'ריענון SIM', kind: 'step', actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }, { id: 'b2', text: 'בקש מהלקוח לאתחל מכשיר' }], outcomes: [], currentVersion: 2, updatedAt: '2025-06-12T00:00:00.000Z' };
    await seedBlock(pool, block); await seedField(pool, { name: 'sim block lbl' });
    const doc: Document = { id: D, slug: 'browsing', title: 'איטיות גלישה', description: '', category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7, sourceId: src, related: [], createdAt: '2025-06-12T00:00:00.000Z', updatedAt: '2025-06-12T00:00:00.000Z',
      phases: [{ id: 'p1', label: '', steps: [{ key: 's8', num: '8', title: 'בדיקת מהירות גלישה', sourceRef: '§4.8', actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ Speedtest' }], outcomes: [], blockRefs: [], deps: [] }, { key: 's11', num: '11', title: 'ריענון SIM', sourceRef: '§4.11', blockId: B, actions: [], outcomes: [], blockRefs: [], deps: [] }] }] };
    await seedDocument(pool, doc, uid);
    const events: Event[] = []; const svc = new SuggestionService(pool, contentStub, { publish: (e) => events.push(e) });
    const created = await svc.createFromProposals(rev, [
      { anchor: '§4.8', type: 'update-step', title: 'סף', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null, payload: { type: 'update-step', addActions: ['ודא ניתוק Wi-Fi'], patch: {} }, confidence: 0.9, rationale: 'r' },
      { anchor: '§4.14', type: 'new-card', title: 'בעיות גלישה ברכב', targetDocumentId: null, targetStepKey: null, targetBlockId: null, payload: { type: 'new-card', title: 'בעיות גלישה ברכב', description: 'd', category: 'tech', wave: 2, priority: 'm', phases: [{ id: 'p1', label: 'שלבי הטיפול', steps: [{ key: 's1', num: '1', title: 'x', sourceRef: '§4.14', actions: [{ id: 'a1', text: 'y' }], outcomes: [{ kind: 'ok', text: '✓ סיום' }], blockRefs: [], deps: [] }] }] }, confidence: 0.8, rationale: 'r' },
      { anchor: '§4.11', type: 'update-block', title: 'ריענון SIM: 90 שניות', targetDocumentId: D, targetStepKey: 's11', targetBlockId: B, payload: { type: 'update-block', actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }, { id: 'b2', text: 'בקש מהלקוח לאתחל מכשיר ולחכות 90 שניות' }] }, confidence: 0.9, rationale: 'r' },
      { anchor: '§4.9', type: 'new-step', title: 'שלב חדש', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null, payload: { type: 'new-step', afterStepKey: 's8', title: 'בדיקת Wi-Fi Calling', actions: ['ודא Wi-Fi Calling פעיל'], outcomes: [] }, confidence: 0.7, rationale: 'r' },
      { anchor: '§4.12', type: 'deprecate-step', title: 'הוצאה משימוש', targetDocumentId: D, targetStepKey: 's8', targetBlockId: null, payload: { type: 'deprecate-step', reason: 'נמחק במקור' }, confidence: 0.7, rationale: 'r' },
      { anchor: '§4.15', type: 'field-alert', title: 'שדה לא מוכר', targetDocumentId: null, targetStepKey: null, targetBlockId: null, payload: { type: 'field-alert', fieldName: 'חסימת גלישה בחו"ל', issue: 'unknown' }, confidence: 0.99, rationale: 'r' },
    ]);
    expect(created).toHaveLength(6); expect(events.filter((e) => e.name === 'suggestion.created')).toHaveLength(6);
    await svc.decide(created[1].id, 'rejected', uid);
    for (const s of created) if (s.id !== created[1].id) await svc.decide(s.id, 'accepted', uid);
    await svc.edit(created[0].id, { type: 'update-step', addActions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה'], patch: {} }, uid);
    await expect(svc.edit(created[0].id, { type: 'new-card', title: 'x', description: '', category: 'tech', wave: 1, priority: 'm', phases: [] }, uid)).rejects.toThrow(/type/);
    const res = await svc.publishAccepted(src, uid);
    expect(res.applied).toBe(5);
    const after = (await readDocument(pool, D))!;
    const s8 = after.phases[0].steps.find((s) => s.key === 's8')!;
    expect(s8.actions.map((a) => a.text)).toContain('ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה');
    expect(s8.tone).toBe('alert'); expect(s8.outcomes[0].text).toContain('הוצא משימוש');
    expect(after.phases[0].steps.map((s) => s.key)).toEqual(['s8', 's12', 's11']);
    expect(after.currentVersion).toBeGreaterThan(7);
    expect((await pool.query(`select count(*)::int as n from document_versions where document_id=$1`, [D])).rows[0].n).toBeGreaterThanOrEqual(3);
    expect((await contentStub.getBlock(await pool.connect() as never, B))!.currentVersion).toBe(3);
    expect((await pool.query(`select status from crm_fields where name=$1`, ['חסימת גלישה בחו"ל'])).rows[0].status).toBe('new');
    expect((await pool.query(`select count(*)::int as n from documents where title=$1`, ['בעיות גלישה ברכב'])).rows[0].n).toBe(0); // rejected
    expect((await pool.query(`select status, applied_version_id from suggestions where id=$1`, [created[0].id])).rows[0]).toMatchObject({ status: 'applied' });
    expect((await pool.query(`select sync_state from sources where id=$1`, [src])).rows[0].sync_state).toBe('synced');
    expect((await pool.query(`select accepted from source_revisions where id=$1`, [rev])).rows[0].accepted).toBe(true);
    expect(events.some((e) => e.name === 'document.published')).toBe(true);
  }), 180000);
});
```

- [ ] **Step 3: Run** — FAIL. **Step 4: Implement `suggestions.ts`**

```ts
import pg from 'pg';
import { SuggestionPayloadSchema, makeEvent, type Document, type Event, type Suggestion, type SuggestionPayload, type Step } from '@wecom/shared';
import type { ProposedSuggestion } from '@wecom/model';
import type { ContentApi } from './content-api.js';

type Status = Suggestion['status'];
const row = (r: Record<string, unknown>): Suggestion => ({ id: r.id as string, sourceRevisionId: r.source_revision_id as string, anchor: r.anchor as string, type: r.type as Suggestion['type'], title: r.title as string, targetDocumentId: (r.target_document_id as string) ?? null, targetStepKey: (r.target_step_key as string) ?? null, targetBlockId: (r.target_block_id as string) ?? null, payload: r.payload as SuggestionPayload, editedPayload: (r.edited_payload as SuggestionPayload) ?? null, confidence: Number(r.confidence), rationale: r.rationale as string, status: r.status as Status, decidedBy: (r.decided_by as string) ?? null, decidedAt: r.decided_at ? (r.decided_at as Date).toISOString() : null, appliedVersionId: (r.applied_version_id as string) ?? null, createdAt: (r.created_at as Date).toISOString() });
const httpErr = (status: number, code: string, message: string) => Object.assign(new Error(message), { statusCode: status, code });
const findStep = (doc: Document, key: string): Step | undefined => doc.phases.flatMap((p) => p.steps).find((s) => s.key === key);
const nextKey = (doc: Document) => 's' + (Math.max(0, ...doc.phases.flatMap((p) => p.steps).map((s) => parseInt(s.key.replace(/^s/, ''), 10)).filter((n) => !isNaN(n))) + 1);

export class SuggestionService {
  constructor(private readonly pool: pg.Pool, private readonly content: ContentApi, private readonly events: { publish(e: Event): void }) {}

  async createFromProposals(revisionId: string, items: ProposedSuggestion[]): Promise<Suggestion[]> {
    const out: Suggestion[] = [];
    const srcRow = await this.pool.query(`select source_id from source_revisions where id=$1`, [revisionId]);
    for (const it of items) {
      SuggestionPayloadSchema.parse(it.payload);
      const r = await this.pool.query(`insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, target_block_id, payload, confidence, rationale) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`, [revisionId, it.anchor, it.type, it.title, it.targetDocumentId, it.targetStepKey, it.targetBlockId, JSON.stringify(it.payload), Math.min(1, Math.max(0, it.confidence)), it.rationale]);
      const s = row(r.rows[0]); out.push(s);
      this.events.publish(makeEvent('suggestion.created', { suggestionId: s.id, sourceId: srcRow.rows[0].source_id, targetDocumentId: s.targetDocumentId, type: s.type }));
    }
    return out;
  }
  async get(id: string): Promise<Suggestion> { const r = await this.pool.query(`select * from suggestions where id=$1`, [id]); if (!r.rowCount) throw httpErr(404, 'NOT_FOUND', 'ההצעה לא נמצאה'); return row(r.rows[0]); }
  async list(q: { status?: Status; sourceId?: string; page: number; pageSize: number }) {
    const where: string[] = []; const params: unknown[] = [];
    if (q.status) { params.push(q.status); where.push(`g.status=$${params.length}`); }
    if (q.sourceId) { params.push(q.sourceId); where.push(`sr.source_id=$${params.length}`); }
    const w = where.length ? 'where ' + where.join(' and ') : '';
    const total = await this.pool.query(`select count(*)::int as n from suggestions g join source_revisions sr on sr.id=g.source_revision_id ${w}`, params);
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const r = await this.pool.query(`select g.* from suggestions g join source_revisions sr on sr.id=g.source_revision_id ${w} order by g.created_at desc limit $${params.length - 1} offset $${params.length}`, params);
    return { items: r.rows.map(row), total: total.rows[0].n as number };
  }
  async decide(id: string, status: 'accepted' | 'rejected' | 'pending', actorId: string): Promise<Suggestion> {
    const cur = await this.get(id); if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    const r = await this.pool.query(`update suggestions set status=$2, decided_by=$3, decided_at=case when $2='pending' then null else now() end where id=$1 returning *`, [id, status, status === 'pending' ? null : actorId]);
    const s = row(r.rows[0]); this.events.publish(makeEvent('suggestion.decided', { suggestionId: id, status, actorId })); return s;
  }
  async edit(id: string, editedPayload: SuggestionPayload, actorId: string): Promise<Suggestion> {
    const cur = await this.get(id);
    const parsed = SuggestionPayloadSchema.parse(editedPayload);
    if (parsed.type !== cur.type) throw httpErr(400, 'TYPE_MISMATCH', 'סוג ההצעה אינו ניתן לשינוי (type)');
    const r = await this.pool.query(`update suggestions set edited_payload=$2, decided_by=coalesce(decided_by,$3) where id=$1 returning *`, [id, JSON.stringify(parsed), actorId]);
    return row(r.rows[0]);
  }

  async applyOne(client: pg.PoolClient, s: Suggestion, actorId: string, sourceTitle: string): Promise<{ versionId: string | null }> {
    const p = s.editedPayload ?? s.payload;
    const label = `ממסמך מקור · ${sourceTitle} ${s.anchor} · ${s.title}`;
    const sourceId = (await client.query(`select source_id from source_revisions where id=$1`, [s.sourceRevisionId])).rows[0].source_id as string;
    const publish = async (doc: Document) => (await this.content.publishDocument(client, doc, { actorId, label, suggestionId: s.id })).versionId;
    switch (p.type) {
      case 'update-step': {
        const doc = await this.needDoc(client, s.targetDocumentId); const st = this.needStep(doc, s.targetStepKey);
        p.addActions.forEach((t, i) => st.actions.push({ id: 'a' + (st.actions.length + i + 1), text: t }));
        if (p.replaceActions) st.actions = p.replaceActions;
        if (p.branch) st.branch = p.branch; if (p.branch === null) delete st.branch;
        if (p.outcomes) st.outcomes = p.outcomes;
        Object.assign(st, p.patch);
        return { versionId: await publish(doc) };
      }
      case 'new-card': {
        const created = await this.content.createDocument(client, { title: p.title, description: p.description, category: p.category, wave: p.wave, priority: p.priority, kind: 'steps', phases: p.phases, sourceId, sourceRef: s.anchor }, actorId);
        created.status = 'published';
        const versionId = await publish(created);
        for (const st of created.phases.flatMap((ph) => ph.steps)) if (st.sourceRef) await client.query(`insert into document_links(from_document_id, from_step_key, to_source_id, type, origin) values ($1,$2,$3,'derived_from_source','explicit')`, [created.id, st.key, sourceId]);
        return { versionId };
      }
      case 'new-step': {
        const doc = await this.needDoc(client, s.targetDocumentId); const key = nextKey(doc);
        const step: Step = { key, num: '', title: p.title, actions: p.actions.map((t, i) => ({ id: 'a' + (i + 1), text: t })), outcomes: p.outcomes, blockRefs: [], deps: [], sourceRef: s.anchor };
        const phase = p.afterStepKey ? doc.phases.find((ph) => ph.steps.some((x) => x.key === p.afterStepKey)) ?? doc.phases[doc.phases.length - 1] : doc.phases[doc.phases.length - 1];
        const idx = p.afterStepKey ? phase.steps.findIndex((x) => x.key === p.afterStepKey) + 1 : phase.steps.length;
        phase.steps.splice(idx, 0, step);
        let n = 1; for (const x of doc.phases.flatMap((ph) => ph.steps)) if (!/[א-ת]/.test(x.num) || x === step) x.num = String(n++);
        await client.query(`insert into document_links(from_document_id, from_step_key, to_source_id, type, origin) values ($1,$2,$3,'derived_from_source','explicit')`, [doc.id, key, sourceId]);
        return { versionId: await publish(doc) };
      }
      case 'update-block': {
        const b = await this.content.getBlock(client, s.targetBlockId ?? ''); if (!b) throw httpErr(404, 'NOT_FOUND', 'הבלוק לא נמצא');
        b.actions = p.actions; if (p.script != null) b.script = p.script;
        await this.content.publishBlock(client, b, { actorId, label });
        return { versionId: null };
      }
      case 'deprecate-step': {
        const doc = await this.needDoc(client, s.targetDocumentId); const st = this.needStep(doc, s.targetStepKey);
        st.tone = 'alert'; st.hint = 'הוצא משימוש במקור'; st.outcomes.unshift({ kind: 'alert', text: '⚑ השלב הוצא משימוש – ' + p.reason });
        return { versionId: await publish(doc) };
      }
      case 'field-alert': {
        await this.content.upsertField(client, { name: p.fieldName, status: p.issue === 'unknown' ? 'new' : p.issue === 'renamed' ? 'renamed' : 'retired', path: '' }, actorId);
        return { versionId: null };
      }
    }
  }
  private async needDoc(client: pg.PoolClient, id: string | null): Promise<Document> { const d = id ? await this.content.getDocument(client, id) : null; if (!d) throw httpErr(404, 'NOT_FOUND', 'מסמך היעד לא נמצא'); return d; }
  private needStep(doc: Document, key: string | null): Step { const st = key ? findStep(doc, key) : undefined; if (!st) throw httpErr(404, 'NOT_FOUND', 'שלב היעד לא נמצא'); return st; }

  async publishAccepted(sourceId: string, actorId: string): Promise<{ applied: number; versions: string[] }> {
    const client = await this.pool.connect(); const versions: string[] = []; const published: { documentId: string; version: number }[] = [];
    try {
      await client.query('begin');
      const srcTitle = (await client.query(`select title from sources where id=$1 for update`, [sourceId])).rows[0]?.title as string;
      const acc = await client.query(`select g.* from suggestions g join source_revisions sr on sr.id=g.source_revision_id where sr.source_id=$1 and g.status='accepted' order by g.created_at`, [sourceId]);
      for (const r of acc.rows) {
        const s = row(r); const res = await this.applyOne(client, s, actorId, srcTitle);
        await client.query(`update suggestions set status='applied', applied_version_id=$2 where id=$1`, [s.id, res.versionId]);
        if (res.versionId) { versions.push(res.versionId); const v = await client.query(`select document_id, version from document_versions where id=$1`, [res.versionId]); published.push({ documentId: v.rows[0].document_id, version: v.rows[0].version }); }
      }
      await client.query(`update source_revisions set accepted=true where source_id=$1 and id in (select source_revision_id from suggestions where status in ('applied','rejected')) and not exists (select 1 from suggestions g2 where g2.source_revision_id=source_revisions.id and g2.status='pending')`, [sourceId]);
      await client.query(`update sources set sync_state='synced', last_synced_at=now(), updated_by=$2 where id=$1`, [sourceId, actorId]);
      await client.query('commit');
    } catch (e) { await client.query('rollback'); throw e; } finally { client.release(); }
    for (const p of published) this.events.publish(makeEvent('document.published', { documentId: p.documentId, version: p.version, actorId }));
    for (const r of versions) void r;
    return { applied: versions.length + 0 + (await this.pool.query(`select count(*)::int as n from suggestions g join source_revisions sr on sr.id=g.source_revision_id where sr.source_id=$1 and g.status='applied' and g.applied_version_id is null`, [sourceId])).rows[0].n, versions };
  }
}
```
(The `applied` count = versioned applies + non-versioned applies such as block/field updates, which is why the final query counts `applied_version_id is null` rows.)

- [ ] **Step 5: Run** — PASS. **Step 6: Commit** — `git add apps/api && git commit -m "feat(api): suggestion service with apply for all payload types"`.

---

### Task 10: Model plugin and pipeline jobs (`pipeline.process`, `sources.watch`)

**Files:**
- Create: `apps/api/src/plugins/model.ts`, `apps/api/src/modules/sources/jobs.ts`
- Modify: `apps/api/src/config.ts` (add `EMBED_MODEL: z.string().default('nomic-embed-text')`, `WATCH_DIR: z.string().optional()`, `MODEL_DISABLED: z.coerce.boolean().default(false)`)
- Test: `apps/api/test/sources/jobs.test.ts` (integration; uses RuleBasedModel)

**Interfaces:**
- Produces: `app.model: ModelClient` (Ollama with `RuleBasedModel` fallback; `RuleBasedModel` alone when `MODEL_DISABLED`), `registerPipelineJobs(app, deps: { revisions: SourceRevisionService; mapping: MappingService; proposal: ProposalService; suggestions: SuggestionService })`, `processRevision(deps, model, revisionId): Promise<{ created: number; used: string }>` (pure function used by the job handler and tests), job names `'pipeline.process'` (teamSize 1, retryLimit 2) and `'sources.watch'` (schedule every 2 minutes when `WATCH_DIR` set: new/changed `.docx` files → `createSource` once per filename → `ingest`).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/db.js';
import { seedUser, seedDocument, contentStub } from '../helpers/stubs.js';
import { SourceRevisionService } from '../../src/modules/sources/revisions.js';
import { MappingService } from '../../src/modules/sources/mapping.js';
import { ProposalService } from '../../src/modules/sources/proposal.js';
import { SuggestionService } from '../../src/modules/sources/suggestions.js';
import { processRevision } from '../../src/modules/sources/jobs.js';
import { parseText } from '../../src/modules/sources/text.js';
import { RuleBasedModel } from '@wecom/model';
import type { Document } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111';
run('processRevision', () => {
  it('diffs against the last accepted revision and stores model proposals', async () => withDb(async (pool) => {
    const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
    const revisions = new SourceRevisionService(pool, { send: async () => null });
    const { id: sourceId } = await revisions.createSource({ kind: 'text', title: 'נהלי תמיכה טכנית' }, uid);
    const doc: Document = { id: D, slug: 'browsing', title: 'איטיות גלישה', description: '', category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7, sourceId, related: [], createdAt: '2025-06-12T00:00:00.000Z', updatedAt: '2025-06-12T00:00:00.000Z', phases: [{ id: 'p1', label: '', steps: [{ key: 's8', num: '8', title: 'בדיקת מהירות גלישה', sourceRef: '§4.8', actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ Speedtest' }], outcomes: [], blockRefs: [], deps: [] }] }] };
    await seedDocument(pool, doc, uid);
    const mapping = new MappingService(pool); const proposal = new ProposalService(pool, mapping, contentStub); const suggestions = new SuggestionService(pool, contentStub, { publish: () => undefined });
    const deps = { revisions, mapping, proposal, suggestions };
    const v1 = await revisions.ingest(sourceId, parseText('a.md', '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest. מעל 5 מגה תקין.'), uid);
    await pool.query(`update source_revisions set accepted=true where id=$1`, [v1.revisionId]);
    const v2 = await revisions.ingest(sourceId, parseText('a.md', '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest. מעל 6 מגה תקין. ודא ניתוק מ-Wi-Fi.'), uid);
    const res = await processRevision(deps, new RuleBasedModel(), v2.revisionId);
    expect(res.used).toBe('rules'); expect(res.created).toBe(1);
    const list = await suggestions.list({ status: 'pending', page: 1, pageSize: 10 });
    expect(list.items[0]).toMatchObject({ type: 'update-step', targetStepKey: 's8', anchor: '§4.8' });
    expect((await pool.query(`select sync_state from sources where id=$1`, [sourceId])).rows[0].sync_state).toBe('pending');
    // re-processing the same revision replaces its pending suggestions instead of duplicating
    await processRevision(deps, new RuleBasedModel(), v2.revisionId);
    expect((await suggestions.list({ page: 1, pageSize: 10 })).total).toBe(1);
  }), 180000);
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`plugins/model.ts`:
```ts
import fp from 'fastify-plugin';
import { OllamaModel, RuleBasedModel, type ModelClient } from '@wecom/model';
declare module 'fastify' { interface FastifyInstance { model: ModelClient } }
export default fp(async (app) => {
  const rules = new RuleBasedModel();
  const model: ModelClient = app.config.MODEL_DISABLED ? rules : new OllamaModel({ url: app.config.MODEL_URL, model: app.config.MODEL_NAME, embedModel: app.config.EMBED_MODEL, timeoutMs: 120_000, fallback: rules });
  app.decorate('model', model);
  app.log.info({ model: model.name }, 'model client ready');
});
```
`jobs.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelClient } from '@wecom/model';
import { paragraphDiff } from './diff.js';
import { parseDocx } from './docx.js';
import type { SourceRevisionService } from './revisions.js';
import type { MappingService } from './mapping.js';
import type { ProposalService } from './proposal.js';
import type { SuggestionService } from './suggestions.js';
export interface PipelineDeps { revisions: SourceRevisionService; mapping: MappingService; proposal: ProposalService; suggestions: SuggestionService }

export async function processRevision(deps: PipelineDeps, model: ModelClient, revisionId: string): Promise<{ created: number; used: string }> {
  const rev = await deps.revisions.getRevision(revisionId); if (!rev) throw new Error('revision not found: ' + revisionId);
  const pool = (deps.revisions as unknown as { pool: import('pg').Pool }).pool;
  await pool.query(`update sources set sync_state='processing' where id=$1`, [rev.sourceId]);
  try {
    const prev = await deps.revisions.latestAccepted(rev.sourceId);
    const diffs = paragraphDiff(prev?.paragraphs ?? null, rev.paragraphs);
    if (!prev) { const props = await deps.mapping.proposeInitialMapping(rev.sourceId, rev.paragraphs); if (props.length) await deps.mapping.confirmMapping(rev.sourceId, props); }
    const ctx = await deps.proposal.buildContext(rev, diffs);
    const items = diffs.some((d) => d.kind !== 'same') ? await model.proposeChanges(ctx) : [];
    await pool.query(`delete from suggestions where source_revision_id=$1 and status='pending'`, [revisionId]);
    const created = await deps.suggestions.createFromProposals(revisionId, items);
    await pool.query(`update sources set sync_state=$2 where id=$1`, [rev.sourceId, created.length ? 'pending' : 'synced']);
    if (!created.length) await pool.query(`update source_revisions set accepted=true where id=$1`, [revisionId]);
    const used = (model as { lastRun?: { used: string } }).lastRun?.used ?? model.name;
    return { created: created.length, used };
  } catch (e) { await pool.query(`update sources set sync_state='error' where id=$1`, [rev.sourceId]); throw e; }
}

export async function registerPipelineJobs(app: FastifyInstance, deps: PipelineDeps): Promise<void> {
  await app.boss.work<{ revisionId: string }>('pipeline.process', { teamSize: 1, teamConcurrency: 1 }, async (job) => {
    const jobs = Array.isArray(job) ? job : [job];
    for (const j of jobs) { app.log.info({ revisionId: j.data.revisionId }, 'pipeline.process start'); const r = await processRevision(deps, app.model, j.data.revisionId); app.log.info({ ...r, revisionId: j.data.revisionId }, 'pipeline.process done'); }
  });
  await app.boss.work('sources.watch', async () => {
    const dir = app.config.WATCH_DIR; if (!dir) return;
    for (const name of await readdir(dir)) {
      if (!/\.docx$/i.test(name)) continue;
      const path = join(dir, name); const st = await stat(path); if (Date.now() - st.mtimeMs < 5000) continue; // still being written
      const buf = await readFile(path); const content = await parseDocx(buf);
      const existing = (await deps.revisions.listSources()).find((s) => s.kind === 'docx' && s.externalId === name);
      const sourceId = existing ? existing.id : (await deps.revisions.createSource({ kind: 'docx', title: content.title, ext: '.docx', externalId: name }, null)).id;
      const r = await deps.revisions.ingest(sourceId, content, null, buf);
      if (!r.duplicate) app.log.info({ name, revisionId: r.revisionId }, 'watched docx ingested');
    }
  });
  if (app.config.WATCH_DIR) await app.boss.schedule('sources.watch', '*/2 * * * *');
}
```
Expose the pool on `SourceRevisionService` as `readonly pool` (change `private readonly pool` → `readonly pool` in Task 7's class) so `processRevision` does not need the cast; update the cast accordingly.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): model plugin, pipeline.process job and docx watch folder"`.

---

### Task 11: Routes for sources and suggestions

**Files:**
- Create: `apps/api/src/modules/sources/routes.ts`, `apps/api/src/modules/sources/index.ts`
- Modify: `apps/api/src/app.ts` (register `@fastify/multipart` with `limits: { fileSize: 25 * 1024 * 1024 }`, register `modelPlugin`, register `registerSourcesModule` under `/api/v1`), `apps/api/package.json` (add `@fastify/multipart ^9.0.1`)
- Test: `apps/api/test/sources/routes.test.ts` (integration, `buildApp` with the test pool and an auth stub granting all permissions)

**Interfaces:**
- Produces routes (all under `/api/v1`):
  - `GET /sources` → `{ items: Source[] }`
  - `POST /sources/upload` (multipart field `file`, optional `sourceId`) → `{ sourceId, revisionId, duplicate, kind, paragraphs: number }` — permission `sources.manage`
  - `POST /sources/:id/process` → `{ revisionId, created, used }` (runs `processRevision` synchronously for the latest revision; used by the "⟳ עבד שינויים" button) — `sources.manage`
  - `GET /sources/:id/revisions/:rev` (`rev` = revision id or `latest`) → `SourceRevision`
  - `GET /suggestions?status=&sourceId=&page=&pageSize=` → `paginated(SuggestionSchema)` — `suggestions.review`
  - `POST /suggestions/:id/accept|reject|reset` → `Suggestion` — `suggestions.review`
  - `PUT /suggestions/:id/edit` body `SuggestionDecisionBodySchema` (`editedPayload`) → `Suggestion` — `suggestions.review`
  - `POST /suggestions/publish` body `{ sourceId }` → `{ applied, versions }` — `suggestions.apply`
- `registerSourcesModule(app)` builds the services from `app.db`, `app.boss`, `app.events`, `app.model` and the content module (`import * as content from '../content/index.js'`, which L2 provides; until then the file exports the `ContentApi` shape).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import FormData from 'form-data';
import { withDb, integration } from '../helpers/db.js';
import { seedUser } from '../helpers/stubs.js';
import { buildDocx } from './fixtures/docx-builder.js';
import { buildApp } from '../../src/app.js';
import pg from 'pg';

const run = integration ? describe : describe.skip;
run('sources & suggestions routes', () => {
  it('uploads a docx, processes it and exposes suggestions', async () => withDb(async (pool, uri) => {
    const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
    const app = await buildApp({ config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true }, pool: pool as pg.Pool, testUser: { id: uid, displayName: 'ענבר ל.', permissions: 'all' } });
    const buf = await buildDocx({ title: 'נהלי תמיכה טכנית', paragraphs: [{ runs: [{ t: '4.14 בעיות גלישה ברכב. אם הלקוח מדווח על איטיות רק ברכב – בדוק Wi-Fi של הרכב. הנחה לכבות Wi-Fi ברכב.' }] }] });
    const fd = new FormData(); fd.append('file', buf, { filename: 'נהלים.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const up = await app.inject({ method: 'POST', url: '/api/v1/sources/upload', payload: fd.getBuffer(), headers: fd.getHeaders() });
    expect(up.statusCode).toBe(200); const { sourceId, revisionId } = up.json();
    const proc = await app.inject({ method: 'POST', url: `/api/v1/sources/${sourceId}/process` });
    expect(proc.json()).toMatchObject({ revisionId, used: 'rules' }); expect(proc.json().created).toBeGreaterThan(0);
    const list = await app.inject({ method: 'GET', url: '/api/v1/suggestions?status=pending' });
    const sug = list.json().items[0]; expect(sug.type).toBe('new-card');
    expect((await app.inject({ method: 'POST', url: `/api/v1/suggestions/${sug.id}/accept` })).json().status).toBe('accepted');
    const pub = await app.inject({ method: 'POST', url: '/api/v1/suggestions/publish', payload: { sourceId } });
    expect(pub.json().applied).toBe(1);
    expect((await app.inject({ method: 'GET', url: `/api/v1/sources/${sourceId}/revisions/latest` })).json().accepted).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/v1/sources' })).json().items[0].syncState).toBe('synced');
    await app.close();
  }), 180000);
  it('rejects without permission', async () => withDb(async (pool, uri) => {
    const uid = await seedUser(pool, { displayName: 'נציג' });
    const app = await buildApp({ config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true }, pool: pool as pg.Pool, testUser: { id: uid, displayName: 'נציג', permissions: ['docs.read'] } });
    expect((await app.inject({ method: 'GET', url: '/api/v1/suggestions' })).statusCode).toBe(403);
    await app.close();
  }), 120000);
});
```
`buildApp` gains an optional `testUser` option (L3 owns the real auth plugin; L0's `buildApp` is extended here with: when `opts.testUser` is set and `NODE_ENV==='test'`, an `onRequest` hook sets `req.user = { id, displayName, permissions: new Set(perms === 'all' ? PERMISSIONS : perms) }`; a `requires(...perms)` helper in `apps/api/src/plugins/authz.ts` — `export const requires = (...perms: Permission[]) => async (req, reply) => { if (!req.user) return reply.code(401).send({ code: 'UNAUTHENTICATED', message: 'נדרשת התחברות' }); if (!perms.every((p) => req.user.permissions.has(p))) return reply.code(403).send({ code: 'FORBIDDEN', message: 'אין הרשאה' }); }` used as `preHandler`. If L3 has already landed `authz.ts` with the same export, reuse it.) Add `form-data ^4.0.0` to devDependencies.

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement `routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { IdSchema, SourceRevisionSchema, SourceSchema, SuggestionDecisionBodySchema, SuggestionSchema, SuggestionsQuerySchema, paginated } from '@wecom/shared';
import { requires } from '../../plugins/authz.js';
import { parseUpload } from './parsers.js';
import { processRevision, type PipelineDeps } from './jobs.js';

export default function sourcesRoutes(deps: PipelineDeps) {
  return async function routes(app: FastifyInstance) {
    app.get('/sources', { schema: { tags: ['sources'], response: { 200: z.object({ items: z.array(SourceSchema) }) } }, preHandler: requires('docs.read') }, async () => ({ items: await deps.revisions.listSources() }));

    app.post('/sources/upload', { schema: { tags: ['sources'], response: { 200: z.object({ sourceId: IdSchema, revisionId: IdSchema, duplicate: z.boolean(), kind: z.string(), paragraphs: z.number().int() }) } }, preHandler: requires('sources.manage') }, async (req) => {
      const parts = req.parts(); let file: { filename: string; buffer: Buffer } | null = null; let sourceId: string | undefined;
      for await (const part of parts) { if (part.type === 'file') file = { filename: part.filename, buffer: await part.toBuffer() }; else if (part.fieldname === 'sourceId') sourceId = String(part.value); }
      if (!file) throw Object.assign(new Error('חסר קובץ'), { statusCode: 400, code: 'NO_FILE' });
      const content = await parseUpload(file.filename, file.buffer);
      const sid = sourceId ?? (await deps.revisions.createSource({ kind: content.kind === 'text' ? 'text' : content.kind, title: content.title, ext: '.' + file.filename.split('.').pop(), externalId: file.filename }, req.user!.id)).id;
      const r = await deps.revisions.ingest(sid, content, req.user!.id, file.buffer);
      return { sourceId: sid, revisionId: r.revisionId, duplicate: r.duplicate, kind: content.kind, paragraphs: content.paragraphs.length };
    });

    app.post('/sources/:id/process', { schema: { tags: ['sources'], params: z.object({ id: IdSchema }), response: { 200: z.object({ revisionId: IdSchema, created: z.number().int(), used: z.string() }) } }, preHandler: requires('sources.manage') }, async (req) => {
      const r = await app.db.query(`select id from source_revisions where source_id=$1 order by imported_at desc limit 1`, [req.params.id]);
      if (!r.rowCount) throw Object.assign(new Error('אין גרסאות למקור זה'), { statusCode: 404, code: 'NOT_FOUND' });
      const res = await processRevision(deps, app.model, r.rows[0].id);
      return { revisionId: r.rows[0].id, ...res };
    });

    app.get('/sources/:id/revisions/:rev', { schema: { tags: ['sources'], params: z.object({ id: IdSchema, rev: z.string() }), response: { 200: SourceRevisionSchema } }, preHandler: requires('docs.read') }, async (req) => {
      const id = req.params.rev === 'latest' ? (await app.db.query(`select id from source_revisions where source_id=$1 order by imported_at desc limit 1`, [req.params.id])).rows[0]?.id : req.params.rev;
      const rev = id ? await deps.revisions.getRevision(id) : null;
      if (!rev || rev.sourceId !== req.params.id) throw Object.assign(new Error('הגרסה לא נמצאה'), { statusCode: 404, code: 'NOT_FOUND' });
      return rev;
    });

    app.get('/suggestions', { schema: { tags: ['suggestions'], querystring: SuggestionsQuerySchema, response: { 200: paginated(SuggestionSchema) } }, preHandler: requires('suggestions.review') }, async (req) => {
      const { items, total } = await deps.suggestions.list(req.query); return { items, total, page: req.query.page, pageSize: req.query.pageSize };
    });
    for (const [action, status] of [['accept', 'accepted'], ['reject', 'rejected'], ['reset', 'pending']] as const)
      app.post(`/suggestions/:id/${action}`, { schema: { tags: ['suggestions'], params: z.object({ id: IdSchema }), response: { 200: SuggestionSchema } }, preHandler: requires('suggestions.review') }, async (req) => deps.suggestions.decide(req.params.id, status, req.user!.id));
    app.put('/suggestions/:id/edit', { schema: { tags: ['suggestions'], params: z.object({ id: IdSchema }), body: SuggestionDecisionBodySchema, response: { 200: SuggestionSchema } }, preHandler: requires('suggestions.review') }, async (req) => {
      if (!req.body.editedPayload) throw Object.assign(new Error('חסר editedPayload'), { statusCode: 400, code: 'VALIDATION' });
      return deps.suggestions.edit(req.params.id, req.body.editedPayload, req.user!.id);
    });
    app.post('/suggestions/publish', { schema: { tags: ['suggestions'], body: z.object({ sourceId: IdSchema }), response: { 200: z.object({ applied: z.number().int(), versions: z.array(IdSchema) }) } }, preHandler: requires('suggestions.apply') }, async (req) => deps.suggestions.publishAccepted(req.body.sourceId, req.user!.id));
  };
}
```
`index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import * as content from '../content/index.js';
import { SourceRevisionService } from './revisions.js';
import { MappingService } from './mapping.js';
import { ProposalService } from './proposal.js';
import { SuggestionService } from './suggestions.js';
import { registerPipelineJobs, type PipelineDeps } from './jobs.js';
import sourcesRoutes from './routes.js';
export async function registerSourcesModule(app: FastifyInstance): Promise<PipelineDeps> {
  const revisions = new SourceRevisionService(app.db, { send: (name, data, opts) => app.boss.send(name, data, opts ?? {}) });
  const mapping = new MappingService(app.db);
  const proposal = new ProposalService(app.db, mapping, content);
  const suggestions = new SuggestionService(app.db, content, app.events);
  const deps = { revisions, mapping, proposal, suggestions };
  await app.register(sourcesRoutes(deps), { prefix: '/api/v1' });
  if (app.boss) await registerPipelineJobs(app, deps);
  return deps;
}
```
If `../content/index.js` does not exist yet (L2 pending), create `apps/api/src/modules/content/index.ts` that re-exports from `documents.ts`, `blocks.ts`, `fields.ts`; those files must satisfy `ContentApi` — coordinate with L2 (their plan implements exactly these names).

- [ ] **Step 4: Run** — PASS. Regenerate OpenAPI: `pnpm openapi` and commit `docs/api/openapi.json`.
- [ ] **Step 5: Commit** — `git add apps/api docs/api && git commit -m "feat(api): sources upload/process/revisions and suggestions routes"`.

---

### Task 12: Frontend hook-up notes and system health integration

**Files:**
- Modify: `apps/api/src/routes/health.ts` (fill `model` via `app.model.available()` with a 2 s timeout and `queue` via `app.boss.getQueueSize('pipeline.process')`)
- Test: `apps/api/test/health.test.ts` (extend: with `MODEL_DISABLED: true`, `model === true`; without boss, `queue === null`)

- [ ] **Step 1: Extend the health test**

```ts
it('reports model availability', async () => {
  const app = await buildApp({ config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none', MODEL_DISABLED: true, NODE_ENV: 'test' } });
  const body = (await app.inject({ method: 'GET', url: '/api/v1/system/health' })).json();
  expect(body.model).toBe(true); expect(body.queue).toBeNull();
  await app.close();
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** in `health.ts`:

```ts
let model: boolean | null = null;
try { model = await Promise.race([app.model.available(), new Promise<boolean>((r) => setTimeout(() => r(false), 2000))]); } catch { model = false; }
let queue: number | null = null;
try { queue = app.boss ? await app.boss.getQueueSize('pipeline.process') : null; } catch { queue = null; }
return { ok: db, db, model, queue, version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000) };
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): health reports model and pipeline queue"`.

Hand-off to L4 (frontend): the existing `legacy/js/views-sources.js` screen maps 1:1 — `GET /sources` → sidebar, `GET /sources/:id/revisions/latest` → paragraph view (runs with `add/del/chg`), `GET /suggestions?sourceId=` → panel, accept/reject/reset/edit → the same buttons, `POST /suggestions/publish` → "פרסם לספרייה", `POST /sources/:id/process` → "⟳ עבד שינויים", `POST /sources/upload` → "+ קשר מסמך / תיקייה"; SSE `suggestion.created` refreshes the badge.

---

## Self-review

- **Spec coverage** — program §7: ingestion (Tasks 3, 4, 7, watch folder in 10), diff (5), mapping (8), model with schema-validated JSON + batch job concurrency 1 (1, 2, 10), review + apply creating versions/cards/block versions attributed to the reviewer with suggestion id in the label (9, 11), acceptance flow (11 test). Contracts §6.6 (`proposeChanges`, validation, one retry, rule fallback, versioned prompt files) → Tasks 1–2; §6.7 (`ingest`, `paragraphDiff`, `SuggestionService.create/decide/apply`) → Tasks 5, 7, 9. Stage-1 §2 pipeline tables used as defined; §4 sources/suggestions routes → Task 11. Health `model`/`queue` → Task 12.
- **Placeholder scan** — none; every step carries code. The only cross-lane dependency (L2 content functions) is pinned by an explicit interface (`content-api.ts`) with a test-only stub.
- **Type consistency** — `ProposedSuggestion` (L0) is what `parseProposals`, `RuleBasedModel`, `OllamaModel` return and `createFromProposals` consumes; `ParagraphDiff.kind` values (`added/removed/changed/same`) match between `paragraphDiff`, `buildMessages` and `RuleBasedModel`; `LinkedStep.anchor` is stored without `§` everywhere (`MappingService.linkedSteps` strips it, `RuleBasedModel` and prompt add it back via `anchorOf`); `Suggestion.anchor` always carries `§`; `Step.key`/`num` naming matches migrations `step_key`/`num`; `SourceRevisionService.pool` is public after Task 10's note.
