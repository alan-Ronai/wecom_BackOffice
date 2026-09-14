# W0 — Wave 4 Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land on `main`, before any wave 4 lane is dispatched, every shared name the lanes W1–W6 consume: zod schemas in `packages/shared/src/schemas/wave4.ts`, four new permissions (in code and in the database), four new events, three new queues, the `Notifier` / `TaxonomyResolver` / `UsageRecorder` interfaces with boot-safe default implementations decorated on the Fastify app, and the contracts document that fixes route paths and migration numbers.

**Architecture:** Purely additive to the existing contract layer (ADR 0001 — additive changes need only the PR; the one enum widening, `DocumentStatusSchema` + `invalid` and `DocumentKindSchema` + `text`, is recorded in ADR 0002). Lanes code against interfaces decorated as `app.notifier`, `app.taxonomy`, `app.usage`; W0 registers default implementations (`LogNotifier`, `NullTaxonomy`, `NullUsage`) so the API boots and tests pass before W1/W3/W5 land and replace them. No routes, no UI.

**Tech Stack:** TypeScript strict, zod 3, Fastify 5 + fastify-plugin, node-pg-migrate, vitest 2.

**Spec:** `docs/superpowers/specs/2026-09-14-kb-wave4-prd-gaps-design.md` (§1 lanes, §2 data model, §3 API, §4 interfaces, §6 isolation).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run everything from the repo root with `pnpm --filter <pkg> <script>`.
- Every new schema lives in `packages/shared/src/schemas/wave4.ts` and is re-exported from `packages/shared/src/schemas/index.ts`. Never duplicate a schema in `apps/api` or `apps/web`.
- Do not edit `packages/shared/src/schemas/stage45.ts` (wave 3 owns it; it is being built against in seven worktrees).
- Additions to `permissions.ts`, `events.ts`, `plugins/boss.ts` are **append-only** (new entries at the end of the existing arrays/objects).
- Migration for this plan: `apps/api/migrations/0029_wave4_permissions.js`. Lanes own `0030`–`0035` (W1 0030, W2 0031, W3 0032, W4 0033, W5 0034, W6 0035). Wave 3 owns `0010`, `0011`, `0020`.
- Hebrew for user-facing labels, English for identifiers and logs.
- Commit after every task; append the attribution lines from the session to every commit message.

## File structure

```
packages/shared/src/schemas/wave4.ts            all wave 4 schemas + Hebrew label maps (new)
packages/shared/src/schemas/common.ts           (modify: DocumentStatusSchema + 'invalid', DocumentKindSchema + 'text')
packages/shared/src/schemas/content.ts          (modify: DocumentSchema/DocumentCardSchema gain optional wave-4 fields via .merge)
packages/shared/src/schemas/api.ts              (modify: PublishBodySchema.resolveFeedbackIds, ListDocumentsQuerySchema + world/topic/docType/tag, SearchQuerySchema + same)
packages/shared/src/schemas/index.ts            (modify: export * from './wave4.js')
packages/shared/src/permissions.ts              (modify: 4 permissions appended; role additions)
packages/shared/src/events.ts                   (modify: 4 events appended)
packages/shared/src/wave4/notifier.ts           Notifier interface + NotifyInput type (new)
packages/shared/src/wave4/taxonomy.ts           TaxonomyResolver interface (new)
packages/shared/src/wave4/usage.ts              UsageRecorder interface + SearchLogInput (new)
packages/shared/src/index.ts                    (modify: export the three interface files)
packages/shared/test/wave4.test.ts              schema tests (new)
packages/shared/test/permissions.test.ts        (modify: expected catalogue)
packages/shared/test/events.test.ts             (modify: expected names)
apps/api/src/plugins/boss.ts                    (modify: QUEUES + feedbackDigest, feedbackAlerts, assetsGc)
apps/api/src/plugins/wave4.ts                   decorates app.notifier / app.taxonomy / app.usage with defaults (new)
apps/api/src/app.ts                             (modify: one register line for plugins/wave4.ts)
apps/api/migrations/0029_wave4_permissions.js   inserts the 4 permissions + role_permissions rows (new)
apps/api/test/unit/wave4-plugin.test.ts         plugin defaults (new)
apps/api/test/migrations.test.ts                (modify: assert the 4 permissions exist)
docs/adr/0002-wave4-enum-widening.md            (new)
docs/api/CONTRACTS-wave4.md                     route + migration + shared-file rules for W1–W6 (new)
docs/superpowers/plans/README.md                (modify: wave 4 table)
```

## Canonical names produced by this plan (lanes import these; do not rename)

| Concern | Name |
|---|---|
| Doc types | `DocTypeSchema` (`'M'|'R'|'O'|'E'|'S'|'T'|'I'`), `DOC_TYPES` (PRD order), `DOC_TYPE_LABELS` |
| World slug | `WorldSlugSchema` |
| Statuses | `DocumentStatusSchema` now includes `'invalid'`; `UNPUBLISHED_STATUSES = ['draft','review','invalid','archived']` |
| Feedback | `FeedbackKindSchema`, `FEEDBACK_KINDS`, `FEEDBACK_KIND_LABELS`, `FeedbackStatusSchema`, `FEEDBACK_STATUSES`, `FEEDBACK_STATUS_LABELS` |
| Permissions | `'taxonomy.manage'`, `'docs.read_unpublished'`, `'feedback.manage'`, `'analytics.read'` |
| Events | `'feedback.created'`, `'feedback.updated'`, `'source_document.saved'`, `'taxonomy.changed'` |
| Queues | `QUEUES.feedbackDigest = 'feedback.digest'`, `QUEUES.feedbackAlerts = 'feedback.alerts'`, `QUEUES.assetsGc = 'assets.gc'` |
| Interfaces | `Notifier.notify(input)`, `TaxonomyResolver.worldsOf(documentId)`, `TaxonomyResolver.usersWithPermissionInWorld(permission, world)`, `UsageRecorder.recordTopicView(userId, topicId)`, `UsageRecorder.recordSearch(entry)` |
| Decorators | `app.notifier: Notifier`, `app.taxonomy: TaxonomyResolver`, `app.usage: UsageRecorder` |

---

### Task 1: Taxonomy schemas

**Files:**
- Create: `packages/shared/src/schemas/wave4.ts`
- Modify: `packages/shared/src/schemas/index.ts`
- Test: `packages/shared/test/wave4.test.ts`

**Interfaces:**
- Consumes: `IdSchema`, `IsoDateSchema`, `PaginationQuerySchema`, `paginated` from `./common.js`; `DocumentStatusSchema`, `DocumentKindSchema` from `./common.js`.
- Produces: `WorldSlugSchema`, `DocTypeSchema`, `DOC_TYPES`, `DOC_TYPE_LABELS`, `WorldSchema`, `WorldBodySchema`, `WorldPatchSchema`, `TopicSchema`, `TopicBodySchema`, `TopicPatchSchema`, `ReorderBodySchema`, `TagCountSchema`, `TagsResponseSchema`, `TopicItemSchema`, `TopicViewSchema`, `WorldsResponseSchema`, `TopicsResponseSchema`, and the inferred types `World`, `Topic`, `DocType`, `TopicView`, `TopicItem`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/wave4.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DocTypeSchema,
  WorldSlugSchema,
  WorldSchema,
  WorldBodySchema,
  TopicViewSchema,
} from '../src/index.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = '2026-09-14T10:00:00.000Z';

