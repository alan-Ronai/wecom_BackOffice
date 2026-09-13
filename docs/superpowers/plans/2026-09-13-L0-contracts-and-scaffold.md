# L0 — Contracts & Monorepo Scaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create the monorepo, the shared contracts (zod schemas, permissions, events, formatter/diff/link logic), the database migrations, the connector and model contracts, and the API/web skeletons with OpenAPI generation, so lanes L1–L7 can start in parallel against fixed names.

**Architecture:** pnpm workspace with `apps/api` (Fastify + zod type provider + swagger), `apps/web` (Vite React), `packages/shared` (schemas + pure logic used by both), `packages/connectors` (contract only), `packages/model` (contract + rule-based fallback). Migrations live in `apps/api/migrations` (node-pg-migrate). CI checks lint, tests, and that the committed OpenAPI file matches the generated one.

**Tech Stack:** Node 22, pnpm 9, TypeScript 5 strict, zod 3, Fastify 5, fastify-type-provider-zod 4, @fastify/swagger 9, node-pg-migrate 7, pg 8, vitest 2, @testcontainers/postgresql, Vite 5, React 18, openapi-typescript 7.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` (sections 3, 6) and `docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` (sections 1, 2, 3 permissions, 4 conventions).

## Global Constraints

- Node `>=22`, pnpm `>=9`; TypeScript `strict: true` in every package.
- All user-facing strings in Hebrew; code identifiers, logs and commit messages in English.
- Every schema in `packages/shared` is the single source of truth: API validation, OpenAPI, and the web client are derived from it, never hand-written twice.
- Breaking changes to any contract require an ADR file in `docs/adr/`.
- Permission strings exactly: `docs.read, docs.create, docs.edit, docs.publish, docs.delete, docs.restore, blocks.edit, fields.edit, scripts.edit, notes.write, notes.moderate, suggestions.review, suggestions.apply, sources.manage, connectors.manage, users.manage, roles.manage, audit.read, system.admin`.
- Event names exactly: `document.published, document.updated, document.deleted, suggestion.created, suggestion.decided, sync.completed, sync.conflict, job.failed, system.status`.
- Categories exactly: `sim, tech, billing, plans, intl, ops`; priorities `hh, h, m, l`; waves `1, 2, 3`.
- Commit after every task; commit messages end with the attribution lines the session provides.

## File structure produced by this plan

```
pnpm-workspace.yaml, package.json, tsconfig.base.json, .eslintrc.cjs, .prettierrc, .gitignore, .nvmrc
.github/workflows/ci.yml
legacy/                       (today's index.html, css/, js/, shared.css, docs/, README moved here)
packages/shared/
  package.json, tsconfig.json, vitest.config.ts
  src/index.ts
  src/schemas/common.ts        enums, ids, pagination, error envelope
  src/schemas/content.ts       Action, Outcome, Branch, Step, Phase, Document, DocumentCard, Block, CrmField, Script, Note, Version, DocumentLink
  src/schemas/pipeline.ts      Run, Paragraph, Source, SourceRevision, Suggestion
  src/schemas/identity.ts      User, Role, Permission, Session, AuditEntry, Me
  src/schemas/api.ts           request/response bodies for stage-1 routes
  src/permissions.ts           PERMISSIONS, DEFAULT_ROLES
  src/events.ts                EVENTS, EventPayloads
  src/format/bidi.ts           fmt, crmIn, stripFmt, fmtPlain
  src/format/diff.ts           wordDiff
  src/format/links.ts          detectFieldRefs, detectLinks, stepText
  test/*.test.ts
packages/connectors/
  package.json, tsconfig.json, src/index.ts, src/contract.ts, test/contract.test.ts
packages/model/
  package.json, tsconfig.json, src/index.ts, src/contract.ts, src/rules.ts, test/rules.test.ts
apps/api/
  package.json, tsconfig.json, vitest.config.ts
  src/config.ts                env schema
  src/app.ts                   buildApp(): Fastify instance with plugins
  src/server.ts                listen
  src/plugins/db.ts            pg Pool decorator
  src/routes/health.ts         GET /api/v1/system/health (DB check only in L0)
  src/openapi.ts               dumps docs/api/openapi.json
  migrations/0001_extensions.js … 0007_search.js
  test/migrations.test.ts, test/health.test.ts
apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx, src/App.tsx, src/api/client.ts, src/api/schema.d.ts (generated)
docs/api/openapi.json         committed, regenerated in CI
docs/adr/0001-contracts-ownership.md
```

---

### Task 1: Monorepo scaffold and legacy move

**Files:**
- Create: `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`, `.eslintrc.cjs`, `.prettierrc`, `.nvmrc`, `.gitignore`
- Move: `index.html`, `css/`, `js/`, `shared.css`, `docs/browsing-issues.html`, `docs/churn-retention.html`, `README.md` → `legacy/`

**Interfaces:**
- Produces: workspace names `@wecom/shared`, `@wecom/connectors`, `@wecom/model`, `@wecom/api`, `@wecom/web`; root scripts `pnpm lint`, `pnpm test`, `pnpm build`.

- [ ] **Step 1: Move the static app into `legacy/`**

```bash
mkdir -p legacy && git mv index.html css js shared.css README.md legacy/ && git mv docs/browsing-issues.html docs/churn-retention.html legacy/
```

- [ ] **Step 2: Create workspace files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - apps/*
  - packages/*
```

`package.json`:
```json
{
  "name": "wecom-kb",
  "private": true,
  "packageManager": "pnpm@9.12.0",
  "engines": { "node": ">=22" },
  "scripts": {
    "build": "pnpm -r build",
    "lint": "eslint . --ext .ts,.tsx --max-warnings 0 && prettier --check .",
    "format": "prettier --write .",
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "openapi": "pnpm --filter @wecom/api openapi && pnpm --filter @wecom/web generate:client"
  },
  "devDependencies": {
    "@typescript-eslint/eslint-plugin": "^8.8.0",
    "@typescript-eslint/parser": "^8.8.0",
    "eslint": "^8.57.0",
    "eslint-config-prettier": "^9.1.0",
    "prettier": "^3.3.3",
    "typescript": "^5.6.2"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true
  }
}
```

`.eslintrc.cjs`:
```js
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist', 'legacy', 'node_modules', '*.d.ts', 'apps/api/migrations'],
  rules: { '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
};
```

`.prettierrc`: `{ "singleQuote": true, "printWidth": 110, "trailingComma": "all" }`
`.nvmrc`: `22`
`.gitignore`:
```
node_modules
dist
coverage
.env
*.log
.playwright-mcp
apps/web/src/api/schema.d.ts
```

- [ ] **Step 3: Install and verify**

Run: `pnpm install && pnpm lint`
Expected: install succeeds; lint passes (no packages yet).

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: monorepo scaffold, move static app to legacy/"
```

---

### Task 2: `@wecom/shared` package skeleton with vitest

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/index.ts`, `packages/shared/test/smoke.test.ts`

**Interfaces:**
- Produces: import path `@wecom/shared` (ESM, `dist/index.js`), and subpath exports `@wecom/shared/schemas`, `@wecom/shared/format`.

- [ ] **Step 1: Write the smoke test**

`packages/shared/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('shared', () => {
  it('exposes a contract version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @wecom/shared test`
Expected: FAIL (package missing / VERSION undefined).

- [ ] **Step 3: Create the package**

`packages/shared/package.json`:
```json
{
  "name": "@wecom/shared",
  "version": "0.1.0",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": "./dist/index.js",
    "./schemas": "./dist/schemas/index.js",
    "./format": "./dist/format/index.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "vitest": "^2.1.1", "typescript": "^5.6.2" }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "compilerOptions": { "outDir": "dist", "rootDir": "src" }, "include": ["src"] }
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } });
```

`packages/shared/src/index.ts`:
```ts
export const VERSION = '0.1.0';
export * from './schemas/index.js';
export * from './permissions.js';
export * from './events.js';
export * from './format/index.js';
```

Create empty barrels so it compiles: `src/schemas/index.ts` (`export {};`), `src/permissions.ts` (`export {};`), `src/events.ts` (`export {};`), `src/format/index.ts` (`export {};`).

- [ ] **Step 4: Run the test**

Run: `pnpm install && pnpm --filter @wecom/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): package skeleton"
```

---

### Task 3: Common and content schemas

**Files:**
- Create: `packages/shared/src/schemas/common.ts`, `packages/shared/src/schemas/content.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Test: `packages/shared/test/content.test.ts`

**Interfaces:**
- Produces (exact exported names): `CategorySchema`, `Category`, `PrioritySchema`, `WaveSchema`, `DocumentKindSchema`, `DocumentStatusSchema`, `IdSchema`, `PaginationQuerySchema`, `paginated(itemSchema)`, `ErrorEnvelopeSchema`, `ActionSchema`, `OutcomeSchema`, `OutcomeKindSchema`, `BranchOptionSchema`, `BranchSchema`, `StepExtrasSchema`, `StepSchema`, `PhaseSchema`, `DocumentSchema`, `DocumentCardSchema`, `BlockSchema`, `CrmFieldSchema`, `CrmFieldStatusSchema`, `ScriptSchema`, `NoteSchema`, `VersionSchema`, `LinkTypeSchema`, `DocumentLinkSchema`, plus `z.infer` types with the same names minus `Schema` (e.g. `Document`, `Step`).

- [ ] **Step 1: Write the failing tests**

`packages/shared/test/content.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { DocumentSchema, StepSchema, paginated, DocumentCardSchema } from '../src/schemas/index.js';

const step = {
  key: 's1', num: '1', title: 'בדיקת חסימת גלישה בארץ',
  actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה "גלישה בארץ"' }],
  outcomes: [{ kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' }],
};

describe('content schemas', () => {
  it('accepts a minimal document', () => {
    const doc = DocumentSchema.parse({
      id: '11111111-1111-4111-8111-111111111111', slug: 'browsing', title: 'איטיות גלישה', description: '',
      category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7,
      phases: [{ id: 'p1', label: 'שלב 1 – מסנן', steps: [step] }],
      createdAt: '2025-06-12T00:00:00.000Z', updatedAt: '2025-06-12T00:00:00.000Z',
    });
    expect(doc.phases[0].steps[0].key).toBe('s1');
  });
  it('rejects an unknown category', () => {
    expect(() => StepSchema.parse({ ...step, key: '' })).toThrow();
    expect(DocumentSchema.safeParse({ category: 'x' }).success).toBe(false);
  });
  it('defaults optional step collections', () => {
    const s = StepSchema.parse({ key: 's9', num: '9', title: 'x' });
    expect(s.actions).toEqual([]);
    expect(s.outcomes).toEqual([]);
  });
  it('builds paginated schemas', () => {
    const P = paginated(DocumentCardSchema);
    expect(P.parse({ items: [], total: 0, page: 1, pageSize: 50 }).total).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/shared test`
Expected: FAIL (schemas not exported).

- [ ] **Step 3: Implement `common.ts`**

```ts
import { z } from 'zod';

export const CategorySchema = z.enum(['sim', 'tech', 'billing', 'plans', 'intl', 'ops']);
export type Category = z.infer<typeof CategorySchema>;
export const PrioritySchema = z.enum(['hh', 'h', 'm', 'l']);
export type Priority = z.infer<typeof PrioritySchema>;
export const WaveSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Wave = z.infer<typeof WaveSchema>;
export const DocumentKindSchema = z.enum(['steps', 'retention']);
export const DocumentStatusSchema = z.enum(['draft', 'review', 'published', 'partial', 'archived']);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const IdSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime();
export const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/);

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({ items: z.array(item), total: z.number().int().nonnegative(), page: z.number().int(), pageSize: z.number().int() });

export const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
```

- [ ] **Step 4: Implement `content.ts`**

```ts
import { z } from 'zod';
import { CategorySchema, DocumentKindSchema, DocumentStatusSchema, IdSchema, IsoDateSchema, PrioritySchema, SlugSchema, WaveSchema } from './common.js';

export const ActionSchema = z.object({ id: z.string().min(1), text: z.string() });
export type Action = z.infer<typeof ActionSchema>;

export const OutcomeKindSchema = z.enum(['ok', 'next', 'alert']);
export const OutcomeSchema = z.object({ kind: OutcomeKindSchema, text: z.string(), goto: z.string().optional() });
export type Outcome = z.infer<typeof OutcomeSchema>;

export const BranchOptionSchema = z.object({ kind: z.enum(['if', 'then']), label: z.string(), text: z.string(), goto: z.string().optional() });
export const BranchSchema = z.object({ q: z.string(), options: z.array(BranchOptionSchema).min(1) });
export type Branch = z.infer<typeof BranchSchema>;

/** Retention-document extras (signals, pillars, conversation stages, objection, principles). */
export const StepExtrasSchema = z.object({
  signals: z.array(z.object({ label: z.string(), tone: z.enum(['red', 'blue']).optional(), items: z.array(z.string()) })).optional(),
  pillars: z.array(z.object({ label: z.string(), text: z.string(), tone: z.enum(['ok', 'warn', 'red', 'gray']).optional() })).optional(),
  stages: z.array(z.object({ label: z.string(), script: z.string().optional(), actions: z.array(z.string()).optional() })).optional(),
  objection: z.object({ q: z.string(), a: z.string() }).optional(),
  principles: z.array(z.string()).optional(),
  icon: z.string().optional(),
});

export const StepSchema = z.object({
  key: z.string().min(1),          // stable within a document, e.g. "s11"
  num: z.string().min(1),          // display number, e.g. "1א"
  title: z.string(),
  description: z.string().optional(),
  hint: z.string().optional(),
  tone: z.enum(['alert']).optional(),
  blockId: IdSchema.optional(),
  blockRefs: z.array(IdSchema).default([]),
  script: z.string().optional(),
  sourceRef: z.string().optional(),   // "§4.11"
  deps: z.array(z.string()).default([]),
  actions: z.array(ActionSchema).default([]),
  outcomes: z.array(OutcomeSchema).default([]),
  branch: BranchSchema.optional(),
  extras: StepExtrasSchema.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const PhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(''),
  note: z.string().optional(),
  route: z.string().optional(),
  steps: z.array(StepSchema).default([]),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const DocumentSchema = z.object({
  id: IdSchema,
  slug: SlugSchema,
  code: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(''),
  category: CategorySchema,
  wave: WaveSchema,
  priority: PrioritySchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  currentVersion: z.number().int().nonnegative(),
  sourceId: IdSchema.nullable().optional(),
  sourceRef: z.string().optional(),
  phases: z.array(PhaseSchema),
  related: z.array(z.object({ documentId: IdSchema, why: z.string() })).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  createdBy: IdSchema.optional(),
  updatedBy: IdSchema.optional(),
  etag: z.string().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

/** Library card: what the list endpoint returns. */
export const DocumentCardSchema = DocumentSchema.pick({
  id: true, slug: true, title: true, description: true, category: true, wave: true, priority: true, kind: true, status: true, currentVersion: true, updatedAt: true,
}).extend({
  stepCount: z.number().int(),
  linksOut: z.number().int(),
  linksIn: z.number().int(),
  views: z.number().int(),
  crmFields: z.array(z.string()),
  hasSharedBlocks: z.boolean(),
  pinned: z.boolean(),
  authorName: z.string().optional(),
});
export type DocumentCard = z.infer<typeof DocumentCardSchema>;

export const BlockSchema = z.object({
  id: IdSchema,
  slug: SlugSchema,
  title: z.string().min(1),
  kind: z.enum(['step', 'script']),
  description: z.string().optional(),
  script: z.string().optional(),
  actions: z.array(ActionSchema).default([]),
  outcomes: z.array(OutcomeSchema).default([]),
  currentVersion: z.number().int().nonnegative(),
  updatedAt: IsoDateSchema,
  updatedBy: IdSchema.optional(),
});
export type Block = z.infer<typeof BlockSchema>;

export const CrmFieldStatusSchema = z.enum(['ok', 'renamed', 'new', 'retired']);
export const CrmFieldSchema = z.object({
  name: z.string().min(1),
  status: CrmFieldStatusSchema,
  renamedTo: z.string().optional(),
  path: z.string().default(''),
  effectiveFrom: IsoDateSchema.optional(),
  note: z.string().optional(),
  updatedAt: IsoDateSchema,
});
export type CrmField = z.infer<typeof CrmFieldSchema>;

export const ScriptSchema = z.object({ id: IdSchema, title: z.string().min(1), text: z.string(), tags: z.array(z.string()).default([]), updatedAt: IsoDateSchema });
export type Script = z.infer<typeof ScriptSchema>;

export const NoteSchema = z.object({
  id: IdSchema, documentId: IdSchema, stepKey: z.string().nullable(), authorId: IdSchema, authorName: z.string(),
  text: z.string().min(1), likes: z.number().int().nonnegative(), likedByMe: z.boolean().default(false), createdAt: IsoDateSchema,
});
export type Note = z.infer<typeof NoteSchema>;

export const VersionKindSchema = z.enum(['published', 'restore', 'system', 'sync']);
export const VersionSchema = z.object({
  documentId: IdSchema, version: z.number().int(), kind: VersionKindSchema, label: z.string(),
  authorId: IdSchema.nullable(), authorName: z.string(), createdAt: IsoDateSchema, suggestionId: IdSchema.nullable().optional(),
});
export type Version = z.infer<typeof VersionSchema>;

export const LinkTypeSchema = z.enum(['next', 'prerequisite', 'shares_block', 'same_field', 'derived_from_source', 'related', 'link']);
export const DocumentLinkSchema = z.object({
  fromDocumentId: IdSchema, fromStepKey: z.string().nullable(),
  toDocumentId: IdSchema.nullable(), toBlockId: IdSchema.nullable(), toFieldName: z.string().nullable(), toSourceId: IdSchema.nullable(),
  type: LinkTypeSchema, origin: z.enum(['explicit', 'detected']),
});
export type DocumentLink = z.infer<typeof DocumentLinkSchema>;
```

`packages/shared/src/schemas/index.ts`:
```ts
export * from './common.js';
export * from './content.js';
```

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @wecom/shared test`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/shared && git commit -m "feat(shared): common and content schemas"
```

---

### Task 4: Pipeline schemas (sources, revisions, paragraphs, suggestions)

**Files:**
- Create: `packages/shared/src/schemas/pipeline.ts`
- Modify: `packages/shared/src/schemas/index.ts` (add `export * from './pipeline.js';`)
- Test: `packages/shared/test/pipeline.test.ts`

**Interfaces:**
- Produces: `RunSchema`, `ParagraphSchema`, `SourceKindSchema`, `SourceSchema`, `SourceRevisionSchema`, `SuggestionTypeSchema`, `SuggestionStatusSchema`, `SuggestionPayloadSchema`, `SuggestionSchema`, `ParagraphDiffSchema` and their inferred types.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { SuggestionSchema, ParagraphSchema } from '../src/schemas/index.js';

describe('pipeline schemas', () => {
  it('validates an update-step suggestion payload by type', () => {
    const ok = SuggestionSchema.safeParse({
      id: '22222222-2222-4222-8222-222222222222', sourceRevisionId: '33333333-3333-4333-8333-333333333333', anchor: '§4.8',
      type: 'update-step', targetDocumentId: '11111111-1111-4111-8111-111111111111', targetStepKey: 's8', targetBlockId: null,
      payload: { type: 'update-step', addActions: ['ודא שהלקוח מנותק מ-Wi-Fi'], branch: null, patch: {} },
      confidence: 0.96, rationale: 'ערך מספרי שונה', status: 'pending', title: 'סף Speedtest', createdAt: '2025-06-12T00:00:00.000Z',
    });
    expect(ok.success).toBe(true);
    const bad = SuggestionSchema.safeParse({ ...ok.data, payload: { type: 'new-card' } });
    expect(bad.success).toBe(false);
  });
  it('keeps tracked-change runs', () => {
    const p = ParagraphSchema.parse({ ref: '4.8', heading: 'בדיקת מהירות גלישה', runs: [{ t: 'מעל 5 מגה', del: true, author: 'ענבר' }, { t: 'מעל 6 מגה', add: true }] });
    expect(p.runs[0].del).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/shared test` — Expected: FAIL.

- [ ] **Step 3: Implement `pipeline.ts`**

```ts
import { z } from 'zod';
import { CategorySchema, IdSchema, IsoDateSchema, PrioritySchema, WaveSchema } from './common.js';
import { ActionSchema, BranchSchema, OutcomeSchema, PhaseSchema } from './content.js';

export const RunSchema = z.object({
  t: z.string(),
  add: z.boolean().optional(),
  del: z.boolean().optional(),
  chg: z.boolean().optional(),
  code: z.boolean().optional(),
  author: z.string().optional(),
  date: IsoDateSchema.optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const ParagraphSchema = z.object({
  ref: z.string(),                 // "4.8" or "A12"
  heading: z.string().optional(),
  level: z.number().int().min(1).max(6).optional(),
  runs: z.array(RunSchema),
  isNew: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  comments: z.array(z.object({ author: z.string(), text: z.string(), date: IsoDateSchema.optional() })).optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;
export const paragraphText = (p: Paragraph): string => p.runs.filter((r) => !r.del).map((r) => r.t).join('');

export const SourceKindSchema = z.enum(['docx', 'wordpress', 'json', 'csv', 'text']);
export const SourceSyncStateSchema = z.enum(['synced', 'pending', 'processing', 'error']);
export const SourceSchema = z.object({
  id: IdSchema, kind: SourceKindSchema, connectorId: IdSchema.nullable(), externalId: z.string().nullable(),
  title: z.string(), ext: z.string().optional(), mapping: z.record(z.string()).optional(),
  syncState: SourceSyncStateSchema, lastHash: z.string().nullable(), lastSyncedAt: IsoDateSchema.nullable(),
  linkedDocuments: z.number().int().default(0), pendingSuggestions: z.number().int().default(0), updatedAt: IsoDateSchema,
});
export type Source = z.infer<typeof SourceSchema>;

export const SourceRevisionSchema = z.object({
  id: IdSchema, sourceId: IdSchema, hash: z.string(), paragraphs: z.array(ParagraphSchema),
  importedAt: IsoDateSchema, importedBy: IdSchema.nullable(), accepted: z.boolean(), meta: z.record(z.unknown()).optional(),
});
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;

export const ParagraphDiffSchema = z.object({
  ref: z.string(), kind: z.enum(['added', 'removed', 'changed', 'same']),
  before: z.string().nullable(), after: z.string().nullable(), similarity: z.number().min(0).max(1),
});
export type ParagraphDiff = z.infer<typeof ParagraphDiffSchema>;

export const SuggestionTypeSchema = z.enum(['update-step', 'new-card', 'new-step', 'update-block', 'deprecate-step', 'field-alert']);
export type SuggestionType = z.infer<typeof SuggestionTypeSchema>;
export const SuggestionStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'applied']);

export const SuggestionPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update-step'), addActions: z.array(z.string()).default([]), replaceActions: z.array(ActionSchema).optional(), branch: BranchSchema.nullable().optional(), outcomes: z.array(OutcomeSchema).optional(), patch: z.record(z.unknown()).default({}) }),
  z.object({ type: z.literal('new-card'), title: z.string(), description: z.string().default(''), category: CategorySchema, wave: WaveSchema, priority: PrioritySchema, phases: z.array(PhaseSchema) }),
  z.object({ type: z.literal('new-step'), afterStepKey: z.string().nullable(), title: z.string(), actions: z.array(z.string()), outcomes: z.array(OutcomeSchema).default([]) }),
  z.object({ type: z.literal('update-block'), actions: z.array(ActionSchema), script: z.string().optional() }),
  z.object({ type: z.literal('deprecate-step'), reason: z.string() }),
  z.object({ type: z.literal('field-alert'), fieldName: z.string(), issue: z.enum(['unknown', 'renamed', 'retired']) }),
]);
export type SuggestionPayload = z.infer<typeof SuggestionPayloadSchema>;

export const SuggestionSchema = z.object({
  id: IdSchema, sourceRevisionId: IdSchema, anchor: z.string(), type: SuggestionTypeSchema, title: z.string(),
  targetDocumentId: IdSchema.nullable(), targetStepKey: z.string().nullable(), targetBlockId: IdSchema.nullable(),
  payload: SuggestionPayloadSchema, editedPayload: SuggestionPayloadSchema.nullable().optional(),
  confidence: z.number().min(0).max(1), rationale: z.string(), status: SuggestionStatusSchema,
  decidedBy: IdSchema.nullable().optional(), decidedAt: IsoDateSchema.nullable().optional(), appliedVersionId: IdSchema.nullable().optional(),
  createdAt: IsoDateSchema,
}).refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' });
export type Suggestion = z.infer<typeof SuggestionSchema>;
```

- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** — `git commit -am "feat(shared): pipeline schemas"` (after `git add packages/shared`).

---

### Task 5: Identity schemas, permissions catalogue, default roles

**Files:**
- Create: `packages/shared/src/schemas/identity.ts`, `packages/shared/src/permissions.ts`
- Modify: `packages/shared/src/schemas/index.ts` (add identity export)
- Test: `packages/shared/test/permissions.test.ts`

**Interfaces:**
- Produces: `PERMISSIONS` (readonly tuple), `Permission` type, `PermissionSchema`, `DEFAULT_ROLES: Record<'agent'|'editor'|'lead'|'admin', Permission[]>`, `hasPermission(perms: ReadonlySet<string>, p: Permission)`, `UserSourceSchema`, `UserSchema`, `RoleSchema`, `UserRoleSchema`, `SessionSchema`, `AuditEntrySchema`, `MeSchema`, `PreferencesSchema`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { PERMISSIONS, DEFAULT_ROLES, hasPermission, MeSchema } from '../src/index.js';

describe('permissions', () => {
  it('has exactly the catalogue from the spec', () => {
    expect([...PERMISSIONS]).toEqual([
      'docs.read', 'docs.create', 'docs.edit', 'docs.publish', 'docs.delete', 'docs.restore', 'blocks.edit', 'fields.edit', 'scripts.edit',
      'notes.write', 'notes.moderate', 'suggestions.review', 'suggestions.apply', 'sources.manage', 'connectors.manage',
      'users.manage', 'roles.manage', 'audit.read', 'system.admin',
    ]);
  });
  it('nests default roles', () => {
    expect(DEFAULT_ROLES.editor).toEqual(expect.arrayContaining(DEFAULT_ROLES.agent));
    expect(DEFAULT_ROLES.lead).toEqual(expect.arrayContaining(DEFAULT_ROLES.editor));
    expect(DEFAULT_ROLES.admin).toEqual([...PERMISSIONS]);
    expect(DEFAULT_ROLES.editor).not.toContain('docs.publish');
  });
  it('checks permissions', () => {
    expect(hasPermission(new Set(['docs.read']), 'docs.read')).toBe(true);
    expect(hasPermission(new Set(['docs.read']), 'docs.publish')).toBe(false);
  });
  it('validates /auth/me', () => {
    const me = MeSchema.parse({ user: { id: '11111111-1111-4111-8111-111111111111', subject: 'x', source: 'entra', email: 'a@b.c', displayName: 'ענבר ל.', initials: 'ע', active: true, lastLoginAt: null }, roles: ['editor'], permissions: ['docs.read'], categoryScopes: null, preferences: { theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false } });
    expect(me.permissions).toContain('docs.read');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `permissions.ts`**

```ts
export const PERMISSIONS = [
  'docs.read', 'docs.create', 'docs.edit', 'docs.publish', 'docs.delete', 'docs.restore', 'blocks.edit', 'fields.edit', 'scripts.edit',
  'notes.write', 'notes.moderate', 'suggestions.review', 'suggestions.apply', 'sources.manage', 'connectors.manage',
  'users.manage', 'roles.manage', 'audit.read', 'system.admin',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const agent: Permission[] = ['docs.read', 'notes.write'];
const editor: Permission[] = [...agent, 'docs.create', 'docs.edit', 'suggestions.review', 'scripts.edit'];
const lead: Permission[] = [...editor, 'docs.publish', 'docs.delete', 'docs.restore', 'blocks.edit', 'fields.edit', 'suggestions.apply', 'sources.manage', 'notes.moderate'];
export const DEFAULT_ROLES = { agent, editor, lead, admin: [...PERMISSIONS] } as const satisfies Record<string, readonly Permission[]>;
export type DefaultRoleName = keyof typeof DEFAULT_ROLES;

/** Permissions the admin role can never lose. */
export const ADMIN_LOCKED: Permission[] = ['roles.manage', 'users.manage'];

export const hasPermission = (perms: ReadonlySet<string>, p: Permission): boolean => perms.has(p);
```

- [ ] **Step 4: Implement `identity.ts`**

```ts
import { z } from 'zod';
import { IdSchema, IsoDateSchema, CategorySchema } from './common.js';
import { PERMISSIONS } from '../permissions.js';

export const PermissionSchema = z.enum(PERMISSIONS);
export const UserSourceSchema = z.enum(['entra', 'paloalto', 'local']);
export const UserSchema = z.object({
  id: IdSchema, subject: z.string(), source: UserSourceSchema, email: z.string().email().nullable(), displayName: z.string(),
  initials: z.string().max(2), active: z.boolean(), lastLoginAt: IsoDateSchema.nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const RoleSchema = z.object({ id: IdSchema, name: z.string().min(1), description: z.string().default(''), system: z.boolean(), permissions: z.array(PermissionSchema) });
export type Role = z.infer<typeof RoleSchema>;
export const UserRoleSchema = z.object({ userId: IdSchema, roleId: IdSchema, roleName: z.string(), categoryScope: z.array(CategorySchema).nullable(), grantedBy: IdSchema.nullable(), grantedAt: IsoDateSchema });
export const GroupMapSchema = z.object({ idpGroupId: z.string(), idpGroupName: z.string(), roleId: IdSchema });

export const SessionSchema = z.object({ id: IdSchema, userId: IdSchema, ip: z.string().nullable(), userAgent: z.string().nullable(), createdAt: IsoDateSchema, lastSeenAt: IsoDateSchema, expiresAt: IsoDateSchema, revokedAt: IsoDateSchema.nullable() });

export const AuditEntrySchema = z.object({
  id: IdSchema, actorId: IdSchema.nullable(), actorName: z.string().nullable(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(),
  before: z.unknown().nullable(), after: z.unknown().nullable(), ip: z.string().nullable(), requestId: z.string().nullable(), at: IsoDateSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const PreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).nullable().default(null),
  font: z.enum(['plex', 'rubik']).default('plex'),
  panel: z.boolean().default(true),
  callMode: z.boolean().default(true),
  sidebarExpanded: z.boolean().default(false),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const MeSchema = z.object({
  user: UserSchema, roles: z.array(z.string()), permissions: z.array(PermissionSchema),
  categoryScopes: z.array(CategorySchema).nullable(), preferences: PreferencesSchema,
});
export type Me = z.infer<typeof MeSchema>;
```

Add to `schemas/index.ts`: `export * from './identity.js';`

- [ ] **Step 5: Run tests** — Expected: PASS.
- [ ] **Step 6: Commit** — `git add packages/shared && git commit -m "feat(shared): identity schemas, permissions catalogue, default roles"`.

---

### Task 6: Events catalogue

**Files:**
- Create: `packages/shared/src/events.ts`
- Test: `packages/shared/test/events.test.ts`

**Interfaces:**
- Produces: `EVENTS` tuple, `EventName`, `EventPayloads` (typed map), `EventSchema` (zod discriminated union `{ name, payload, at }`), `makeEvent(name, payload)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { EVENTS, EventSchema, makeEvent } from '../src/index.js';

describe('events', () => {
  it('lists the spec names', () => {
    expect([...EVENTS]).toEqual(['document.published', 'document.updated', 'document.deleted', 'suggestion.created', 'suggestion.decided', 'sync.completed', 'sync.conflict', 'job.failed', 'system.status']);
  });
  it('builds and validates an event', () => {
    const e = makeEvent('document.published', { documentId: '11111111-1111-4111-8111-111111111111', version: 8, actorId: null });
    expect(EventSchema.parse(e).name).toBe('document.published');
    expect(EventSchema.safeParse({ name: 'document.published', payload: {}, at: e.at }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
import { z } from 'zod';
import { IdSchema, IsoDateSchema } from './schemas/common.js';

export const EVENTS = ['document.published', 'document.updated', 'document.deleted', 'suggestion.created', 'suggestion.decided', 'sync.completed', 'sync.conflict', 'job.failed', 'system.status'] as const;
export type EventName = (typeof EVENTS)[number];

const payloads = {
  'document.published': z.object({ documentId: IdSchema, version: z.number().int(), actorId: IdSchema.nullable() }),
  'document.updated': z.object({ documentId: IdSchema, actorId: IdSchema.nullable(), etag: z.string().optional() }),
  'document.deleted': z.object({ documentId: IdSchema, actorId: IdSchema.nullable(), restoredUntil: IsoDateSchema }),
  'suggestion.created': z.object({ suggestionId: IdSchema, sourceId: IdSchema, targetDocumentId: IdSchema.nullable(), type: z.string() }),
  'suggestion.decided': z.object({ suggestionId: IdSchema, status: z.enum(['accepted', 'rejected', 'applied', 'pending']), actorId: IdSchema.nullable() }),
  'sync.completed': z.object({ connectorId: IdSchema, imported: z.number().int(), pushed: z.number().int(), conflicts: z.number().int() }),
  'sync.conflict': z.object({ connectorId: IdSchema, documentId: IdSchema, externalId: z.string() }),
  'job.failed': z.object({ jobName: z.string(), jobId: z.string(), error: z.string() }),
  'system.status': z.object({ db: z.boolean(), model: z.boolean(), queue: z.number().int(), connectors: z.record(z.boolean()) }),
} as const;
export type EventPayloads = { [K in EventName]: z.infer<(typeof payloads)[K]> };

export const EventSchema = z.discriminatedUnion('name', EVENTS.map((name) => z.object({ name: z.literal(name), payload: payloads[name], at: IsoDateSchema })) as unknown as [z.ZodObject<{ name: z.ZodLiteral<EventName>; payload: z.ZodTypeAny; at: z.ZodString }>, ...z.ZodObject<{ name: z.ZodLiteral<EventName>; payload: z.ZodTypeAny; at: z.ZodString }>[]]);
export type Event = { [K in EventName]: { name: K; payload: EventPayloads[K]; at: string } }[EventName];

export const makeEvent = <K extends EventName>(name: K, payload: EventPayloads[K]): Extract<Event, { name: K }> =>
  ({ name, payload, at: new Date().toISOString() }) as Extract<Event, { name: K }>;
export const eventPayloadSchema = <K extends EventName>(name: K) => payloads[name];
```

- [ ] **Step 4: Run** — Expected: PASS. Then `pnpm --filter @wecom/shared typecheck` — Expected: no errors.
- [ ] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): events catalogue"`.

---

### Task 7: API request/response schemas for stage-1 routes

**Files:**
- Create: `packages/shared/src/schemas/api.ts`
- Modify: `packages/shared/src/schemas/index.ts` (add `export * from './api.js';`)
- Test: `packages/shared/test/api.test.ts`

**Interfaces:**
- Produces: `ListDocumentsQuerySchema`, `ListDocumentsResponseSchema`, `CreateDocumentBodySchema`, `PatchDocumentBodySchema`, `StructureBodySchema`, `PublishBodySchema`, `DiffQuerySchema`, `SearchQuerySchema`, `SearchResponseSchema`, `SearchHitSchema`, `TrashItemSchema`, `TrashListSchema`, `CreateNoteBodySchema`, `DraftBodySchema`, `RelatedDocSchema`, `HealthResponseSchema`, `UpsertBlockBodySchema`, `UpsertFieldBodySchema`, `UpsertScriptBodySchema`, `SuggestionDecisionBodySchema`, `AdminUserPatchSchema`, `RoleUpsertSchema`, `GroupMapPutSchema`, `AuditQuerySchema`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { ListDocumentsQuerySchema, SearchResponseSchema, StructureBodySchema } from '../src/schemas/index.js';

describe('api schemas', () => {
  it('coerces list query', () => {
    const q = ListDocumentsQuerySchema.parse({ category: 'intl', wave: '2', pinned: 'true', page: '2' });
    expect(q.wave).toBe(2); expect(q.pinned).toBe(true); expect(q.page).toBe(2); expect(q.pageSize).toBe(50);
  });
  it('requires at least one phase in a structure body', () => {
    expect(StructureBodySchema.safeParse({ phases: [] }).success).toBe(false);
  });
  it('groups search hits', () => {
    const r = SearchResponseSchema.parse({ groups: [{ type: 'documents', hits: [{ type: 'document', id: '11111111-1111-4111-8111-111111111111', title: 'x', snippet: 'x', meta: '', score: 1 }] }], total: 1, tookMs: 3, files: 1 });
    expect(r.groups[0].hits[0].type).toBe('document');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `api.ts`**

```ts
import { z } from 'zod';
import { CategorySchema, DocumentStatusSchema, IdSchema, IsoDateSchema, PaginationQuerySchema, PrioritySchema, WaveSchema, paginated } from './common.js';
import { ActionSchema, BlockSchema, CrmFieldStatusSchema, DocumentCardSchema, DocumentSchema, OutcomeSchema, PhaseSchema } from './content.js';
import { SuggestionPayloadSchema } from './pipeline.js';
import { PermissionSchema } from './identity.js';

const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

export const ListDocumentsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(), category: CategorySchema.optional(), wave: z.coerce.number().pipe(WaveSchema).optional(),
  priority: PrioritySchema.optional(), status: DocumentStatusSchema.optional(), pinned: bool.optional(), recent: bool.optional(),
  drafts: bool.optional(), updatedSince: IsoDateSchema.optional(), sort: z.enum(['wave', 'updated', 'title', 'views']).default('wave'),
});
export const ListDocumentsResponseSchema = paginated(DocumentCardSchema);

export const CreateDocumentBodySchema = DocumentSchema.pick({ title: true, description: true, category: true, wave: true, priority: true, kind: true }).extend({ slug: z.string().optional(), topicId: z.number().int().optional(), phases: z.array(PhaseSchema).optional() });
export const PatchDocumentBodySchema = DocumentSchema.pick({ title: true, description: true, category: true, wave: true, priority: true, code: true, sourceRef: true }).partial();
export const StructureBodySchema = z.object({ phases: z.array(PhaseSchema).min(1), related: DocumentSchema.shape.related.optional() });
export const PublishBodySchema = z.object({ label: z.string().min(1).max(200), markPartial: z.boolean().optional() });
export const DiffQuerySchema = z.object({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(0).optional() });
export const RelatedDocSchema = z.object({ documentId: IdSchema, title: z.string(), category: CategorySchema, why: z.string() });

export const SearchHitSchema = z.object({
  type: z.enum(['document', 'step', 'block', 'field', 'script', 'action']), id: z.string(), title: z.string(), snippet: z.string(), meta: z.string(),
  score: z.number(), documentId: IdSchema.optional(), stepKey: z.string().optional(), num: z.string().optional(), kbd: z.string().optional(),
});
export const SearchQuerySchema = z.object({ q: z.string().default(''), types: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });
export const SearchResponseSchema = z.object({ groups: z.array(z.object({ type: z.enum(['documents', 'steps', 'blocks', 'fields', 'scripts', 'actions']), hits: z.array(SearchHitSchema) })), total: z.number().int(), tookMs: z.number(), files: z.number().int() });

export const TrashItemSchema = z.object({ type: z.enum(['document', 'block', 'field', 'script']), id: z.string(), title: z.string(), meta: z.string(), deletedBy: z.string(), deletedAt: IsoDateSchema, purgeAt: IsoDateSchema, impact: z.object({ brokenLinks: z.number().int(), documents: z.array(z.object({ id: IdSchema, title: z.string() })) }) });
export const TrashListSchema = z.object({ items: z.array(TrashItemSchema) });

export const CreateNoteBodySchema = z.object({ stepKey: z.string().nullable().default(null), text: z.string().min(1).max(2000) });
export const DraftBodySchema = z.object({ payload: z.record(z.unknown()) });

export const UpsertBlockBodySchema = BlockSchema.pick({ title: true, kind: true, description: true, script: true }).extend({ actions: z.array(ActionSchema).default([]), outcomes: z.array(OutcomeSchema).default([]), slug: z.string().optional(), label: z.string().optional() });
export const UpsertFieldBodySchema = z.object({ name: z.string().min(1), status: CrmFieldStatusSchema, renamedTo: z.string().optional(), path: z.string().default(''), note: z.string().optional() });
export const UpsertScriptBodySchema = z.object({ title: z.string().min(1), text: z.string().min(1), tags: z.array(z.string()).default([]) });

export const SuggestionDecisionBodySchema = z.object({ editedPayload: SuggestionPayloadSchema.optional() });
export const SuggestionsQuerySchema = PaginationQuerySchema.extend({ status: z.enum(['pending', 'accepted', 'rejected', 'applied']).optional(), sourceId: IdSchema.optional() });

export const HealthResponseSchema = z.object({ ok: z.boolean(), db: z.boolean(), model: z.boolean().nullable(), queue: z.number().int().nullable(), version: z.string(), uptimeSec: z.number() });

export const AdminUserPatchSchema = z.object({ active: z.boolean().optional(), roles: z.array(z.object({ roleId: IdSchema, categoryScope: z.array(CategorySchema).nullable() })).optional() });
export const RoleUpsertSchema = z.object({ name: z.string().min(1).max(40), description: z.string().default(''), permissions: z.array(PermissionSchema) });
export const GroupMapPutSchema = z.object({ entries: z.array(z.object({ idpGroupId: z.string(), idpGroupName: z.string(), roleId: IdSchema })) });
export const AuditQuerySchema = PaginationQuerySchema.extend({ actorId: IdSchema.optional(), entityType: z.string().optional(), entityId: z.string().optional(), from: IsoDateSchema.optional(), to: IsoDateSchema.optional() });
```

- [ ] **Step 4: Run tests and typecheck** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): stage-1 API schemas"`.

---

### Task 8: Port the bidi formatter (`fmt`, `crmIn`, `stripFmt`)

**Files:**
- Create: `packages/shared/src/format/bidi.ts`, `packages/shared/src/format/index.ts`
- Test: `packages/shared/test/bidi.test.ts`
- Reference: `legacy/js/core.js` (functions `fmtPlain`, `KB.fmt`, `KB.crmChip`, `KB.stripFmt`, `KB.crmIn`)

**Interfaces:**
- Produces: `fmt(text: string, opts: FmtOptions): string` (HTML), `FmtOptions = { fields: FieldInfo[]; docs?: DocRef[]; noCrm?: boolean }`, `FieldInfo = { name: string; status: 'ok'|'renamed'|'new'|'retired'|'unknown'; path?: string; renamedTo?: string }`, `DocRef = { id: string; title: string; code?: string }`, `crmIn(text, fieldNames: string[]): string[]`, `stripFmt(text): string`, `escapeHtml(s): string`, `crmChip(field: FieldInfo): string`.

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { fmt, crmIn, stripFmt } from '../src/format/index.js';

const fields = [{ name: 'גלישה בארץ', status: 'ok' as const }, { name: 'sim block lbl', status: 'ok' as const }, { name: 'שירות נדידה', status: 'renamed' as const, renamedTo: 'שירותי נדידה' }];
const docs = [{ id: '11111111-1111-4111-8111-111111111111', title: 'אין גלישה בחו"ל', code: 'R-02' }];

describe('fmt', () => {
  it('isolates latin runs', () => {
    expect(fmt('ודא שה-APN מוגדר ל-WE', { fields })).toBe('ודא שה-<bdi class="lat" dir="ltr">APN</bdi> מוגדר ל-<bdi class="lat" dir="ltr">WE</bdi>');
  });
  it('renders CRM chips with status', () => {
    const html = fmt('פתח CRM ↗ שדה "שירות נדידה"', { fields });
    expect(html).toContain('class="crm rtl renamed"');
    expect(html).toContain('data-crm="שירות נדידה"');
  });
  it('renders bold, links and codes', () => {
    const html = fmt('המשך לפי [[doc:11111111-1111-4111-8111-111111111111|אין גלישה]] או **R-02**', { fields, docs });
    expect(html).toContain('<a class="doc-link" data-doc="11111111-1111-4111-8111-111111111111">אין גלישה</a>');
    expect(html).toContain('<b><a class="doc-link"');
  });
  it('escapes html', () => {
    expect(fmt('<script>', { fields })).toBe('&lt;<bdi class="lat" dir="ltr">script</bdi>&gt;');
  });
  it('skips chips when noCrm', () => {
    expect(fmt('גלישה בארץ', { fields, noCrm: true })).toBe('גלישה בארץ');
  });
});
describe('crmIn / stripFmt', () => {
  it('finds longest names first', () => {
    expect(crmIn('שוב עריכה ← sim block lbl ← שמור', fields.map((f) => f.name))).toEqual(['sim block lbl']);
  });
  it('strips markup', () => {
    expect(stripFmt('**x** [[doc:abc|y]]')).toBe('x y');
  });
});
```

- [ ] **Step 2: Run** — Expected: FAIL.

- [ ] **Step 3: Implement `bidi.ts`** (a faithful TypeScript port of the legacy functions; `fields`/`docs` are passed in instead of read from globals)

```ts
export type FieldStatus = 'ok' | 'renamed' | 'new' | 'retired' | 'unknown';
export interface FieldInfo { name: string; status: FieldStatus; path?: string; renamedTo?: string }
export interface DocRef { id: string; title: string; code?: string }
export interface FmtOptions { fields: FieldInfo[]; docs?: DocRef[]; noCrm?: boolean }

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);

const LATIN_RE = /[A-Za-z][A-Za-z0-9+\-/.]*(?:[ ][A-Za-z0-9+\-/.]+)*|\d+(?:[.:]\d+)+|\d+s\b/g;
const CODE_RE = /\b([RMOE]-\d{2}|T-\d{2})\b/g;
const LINK_RE = /\[\[doc:([\w-]+)(?:\|([^\]]+))?\]\]/;
const BOLD_RE = /\*\*([^*]+)\*\*/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function fmtPlain(text: string): string {
  let out = '', last = 0; const s = String(text); LATIN_RE.lastIndex = 0; let m: RegExpExecArray | null;
  while ((m = LATIN_RE.exec(s))) {
    out += escapeHtml(s.slice(last, m.index));
    const tok = m[0];
    if (/^[A-Za-z]$/.test(tok) && !/[A-Za-z]/.test(s[m.index + 1] ?? '')) out += escapeHtml(tok);
    else out += '<bdi class="lat" dir="ltr">' + escapeHtml(tok) + '</bdi>';
    last = m.index + tok.length;
  }
  return out + escapeHtml(s.slice(last));
}

export function crmChip(field: FieldInfo, extra?: string): string {
  const isLatin = /^[A-Za-z]/.test(field.name);
  const title = field.status === 'renamed' ? 'שדה CRM · שונה שם ל-' + (field.renamedTo ?? '') : field.status === 'new' ? 'שדה CRM · חדש' : field.status === 'unknown' ? 'שדה CRM · לא מוכר' : 'שדה CRM · תקין · ' + (field.path ?? '');
  return `<span class="crm ${isLatin ? '' : 'rtl '}${field.status}" data-crm="${escapeHtml(field.name)}" title="${escapeHtml(title)}">${escapeHtml(field.name)}<i class="dot"></i></span>` + (extra ? `<span class="fnote">${escapeHtml(extra)}</span>` : '');
}

export function crmIn(text: string, fieldNames: string[]): string[] {
  const t = String(text ?? '');
  return [...fieldNames].sort((a, b) => b.length - a.length).filter((n) => t.includes(n));
}

export const stripFmt = (t: unknown): string => String(t ?? '').replace(/\*\*/g, '').replace(/\[\[doc:[\w-]+(?:\|([^\]]+))?\]\]/g, (_m, l: string | undefined) => l ?? '');

type Part = { kind: 'text'; t: string } | { kind: 'bold' | 'crm' | 'link' | 'code'; m: RegExpExecArray };

export function fmt(text: unknown, opts: FmtOptions): string {
  if (text == null) return '';
  const s = String(text);
  const names = opts.fields.map((f) => f.name).sort((a, b) => b.length - a.length);
  const nameRe = names.length && !opts.noCrm ? new RegExp('(' + names.map(escapeRe).join('|') + ')') : null;
  const parts: Part[] = []; let rest = s;
  while (rest.length) {
    const cands: { i: number; len: number; kind: Part['kind']; m: RegExpExecArray }[] = [];
    const lm = LINK_RE.exec(rest); if (lm) cands.push({ i: lm.index, len: lm[0].length, kind: 'link', m: lm });
    const bm = BOLD_RE.exec(rest); if (bm) cands.push({ i: bm.index, len: bm[0].length, kind: 'bold', m: bm });
    if (nameRe) { const cm = nameRe.exec(rest); if (cm) cands.push({ i: cm.index, len: cm[0].length, kind: 'crm', m: cm }); }
    CODE_RE.lastIndex = 0; const km = CODE_RE.exec(rest); if (km) cands.push({ i: km.index, len: km[0].length, kind: 'code', m: km });
    if (!cands.length) { parts.push({ kind: 'text', t: rest }); break; }
    cands.sort((a, b) => a.i - b.i || b.len - a.len);
    const c = cands[0];
    if (c.i > 0) parts.push({ kind: 'text', t: rest.slice(0, c.i) });
    parts.push({ kind: c.kind, m: c.m } as Part);
    rest = rest.slice(c.i + c.len);
  }
  const docs = opts.docs ?? [];
  return parts.map((p) => {
    if (p.kind === 'text') return fmtPlain(p.t);
    if (p.kind === 'bold') return '<b>' + fmt(p.m[1], opts) + '</b>';
    if (p.kind === 'crm') { const f = opts.fields.find((x) => x.name === p.m[1]) ?? { name: p.m[1], status: 'unknown' as const }; return crmChip(f); }
    if (p.kind === 'link') { const d = docs.find((x) => x.id === p.m[1]); const label = p.m[2] ?? d?.title ?? p.m[1]; return `<a class="doc-link" data-doc="${escapeHtml(p.m[1])}">${escapeHtml(label)}</a>`; }
    const d = docs.find((x) => x.code === p.m[1]);
    const code = `<bdi class="lat" dir="ltr">${escapeHtml(p.m[1])}</bdi>`;
    return d ? `<a class="doc-link" data-doc="${escapeHtml(d.id)}">${code}</a>` : code;
  }).join('');
}
```

`packages/shared/src/format/index.ts`:
```ts
export * from './bidi.js';
export * from './diff.js';
export * from './links.js';
```
(Create `diff.ts` and `links.ts` with `export {};` for now; Tasks 9–10 fill them.)

- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): bidi formatter port"`.

---

### Task 9: Word-level diff

**Files:**
- Create: `packages/shared/src/format/diff.ts`
- Test: `packages/shared/test/diff.test.ts`
- Reference: `legacy/js/core.js` `KB.wordDiff`

**Interfaces:**
- Produces: `wordDiff(a: string, b: string): { a: string; b: string; changed: boolean }` (HTML with `<del class="d">`/`<ins class="d">`), `similarity(a: string, b: string): number` (0..1, Dice coefficient on word bigrams; used by L5 paragraph alignment).

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { wordDiff, similarity } from '../src/format/index.js';

describe('wordDiff', () => {
  it('marks changed words', () => {
    const d = wordDiff('מעל 5 מגה → תקין', 'מעל 6 מגה → תקין');
    expect(d.changed).toBe(true);
    expect(d.a).toContain('<del class="d">5</del>');
    expect(d.b).toContain('<ins class="d">6</ins>');
  });
  it('reports no change', () => { expect(wordDiff('a b', 'a b').changed).toBe(false); });
  it('escapes html', () => { expect(wordDiff('<b>', '<b>').a).toBe('&lt;b&gt;'); });
});
describe('similarity', () => {
  it('is 1 for identical, low for unrelated', () => {
    expect(similarity('בקש מהלקוח להריץ Speedtest', 'בקש מהלקוח להריץ Speedtest')).toBe(1);
    expect(similarity('בקש מהלקוח להריץ Speedtest', 'החלפת SIM פיזי')).toBeLessThan(0.2);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
import { escapeHtml, stripFmt } from './bidi.js';

export function wordDiff(a: string, b: string): { a: string; b: string; changed: boolean } {
  const A = stripFmt(a).split(/(\s+)/).filter((x) => x.length), B = stripFmt(b).split(/(\s+)/).filter((x) => x.length);
  const n = A.length, m = B.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0, j = 0; const outA: string[] = [], outB: string[] = [];
  while (i < n && j < m) {
    if (A[i] === B[j]) { outA.push(escapeHtml(A[i])); outB.push(escapeHtml(B[j])); i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) outA.push(`<del class="d">${escapeHtml(A[i++])}</del>`);
    else outB.push(`<ins class="d">${escapeHtml(B[j++])}</ins>`);
  }
  while (i < n) outA.push(`<del class="d">${escapeHtml(A[i++])}</del>`);
  while (j < m) outB.push(`<ins class="d">${escapeHtml(B[j++])}</ins>`);
  return { a: outA.join(''), b: outB.join(''), changed: outA.some((x) => x.startsWith('<del')) || outB.some((x) => x.startsWith('<ins')) };
}

const bigrams = (s: string): Map<string, number> => {
  const w = stripFmt(s).toLowerCase().split(/\s+/).filter(Boolean); const m = new Map<string, number>();
  if (w.length === 1) m.set(w[0], 1);
  for (let i = 0; i < w.length - 1; i++) { const k = w[i] + ' ' + w[i + 1]; m.set(k, (m.get(k) ?? 0) + 1); }
  return m;
};
export function similarity(a: string, b: string): number {
  const A = bigrams(a), B = bigrams(b); if (!A.size && !B.size) return 1; if (!A.size || !B.size) return 0;
  let inter = 0; for (const [k, v] of A) inter += Math.min(v, B.get(k) ?? 0);
  const sizeA = [...A.values()].reduce((x, y) => x + y, 0), sizeB = [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / (sizeA + sizeB);
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): word diff and similarity"`.

---

### Task 10: Link and field detection (`links.ts`)

**Files:**
- Create: `packages/shared/src/format/links.ts`
- Test: `packages/shared/test/links.test.ts`
- Reference: `legacy/js/core.js` `KB.stepText`, `KB.docLinksOut`, `KB.docCrm`

**Interfaces:**
- Produces: `stepText(step: Step, block?: Block | null): string`, `detectFieldRefs(doc: Document, fieldNames: string[], blocks: Map<string, Block>): { stepKey: string; fieldName: string }[]`, `detectLinks(doc: Document, docs: DocRef[], blocks: Map<string, Block>): DocumentLink[]` (types `link`, `shares_block`, `next` from `goto` are within-document so excluded; `link` for `[[doc:]]` and codes; `related` for `doc.related`).

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { detectFieldRefs, detectLinks, stepText } from '../src/format/index.js';
import type { Document } from '../src/schemas/index.js';

const D1 = '11111111-1111-4111-8111-111111111111', D2 = '22222222-2222-4222-8222-222222222222';
const doc = {
  id: D1, slug: 'a', title: 'a', description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps', status: 'published', currentVersion: 1,
  related: [{ documentId: D2, why: 'x' }], createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  phases: [{ id: 'p1', label: '', steps: [
    { key: 's1', num: '1', title: 'x', actions: [{ id: 'a', text: 'פתח CRM ↗ שדה "גלישה בארץ" ואז [[doc:' + D2 + ']]' }], outcomes: [], blockRefs: [], deps: [] },
    { key: 's2', num: '2', title: 'y', actions: [{ id: 'b', text: 'עבור למסלול R-02' }], outcomes: [], blockRefs: [], deps: [] },
  ] }],
} as unknown as Document;

describe('links', () => {
  it('detects field refs per step', () => {
    expect(detectFieldRefs(doc, ['גלישה בארץ', 'APN'], new Map())).toEqual([{ stepKey: 's1', fieldName: 'גלישה בארץ' }]);
  });
  it('detects outgoing links by token, code and related', () => {
    const links = detectLinks(doc, [{ id: D2, title: 'b', code: 'R-02' }], new Map());
    expect(links.map((l) => [l.fromStepKey, l.toDocumentId, l.type])).toEqual([['s1', D2, 'link'], ['s2', D2, 'link'], [null, D2, 'related']]);
  });
  it('flattens step text', () => { expect(stepText(doc.phases[0].steps[0])).toContain('גלישה בארץ'); });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
import type { Block, Document, DocumentLink, Step } from '../schemas/index.js';
import { crmIn } from './bidi.js';
import type { DocRef } from './bidi.js';

const CODE_RE = /\b([RMOE]-\d{2}|T-\d{2})\b/g;
const LINK_RE = /\[\[doc:([\w-]+)/g;

export function stepText(step: Step, block?: Block | null): string {
  const actions = block?.actions ?? step.actions;
  const script = step.script ?? block?.script ?? '';
  const parts = [step.title, step.description ?? '', ...actions.map((a) => a.text), script];
  if (step.branch) parts.push(step.branch.q, ...step.branch.options.map((o) => o.label + ' ' + o.text));
  parts.push(...step.outcomes.map((o) => o.text));
  const ex = step.extras;
  if (ex) {
    (ex.stages ?? []).forEach((st) => parts.push(st.label, st.script ?? '', ...(st.actions ?? [])));
    (ex.signals ?? []).forEach((g) => parts.push(...g.items));
    if (ex.objection) parts.push(ex.objection.q, ex.objection.a);
    parts.push(...(ex.principles ?? []), ...(ex.pillars ?? []).map((p) => p.label + ' ' + p.text));
  }
  return parts.filter(Boolean).join(' · ');
}

const allSteps = (doc: Document): Step[] => doc.phases.flatMap((p) => p.steps);

export function detectFieldRefs(doc: Document, fieldNames: string[], blocks: Map<string, Block>) {
  const out: { stepKey: string; fieldName: string }[] = [];
  for (const s of allSteps(doc)) for (const f of crmIn(stepText(s, s.blockId ? blocks.get(s.blockId) : null), fieldNames)) out.push({ stepKey: s.key, fieldName: f });
  return out;
}

export function detectLinks(doc: Document, docs: DocRef[], blocks: Map<string, Block>): DocumentLink[] {
  const out: DocumentLink[] = [];
  const base = { fromDocumentId: doc.id, toBlockId: null, toFieldName: null, toSourceId: null, origin: 'detected' as const };
  for (const s of allSteps(doc)) {
    const t = stepText(s, s.blockId ? blocks.get(s.blockId) : null);
    const seen = new Set<string>();
    for (const m of t.matchAll(LINK_RE)) if (m[1] !== doc.id && docs.some((d) => d.id === m[1])) seen.add(m[1]);
    for (const m of t.matchAll(CODE_RE)) { const d = docs.find((x) => x.code === m[1]); if (d && d.id !== doc.id) seen.add(d.id); }
    for (const id of seen) out.push({ ...base, fromStepKey: s.key, toDocumentId: id, type: 'link' });
    if (s.blockId) out.push({ ...base, fromStepKey: s.key, toDocumentId: null, toBlockId: s.blockId, type: 'shares_block' });
  }
  for (const r of doc.related) if (r.documentId !== doc.id) out.push({ ...base, fromStepKey: null, toDocumentId: r.documentId, type: 'related', origin: 'explicit' });
  return out;
}
```

- [ ] **Step 4: Run + typecheck** — PASS. **Step 5: Commit** — `git add packages/shared && git commit -m "feat(shared): field and link detection"`.

---

### Task 11: Connector contract package

**Files:**
- Create: `packages/connectors/package.json`, `packages/connectors/tsconfig.json`, `packages/connectors/vitest.config.ts`, `packages/connectors/src/contract.ts`, `packages/connectors/src/index.ts`, `packages/connectors/src/registry.ts`
- Test: `packages/connectors/test/contract.test.ts`

**Interfaces:**
- Produces:
```ts
interface ConnectorInfo { id: string; name: string; capabilities: { read: boolean; write: boolean; webhooks: boolean; identity: boolean } }
interface RemoteItem { externalId: string; title: string; hash: string; updatedAt: string; kind: string; url?: string }
interface SourceContent { title: string; paragraphs: Paragraph[]; raw?: string; hash: string; meta?: Record<string, unknown> }
interface LibraryContent { document: Document; html: string; blocks: Block[] }
interface RemoteRef { externalId: string; url?: string; hash: string; updatedAt: string }
interface RemoteChange { externalId: string; kind: 'created' | 'updated' | 'deleted'; at: string }
interface Connector<C = unknown> { describe(): ConnectorInfo; configSchema: ZodTypeAny; testConnection(config: C): Promise<{ ok: boolean; message: string }>; listRemote(config: C, since?: string): Promise<RemoteItem[]>; fetch(config: C, externalId: string): Promise<SourceContent>; push(config: C, externalId: string | null, content: LibraryContent): Promise<RemoteRef>; parseWebhook?(config: C, headers: Record<string,string>, body: unknown): Promise<RemoteChange[]>; mapIdentity?(config: C, subject: string): Promise<{ email: string; groups: string[] } | null> }
class ConnectorRegistry { register(c: Connector): void; get(id: string): Connector; list(): ConnectorInfo[] }
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry, type Connector } from '../src/index.js';

const fake: Connector<{ url: string }> = {
  describe: () => ({ id: 'fake', name: 'Fake', capabilities: { read: true, write: false, webhooks: false, identity: false } }),
  configSchema: z.object({ url: z.string().url() }),
  testConnection: async () => ({ ok: true, message: 'ok' }),
  listRemote: async () => [{ externalId: '1', title: 't', hash: 'h', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'post' }],
  fetch: async () => ({ title: 't', paragraphs: [{ ref: '1', runs: [{ t: 'x' }] }], hash: 'h' }),
  push: async () => { throw new Error('read-only'); },
};

describe('ConnectorRegistry', () => {
  it('registers and lists connectors', () => {
    const r = new ConnectorRegistry(); r.register(fake);
    expect(r.list().map((c) => c.id)).toEqual(['fake']);
    expect(r.get('fake').describe().name).toBe('Fake');
    expect(() => r.get('nope')).toThrow(/unknown connector/);
    expect(() => r.register(fake)).toThrow(/already registered/);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`package.json` (name `@wecom/connectors`, deps `@wecom/shared: workspace:*`, `zod`), tsconfig and vitest config identical in shape to Task 2.

`src/contract.ts`:
```ts
import type { ZodTypeAny } from 'zod';
import type { Block, Document, Paragraph } from '@wecom/shared';

export interface ConnectorInfo { id: string; name: string; capabilities: { read: boolean; write: boolean; webhooks: boolean; identity: boolean } }
export interface RemoteItem { externalId: string; title: string; hash: string; updatedAt: string; kind: string; url?: string }
export interface SourceContent { title: string; paragraphs: Paragraph[]; raw?: string; hash: string; meta?: Record<string, unknown> }
export interface LibraryContent { document: Document; html: string; blocks: Block[] }
export interface RemoteRef { externalId: string; url?: string; hash: string; updatedAt: string }
export interface RemoteChange { externalId: string; kind: 'created' | 'updated' | 'deleted'; at: string }

export interface Connector<C = unknown> {
  describe(): ConnectorInfo;
  configSchema: ZodTypeAny;
  testConnection(config: C): Promise<{ ok: boolean; message: string }>;
  listRemote(config: C, since?: string): Promise<RemoteItem[]>;
  fetch(config: C, externalId: string): Promise<SourceContent>;
  push(config: C, externalId: string | null, content: LibraryContent): Promise<RemoteRef>;
  parseWebhook?(config: C, headers: Record<string, string>, body: unknown): Promise<RemoteChange[]>;
  mapIdentity?(config: C, subject: string): Promise<{ email: string; groups: string[] } | null>;
}
```

`src/registry.ts`:
```ts
import type { Connector, ConnectorInfo } from './contract.js';
export class ConnectorRegistry {
  private map = new Map<string, Connector<unknown>>();
  register(c: Connector<never>): void { const id = c.describe().id; if (this.map.has(id)) throw new Error(`connector already registered: ${id}`); this.map.set(id, c as Connector<unknown>); }
  get(id: string): Connector<unknown> { const c = this.map.get(id); if (!c) throw new Error(`unknown connector: ${id}`); return c; }
  list(): ConnectorInfo[] { return [...this.map.values()].map((c) => c.describe()); }
}
```
`src/index.ts`: `export * from './contract.js'; export * from './registry.js';`

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add packages/connectors && git commit -m "feat(connectors): connector contract and registry"`.

---

### Task 12: Model contract package with rule-based fallback

**Files:**
- Create: `packages/model/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/contract.ts`, `src/rules.ts`, `src/index.ts`
- Test: `packages/model/test/rules.test.ts`

**Interfaces:**
- Produces:
```ts
interface ProposalContext { source: { id: string; title: string }; diffs: ParagraphDiff[]; paragraphs: Paragraph[]; linkedSteps: { documentId: string; documentTitle: string; stepKey: string; stepNum: string; stepTitle: string; anchor: string; actions: string[]; blockId?: string }[]; fields: { name: string; status: string }[]; blocks: { id: string; title: string; actions: string[] }[] }
type ProposedSuggestion = Omit<Suggestion, 'id' | 'sourceRevisionId' | 'status' | 'createdAt' | 'decidedBy' | 'decidedAt' | 'appliedVersionId' | 'editedPayload'>
interface ModelClient { name: string; available(): Promise<boolean>; proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]>; embed?(text: string): Promise<number[]> }
class RuleBasedModel implements ModelClient  // deterministic fallback
```

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { RuleBasedModel, type ProposalContext } from '../src/index.js';

const D = '11111111-1111-4111-8111-111111111111';
const ctx: ProposalContext = {
  source: { id: 'src', title: 'נהלי תמיכה טכנית' },
  paragraphs: [],
  diffs: [
    { ref: '4.8', kind: 'changed', before: 'בקש מהלקוח להריץ Speedtest. מעל 5 מגה – תקין.', after: 'בקש מהלקוח להריץ Speedtest. מעל 6 מגה – תקין. יש לוודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.', similarity: 0.8 },
    { ref: '4.14', kind: 'added', before: null, after: 'בעיות גלישה ברכב. אם הלקוח מדווח על איטיות רק ברכב – בדוק Wi-Fi של הרכב. הנחה לכבות Wi-Fi ברכב.', similarity: 0 },
    { ref: '4.11', kind: 'changed', before: 'ריענון SIM. sim block lbl ← שמור.', after: 'ריענון SIM. sim block lbl ← שמור. ולחכות 90 שניות.', similarity: 0.9 },
  ],
  linkedSteps: [
    { documentId: D, documentTitle: 'איטיות גלישה', stepKey: 's8', stepNum: '8', stepTitle: 'בדיקת מהירות גלישה', anchor: '4.8', actions: ['בקש מהלקוח להריץ Speedtest'] },
    { documentId: D, documentTitle: 'איטיות גלישה', stepKey: 's11', stepNum: '11', stepTitle: 'ריענון SIM', anchor: '4.11', actions: [], blockId: 'blk-1' },
  ],
  fields: [{ name: 'sim block lbl', status: 'ok' }],
  blocks: [{ id: 'blk-1', title: 'ריענון SIM', actions: ['CRM ← sim block lbl ← שמור', 'בקש מהלקוח לאתחל מכשיר'] }],
};

describe('RuleBasedModel', () => {
  it('maps changed paragraph with a linked step to update-step, added paragraph to new-card, block-linked to update-block', async () => {
    const out = await new RuleBasedModel().proposeChanges(ctx);
    expect(out.map((s) => [s.anchor, s.type])).toEqual([['§4.8', 'update-step'], ['§4.14', 'new-card'], ['§4.11', 'update-block']]);
    const upd = out[0]; if (upd.payload.type !== 'update-step') throw new Error();
    expect(upd.payload.addActions).toEqual(['יש לוודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.']);
    expect(upd.targetStepKey).toBe('s8');
    expect(upd.confidence).toBeGreaterThan(0.5);
  });
  it('is always available', async () => { expect(await new RuleBasedModel().available()).toBe(true); });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`src/contract.ts`:
```ts
import type { Paragraph, ParagraphDiff, Suggestion } from '@wecom/shared';
export interface LinkedStep { documentId: string; documentTitle: string; stepKey: string; stepNum: string; stepTitle: string; anchor: string; actions: string[]; blockId?: string }
export interface ProposalContext {
  source: { id: string; title: string };
  diffs: ParagraphDiff[];
  paragraphs: Paragraph[];
  linkedSteps: LinkedStep[];
  fields: { name: string; status: string }[];
  blocks: { id: string; title: string; actions: string[] }[];
}
export type ProposedSuggestion = Omit<Suggestion, 'id' | 'sourceRevisionId' | 'status' | 'createdAt' | 'decidedBy' | 'decidedAt' | 'appliedVersionId' | 'editedPayload'>;
export interface ModelClient {
  name: string;
  available(): Promise<boolean>;
  proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]>;
  embed?(text: string): Promise<number[]>;
}
```

`src/rules.ts`:
```ts
import type { ModelClient, ProposalContext, ProposedSuggestion } from './contract.js';

const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length > 2);
const anchorOf = (ref: string) => (ref.startsWith('§') ? ref : '§' + ref);
const stripRef = (ref: string) => ref.replace(/^§/, '');

/** Deterministic fallback: no language model, only alignment + heuristics. */
export class RuleBasedModel implements ModelClient {
  name = 'rules';
  async available() { return true; }
  async proposeChanges(ctx: ProposalContext): Promise<ProposedSuggestion[]> {
    const out: ProposedSuggestion[] = [];
    for (const d of ctx.diffs) {
      if (d.kind === 'same') continue;
      const linked = ctx.linkedSteps.filter((s) => stripRef(s.anchor) === stripRef(d.ref));
      const anchor = anchorOf(d.ref);
      if (d.kind === 'removed' && linked.length) {
        for (const s of linked) out.push({ anchor, type: 'deprecate-step', title: 'הוצאה משימוש: ' + s.stepTitle, targetDocumentId: s.documentId, targetStepKey: s.stepKey, targetBlockId: null, payload: { type: 'deprecate-step', reason: 'הפסקה ' + d.ref + ' נמחקה במסמך המקור' }, confidence: 0.7, rationale: 'הפסקה נמחקה במקור.' });
        continue;
      }
      if (d.kind === 'added' || !linked.length) {
        const after = d.after ?? ''; const ss = sentences(after); const title = (ss[0] ?? after).replace(/[.:]$/, '').slice(0, 80);
        const steps = (ss.length > 1 ? ss.slice(1) : ss).slice(0, 8).map((s, i, arr) => ({ key: 's' + (i + 1), num: String(i + 1), title: s.length > 48 ? s.slice(0, 45) + '…' : s, actions: [{ id: 'a1', text: s }], outcomes: i === arr.length - 1 ? [{ kind: 'ok' as const, text: '✓ הסתדר – סיום' }] : [{ kind: 'next' as const, text: '→ המשך לשלב ' + (i + 2), goto: 's' + (i + 2) }], blockRefs: [], deps: [], sourceRef: anchor }));
        out.push({ anchor, type: 'new-card', title, targetDocumentId: null, targetStepKey: null, targetBlockId: null,
          payload: { type: 'new-card', title, description: after.slice(0, 120), category: /חו"ל|נדידה/.test(after) ? 'intl' : /חיוב|חשבונית/.test(after) ? 'billing' : /שימור|נטישה/.test(after) ? 'ops' : 'tech', wave: 2, priority: 'm', phases: [{ id: 'p1', label: 'שלבי הטיפול', steps }] },
          confidence: Math.min(0.85, 0.5 + steps.length * 0.05), rationale: 'פסקה חדשה ' + d.ref + ' ללא שלב מקושר.' });
        continue;
      }
      // changed + linked
      const beforeS = new Set(sentences(d.before ?? '')); const added = sentences(d.after ?? '').filter((s) => !beforeS.has(s));
      for (const s of linked) {
        if (s.blockId) {
          const b = ctx.blocks.find((x) => x.id === s.blockId);
          if (!b) continue;
          const actions = b.actions.map((t, i) => ({ id: 'b' + (i + 1), text: t }));
          if (added.length) actions[actions.length - 1] = { ...actions[actions.length - 1], text: actions[actions.length - 1].text + ' ' + added.join(' ') };
          out.push({ anchor, type: 'update-block', title: b.title + ': ' + (added[0] ?? 'עדכון'), targetDocumentId: s.documentId, targetStepKey: s.stepKey, targetBlockId: s.blockId, payload: { type: 'update-block', actions }, confidence: 0.75, rationale: 'הפסקה ממופה לבלוק משותף "' + b.title + '".' });
        } else {
          out.push({ anchor, type: 'update-step', title: s.stepTitle + ': ' + (added[0] ?? 'שינוי ניסוח'), targetDocumentId: s.documentId, targetStepKey: s.stepKey, targetBlockId: null, payload: { type: 'update-step', addActions: added, patch: {} }, confidence: added.length ? 0.8 : 0.55, rationale: 'הפסקה ' + d.ref + ' שונתה; משפיע על שלב ' + s.stepNum + ' ב"' + s.documentTitle + '".' });
        }
      }
    }
    return out;
  }
}
```
`src/index.ts`: `export * from './contract.js'; export * from './rules.js';`

- [ ] **Step 4: Run + typecheck** — PASS. **Step 5: Commit** — `git add packages/model && git commit -m "feat(model): model contract and rule-based fallback"`.

---

### Task 13: API skeleton (Fastify, zod provider, swagger, config, DB plugin, health route, OpenAPI dump)

**Files:**
- Create: `apps/api/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/config.ts`, `src/app.ts`, `src/server.ts`, `src/plugins/db.ts`, `src/routes/health.ts`, `src/openapi.ts`, `.env.example` (root `deploy/.env.example` is L1's; this one is for local dev)
- Test: `apps/api/test/health.test.ts`

**Interfaces:**
- Produces: `buildApp(opts?: { config?: Partial<Config>; pool?: Pool }): Promise<FastifyInstance>` (typed with `ZodTypeProvider`), decorators `app.db: Pool`, `app.config: Config`; route registration convention: each module exports `export default async function routes(app: FastifyInstance)` mounted under `/api/v1`; `Config` fields exactly as `.env.example`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { buildApp } from '../src/app.js';

describe('health', () => {
  it('reports db status without a database', async () => {
    const app = await buildApp({ config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' } });
    const res = await app.inject({ method: 'GET', url: '/api/v1/system/health' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(false); expect(body.db).toBe(false); expect(typeof body.version).toBe('string');
    await app.close();
  });
  it('serves openapi json', async () => {
    const app = await buildApp({ config: { DATABASE_URL: 'postgres://nobody:none@127.0.0.1:1/none' } });
    const res = await app.inject({ method: 'GET', url: '/api/docs/json' });
    expect(res.json().paths['/api/v1/system/health']).toBeDefined();
    await app.close();
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`apps/api/package.json`:
```json
{
  "name": "@wecom/api", "version": "0.1.0", "type": "module",
  "scripts": {
    "dev": "tsx watch src/server.ts", "build": "tsc -p tsconfig.json", "start": "node dist/server.js",
    "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run", "test:int": "RUN_INTEGRATION=1 vitest run",
    "migrate": "node-pg-migrate -m migrations -j js up", "migrate:down": "node-pg-migrate -m migrations -j js down",
    "openapi": "tsx src/openapi.ts"
  },
  "dependencies": {
    "@fastify/cookie": "^10.0.1", "@fastify/cors": "^10.0.1", "@fastify/swagger": "^9.1.0", "@wecom/connectors": "workspace:*", "@wecom/model": "workspace:*", "@wecom/shared": "workspace:*",
    "fastify": "^5.0.0", "fastify-type-provider-zod": "^4.0.1", "node-pg-migrate": "^7.6.1", "pg": "^8.13.0", "pg-boss": "^10.1.1", "pino": "^9.4.0", "zod": "^3.23.8"
  },
  "devDependencies": { "@testcontainers/postgresql": "^10.13.1", "@types/node": "^22.7.4", "@types/pg": "^8.11.10", "tsx": "^4.19.1", "typescript": "^5.6.2", "vitest": "^2.1.1" }
}
```

`src/config.ts`:
```ts
import { z } from 'zod';
export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),
  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please'),
  PUBLIC_URL: z.string().url().default('http://localhost:5173'),
  OIDC_ISSUER: z.string().optional(), OIDC_CLIENT_ID: z.string().optional(), OIDC_CLIENT_SECRET: z.string().optional(), OIDC_REDIRECT_URI: z.string().optional(),
  AUTH_FALLBACK: z.enum(['none', 'paloalto']).default('none'),
  PALOALTO_HOST: z.string().optional(), PALOALTO_API_KEY: z.string().optional(), PALOALTO_SUBNETS: z.string().default(''),
  MODEL_URL: z.string().default('http://localhost:11434'), MODEL_NAME: z.string().default('qwen2.5:3b-instruct-q4_K_M'),
  BACKUP_DIR: z.string().default('/backups'),
});
export type Config = z.infer<typeof ConfigSchema>;
export const loadConfig = (over: Partial<Config> = {}): Config => ConfigSchema.parse({ ...process.env, ...over });
```

`src/plugins/db.ts`:
```ts
import fp from 'fastify-plugin';
import pg from 'pg';
declare module 'fastify' { interface FastifyInstance { db: pg.Pool } }
export default fp(async (app, opts: { pool?: pg.Pool }) => {
  const pool = opts.pool ?? new pg.Pool({ connectionString: app.config.DATABASE_URL, max: 10 });
  app.decorate('db', pool);
  app.addHook('onClose', async () => { await pool.end(); });
});
```
(add `fastify-plugin` `^5.0.1` to dependencies)

`src/routes/health.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { HealthResponseSchema } from '@wecom/shared';
import { VERSION } from '@wecom/shared';
const started = Date.now();
export default async function routes(app: FastifyInstance) {
  app.get('/system/health', { schema: { tags: ['system'], response: { 200: HealthResponseSchema } } }, async () => {
    let db = false;
    try { await app.db.query('select 1'); db = true; } catch { db = false; }
    return { ok: db, db, model: null, queue: null, version: VERSION, uptimeSec: Math.round((Date.now() - started) / 1000) };
  });
}
```

`src/app.ts`:
```ts
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import cookie from '@fastify/cookie';
import swagger from '@fastify/swagger';
import { jsonSchemaTransform, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import type pg from 'pg';
import { loadConfig, type Config } from './config.js';
import dbPlugin from './plugins/db.js';
import health from './routes/health.js';
import { ErrorEnvelopeSchema } from '@wecom/shared';

declare module 'fastify' { interface FastifyInstance { config: Config } }

export async function buildApp(opts: { config?: Partial<Config>; pool?: pg.Pool } = {}): Promise<FastifyInstance> {
  const config = loadConfig(opts.config);
  const app = Fastify({ logger: config.NODE_ENV !== 'test', genReqId: () => crypto.randomUUID() }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  app.decorate('config', config);
  await app.register(cors, { origin: config.PUBLIC_URL, credentials: true });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(swagger, { openapi: { info: { title: 'wecom KB API', version: '1.0.0' }, servers: [{ url: '/' }] }, transform: jsonSchemaTransform });
  await app.register(dbPlugin, { pool: opts.pool });
  app.setErrorHandler((err, req, reply) => {
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    const body = ErrorEnvelopeSchema.parse({ code: (err as { code?: string }).code ?? (status === 500 ? 'INTERNAL' : 'ERROR'), message: status === 500 ? 'שגיאה פנימית' : err.message, details: status === 400 ? (err as { validation?: unknown }).validation : undefined, requestId: req.id });
    if (status === 500) req.log.error(err);
    reply.status(status).send(body);
  });
  await app.register(async (v1) => { await v1.register(health); }, { prefix: '/api/v1' });
  app.get('/api/docs/json', { schema: { hide: true } }, async () => app.swagger());
  return app;
}
```

`src/server.ts`:
```ts
import { buildApp } from './app.js';
const app = await buildApp();
await app.listen({ port: app.config.PORT, host: '0.0.0.0' });
```

`src/openapi.ts`:
```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { buildApp } from './app.js';
const app = await buildApp({ config: { DATABASE_URL: 'postgres://x:x@127.0.0.1:1/x', NODE_ENV: 'test' } });
await app.ready();
mkdirSync('../../docs/api', { recursive: true });
writeFileSync('../../docs/api/openapi.json', JSON.stringify(app.swagger(), null, 2) + '\n');
await app.close();
console.log('wrote docs/api/openapi.json');
```

`apps/api/.env.example`: every `Config` key with a dev value (`DATABASE_URL=postgres://kb:kb@localhost:5432/kb`, etc.).
`tsconfig.json`: extends base, `outDir dist`, `rootDir src`, `types: ["node"]`. `vitest.config.ts`: `include: ['test/**/*.test.ts']`, `testTimeout: 60000`.

- [ ] **Step 4: Run tests** — `pnpm install && pnpm --filter @wecom/api test` — PASS. Run `pnpm --filter @wecom/api openapi` — writes `docs/api/openapi.json`.
- [ ] **Step 5: Commit** — `git add apps/api docs/api && git commit -m "feat(api): fastify skeleton with zod, swagger, health, openapi dump"`.

---

### Task 14: Database migrations

**Files:**
- Create: `apps/api/migrations/0001_extensions.js`, `0002_identity.js`, `0003_content.js`, `0004_links_notes_prefs.js`, `0005_sources_pipeline.js`, `0006_sessions_audit.js`, `0007_search.js`
- Test: `apps/api/test/migrations.test.ts` (integration, testcontainers)

**Interfaces:**
- Produces: the tables and columns below, used verbatim by L2/L3/L5/L6. Column naming: snake_case; ids `uuid default gen_random_uuid()`; timestamps `timestamptz`.

- [ ] **Step 1: Failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('migrations', () => {
  let c: StartedPostgreSqlContainer; let pool: pg.Pool;
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    await runner({ databaseUrl: c.getConnectionUri(), dir: 'migrations', direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined });
  }, 120000);
  afterAll(async () => { await pool?.end(); await c?.stop(); });
  it('creates all stage-1 tables', async () => {
    const r = await pool.query("select table_name from information_schema.tables where table_schema='public' order by 1");
    const names = r.rows.map((x) => x.table_name);
    for (const t of ['users', 'roles', 'permissions', 'role_permissions', 'user_roles', 'groups_map', 'documents', 'document_versions', 'phases', 'steps', 'step_actions', 'step_outcomes', 'step_branches', 'step_branch_options', 'blocks', 'block_actions', 'block_outcomes', 'block_versions', 'crm_fields', 'step_field_refs', 'scripts', 'script_refs', 'document_links', 'notes', 'note_likes', 'pins', 'recent_views', 'drafts', 'user_preferences', 'sources', 'source_revisions', 'suggestions', 'sessions', 'audit_log']) expect(names, t).toContain(t);
  });
  it('seeds permissions and default roles', async () => {
    expect((await pool.query('select count(*)::int as n from permissions')).rows[0].n).toBe(19);
    expect((await pool.query("select name from roles order by name")).rows.map((r) => r.name)).toEqual(['admin', 'agent', 'editor', 'lead']);
  });
  it('rolls back cleanly', async () => {
    await runner({ databaseUrl: c.getConnectionUri(), dir: 'migrations', direction: 'down', count: 7, migrationsTable: 'pgmigrations', log: () => undefined });
    const r = await pool.query("select count(*)::int as n from information_schema.tables where table_schema='public' and table_name<>'pgmigrations'");
    expect(r.rows[0].n).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @wecom/api test:int` — FAIL (no migrations).

- [ ] **Step 3: Write migrations** (node-pg-migrate JS; each file exports `up`/`down`; `down` drops in reverse)

`0001_extensions.js`:
```js
exports.up = (pgm) => { pgm.sql('create extension if not exists pgcrypto'); pgm.sql('create extension if not exists vector'); pgm.sql('create extension if not exists pg_trgm'); };
exports.down = (pgm) => { pgm.sql('drop extension if exists pg_trgm'); pgm.sql('drop extension if exists vector'); };
```

`0002_identity.js`:
```js
const PERMISSIONS = ['docs.read','docs.create','docs.edit','docs.publish','docs.delete','docs.restore','blocks.edit','fields.edit','scripts.edit','notes.write','notes.moderate','suggestions.review','suggestions.apply','sources.manage','connectors.manage','users.manage','roles.manage','audit.read','system.admin'];
const agent = ['docs.read','notes.write'];
const editor = [...agent,'docs.create','docs.edit','suggestions.review','scripts.edit'];
const lead = [...editor,'docs.publish','docs.delete','docs.restore','blocks.edit','fields.edit','suggestions.apply','sources.manage','notes.moderate'];
const ROLES = { agent, editor, lead, admin: PERMISSIONS };
exports.up = (pgm) => {
  pgm.createTable('users', { id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') }, subject: { type: 'text', notNull: true }, source: { type: 'text', notNull: true, check: "source in ('entra','paloalto','local')" }, email: 'text', display_name: { type: 'text', notNull: true }, initials: { type: 'text', notNull: true, default: '' }, active: { type: 'boolean', notNull: true, default: true }, password_hash: 'text', last_login_at: 'timestamptz', created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.addConstraint('users', 'users_subject_source_unique', { unique: ['subject', 'source'] });
  pgm.createIndex('users', 'lower(email)', { name: 'users_email_idx' });
  pgm.createTable('roles', { id: { type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') }, name: { type: 'text', notNull: true, unique: true }, description: { type: 'text', notNull: true, default: '' }, system: { type: 'boolean', notNull: true, default: false }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.createTable('permissions', { name: { type: 'text', primaryKey: true }, resource: { type: 'text', notNull: true }, description: { type: 'text', notNull: true, default: '' } });
  pgm.createTable('role_permissions', { role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'cascade' }, permission: { type: 'text', notNull: true, references: 'permissions', onDelete: 'cascade' } }, { constraints: { primaryKey: ['role_id', 'permission'] } });
  pgm.createTable('user_roles', { user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' }, role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'cascade' }, category_scope: 'text[]', granted_by: { type: 'uuid', references: 'users' }, granted_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } }, { constraints: { primaryKey: ['user_id', 'role_id'] } });
  pgm.createTable('groups_map', { idp_group_id: { type: 'text', primaryKey: true }, idp_group_name: { type: 'text', notNull: true }, role_id: { type: 'uuid', notNull: true, references: 'roles', onDelete: 'cascade' } });
  for (const p of PERMISSIONS) pgm.sql(`insert into permissions(name, resource) values ('${p}', '${p.split('.')[0]}')`);
  for (const [name, perms] of Object.entries(ROLES)) { pgm.sql(`insert into roles(name, system) values ('${name}', true)`); for (const p of perms) pgm.sql(`insert into role_permissions(role_id, permission) select id, '${p}' from roles where name='${name}'`); }
};
exports.down = (pgm) => { pgm.dropTable('groups_map'); pgm.dropTable('user_roles'); pgm.dropTable('role_permissions'); pgm.dropTable('permissions'); pgm.dropTable('roles'); pgm.dropTable('users'); };
```

`0003_content.js`:
```js
const ts = (pgm) => ({ created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, created_by: { type: 'uuid', references: 'users' }, updated_by: { type: 'uuid', references: 'users' }, deleted_at: 'timestamptz', deleted_by: { type: 'uuid', references: 'users' } });
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('sources', { id: id(pgm), kind: { type: 'text', notNull: true, check: "kind in ('docx','wordpress','json','csv','text')" }, connector_id: 'uuid', external_id: 'text', title: { type: 'text', notNull: true }, ext: 'text', mapping: 'jsonb', sync_state: { type: 'text', notNull: true, default: 'synced' }, last_hash: 'text', last_synced_at: 'timestamptz', ...ts(pgm) });
  pgm.createTable('documents', { id: id(pgm), slug: { type: 'text', notNull: true, unique: true }, code: 'text', title: { type: 'text', notNull: true }, description: { type: 'text', notNull: true, default: '' }, category: { type: 'text', notNull: true, check: "category in ('sim','tech','billing','plans','intl','ops')" }, wave: { type: 'smallint', notNull: true, check: 'wave between 1 and 3' }, priority: { type: 'text', notNull: true, check: "priority in ('hh','h','m','l')" }, kind: { type: 'text', notNull: true, default: 'steps' }, status: { type: 'text', notNull: true, default: 'draft' }, current_version: { type: 'integer', notNull: true, default: 0 }, source_id: { type: 'uuid', references: 'sources' }, source_ref: 'text', topic_id: 'integer', related: { type: 'jsonb', notNull: true, default: '[]' }, etag: { type: 'text', notNull: true, default: pgm.func('gen_random_uuid()::text') }, search_vector: 'tsvector', embedding: 'vector(768)', ...ts(pgm) });
  pgm.createIndex('documents', ['category', 'wave']); pgm.createIndex('documents', 'search_vector', { method: 'gin' });
  pgm.createTable('document_versions', { id: id(pgm), document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, version: { type: 'integer', notNull: true }, snapshot: { type: 'jsonb', notNull: true }, author_id: { type: 'uuid', references: 'users' }, label: { type: 'text', notNull: true, default: '' }, kind: { type: 'text', notNull: true, default: 'published' }, suggestion_id: 'uuid', created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.addConstraint('document_versions', 'document_versions_unique', { unique: ['document_id', 'version'] });
  pgm.createTable('blocks', { id: id(pgm), slug: { type: 'text', notNull: true, unique: true }, title: { type: 'text', notNull: true }, kind: { type: 'text', notNull: true, default: 'step' }, description: 'text', script: 'text', current_version: { type: 'integer', notNull: true, default: 1 }, ...ts(pgm) });
  pgm.createTable('block_actions', { id: id(pgm), block_id: { type: 'uuid', notNull: true, references: 'blocks', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, text: { type: 'text', notNull: true } });
  pgm.createTable('block_outcomes', { id: id(pgm), block_id: { type: 'uuid', notNull: true, references: 'blocks', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, kind: { type: 'text', notNull: true }, text: { type: 'text', notNull: true }, goto_step_key: 'text' });
  pgm.createTable('block_versions', { id: id(pgm), block_id: { type: 'uuid', notNull: true, references: 'blocks', onDelete: 'cascade' }, version: { type: 'integer', notNull: true }, snapshot: { type: 'jsonb', notNull: true }, author_id: { type: 'uuid', references: 'users' }, label: { type: 'text', notNull: true, default: '' }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.createTable('phases', { id: id(pgm), document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, phase_key: { type: 'text', notNull: true }, label: { type: 'text', notNull: true, default: '' }, note: 'text', route: 'text' });
  pgm.createTable('steps', { id: id(pgm), phase_id: { type: 'uuid', notNull: true, references: 'phases', onDelete: 'cascade' }, document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, step_key: { type: 'text', notNull: true }, num: { type: 'text', notNull: true }, title: { type: 'text', notNull: true, default: '' }, description: 'text', hint: 'text', tone: 'text', block_id: { type: 'uuid', references: 'blocks' }, block_refs: { type: 'uuid[]', notNull: true, default: '{}' }, script: 'text', source_ref: 'text', deps: { type: 'text[]', notNull: true, default: '{}' }, extras: 'jsonb' });
  pgm.addConstraint('steps', 'steps_document_key_unique', { unique: ['document_id', 'step_key'] });
  pgm.createTable('step_actions', { id: id(pgm), step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, action_key: { type: 'text', notNull: true }, text: { type: 'text', notNull: true } });
  pgm.createTable('step_outcomes', { id: id(pgm), step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, kind: { type: 'text', notNull: true }, text: { type: 'text', notNull: true }, goto_step_key: 'text' });
  pgm.createTable('step_branches', { id: id(pgm), step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade', unique: true }, question: { type: 'text', notNull: true } });
  pgm.createTable('step_branch_options', { id: id(pgm), branch_id: { type: 'uuid', notNull: true, references: 'step_branches', onDelete: 'cascade' }, position: { type: 'integer', notNull: true }, kind: { type: 'text', notNull: true }, label: { type: 'text', notNull: true }, text: { type: 'text', notNull: true }, goto_step_key: 'text' });
  pgm.createTable('crm_fields', { name: { type: 'text', primaryKey: true }, status: { type: 'text', notNull: true, default: 'ok' }, renamed_to: 'text', path: { type: 'text', notNull: true, default: '' }, effective_from: 'timestamptz', note: 'text', ...ts(pgm) });
  pgm.createTable('step_field_refs', { step_id: { type: 'uuid', notNull: true, references: 'steps', onDelete: 'cascade' }, field_name: { type: 'text', notNull: true, references: 'crm_fields', onDelete: 'cascade' } }, { constraints: { primaryKey: ['step_id', 'field_name'] } });
  pgm.createTable('scripts', { id: id(pgm), title: { type: 'text', notNull: true }, text: { type: 'text', notNull: true }, tags: { type: 'text[]', notNull: true, default: '{}' }, ...ts(pgm) });
  pgm.createTable('script_refs', { script_id: { type: 'uuid', notNull: true, references: 'scripts', onDelete: 'cascade' }, document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, step_key: 'text' }, { constraints: { primaryKey: ['script_id', 'document_id'] } });
};
exports.down = (pgm) => { for (const t of ['script_refs','scripts','step_field_refs','crm_fields','step_branch_options','step_branches','step_outcomes','step_actions','steps','phases','block_versions','block_outcomes','block_actions','blocks','document_versions','documents','sources']) pgm.dropTable(t); };
```

`0004_links_notes_prefs.js`:
```js
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('document_links', { id: id(pgm), from_document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, from_step_key: 'text', to_document_id: { type: 'uuid', references: 'documents', onDelete: 'cascade' }, to_block_id: { type: 'uuid', references: 'blocks', onDelete: 'cascade' }, to_field_name: { type: 'text', references: 'crm_fields', onDelete: 'cascade' }, to_source_id: { type: 'uuid', references: 'sources', onDelete: 'cascade' }, type: { type: 'text', notNull: true }, origin: { type: 'text', notNull: true, default: 'detected' } });
  pgm.createIndex('document_links', 'to_document_id'); pgm.createIndex('document_links', 'from_document_id');
  pgm.createTable('notes', { id: id(pgm), document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, step_key: 'text', author_id: { type: 'uuid', notNull: true, references: 'users' }, text: { type: 'text', notNull: true }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, deleted_at: 'timestamptz' });
  pgm.createTable('note_likes', { note_id: { type: 'uuid', notNull: true, references: 'notes', onDelete: 'cascade' }, user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' } }, { constraints: { primaryKey: ['note_id', 'user_id'] } });
  pgm.createTable('pins', { user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' }, document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } }, { constraints: { primaryKey: ['user_id', 'document_id'] } });
  pgm.createTable('recent_views', { user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' }, document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, viewed_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, count: { type: 'integer', notNull: true, default: 1 } }, { constraints: { primaryKey: ['user_id', 'document_id'] } });
  pgm.createTable('drafts', { id: id(pgm), user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' }, document_id: { type: 'uuid', references: 'documents', onDelete: 'cascade' }, draft_key: { type: 'text', notNull: true }, payload: { type: 'jsonb', notNull: true }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.addConstraint('drafts', 'drafts_user_key_unique', { unique: ['user_id', 'draft_key'] });
  pgm.createTable('user_preferences', { user_id: { type: 'uuid', primaryKey: true, references: 'users', onDelete: 'cascade' }, prefs: { type: 'jsonb', notNull: true, default: '{}' } });
};
exports.down = (pgm) => { for (const t of ['user_preferences','drafts','recent_views','pins','note_likes','notes','document_links']) pgm.dropTable(t); };
```

`0005_sources_pipeline.js`:
```js
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('source_revisions', { id: id(pgm), source_id: { type: 'uuid', notNull: true, references: 'sources', onDelete: 'cascade' }, hash: { type: 'text', notNull: true }, raw: 'bytea', paragraphs: { type: 'jsonb', notNull: true }, meta: 'jsonb', imported_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, imported_by: { type: 'uuid', references: 'users' }, accepted: { type: 'boolean', notNull: true, default: false } });
  pgm.addConstraint('source_revisions', 'source_revisions_hash_unique', { unique: ['source_id', 'hash'] });
  pgm.createTable('suggestions', { id: id(pgm), source_revision_id: { type: 'uuid', notNull: true, references: 'source_revisions', onDelete: 'cascade' }, anchor: { type: 'text', notNull: true }, type: { type: 'text', notNull: true }, title: { type: 'text', notNull: true }, target_document_id: { type: 'uuid', references: 'documents', onDelete: 'set null' }, target_step_key: 'text', target_block_id: { type: 'uuid', references: 'blocks', onDelete: 'set null' }, payload: { type: 'jsonb', notNull: true }, edited_payload: 'jsonb', confidence: { type: 'numeric(4,3)', notNull: true }, rationale: { type: 'text', notNull: true, default: '' }, status: { type: 'text', notNull: true, default: 'pending' }, decided_by: { type: 'uuid', references: 'users' }, decided_at: 'timestamptz', applied_version_id: { type: 'uuid', references: 'document_versions' }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.createIndex('suggestions', ['status', 'created_at']);
};
exports.down = (pgm) => { pgm.dropTable('suggestions'); pgm.dropTable('source_revisions'); };
```

`0006_sessions_audit.js`:
```js
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('sessions', { id: id(pgm), user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' }, token_hash: { type: 'text', notNull: true, unique: true }, ip: 'text', user_agent: 'text', created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, last_seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, expires_at: { type: 'timestamptz', notNull: true }, revoked_at: 'timestamptz' });
  pgm.createIndex('sessions', ['user_id', 'expires_at']);
  pgm.createTable('audit_log', { id: id(pgm), actor_id: { type: 'uuid', references: 'users' }, action: { type: 'text', notNull: true }, entity_type: { type: 'text', notNull: true }, entity_id: 'text', before: 'jsonb', after: 'jsonb', ip: 'text', request_id: 'text', at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.createIndex('audit_log', ['entity_type', 'entity_id']); pgm.createIndex('audit_log', 'at');
};
exports.down = (pgm) => { pgm.dropTable('audit_log'); pgm.dropTable('sessions'); };
```

`0007_search.js` (trigger keeps `search_vector` in sync from title/description/step text; step text is recomputed by L2 on structure save into `documents.search_text`):
```js
exports.up = (pgm) => {
  pgm.addColumns('documents', { search_text: { type: 'text', notNull: true, default: '' } });
  pgm.sql(`create or replace function documents_search_vector_update() returns trigger as $$ begin new.search_vector := setweight(to_tsvector('simple', coalesce(new.title,'')), 'A') || setweight(to_tsvector('simple', coalesce(new.description,'')), 'B') || setweight(to_tsvector('simple', coalesce(new.search_text,'')), 'C'); return new; end $$ language plpgsql`);
  pgm.sql('create trigger documents_search_vector before insert or update of title, description, search_text on documents for each row execute function documents_search_vector_update()');
  pgm.createIndex('documents', 'title gin_trgm_ops', { method: 'gin', name: 'documents_title_trgm' });
};
exports.down = (pgm) => { pgm.dropIndex('documents', 'title', { name: 'documents_title_trgm' }); pgm.sql('drop trigger if exists documents_search_vector on documents'); pgm.sql('drop function if exists documents_search_vector_update'); pgm.dropColumns('documents', ['search_text']); };
```

- [ ] **Step 4: Run** — `pnpm --filter @wecom/api test:int` (Docker required) — PASS (3 tests).
- [ ] **Step 5: Commit** — `git add apps/api/migrations apps/api/test && git commit -m "feat(api): stage-1 database migrations"`.

---

### Task 15: Web skeleton with generated API client

**Files:**
- Create: `apps/web/package.json`, `tsconfig.json`, `vite.config.ts`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/api/client.ts`, `src/vite-env.d.ts`
- Test: `apps/web/test/client.test.ts`

**Interfaces:**
- Produces: `apps/web/src/api/schema.d.ts` generated from `docs/api/openapi.json` by `pnpm --filter @wecom/web generate:client`; `api` object from `openapi-fetch` typed by `paths`; base URL `/api/v1`, `credentials: 'include'`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { api } from '../src/api/client.js';

describe('api client', () => {
  it('exposes typed GET for health', async () => {
    // no server: expect a network error, not a type error
    await expect(api.GET('/system/health')).rejects.toBeTruthy();
    expect(typeof api.GET).toBe('function');
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`apps/web/package.json`:
```json
{
  "name": "@wecom/web", "version": "0.1.0", "type": "module",
  "scripts": { "dev": "vite", "build": "tsc -p tsconfig.json --noEmit && vite build", "typecheck": "tsc -p tsconfig.json --noEmit", "test": "vitest run", "generate:client": "openapi-typescript ../../docs/api/openapi.json -o src/api/schema.d.ts" },
  "dependencies": { "@tanstack/react-query": "^5.59.0", "@wecom/shared": "workspace:*", "openapi-fetch": "^0.12.2", "react": "^18.3.1", "react-dom": "^18.3.1", "react-router-dom": "^6.26.2" },
  "devDependencies": { "@types/react": "^18.3.10", "@types/react-dom": "^18.3.0", "@vitejs/plugin-react": "^4.3.2", "jsdom": "^25.0.1", "openapi-typescript": "^7.4.1", "typescript": "^5.6.2", "vite": "^5.4.8", "vitest": "^2.1.1" }
}
```

`src/api/client.ts`:
```ts
import createClient from 'openapi-fetch';
import type { paths } from './schema.js';
export const api = createClient<paths>({ baseUrl: '/api/v1', credentials: 'include' });
```
`vite.config.ts` (react plugin, `server.proxy['/api']` and `['/events']` → `http://localhost:3000`, `test: { environment: 'jsdom', include: ['test/**/*.test.ts?(x)'] }`), `index.html` (`<html lang="he" dir="rtl">`, root div, `<script type="module" src="/src/main.tsx">`), `src/main.tsx` (QueryClientProvider + BrowserRouter + `<App/>`), `src/App.tsx` (renders `wecom. מאגר ידע פנימי` placeholder heading; L4 replaces it).

- [ ] **Step 4: Generate client and run** — `pnpm install && pnpm --filter @wecom/web generate:client && pnpm --filter @wecom/web test` — PASS.
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): vite react skeleton with generated api client"`.

---

### Task 16: CI workflow with OpenAPI contract check and ADR 0001

**Files:**
- Create: `.github/workflows/ci.yml`, `docs/adr/0001-contracts-ownership.md`, `docs/adr/README.md`

- [ ] **Step 1: Write the workflow**

```yaml
name: ci
on: [push, pull_request]
jobs:
  build:
    runs-on: ubuntu-latest
    services:
      db:
        image: pgvector/pgvector:pg16
        env: { POSTGRES_USER: kb, POSTGRES_PASSWORD: kb, POSTGRES_DB: kb }
        ports: ['5432:5432']
        options: --health-cmd pg_isready --health-interval 5s --health-timeout 5s --health-retries 10
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 9 }
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm -r build
      - run: pnpm test
      - run: pnpm --filter @wecom/api test:int
        env: { RUN_INTEGRATION: '1', TESTCONTAINERS_RYUK_DISABLED: 'true' }
      - name: OpenAPI contract check
        run: |
          pnpm --filter @wecom/api openapi
          git diff --exit-code -- docs/api/openapi.json || (echo 'openapi.json is stale: run pnpm openapi and commit' && exit 1)
```

- [ ] **Step 2: Write ADR 0001**

```markdown
# ADR 0001 — Contract ownership

Date: 2026-09-13 · Status: accepted

## Context
Eight lanes implement the platform in parallel. They must agree on schemas, permissions, events, migrations, and connector/model interfaces without blocking each other.

## Decision
`packages/shared`, `packages/connectors/src/contract.ts`, `packages/model/src/contract.ts`, `apps/api/migrations`, and `docs/api/openapi.json` are owned by lane L0. Other lanes propose changes by pull request; a breaking change (renamed field, removed permission, changed event payload, dropped column) needs a new ADR in this folder before merge. Additive changes need only the PR.

## Consequences
Lanes can code against fixed names from day 3; CI fails when the generated OpenAPI drifts from the committed file, which forces the API and web client to move together.
```

- [ ] **Step 3: Run the whole pipeline locally** — `pnpm lint && pnpm typecheck && pnpm -r build && pnpm test` — all PASS.
- [ ] **Step 4: Commit** — `git add .github docs/adr && git commit -m "ci: lint, tests, integration, openapi contract check; adr 0001"`.

---

## Self-review

- **Spec coverage**: program §3 layout → Tasks 1, 2, 11, 12, 13, 15; §6 contracts 1–7 → Tasks 14 (schema), 3–7 (schemas/OpenAPI), 5 (permissions), 6 (events), 11 (connector), 12 (model), 4 + 12 (pipeline types; the service interfaces `SourceRevisionService/DiffService/SuggestionService` are implemented in L5's plan against the types defined here); stage-1 §2 tables → Task 14 (all 34 tables present, soft-delete columns via `ts()`); §4 conventions (error envelope, pagination, request ids) → Tasks 3, 13; CI contract test → Task 16.
- **Placeholder scan**: none; every step has code.
- **Type consistency**: `Step.key/num`, `Phase.id`, `DocumentLink` fields, `Suggestion.payload` discriminator, `Permission` names, `EventName` list are used identically in Tasks 3–12 and the migrations (`step_key`, `phase_key`, `action_key` columns mirror `key`/`id`).