describe('wave4 taxonomy schemas', () => {
  it('lists doc types in PRD order with Hebrew labels', () => {
    expect([...DOC_TYPES]).toEqual(['M', 'R', 'O', 'E', 'S', 'T', 'I']);
    expect(DOC_TYPE_LABELS.M).toBe('אבחון');
    expect(DOC_TYPE_LABELS.I).toBe('מידע');
    expect(DocTypeSchema.safeParse('X').success).toBe(false);
  });
  it('validates world slugs like the existing category slugs', () => {
    expect(WorldSlugSchema.safeParse('sim').success).toBe(true);
    expect(WorldSlugSchema.safeParse('field-ops-2').success).toBe(true);
    expect(WorldSlugSchema.safeParse('Sim').success).toBe(false);
    expect(WorldSlugSchema.safeParse('').success).toBe(false);
  });
  it('parses a world row and a create body', () => {
    const w = WorldSchema.parse({
      id: U, slug: 'sim', name: 'SIM / eSIM', description: '', position: 0, active: true,
      topicCount: 3, itemCount: 12, createdAt: T, updatedAt: T,
    });
    expect(w.slug).toBe('sim');
    expect(WorldBodySchema.parse({ slug: 'new', name: 'חדש' })).toEqual({
      slug: 'new', name: 'חדש', description: '', active: true,
    });
  });
  it('parses a topic view grouped by doc type', () => {
    const v = TopicViewSchema.parse({
      topic: { id: U, worldSlug: 'sim', slug: 'esim-activation', name: 'הפעלת eSIM', description: '', position: 0, active: true, itemCount: 2 },
      world: { id: U, slug: 'sim', name: 'SIM / eSIM', description: '', position: 0, active: true, topicCount: 1, itemCount: 2, createdAt: T, updatedAt: T },
      groups: [
        { docType: 'M', items: [{ id: U, slug: 'm-esim', title: 'אבחון eSIM', docType: 'M', kind: 'steps', status: 'published', worlds: ['sim'], description: '', tags: ['esim'], updatedAt: T }] },
      ],
    });
    expect(v.groups[0].items[0].tags).toEqual(['esim']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @wecom/shared test -- wave4`
Expected: FAIL — `DOC_TYPES` is not exported.

- [ ] **Step 3: Write `wave4.ts` (taxonomy part) and export it**

`packages/shared/src/schemas/wave4.ts`:
```ts
import { z } from 'zod';
import { IdSchema, IsoDateSchema, PaginationQuerySchema, paginated, DocumentKindSchema, DocumentStatusSchema } from './common.js';

/* ── Taxonomy (W1) ─────────────────────────────────────────────────────── */
export const WorldSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
export const DOC_TYPES = ['M', 'R', 'O', 'E', 'S', 'T', 'I'] as const;
export const DocTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocTypeSchema>;
/** PRD §3 labels, in the order a topic page renders its groups. */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  M: 'אבחון',
  R: 'טיפול',
  O: 'תפעול',
  E: 'הסלמה',
  S: 'מומחה',
  T: 'תסריט',
  I: 'מידע',
};

export const WorldSchema = z.object({
  id: IdSchema,
  slug: WorldSlugSchema,
  name: z.string().min(1).max(80),
  description: z.string().default(''),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  topicCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type World = z.infer<typeof WorldSchema>;
export const WorldBodySchema = z.object({
  slug: WorldSlugSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  active: z.boolean().default(true),
});
export const WorldPatchSchema = WorldBodySchema.omit({ slug: true }).partial();
export const WorldsResponseSchema = z.object({ items: z.array(WorldSchema) });
export const WorldsQuerySchema = z.object({
  includeInactive: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
});

export const TopicSchema = z.object({
  id: IdSchema,
  worldSlug: WorldSlugSchema,
  slug: WorldSlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().default(''),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  itemCount: z.number().int().nonnegative(),
});
export type Topic = z.infer<typeof TopicSchema>;
export const TopicBodySchema = z.object({
  slug: WorldSlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  active: z.boolean().default(true),
});
export const TopicPatchSchema = TopicBodySchema.omit({ slug: true }).partial().extend({
  worldSlug: WorldSlugSchema.optional(), // move a topic to another world
});
export const TopicsResponseSchema = z.object({ items: z.array(TopicSchema) });
export const ReorderBodySchema = z.object({ ids: z.array(IdSchema).min(1).max(500) });

export const TagCountSchema = z.object({ tag: z.string().min(1), count: z.number().int().nonnegative() });
export const TagsResponseSchema = z.object({ items: z.array(TagCountSchema) });
export const TagsQuerySchema = z.object({ q: z.string().max(60).optional(), limit: z.coerce.number().int().min(1).max(100).default(20) });

export const TopicItemSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  title: z.string(),
  docType: DocTypeSchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  worlds: z.array(WorldSlugSchema),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  updatedAt: IsoDateSchema,
});
export type TopicItem = z.infer<typeof TopicItemSchema>;
export const TopicViewSchema = z.object({
  topic: TopicSchema,
  world: WorldSchema,
  groups: z.array(z.object({ docType: DocTypeSchema, items: z.array(TopicItemSchema) })),
});
export type TopicView = z.infer<typeof TopicViewSchema>;
```

Append to `packages/shared/src/schemas/index.ts`:
```ts
export * from './wave4.js';
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @wecom/shared test -- wave4`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/schemas/wave4.ts packages/shared/src/schemas/index.ts packages/shared/test/wave4.test.ts
git commit -m "feat(shared): wave 4 taxonomy schemas (worlds, topics, doc types, tags, topic view)"
```

---

### Task 2: Governance and document field extensions

**Files:**
- Modify: `packages/shared/src/schemas/common.ts` (two enums), `packages/shared/src/schemas/content.ts` (DocumentSchema, DocumentCardSchema), `packages/shared/src/schemas/api.ts` (ListDocumentsQuerySchema, SearchQuerySchema, PublishBodySchema), `packages/shared/src/schemas/wave4.ts`
- Create: `docs/adr/0002-wave4-enum-widening.md`
- Test: `packages/shared/test/wave4.test.ts`, existing `packages/shared/test/content.test.ts` must stay green

**Interfaces:**
- Produces: `DocumentStatusSchema` (`'draft'|'review'|'published'|'partial'|'invalid'|'archived'`), `UNPUBLISHED_STATUSES`, `DocumentKindSchema` (`'steps'|'retention'|'text'`), `DocumentWave4FieldsSchema` (merged into `DocumentSchema` and `DocumentCardSchema`, all optional/defaulted), `SetStatusBodySchema`, `SourceReviewClearBodySchema`, `TaxonomyFilterSchema` (`world`, `topic`, `docType`, `tag` — merged into list and search queries), `PublishBodySchema.resolveFeedbackIds`.

- [ ] **Step 1: Write the failing tests** (append to `wave4.test.ts`)

```ts
import {
  DocumentStatusSchema, DocumentKindSchema, UNPUBLISHED_STATUSES, DocumentSchema, DocumentCardSchema,
  ListDocumentsQuerySchema, SearchQuerySchema, PublishBodySchema, SetStatusBodySchema,
} from '../src/index.js';

describe('wave4 governance extensions', () => {
  it('widens status and kind enums', () => {
    expect(DocumentStatusSchema.options).toEqual(['draft', 'review', 'published', 'partial', 'invalid', 'archived']);
    expect(DocumentKindSchema.options).toEqual(['steps', 'retention', 'text']);
    expect([...UNPUBLISHED_STATUSES]).toEqual(['draft', 'review', 'invalid', 'archived']);
  });
  it('keeps old documents valid and defaults the new fields', () => {
    const d = DocumentSchema.parse({
      id: U, slug: 'r-01', title: 'מסמך', description: '', category: 'sim', wave: 1, priority: 'h',
      kind: 'steps', status: 'published', currentVersion: 1, phases: [], createdAt: T, updatedAt: T,
    });
    expect(d.tags).toEqual([]);
    expect(d.worlds).toEqual([]);
    expect(d.topics).toEqual([]);
    expect(d.sourceReviewNeeded).toBe(false);
    expect(d.docType).toBeUndefined();
    const c = DocumentCardSchema.parse({
      id: U, slug: 'r-01', title: 'מסמך', description: '', category: 'sim', wave: 1, priority: 'h',
      kind: 'steps', status: 'published', currentVersion: 1, updatedAt: T,
      stepCount: 0, linksOut: 0, linksIn: 0, views: 0, crmFields: [], hasSharedBlocks: false, pinned: false,
    });
    expect(c.tags).toEqual([]);
  });
  it('accepts taxonomy filters on list and search', () => {
    const q = ListDocumentsQuerySchema.parse({ world: 'sim', topic: U, docType: 'R', tag: ['esim', 'apn'] });
    expect(q.tag).toEqual(['esim', 'apn']);
    expect(ListDocumentsQuerySchema.parse({ tag: 'esim' }).tag).toEqual(['esim']);
    expect(SearchQuerySchema.parse({ q: 'x', docType: 'O' }).docType).toBe('O');
  });
  it('lets publish close feedback and validates status changes', () => {
    expect(PublishBodySchema.parse({ label: 'v', resolveFeedbackIds: [U] }).resolveFeedbackIds).toEqual([U]);
    expect(SetStatusBodySchema.safeParse({ status: 'published', reason: 'x' }).success).toBe(false);
    expect(SetStatusBodySchema.parse({ status: 'invalid', reason: 'הוחלף בנוהל חדש' }).status).toBe('invalid');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- wave4`
Expected: FAIL — `UNPUBLISHED_STATUSES` not exported; status enum has 5 options.

- [ ] **Step 3: Implement**

`common.ts` — replace the two lines:
```ts
export const DocumentKindSchema = z.enum(['steps', 'retention', 'text']);
export const DocumentStatusSchema = z.enum(['draft', 'review', 'published', 'partial', 'invalid', 'archived']);
```

`wave4.ts` — append (after the taxonomy block):
```ts
/* ── Governance (W2) ───────────────────────────────────────────────────── */
export const UNPUBLISHED_STATUSES = ['draft', 'review', 'invalid', 'archived'] as const;
/** Additive document fields. Everything optional/defaulted so pre-wave-4 rows still validate. */
export const DocumentWave4FieldsSchema = z.object({
  docType: DocTypeSchema.optional(),
  tags: z.array(z.string().min(1).max(40)).default([]),
  worlds: z.array(WorldSlugSchema).default([]), // primary first
  topics: z.array(IdSchema).default([]),
  ownerId: IdSchema.nullable().optional(),
  ownerName: z.string().nullable().optional(),
  editorId: IdSchema.nullable().optional(),
  editorName: z.string().nullable().optional(),
  approverId: IdSchema.nullable().optional(),
  approverName: z.string().nullable().optional(),
  publishedAt: IsoDateSchema.nullable().optional(),
  sourceReviewNeeded: z.boolean().default(false),
  sourceReviewReason: z.string().nullable().optional(),
  bodyHtml: z.string().optional(), // kind 'text' only
});
export const SetStatusBodySchema = z.object({
  status: z.enum(['invalid', 'archived', 'draft']),
  reason: z.string().min(1).max(500),
});
export const SourceReviewClearBodySchema = z.object({ note: z.string().min(1).max(500) });
const oneOrMany = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));
export const TaxonomyFilterSchema = z.object({
  world: WorldSlugSchema.optional(),
  topic: IdSchema.optional(),
  docType: DocTypeSchema.optional(),
  tag: oneOrMany.optional(),
});
```

`content.ts` — `DocumentSchema` and `DocumentCardSchema` merge the fields. Because `wave4.ts` imports from `common.ts` only, import the fields schema into `content.ts` from `./wave4.js` (no cycle: `wave4.ts` must not import `content.ts`):
```ts
import { DocumentWave4FieldsSchema } from './wave4.js';
// ...
export const DocumentSchema = z.object({ /* existing fields unchanged */ }).merge(DocumentWave4FieldsSchema);
// DocumentCardSchema: keep the existing .pick({...}).extend({...}) and add:
//   .merge(DocumentWave4FieldsSchema.omit({ bodyHtml: true }))
```

`api.ts`:
```ts
import { TaxonomyFilterSchema } from './wave4.js';
export const ListDocumentsQuerySchema = PaginationQuerySchema.extend({ /* existing */ }).merge(TaxonomyFilterSchema);
export const SearchQuerySchema = z.object({ /* existing */ }).merge(TaxonomyFilterSchema);
export const PublishBodySchema = z.object({
  label: z.string().min(1).max(200),
  markPartial: z.boolean().optional(),
  resolveFeedbackIds: z.array(IdSchema).max(50).optional(),
});
```

`docs/adr/0002-wave4-enum-widening.md`:
```md
# ADR 0002 — Wave 4 enum widening

Date: 2026-09-14 · Status: accepted

## Context
PRD §10 requires a "לא בתוקף" status distinct from archive, and folding scripts into documents (spec §2.1) needs a text rendering kind.

## Decision
`DocumentStatusSchema` gains `'invalid'`; `DocumentKindSchema` gains `'text'`. Both are widenings: every existing value stays valid, existing rows are untouched, and the API check constraints are widened by migrations 0030 (kind) and 0031 (status). Consumers that switch exhaustively over these enums must add the new arm (TypeScript flags them).

## Consequences
Wave 3 lanes rebase and add the two arms where the compiler asks. No data migration.
```

- [ ] **Step 4: Run all shared tests**

Run: `pnpm --filter @wecom/shared test`
Expected: PASS (existing content/api tests still green; the `DocumentCardSchema` pick list is unchanged).

- [ ] **Step 5: Commit**

```bash
git add packages/shared docs/adr/0002-wave4-enum-widening.md
git commit -m "feat(shared): wave 4 governance fields, status/kind widening (ADR 0002), taxonomy filters"
```

---

### Task 3: Feedback, source document and usage schemas

**Files:**
- Modify: `packages/shared/src/schemas/wave4.ts`
- Test: `packages/shared/test/wave4.test.ts`

**Interfaces:**
- Produces: `FEEDBACK_KINDS`, `FeedbackKindSchema`, `FEEDBACK_KIND_LABELS`, `FEEDBACK_STATUSES`, `FeedbackStatusSchema`, `FEEDBACK_STATUS_LABELS`, `FeedbackSchema`, `CreateFeedbackBodySchema`, `FeedbackRowSchema`, `FeedbackQuerySchema`, `FeedbackListResponseSchema`, `FeedbackPatchBodySchema`, `FeedbackResolveBodySchema`, `FeedbackDetailSchema`, `FeedbackAnalyticsQuerySchema`, `FeedbackAnalyticsSchema`, `DocumentFeedbackResponseSchema`; `SourceDocumentSchema`, `PutSourceDocumentBodySchema`, `SourceDocumentVersionSchema`, `SourceDocumentVersionsResponseSchema`, `AssetSchema`, `ASSET_MIMES`, `ASSET_MAX_BYTES`; `SearchLogRowSchema`, `SearchLogQuerySchema`, `SearchLogResponseSchema`, `UsageAnalyticsQuerySchema`, `UsageAnalyticsSchema`; types `Feedback`, `FeedbackRow`, `FeedbackAnalytics`, `SourceDocument`, `SourceDocumentVersion`, `Asset`, `UsageAnalytics`.

- [ ] **Step 1: Write the failing tests** (append)

```ts
import {
  FEEDBACK_KINDS, FEEDBACK_KIND_LABELS, FEEDBACK_STATUSES, CreateFeedbackBodySchema, FeedbackSchema,
  FeedbackAnalyticsSchema, PutSourceDocumentBodySchema, AssetSchema, ASSET_MIMES, ASSET_MAX_BYTES,
  UsageAnalyticsSchema, SearchLogRowSchema,
} from '../src/index.js';

describe('wave4 feedback / source / usage schemas', () => {
  it('has the seven PRD feedback kinds and five statuses', () => {
    expect([...FEEDBACK_KINDS]).toEqual(['outdated', 'error', 'unclear', 'missing', 'process_fails', 'no_answer', 'other']);
    expect(FEEDBACK_KIND_LABELS.process_fails).toBe('התהליך לא עובד בפועל');
    expect([...FEEDBACK_STATUSES]).toEqual(['new', 'in_review', 'needs_update', 'no_change', 'done']);
  });
  it('agent body needs only a kind', () => {
    expect(CreateFeedbackBodySchema.parse({ kind: 'other' })).toEqual({ kind: 'other', text: '' });
    expect(CreateFeedbackBodySchema.safeParse({ kind: 'other', text: 'x'.repeat(1001) }).success).toBe(false);
  });
  it('parses a stored feedback row with auto-captured context', () => {
    const f = FeedbackSchema.parse({
      id: U, documentId: U, documentVersion: 3, docType: 'R', worldSlug: 'sim', stepKey: 's11', kind: 'error', text: '',
      status: 'new', userId: U, userName: 'דנה', createdAt: T, assigneeId: null, decisionNote: null,
      decidedBy: null, decidedAt: null, resolvedVersion: null,
    });
    expect(f.documentVersion).toBe(3);
  });
  it('analytics shape', () => {
    const a = FeedbackAnalyticsSchema.parse({
      from: T, to: T, total: 1,
      perItem: [{ documentId: U, title: 't', docType: 'R', count: 1, open: 1 }],
      byKind: [{ kind: 'error', count: 1 }],
      topItems: [{ documentId: U, title: 't', count: 1 }],
      meanHoursToClose: null, changeRate: 0,
      recurringByTopic: [{ topicId: U, topicName: 'x', kind: 'error', count: 1 }],
    });
    expect(a.total).toBe(1);
  });
  it('source document body and assets', () => {
    expect(PutSourceDocumentBodySchema.parse({ html: '<p>x</p>' }).label).toBeUndefined();
    expect(ASSET_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(ASSET_MIMES).toContain('image/png');
    expect(AssetSchema.parse({ id: U, url: '/api/v1/assets/' + U, mime: 'image/png', size: 10, width: null, height: null }).size).toBe(10);
  });
  it('usage analytics and search log rows', () => {
    expect(SearchLogRowSchema.parse({ id: U, userId: U, userName: 'x', q: 'apn', filters: {}, results: 0, tookMs: 4, at: T }).results).toBe(0);
    const u = UsageAnalyticsSchema.parse({
      from: T, to: T,
      itemViews: [{ documentId: U, title: 't', docType: 'R', views: 3, viewers: 2, lastViewedAt: T }],
      topItems: [{ documentId: U, title: 't', views: 3 }],
      topTopics: [{ topicId: U, name: 'x', worldSlug: 'sim', views: 3 }],
      viewers: [{ userId: U, displayName: 'x', views: 3 }],
      zeroResultTerms: [{ q: 'zzz', count: 2, lastAt: T }],
      staleness: [{ documentId: U, title: 't', ownerName: null, updatedAt: T, publishedAt: null, daysSinceUpdate: 12 }],
    });
    expect(u.zeroResultTerms[0].q).toBe('zzz');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- wave4`
Expected: FAIL — `FEEDBACK_KINDS` not exported.

- [ ] **Step 3: Append to `wave4.ts`**

```ts
/* ── Feedback (W3) ─────────────────────────────────────────────────────── */
export const FEEDBACK_KINDS = ['outdated', 'error', 'unclear', 'missing', 'process_fails', 'no_answer', 'other'] as const;
export const FeedbackKindSchema = z.enum(FEEDBACK_KINDS);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  outdated: 'המידע לא מעודכן',
  error: 'מצאתי טעות',
  unclear: 'ההנחיה לא ברורה',
  missing: 'חסר מידע',
  process_fails: 'התהליך לא עובד בפועל',
  no_answer: 'לא מצאתי תשובה למקרה שלי',
  other: 'אחר',
};
export const FEEDBACK_STATUSES = ['new', 'in_review', 'needs_update', 'no_change', 'done'] as const;
export const FeedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'חדש',
  in_review: 'בבדיקה',
  needs_update: 'דורש עדכון',
  no_change: 'לא נדרש שינוי',
  done: 'טופל',
};
export const FeedbackSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  documentVersion: z.number().int().nonnegative(),
  docType: DocTypeSchema.nullable(),
  worldSlug: WorldSlugSchema,
  stepKey: z.string().nullable(),
  kind: FeedbackKindSchema,
  text: z.string().default(''),
  status: FeedbackStatusSchema,
  userId: IdSchema,
  userName: z.string(),
  createdAt: IsoDateSchema,
  assigneeId: IdSchema.nullable(),
  decisionNote: z.string().nullable(),
  decidedBy: IdSchema.nullable(),
  decidedAt: IsoDateSchema.nullable(),
  resolvedVersion: z.number().int().nullable(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
export const CreateFeedbackBodySchema = z.object({
  kind: FeedbackKindSchema,
  text: z.string().max(1000).default(''),
  stepKey: z.string().max(40).optional(),
});
export const FeedbackRowSchema = FeedbackSchema.extend({
  documentTitle: z.string(),
  assigneeName: z.string().nullable(),
});
export type FeedbackRow = z.infer<typeof FeedbackRowSchema>;
export const FeedbackQuerySchema = PaginationQuerySchema.extend({
  status: FeedbackStatusSchema.optional(),
  world: WorldSlugSchema.optional(),
  kind: FeedbackKindSchema.optional(),
  documentId: IdSchema.optional(),
  assigneeId: IdSchema.optional(),
  docType: DocTypeSchema.optional(),
});
export const FeedbackListResponseSchema = paginated(FeedbackRowSchema).extend({
  counts: z.record(FeedbackStatusSchema, z.number().int()), // tab badges
});
export const FeedbackPatchBodySchema = z.object({
  status: FeedbackStatusSchema.optional(),
  assigneeId: IdSchema.nullable().optional(),
  decisionNote: z.string().max(2000).optional(),
});
export const FeedbackResolveBodySchema = z.object({
  version: z.number().int().positive(),
  decisionNote: z.string().max(2000).optional(),
});
export const FeedbackDetailSchema = FeedbackRowSchema.extend({
  versionLabel: z.string().nullable(),
  href: z.string(), // "/doc/<id>/<stepKey>" the queue deep-links to
  laterVersions: z.array(z.object({ version: z.number().int(), label: z.string(), createdAt: IsoDateSchema })),
});
export const DocumentFeedbackResponseSchema = z.object({ items: z.array(FeedbackRowSchema) });
export const FeedbackAnalyticsQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  world: WorldSlugSchema.optional(),
});
export const FeedbackAnalyticsSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  total: z.number().int(),
  perItem: z.array(z.object({ documentId: IdSchema, title: z.string(), docType: DocTypeSchema.nullable(), count: z.number().int(), open: z.number().int() })),
  byKind: z.array(z.object({ kind: FeedbackKindSchema, count: z.number().int() })),
  topItems: z.array(z.object({ documentId: IdSchema, title: z.string(), count: z.number().int() })),
  meanHoursToClose: z.number().nullable(),
  changeRate: z.number().min(0).max(1), // share of closed feedback with resolvedVersion set
  recurringByTopic: z.array(z.object({ topicId: IdSchema, topicName: z.string(), kind: FeedbackKindSchema, count: z.number().int() })),
});
export type FeedbackAnalytics = z.infer<typeof FeedbackAnalyticsSchema>;

/* ── Source documents (W4) ─────────────────────────────────────────────── */
export const SourceDocumentSchema = z.object({
  documentId: IdSchema,
  html: z.string(),
  text: z.string(),
  version: z.number().int().nonnegative(),
  etag: z.string(),
  updatedById: IdSchema.nullable(),
  updatedByName: z.string().nullable(),
  updatedAt: IsoDateSchema,
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export const PutSourceDocumentBodySchema = z.object({
  html: z.string().max(2_000_000),
  label: z.string().min(1).max(200).optional(),
});
export const SourceDocumentVersionSchema = z.object({
  documentId: IdSchema,
  version: z.number().int(),
  label: z.string(),
  authorId: IdSchema.nullable(),
  authorName: z.string(),
  createdAt: IsoDateSchema,
  sourceRevisionId: IdSchema.nullable(),
});
export type SourceDocumentVersion = z.infer<typeof SourceDocumentVersionSchema>;
export const SourceDocumentVersionsResponseSchema = z.object({ items: z.array(SourceDocumentVersionSchema) });
export const ASSET_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml'] as const;
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const AssetSchema = z.object({
  id: IdSchema,
  url: z.string(),
  mime: z.enum(ASSET_MIMES),
  size: z.number().int().positive(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Asset = z.infer<typeof AssetSchema>;

/* ── Usage (W5) ────────────────────────────────────────────────────────── */
export const SearchLogRowSchema = z.object({
  id: IdSchema,
  userId: IdSchema.nullable(),
  userName: z.string().nullable(),
  q: z.string(),
  filters: z.record(z.unknown()),
  results: z.number().int().nonnegative(),
  tookMs: z.number().int().nonnegative(),
  at: IsoDateSchema,
});
export const SearchLogQuerySchema = PaginationQuerySchema.extend({
  zeroOnly: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});
export const SearchLogResponseSchema = paginated(SearchLogRowSchema);
export const UsageAnalyticsQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  world: WorldSlugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const UsageAnalyticsSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  itemViews: z.array(z.object({ documentId: IdSchema, title: z.string(), docType: DocTypeSchema.nullable(), views: z.number().int(), viewers: z.number().int(), lastViewedAt: IsoDateSchema.nullable() })),
  topItems: z.array(z.object({ documentId: IdSchema, title: z.string(), views: z.number().int() })),
  topTopics: z.array(z.object({ topicId: IdSchema, name: z.string(), worldSlug: WorldSlugSchema, views: z.number().int() })),
  viewers: z.array(z.object({ userId: IdSchema, displayName: z.string(), views: z.number().int() })),
  zeroResultTerms: z.array(z.object({ q: z.string(), count: z.number().int(), lastAt: IsoDateSchema })),
  staleness: z.array(z.object({ documentId: IdSchema, title: z.string(), ownerName: z.string().nullable(), updatedAt: IsoDateSchema, publishedAt: IsoDateSchema.nullable(), daysSinceUpdate: z.number().int() })),
});
export type UsageAnalytics = z.infer<typeof UsageAnalyticsSchema>;
```

- [ ] **Step 4: Run and verify pass**

Run: `pnpm --filter @wecom/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): wave 4 feedback, source document, asset and usage schemas"
```

---

### Task 4: Permissions and events

**Files:**
- Modify: `packages/shared/src/permissions.ts`, `packages/shared/src/events.ts`
- Test: `packages/shared/test/permissions.test.ts`, `packages/shared/test/events.test.ts`

**Interfaces:**
- Produces: permissions `taxonomy.manage`, `docs.read_unpublished`, `feedback.manage`, `analytics.read`; roles: editor += `docs.read_unpublished`, `feedback.manage`, `analytics.read`; lead += `taxonomy.manage`. Events `feedback.created { feedbackId, documentId, kind }`, `feedback.updated { feedbackId, documentId, status }`, `source_document.saved { documentId, version, actorId }`, `taxonomy.changed { entity: 'world'|'topic', id }`.

- [ ] **Step 1: Update the expected lists in both tests**

`permissions.test.ts` — append to the expected array after `'system.admin'`:
```ts
      'taxonomy.manage',
      'docs.read_unpublished',
      'feedback.manage',
      'analytics.read',
```
and add a test:
```ts
  it('grants the wave 4 permissions to the right roles', () => {
    expect(DEFAULT_ROLES.agent).not.toContain('docs.read_unpublished');
    expect(DEFAULT_ROLES.editor).toEqual(expect.arrayContaining(['docs.read_unpublished', 'feedback.manage', 'analytics.read']));
    expect(DEFAULT_ROLES.editor).not.toContain('taxonomy.manage');
    expect(DEFAULT_ROLES.lead).toContain('taxonomy.manage');
  });
```

`events.test.ts` — append after `'system.status'`:
```ts
      'feedback.created',
      'feedback.updated',
      'source_document.saved',
      'taxonomy.changed',
```
and:
```ts
  it('validates the wave 4 events', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(EventSchema.parse(makeEvent('feedback.created', { feedbackId: id, documentId: id, kind: 'error' })).name).toBe('feedback.created');
    expect(EventSchema.parse(makeEvent('taxonomy.changed', { entity: 'world', id })).name).toBe('taxonomy.changed');
    expect(EventSchema.safeParse({ name: 'source_document.saved', payload: { documentId: id }, at: new Date().toISOString() }).success).toBe(false);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- permissions events`
Expected: FAIL on the catalogue equality.

- [ ] **Step 3: Implement**

`permissions.ts` — append inside `PERMISSIONS` after `'system.admin',`:
```ts
  'taxonomy.manage',
  'docs.read_unpublished',
  'feedback.manage',
  'analytics.read',
```
Change the role arrays:
```ts
const editor: Permission[] = [
  ...agent, 'docs.create', 'docs.edit', 'suggestions.review', 'scripts.edit',
  'docs.read_unpublished', 'feedback.manage', 'analytics.read',
];
const lead: Permission[] = [
  ...editor, 'docs.publish', 'docs.delete', 'docs.restore', 'blocks.edit', 'fields.edit',
  'suggestions.apply', 'sources.manage', 'notes.moderate', 'taxonomy.manage',
];
```
(`admin: [...PERMISSIONS]` picks the new ones up automatically.)

`events.ts` — append to `EVENTS` after `'system.status',`:
```ts
  'feedback.created',
  'feedback.updated',
  'source_document.saved',
  'taxonomy.changed',
```
and to `payloads`:
```ts
  'feedback.created': z.object({ feedbackId: IdSchema, documentId: IdSchema, kind: z.string() }),
  'feedback.updated': z.object({ feedbackId: IdSchema, documentId: IdSchema, status: z.string() }),
  'source_document.saved': z.object({ documentId: IdSchema, version: z.number().int(), actorId: IdSchema.nullable() }),
  'taxonomy.changed': z.object({ entity: z.enum(['world', 'topic']), id: IdSchema }),
```

- [ ] **Step 4: Run all shared tests**

Run: `pnpm --filter @wecom/shared test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): wave 4 permissions and events (append-only)"
```

---

### Task 5: Permissions migration 0029

**Files:**
- Create: `apps/api/migrations/0029_wave4_permissions.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: tables `permissions(name, resource)`, `roles(name)`, `role_permissions(role_id, permission)` from `0002_identity.js`.
- Produces: rows for the four permissions; role_permissions for editor/lead/admin as in Task 4.

- [ ] **Step 1: Add the assertion to `migrations.test.ts`** (inside the existing `run('migrations', …)` block)

```ts
  it('seeds the wave 4 permissions and role grants', async () => {
    const p = await pool.query("select name from permissions where name in ('taxonomy.manage','docs.read_unpublished','feedback.manage','analytics.read') order by 1");
    expect(p.rows.map((r) => r.name)).toEqual(['analytics.read', 'docs.read_unpublished', 'feedback.manage', 'taxonomy.manage']);
    const rp = await pool.query(
      `select r.name role, rp.permission from role_permissions rp join roles r on r.id=rp.role_id
       where rp.permission in ('taxonomy.manage','docs.read_unpublished','feedback.manage','analytics.read') order by 1,2`,
    );
    const grants = rp.rows.map((x) => x.role + ':' + x.permission);
    expect(grants).toEqual(expect.arrayContaining(['editor:docs.read_unpublished', 'editor:feedback.manage', 'editor:analytics.read', 'lead:taxonomy.manage', 'admin:taxonomy.manage']));
    expect(grants).not.toContain('agent:docs.read_unpublished');
    expect(grants).not.toContain('editor:taxonomy.manage');
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts`
Expected: FAIL — zero permission rows.

- [ ] **Step 3: Write the migration**

`apps/api/migrations/0029_wave4_permissions.js`:
```js
/** Wave 4 (W0): four permissions + default role grants. Mirrors packages/shared/src/permissions.ts. */
const NEW = [
  ['taxonomy.manage', 'taxonomy'],
  ['docs.read_unpublished', 'docs'],
  ['feedback.manage', 'feedback'],
  ['analytics.read', 'analytics'],
];
const GRANTS = {
  editor: ['docs.read_unpublished', 'feedback.manage', 'analytics.read'],
  lead: ['docs.read_unpublished', 'feedback.manage', 'analytics.read', 'taxonomy.manage'],
  admin: ['docs.read_unpublished', 'feedback.manage', 'analytics.read', 'taxonomy.manage'],
};
exports.up = (pgm) => {
  for (const [name, resource] of NEW)
    pgm.sql(`insert into permissions(name, resource) values ('${name}', '${resource}') on conflict (name) do nothing`);
  for (const [role, perms] of Object.entries(GRANTS))
    for (const p of perms)
      pgm.sql(
        `insert into role_permissions(role_id, permission) select id, '${p}' from roles where name='${role}' on conflict do nothing`,
      );
};
exports.down = (pgm) => {
  const list = NEW.map(([n]) => `'${n}'`).join(',');
  pgm.sql(`delete from role_permissions where permission in (${list})`);
  pgm.sql(`delete from permissions where name in (${list})`);
};
```
If `permissions.name` is not declared unique/primary in `0002_identity.js`, check `apps/api/migrations/0002_identity.js` line 59–63: it is `name: { type: 'text', primaryKey: true }` — the `on conflict (name)` clause is valid.

- [ ] **Step 4: Run the migration tests (up and the existing down-to-empty test)**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/0029_wave4_permissions.js apps/api/test/migrations.test.ts
git commit -m "feat(api): migration 0029 — wave 4 permissions and role grants"
```

---

### Task 6: Interfaces, default implementations, queues, plugin

**Files:**
- Create: `packages/shared/src/wave4/notifier.ts`, `packages/shared/src/wave4/taxonomy.ts`, `packages/shared/src/wave4/usage.ts`, `apps/api/src/plugins/wave4.ts`
- Modify: `packages/shared/src/index.ts`, `apps/api/src/plugins/boss.ts`, `apps/api/src/app.ts`
- Test: `apps/api/test/unit/wave4-plugin.test.ts`

**Interfaces:**
- Produces (shared):
```ts
export interface NotifyInput { userIds: string[]; kind: 'feedback' | 'source' | 'system'; title: string; body?: string; href?: string; entityType?: string; entityId?: string }
export interface Notifier { notify(input: NotifyInput): Promise<void> }
export interface TaxonomyResolver { worldsOf(documentId: string): Promise<string[]>; usersWithPermissionInWorld(permission: string, world: string): Promise<string[]> }
export interface SearchLogInput { userId: string | null; q: string; filters: Record<string, unknown>; results: number; tookMs: number }
export interface UsageRecorder { recordTopicView(userId: string, topicId: string): Promise<void>; recordSearch(entry: SearchLogInput): Promise<void> }
```
- Produces (api): `app.notifier`, `app.taxonomy`, `app.usage` decorators; `QUEUES.feedbackDigest`, `QUEUES.feedbackAlerts`, `QUEUES.assetsGc`; classes `LogNotifier`, `NullTaxonomy`, `NullUsage` exported from `plugins/wave4.ts`; plugin option `{ notifier?, taxonomy?, usage? }` so a lane can override at registration.
- Replacement rule for lanes: W3 provides the production `Notifier` (writes wave 3's `notifications` table when it exists; until then keeps `LogNotifier`), W1 provides `TaxonomyResolver`, W5 provides `UsageRecorder`. Each lane replaces the default by calling `app.register(wave4Plugin, { taxonomy: new PgTaxonomy(app.db) })`-style overrides **from its own module's `index.ts`**, not by editing `app.ts` (see `docs/api/CONTRACTS-wave4.md`).

- [ ] **Step 1: Write the failing unit test**

`apps/api/test/unit/wave4-plugin.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import wave4Plugin, { LogNotifier, NullTaxonomy, NullUsage } from '../../src/plugins/wave4.js';
import { QUEUES } from '../../src/plugins/boss.js';

describe('wave4 plugin', () => {
  it('decorates boot-safe defaults', async () => {
    const app = Fastify({ logger: false });
    await app.register(wave4Plugin);
    await app.ready();
    expect(app.notifier).toBeInstanceOf(LogNotifier);
    expect(app.taxonomy).toBeInstanceOf(NullTaxonomy);
    expect(app.usage).toBeInstanceOf(NullUsage);
    await expect(app.notifier.notify({ userIds: ['u1'], kind: 'system', title: 'x' })).resolves.toBeUndefined();
    await expect(app.taxonomy.worldsOf('d1')).resolves.toEqual([]);
    await expect(app.taxonomy.usersWithPermissionInWorld('docs.publish', 'sim')).resolves.toEqual([]);
    await expect(app.usage.recordSearch({ userId: null, q: 'a', filters: {}, results: 0, tookMs: 1 })).resolves.toBeUndefined();
    await app.close();
  });
  it('accepts overrides', async () => {
    const app = Fastify({ logger: false });
    const calls: string[] = [];
    await app.register(wave4Plugin, {
      notifier: { notify: async (n) => { calls.push(n.title); } },
    });
    await app.ready();
    await app.notifier.notify({ userIds: [], kind: 'feedback', title: 'hello' });
    expect(calls).toEqual(['hello']);
    await app.close();
  });
  it('registers the wave 4 queues', () => {
    expect(QUEUES.feedbackDigest).toBe('feedback.digest');
    expect(QUEUES.feedbackAlerts).toBe('feedback.alerts');
    expect(QUEUES.assetsGc).toBe('assets.gc');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/unit/wave4-plugin.test.ts`
Expected: FAIL — cannot resolve `../../src/plugins/wave4.js`.

- [ ] **Step 3: Implement the shared interfaces**

`packages/shared/src/wave4/notifier.ts`:
```ts
/** Wave 4 alert sink. Production implementation (W3) writes wave 3's `notifications` table. */
export interface NotifyInput {
  userIds: string[];
  kind: 'feedback' | 'source' | 'system';
  title: string;
  body?: string;
  href?: string;
  entityType?: string;
  entityId?: string;
}
export interface Notifier {
  notify(input: NotifyInput): Promise<void>;
}
```
`packages/shared/src/wave4/taxonomy.ts`:
```ts
/** Resolves a document's worlds and the people to alert in a world. Implemented by W1 on `document_worlds` + `user_roles`. */
export interface TaxonomyResolver {
  /** World slugs, primary first. Empty when the document does not exist. */
  worldsOf(documentId: string): Promise<string[]>;
  /** Active users holding `permission` whose world scope is null or includes `world`. */
  usersWithPermissionInWorld(permission: string, world: string): Promise<string[]>;
}
```
`packages/shared/src/wave4/usage.ts`:
```ts
export interface SearchLogInput {
  userId: string | null;
  q: string;
  filters: Record<string, unknown>;
  results: number;
  tookMs: number;
}
/** Usage sink implemented by W5 (`topic_views`, `search_log`). Callers never await failures — implementations must swallow and log. */
export interface UsageRecorder {
  recordTopicView(userId: string, topicId: string): Promise<void>;
  recordSearch(entry: SearchLogInput): Promise<void>;
}
```
`packages/shared/src/index.ts` — append:
```ts
export * from './wave4/notifier.js';
export * from './wave4/taxonomy.js';
export * from './wave4/usage.js';
```

- [ ] **Step 4: Implement queues and the plugin**

`apps/api/src/plugins/boss.ts` — append inside `QUEUES` before `} as const;`:
```ts
  feedbackDigest: 'feedback.digest', // W3: daily per-editor summary of open feedback
  feedbackAlerts: 'feedback.alerts', // W3: every 10 min, repeat/anomaly windows
  assetsGc: 'assets.gc', // W4: weekly, delete assets no source version references
```

`apps/api/src/plugins/wave4.ts`:
```ts
import fp from 'fastify-plugin';
import type { FastifyBaseLogger } from 'fastify';
import type { Notifier, NotifyInput, SearchLogInput, TaxonomyResolver, UsageRecorder } from '@wecom/shared';

declare module 'fastify' {
  interface FastifyInstance {
    notifier: Notifier;
    taxonomy: TaxonomyResolver;
    usage: UsageRecorder;
  }
}

/** Default until W3 lands: alerts go to the log so nothing is silently dropped. */
export class LogNotifier implements Notifier {
  constructor(private log?: FastifyBaseLogger) {}
  async notify(input: NotifyInput): Promise<void> {
    this.log?.info({ notify: input }, 'notification (log sink)');
  }
}
/** Default until W1 lands: no worlds, no recipients. */
export class NullTaxonomy implements TaxonomyResolver {
  async worldsOf(): Promise<string[]> { return []; }
  async usersWithPermissionInWorld(): Promise<string[]> { return []; }
}
/** Default until W5 lands: usage is not recorded. */
export class NullUsage implements UsageRecorder {
  async recordTopicView(): Promise<void> {}
  async recordSearch(_e: SearchLogInput): Promise<void> {}
}

export interface Wave4PluginOptions {
  notifier?: Notifier;
  taxonomy?: TaxonomyResolver;
  usage?: UsageRecorder;
}

/**
 * Decorates `app.notifier`, `app.taxonomy`, `app.usage`. Registered once in app.ts with no
 * options; lanes replace an implementation by calling the matching `set*` from their module.
 */
export default fp(async (app, opts: Wave4PluginOptions) => {
  app.decorate('notifier', opts.notifier ?? new LogNotifier(app.log));
  app.decorate('taxonomy', opts.taxonomy ?? new NullTaxonomy());
  app.decorate('usage', opts.usage ?? new NullUsage());
});

/** Lane hooks: replace a default after boot without touching app.ts (decorators are plain properties). */
export const setNotifier = (app: { notifier: Notifier }, n: Notifier) => { app.notifier = n; };
export const setTaxonomy = (app: { taxonomy: TaxonomyResolver }, t: TaxonomyResolver) => { app.taxonomy = t; };
export const setUsage = (app: { usage: UsageRecorder }, u: UsageRecorder) => { app.usage = u; };
```

`apps/api/src/app.ts` — after the line `await app.register(bossPlugin, { boss: opts.boss });` add:
```ts
  await app.register(wave4Plugin); // W0: app.notifier / app.taxonomy / app.usage defaults
```
with the import at the top:
```ts
import wave4Plugin from './plugins/wave4.js';
```

- [ ] **Step 5: Run unit tests, typecheck, and the wiring integration test**

Run: `pnpm --filter @wecom/shared build && cd apps/api && pnpm vitest run test/unit && pnpm tsc --noEmit && RUN_INTEGRATION=1 pnpm vitest run test/int/wiring.test.ts`
Expected: PASS everywhere (the wiring test proves the API still boots with the new plugin).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/wave4 packages/shared/src/index.ts apps/api/src/plugins/wave4.ts apps/api/src/plugins/boss.ts apps/api/src/app.ts apps/api/test/unit/wave4-plugin.test.ts
git commit -m "feat(api,shared): wave 4 Notifier/TaxonomyResolver/UsageRecorder interfaces, defaults plugin, queues"
```

---

### Task 7: Contracts document, plan index, OpenAPI check

**Files:**
- Create: `docs/api/CONTRACTS-wave4.md`
- Modify: `docs/superpowers/plans/README.md`, `docs/api/openapi.json` (regenerate)

**Interfaces:**
- Produces: the authoritative route table and the shared-file rules W1–W6 follow.

- [ ] **Step 1: Write `docs/api/CONTRACTS-wave4.md`**

```md
# Wave 4 API contract (authoritative for lanes W1–W6)

Schemas: `packages/shared/src/schemas/wave4.ts` (+ the additive fields merged into `DocumentSchema`, `DocumentCardSchema`, `ListDocumentsQuerySchema`, `SearchQuerySchema`, `PublishBodySchema`). Every route validates with those schemas, appears in `docs/api/openapi.json`, and is what `apps/web` calls. Spec: `docs/superpowers/specs/2026-09-14-kb-wave4-prd-gaps-design.md`.

## Migrations
| Lane | File | Owns |
|---|---|---|
| W0 | `0029_wave4_permissions.js` | permissions + grants (done) |
| W1 | `0030_taxonomy.js` | worlds, topics, document_worlds, document_topics, doc_type, tags, kind 'text', body_html, scripts fold, user_roles.world_scope |
| W2 | `0031_governance.js` | status 'invalid', owner/editor/approver, published_at, source_review_*, document_versions.source_version |
| W3 | `0032_feedback.js` | feedback, feedback_alerts |
| W4 | `0033_source_documents.js` | source_documents, source_document_versions, assets |
| W5 | `0034_usage.js` | search_log, topic_views |
| W6 | `0035_wave4_fixups.js` | indexes/fixes found in integration (may be empty → do not create) |
Wave 3 owns `0010`, `0011`, `0020`.

## Shared files a lane may touch (append-only)
`apps/api/src/modules/index.ts` (one import + one list entry), `apps/web/src/routes.tsx` (route entries), `packages/shared/src/events.ts` (new names + payloads only), `packages/shared/src/permissions.ts` (new names + role additions only), `apps/api/src/plugins/boss.ts` (`QUEUES` entries), `apps/web/src/api/keys.ts` (new keys).
**Never** edit: `packages/shared/src/schemas/stage45.ts`, `apps/api/src/app.ts`, `apps/web/src/components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`. Ship a component + a documented one-line mount in your lane report; W6 mounts it.
Replacing a default: W1 calls `setTaxonomy(app, new PgTaxonomy(app.db))`, W3 `setNotifier(...)`, W5 `setUsage(...)` from the lane's own module `index.ts` (imported from `apps/api/src/plugins/wave4.ts`).

## Routes
### W1 Taxonomy
| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/worlds` | `WorldsQuerySchema` | `WorldsResponseSchema` | docs.read |
| POST | `/worlds` | `WorldBodySchema` | `WorldSchema` | taxonomy.manage |
| PATCH | `/worlds/:slug` | `WorldPatchSchema` | `WorldSchema` | taxonomy.manage |
| DELETE | `/worlds/:slug` | `?force` | 204 (deactivates; 409 `WORLD_IN_USE` when items remain and no force) | taxonomy.manage |
| PUT | `/worlds/reorder` | `ReorderBodySchema` | `WorldsResponseSchema` | taxonomy.manage |
| GET | `/worlds/:slug/topics` | — | `TopicsResponseSchema` | docs.read |
| POST | `/worlds/:slug/topics` | `TopicBodySchema` | `TopicSchema` | taxonomy.manage |
| PUT | `/worlds/:slug/topics/reorder` | `ReorderBodySchema` | `TopicsResponseSchema` | taxonomy.manage |
| PATCH | `/topics/:id` | `TopicPatchSchema` | `TopicSchema` | taxonomy.manage |
| DELETE | `/topics/:id` | — | 204 (deactivates) | taxonomy.manage |
| GET | `/topics/:id/items` | — | `TopicViewSchema` (visibility rule; records a topic view via `app.usage`) | docs.read |
| GET | `/tags` | `TagsQuerySchema` | `TagsResponseSchema` | docs.read |
| GET | `/documents` | + `TaxonomyFilterSchema` | unchanged | — |
| GET | `/search` | + `TaxonomyFilterSchema`; new group type `tags` | unchanged | — |
| PATCH | `/documents/:id` | + `docType, tags, worlds, topics, ownerId, editorId, bodyHtml` | `DocumentSchema` | docs.edit |
| * | `/scripts*` | unchanged shapes, served from `doc_type='T'` documents, `deprecated: true` in OpenAPI | as today |

### W2 Governance
| POST | `/documents/:id/status` | `SetStatusBodySchema` | `DocumentSchema` | docs.publish |
| POST | `/documents/:id/source-review/clear` | `SourceReviewClearBodySchema` | `DocumentSchema` | docs.edit |
| DELETE | `/documents/:id` | — | 409 `ONCE_PUBLISHED { allowed: ['invalid','archived'] }` when a published version exists | docs.delete |
Visibility: without `docs.read_unpublished`, list/get/related/links/backlinks/topic/search return only `published`/`partial`; get on an unpublished id → 404 `NOT_PUBLISHED`.

### W3 Feedback
| POST | `/documents/:id/feedback` | `CreateFeedbackBodySchema` | `FeedbackSchema` | docs.read |
| GET | `/documents/:id/feedback` | — | `DocumentFeedbackResponseSchema` (open only) | docs.edit |
| GET | `/feedback` | `FeedbackQuerySchema` | `FeedbackListResponseSchema` | feedback.manage |
| GET | `/feedback/:id` | — | `FeedbackDetailSchema` | feedback.manage |
| PATCH | `/feedback/:id` | `FeedbackPatchBodySchema` | `FeedbackRowSchema` | feedback.manage |
| POST | `/feedback/:id/resolve` | `FeedbackResolveBodySchema` | `FeedbackRowSchema` | feedback.manage |
| GET | `/feedback/analytics` | `FeedbackAnalyticsQuerySchema` | `FeedbackAnalyticsSchema` (60 s cache) | feedback.manage |
| POST | `/documents/:id/publish` | `PublishBodySchema.resolveFeedbackIds` | unchanged | docs.publish |

### W4 Source documents
| GET | `/documents/:id/source` | — | `SourceDocumentSchema` or 204 | docs.read |
| PUT | `/documents/:id/source` | `PutSourceDocumentBodySchema` + `If-Match` | `SourceDocumentSchema` (412 on etag mismatch) | docs.edit |
| GET | `/documents/:id/source/versions` | — | `SourceDocumentVersionsResponseSchema` | docs.read |
| GET | `/documents/:id/source/versions/:v` | — | `SourceDocumentSchema` (that version) | docs.read |
| POST | `/documents/:id/source/restore/:v` | — | `SourceDocumentSchema` | docs.edit |
| POST | `/documents/:id/source/import` | multipart `.docx` | `SourceDocumentSchema` | docs.edit |
| GET | `/documents/:id/source/export.docx` | — | docx bytes | docs.read |
| GET | `/sources/:id/revisions/:rev/raw` | — | original upload bytes | docs.read |
| POST | `/assets` | multipart image | `AssetSchema` | docs.edit |
| GET | `/assets/:id` | — | bytes, immutable cache | docs.read |

### W5 Usage
| GET | `/analytics/usage` | `UsageAnalyticsQuerySchema` | `UsageAnalyticsSchema` (60 s cache) | analytics.read |
| GET | `/analytics/search-log` | `SearchLogQuerySchema` | `SearchLogResponseSchema` | analytics.read |

## Web routes (owner in parentheses)
`/topic/:id` (W1), `/admin/taxonomy` (W1), `/feedback` (W3), `/feedback/:id` (W3), `/analytics` (W5), `/doc/:id` pane modes + `/edit/:id/source` (W4). Mount points in shell/article/editor/library are performed by W6.
```

- [ ] **Step 2: Update `docs/superpowers/plans/README.md`** — append:

```md
## Wave 4 — PRD gaps (spec `../specs/2026-09-14-kb-wave4-prd-gaps-design.md`, contract `docs/api/CONTRACTS-wave4.md`)

| Lane | Plan | Start after | Produces for |
|---|---|---|---|
| W0 Contracts | `2026-09-14-W0-wave4-contracts.md` | — | everyone (wave4 schemas, permissions, events, queues, Notifier/TaxonomyResolver/UsageRecorder) |
| W1 Taxonomy | `2026-09-14-W1-taxonomy.md` | W0 | worlds/topics/docType/tags, scripts fold, `PgTaxonomy`, topic page |
| W2 Governance | `2026-09-14-W2-governance.md` | W0 | statuses, visibility, ownership, source-review flag |
| W3 Feedback | `2026-09-14-W3-feedback.md` | W0 | feedback module, `PgNotifier`, queue + analytics UI |
| W4 Source documents | `2026-09-14-W4-source-documents.md` | W0 | source docs, assets, editor, docx in/out, WP render switch |
| W5 Usage | `2026-09-14-W5-usage.md` | W0 | search log, `PgUsage`, analytics page |
| W6 Integration | `2026-09-14-W6-integration.md` | W1–W5 + wave 3 merged | mounts, e2e flows, merge fixes |
```

- [ ] **Step 3: Regenerate OpenAPI and run the contract check**

Run: `pnpm --filter @wecom/api openapi:generate && git diff --stat docs/api/openapi.json && pnpm --filter @wecom/api test -- openapi`
(Use the script names present in `apps/api/package.json`; if the generate script is named differently, e.g. `openapi`, use that.) Expected: the file changes only by the widened enums and the optional document fields; the contract test passes.

- [ ] **Step 4: Full green gate**

Run: `pnpm -r test && cd apps/api && RUN_INTEGRATION=1 pnpm test:int`
Expected: all green (shared, connectors, model, api unit + integration, web unit).

- [ ] **Step 5: Commit and record in the ledger**

```bash
git add docs/api/CONTRACTS-wave4.md docs/api/openapi.json docs/superpowers/plans/README.md
git commit -m "docs(contracts): wave 4 route/migration/shared-file contract; plan index"
echo "Wave 4 W0 contracts on main ($(git rev-parse --short HEAD)): wave4.ts, permissions 0029, events, queues, wave4 plugin. Dispatching W1–W5 in parallel worktrees; W6 after merge." >> .superpowers/sdd/program/progress.md
git add .superpowers/sdd/program/progress.md && git commit -m "chore(ledger): wave 4 W0 landed"
```

---

## Self-review

- Spec coverage: §2 names (doc_type, tags, worlds, topics, statuses, feedback kinds/statuses, source docs, assets, search_log) all have schemas here; §3 routes are fixed in the contract doc; §4 interfaces are Task 6. Route implementations are lane work by design.
- Placeholders: none; every code step is complete.
- Type consistency: `DocumentWave4FieldsSchema` is merged into both document schemas; `TaxonomyFilterSchema` is merged into both query schemas; the `Notifier`/`TaxonomyResolver`/`UsageRecorder` method names match between shared, plugin and the contract doc.
