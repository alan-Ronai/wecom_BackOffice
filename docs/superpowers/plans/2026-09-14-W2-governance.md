# W2 — Governance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the library the PRD's status and ownership rules: a "לא בתוקף" status, published-only visibility for read-only roles everywhere a document can be read, no hard purge of items that were ever published, owner / responsible editor / approver per item with `published_at`, and a document-level "source needs review" flag that is raised when a source revision lands and cleared by an editor action.

**Architecture:** One migration (`0031_governance.js`) adds columns only. A single SQL helper, `visibilityWhere(user, alias)` in `apps/api/src/lib/visibility.ts`, is appended to every documents-bearing query (list, get, related, links, backlinks, search) so the rule lives in one place; W1's topic view reuses it. Status changes and the source-review flag are ordinary transactional repo functions with audit rows and `document.updated` events. Alerts go through W0's `app.notifier`; worlds come from W0's `app.taxonomy` — W2 never reads W1's tables. The web side ships self-contained components (`StatusChip`, `StatusMenu`, `SourceReviewBadge`, `OwnerFields`, `UnavailablePage`) plus hooks; mounting into the shell/article/editor/library is W6's job.

**Tech Stack:** Node 22, Fastify 5, fastify-type-provider-zod, pg 8, zod 3, node-pg-migrate, vitest 2 + testcontainers (API); React 18, TanStack Query, openapi-fetch, msw, Testing Library (web). `@wecom/shared` W0 names only.

**Spec:** `docs/superpowers/specs/2026-09-14-kb-wave4-prd-gaps-design.md` §2.2, §3 Governance, §5.2, §5.5, §6, §7. Contract: `docs/api/CONTRACTS-wave4.md` (W2 rows). Consumes `docs/superpowers/plans/2026-09-14-W0-wave4-contracts.md` Tasks 2, 4, 6.

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`; run scripts as `pnpm --filter @wecom/api …` / `pnpm --filter @wecom/web …` from the repo root, or `cd apps/api && …` where a plan step says so.
- Only W0 schema names: `DocumentStatusSchema` (now `draft|review|published|partial|invalid|archived`), `UNPUBLISHED_STATUSES`, `SetStatusBodySchema`, `SourceReviewClearBodySchema`, `DocumentWave4FieldsSchema` (`ownerId, ownerName, editorId, editorName, approverId, approverName, publishedAt, sourceReviewNeeded, sourceReviewReason`), permission `docs.read_unpublished`, `app.notifier` (`Notifier.notify`), `app.taxonomy` (`TaxonomyResolver.worldsOf`). Never re-declare a schema in `apps/api` or `apps/web`.
- Migration file is exactly `apps/api/migrations/0031_governance.js`. Do not touch `0030` (W1), `0032` (W3), `0033` (W4), `0034` (W5).
- Append-only touches allowed: `apps/api/src/modules/index.ts` (none needed — routes are added inside the existing documents module), `packages/shared/src/schemas/api.ts` (`PatchDocumentBodySchema` gains two optional fields — see Task 4), `apps/web/src/routes.tsx` (none needed), `apps/web/src/api/keys.ts` (none needed).
- Never edit: `packages/shared/src/schemas/stage45.ts`, `apps/api/src/app.ts`, `apps/web/src/components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`. Components are exported with a one-line mount documented in the lane report.
- Route permission declaration exactly `config: { requires: ['docs.publish'], scope: 'document' }`. Errors via `httpError(status, code, message, details?)` from `apps/api/src/lib/http.ts`. Every mutation writes `audit(tx, …)` inside its transaction.
- Hebrew for user-facing strings, English for identifiers and logs.
- Commit after every task; append the attribution lines from the session to every commit message.

## Facts verified in the codebase (2026-09-14, main `7cf8c4a`)

- `documents.status` is `text not null default 'draft'` with **no check constraint** (`apps/api/migrations/0003_content.js:38`). Widening therefore needs no constraint change; `0031` adds a check so the enum is enforced from now on.
- `apps/api/src/modules/documents/repo.ts`: `assembleMany` (line 51) selects `select * from documents`; `listCards` (162) builds `where` from an array; `publishDocument` (531) updates `current_version/status/updated_by`; `softDelete` (606); `linksFor` (642); `relatedFor` (654). `PublishOptions` is at line 519.
- `apps/api/src/modules/documents/routes.ts`: GET list (79), GET one (97), PATCH (141), publish (238), DELETE (382), links (466), related (478), backlinks (494, wave 3, uses `inboundFor` from `../graph/repo.js`).
- `apps/api/src/modules/search/repo.ts`: `search(q, query, model, categoryScopes)`; the `steps` (line ~70) and `documents` (~120) groups join `documents d`; blocks/fields/scripts do not.
- `apps/api/src/modules/trash/repo.ts`: `purgeExpired(pool, days)` (169) deletes `documents` rows past the window with no published-version check.
- `apps/api/src/modules/sources/revisions.ts`: `SourceRevisionService(pool, queue)`; `ingest()` (82) inserts `source_revisions`, marks the source pending, enqueues `pipeline.process`. Constructed in `apps/api/src/modules/sources/index.ts:22` where `app` is available.
- `apps/api/src/modules/sources/suggestions.ts`: `decide(id, status, actorId)` (180) is the accept/reject path; `publishAccepted` (355) applies accepted suggestions through `ContentApi` and marks revisions accepted.
- Documents map to sources by `documents.source_id` and by `document_links.to_source_id` (type `derived_from_source`).
- Web: `apps/web/src/lib/constants.ts:127` `STATUS_LABEL` lacks `invalid`; `DocCard.tsx` renders status chips inline; `useModal().prompt(title, label, value?, multiline?)` returns `string | null`; `ApiError` has `.status` and `.code`; msw state lives in `apps/web/test/msw/handlers.ts` (`state.documents`, `withMe`, `asDenied`).

## File structure

```
apps/api/migrations/0031_governance.js                       (new) columns + check + backfill
apps/api/src/lib/visibility.ts                               (new) canReadUnpublished(user), visibilityWhere(user, alias)
apps/api/src/modules/documents/repo.ts                       (modify) assembleMany joins owners; listCards/relatedFor/linksFor take visibility; patch columns; publish sets approver/published_at/source_version + clears flag; setStatus(); hasPublishedVersion()
apps/api/src/modules/documents/routes.ts                     (modify) visibility on GET one/list/related/links/backlinks; POST /status; POST /source-review/clear; DELETE 409
apps/api/src/modules/documents/sourceReview.ts               (new) markSourceReviewNeeded(), clearSourceReview(), documentsForSource()
apps/api/src/modules/search/repo.ts                          (modify) 5th param readUnpublished
apps/api/src/modules/search/routes.ts                        (modify) pass canReadUnpublished(user)
apps/api/src/modules/trash/repo.ts                           (modify) purgeExpired skips once-published documents
apps/api/src/modules/sources/revisions.ts                    (modify) optional hooks.onIngested
apps/api/src/modules/sources/index.ts                        (modify) wire onIngested → markSourceReviewNeeded
apps/api/src/modules/sources/suggestions.ts                  (modify) decide(): clear flag when a revision is fully rejected
packages/shared/src/schemas/api.ts                           (modify, append) PatchDocumentBodySchema += ownerId, editorId
apps/api/test/unit/visibility.test.ts                        (new)
apps/api/test/governance.test.ts                             (new) integration: visibility, status, delete 409, ownership, publish fields
apps/api/test/governance-source-review.test.ts               (new) integration: ingest → flag → notify; publish/reject clear
apps/api/test/trash.test.ts                                  (modify) purge skip
apps/api/test/migrations.test.ts                             (modify) new columns exist
apps/web/src/lib/constants.ts                                (modify) STATUS_LABEL.invalid
apps/web/src/api/hooks/governance.ts                         (new) useSetStatus, useClearSourceReview, useReadOnlyReader
apps/web/src/components/governance/StatusChip.tsx            (new)
apps/web/src/components/governance/StatusMenu.tsx            (new) menu items builder + reason dialog
apps/web/src/components/governance/SourceReviewBadge.tsx     (new)
apps/web/src/components/governance/OwnerFields.tsx           (new)
apps/web/src/components/governance/UnavailablePage.tsx       (new)
apps/web/test/msw/handlers.ts                                (modify, append) status + source-review handlers
apps/web/test/governance/Governance.test.tsx                 (new)
docs/api/openapi.json                                        (regenerate)
```

## Names this lane produces (other lanes import these)

| Name | Signature | Consumer |
|---|---|---|
| `canReadUnpublished` | `(user: Pick<ReqUser, 'permissions'>) => boolean` | W1 topic view, W3 feedback (agent may only report on visible items), W5 |
| `visibilityWhere` | `(user: Pick<ReqUser, 'permissions'>, alias = 'd') => string` — returns `''` or `` ` and ${alias}.status in ('published','partial')` `` | W1 `GET /topics/:id/items`, wave 3 backlinks, W5 analytics |
| `markSourceReviewNeeded` | `(tx: Tx, notifier: Notifier, documentId: string, reason: string) => Promise<void>` | W4 (source-document save path calls ingest, which calls this) |
| `clearSourceReview` | `(tx: Tx, documentId: string) => Promise<void>` | W4 |
| `documentsForSource` | `(q: Q, sourceId: string) => Promise<string[]>` | W4 |
| `PublishOptions.sourceVersion?: number \| null` | written to `document_versions.source_version`; publish also clears the flag | W4 passes the current source-document version |
| `SourceRevisionService` ctor | `(pool, queue, hooks?: { onIngested?: (info: { sourceId: string; revisionId: string; actorId: string \| null }) => Promise<void> })` | W4, W6 |
| `NOT_PUBLISHED` (404), `ONCE_PUBLISHED` (409, details `{ allowed: ['invalid','archived'] }`) | error codes | web (all lanes) |

---

### Task 1: Migration 0031 — columns, check constraint, backfill

**Files:**
- Create: `apps/api/migrations/0031_governance.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Consumes: `documents`, `document_versions`, `users` from `0003_content.js`.
- Produces: columns `documents.owner_id uuid`, `editor_id uuid`, `approver_id uuid` (all → `users`), `published_at timestamptz`, `source_review_needed boolean not null default false`, `source_review_reason text`, `source_review_at timestamptz`; `document_versions.source_version integer`; constraint `documents_status_check`.

- [ ] **Step 1: Add the failing assertion** — inside the existing `run('migrations', …)` block of `apps/api/test/migrations.test.ts`:

```ts
  it('adds the wave 4 governance columns and the status check', async () => {
    const cols = await pool.query(
      `select column_name from information_schema.columns where table_name='documents'
         and column_name in ('owner_id','editor_id','approver_id','published_at','source_review_needed','source_review_reason','source_review_at')
       order by 1`,
    );
    expect(cols.rows.map((r) => r.column_name)).toEqual([
      'approver_id', 'editor_id', 'owner_id', 'published_at', 'source_review_at', 'source_review_needed', 'source_review_reason',
    ]);
    const sv = await pool.query(
      "select 1 from information_schema.columns where table_name='document_versions' and column_name='source_version'",
    );
    expect(sv.rowCount).toBe(1);
    await expect(
      pool.query(
        "insert into documents(slug,title,category,wave,priority,status) values ('bad-status','x','sim',1,'m','bogus')",
      ),
    ).rejects.toThrow(/documents_status_check/);
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts`
Expected: FAIL — the column list is empty.

- [ ] **Step 3: Write the migration**

`apps/api/migrations/0031_governance.js`:
```js
/**
 * Wave 4 (W2): status 'invalid', ownership, published_at, source-review flag,
 * and the source-document version a working version was derived from.
 * `documents.status` had no check constraint (0003); one is added now that the enum is closed.
 */
exports.up = (pgm) => {
  pgm.addColumns('documents', {
    owner_id: { type: 'uuid', references: 'users' },
    editor_id: { type: 'uuid', references: 'users' },
    approver_id: { type: 'uuid', references: 'users' },
    published_at: 'timestamptz',
    source_review_needed: { type: 'boolean', notNull: true, default: false },
    source_review_reason: 'text',
    source_review_at: 'timestamptz',
  });
  pgm.addColumns('document_versions', { source_version: 'integer' });
  pgm.addConstraint('documents', 'documents_status_check', {
    check: "status in ('draft','review','published','partial','invalid','archived')",
  });
  // Backfill: whoever last touched the row is its owner and editor; the last published version dates it.
  pgm.sql(`update documents set owner_id = updated_by, editor_id = updated_by where owner_id is null`);
  pgm.sql(`update documents d set published_at = v.at
             from (select document_id, max(created_at) at from document_versions where kind='published' group by 1) v
            where v.document_id = d.id and d.published_at is null`);
  pgm.sql(`update documents d set approver_id = v.author_id
             from (select distinct on (document_id) document_id, author_id from document_versions
                    where kind='published' order by document_id, version desc) v
            where v.document_id = d.id and d.approver_id is null`);
  pgm.createIndex('documents', 'source_review_needed', { where: 'source_review_needed', name: 'documents_source_review_idx' });
};
exports.down = (pgm) => {
  pgm.dropIndex('documents', 'source_review_needed', { name: 'documents_source_review_idx' });
  pgm.dropConstraint('documents', 'documents_status_check');
  pgm.dropColumns('document_versions', ['source_version']);
  pgm.dropColumns('documents', [
    'owner_id', 'editor_id', 'approver_id', 'published_at',
    'source_review_needed', 'source_review_reason', 'source_review_at',
  ]);
};
```

- [ ] **Step 4: Run the migration tests (up, and the existing down-to-empty check)**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/0031_governance.js apps/api/test/migrations.test.ts
git commit -m "feat(api): migration 0031 — status check, ownership, published_at, source-review flag"
```

---

### Task 2: Visibility rule (helper + every read path + search)

**Files:**
- Create: `apps/api/src/lib/visibility.ts`, `apps/api/test/unit/visibility.test.ts`, `apps/api/test/governance.test.ts`
- Modify: `apps/api/src/modules/documents/repo.ts` (`listCards`, `relatedFor`, `linksFor`, new `getVisibleDocument`), `apps/api/src/modules/documents/routes.ts` (GET one, list, related, links, backlinks), `apps/api/src/modules/search/repo.ts`, `apps/api/src/modules/search/routes.ts`

**Interfaces:**
- Consumes: `ReqUser` from `apps/api/src/lib/user.ts` (`permissions: Set<string>`), `UNPUBLISHED_STATUSES` from `@wecom/shared`.
- Produces: `canReadUnpublished(user)`, `visibilityWhere(user, alias = 'd')`, `repo.getVisibleDocument(q, id, user)` (throws 404 `NOT_PUBLISHED` when hidden), `listCards(q, query, userId, categoryScopes, readUnpublished = true)`, `relatedFor(q, doc, readUnpublished = true)`, `linksFor(q, id, readUnpublished = true)`, `search(q, query, model, categoryScopes, readUnpublished = true)`.

- [ ] **Step 1: Unit test for the helper**

`apps/api/test/unit/visibility.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canReadUnpublished, visibilityWhere } from '../../src/lib/visibility.js';

const u = (perms: string[]) => ({ permissions: new Set(perms) });

describe('visibility', () => {
  it('editors see everything', () => {
    expect(canReadUnpublished(u(['docs.read', 'docs.read_unpublished']))).toBe(true);
    expect(visibilityWhere(u(['docs.read_unpublished']))).toBe('');
  });
  it('read-only users see published and partial only', () => {
    expect(canReadUnpublished(u(['docs.read']))).toBe(false);
    expect(visibilityWhere(u(['docs.read']))).toBe(" and d.status in ('published','partial')");
    expect(visibilityWhere(u(['docs.read']), 'x')).toBe(" and x.status in ('published','partial')");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/unit/visibility.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the helper**

`apps/api/src/lib/visibility.ts`:
```ts
import type { ReqUser } from './user.js';

/** Statuses a read-only role may see (PRD §10: only published content by default). */
export const VISIBLE_TO_READERS = ['published', 'partial'] as const;

export const canReadUnpublished = (user: Pick<ReqUser, 'permissions'>): boolean =>
  user.permissions.has('docs.read_unpublished');

/**
 * SQL fragment to append to a `where` clause on a documents alias. Empty for editors.
 * Literal statuses, not a parameter, so callers can splice it into any query without
 * renumbering their placeholders.
 */
export const visibilityWhere = (user: Pick<ReqUser, 'permissions'>, alias = 'd'): string =>
  canReadUnpublished(user) ? '' : ` and ${alias}.status in ('published','partial')`;
```

- [ ] **Step 4: Run the unit test**

Run: `cd apps/api && pnpm vitest run test/unit/visibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing integration tests**

`apps/api/test/governance.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
const READER = ['docs.read'];

run('governance', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let reader: Awaited<ReturnType<typeof makeUser>>;
  let draftId: string;
  let publishedId: string;

  const create = async (title: string) =>
    (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(editor),
        payload: { title, description: 'd', category: 'tech', wave: 1, priority: 'h', kind: 'steps' },
      })
    ).json() as { id: string; etag: string };

  const publish = async (id: string) => {
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(editor) });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(editor), 'if-match': g.headers.etag as string },
      payload: minimalStructure,
    });
    const p = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(editor),
      payload: { label: 'v1' },
    });
    expect(p.statusCode).toBe(200);
    return p.json();
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    editor = await makeUser(db.pool);
    reader = await makeUser(db.pool, { perms: READER });
    draftId = (await create('טיוטה סודית')).id;
    publishedId = (await create('מסמך מפורסם')).id;
    await publish(publishedId);
    // published → related to the draft through an explicit related entry
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${publishedId}`, headers: auth(editor) });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${publishedId}/structure`,
      headers: { ...auth(editor), 'if-match': g.headers.etag as string },
      payload: { ...minimalStructure, related: [{ documentId: draftId, why: 'בדיקה' }] },
    });
    await app.inject({ method: 'POST', url: `/api/v1/documents/${publishedId}/publish`, headers: auth(editor), payload: { label: 'v2' } });
  }, 180000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  describe('visibility', () => {
    it('list: reader gets published/partial only, editor gets all', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/documents', headers: auth(reader) });
      expect(r.json().items.map((c: { id: string }) => c.id)).toEqual([publishedId]);
      const e = await app.inject({ method: 'GET', url: '/api/v1/documents', headers: auth(editor) });
      expect(e.json().total).toBe(2);
    });
    it('get: reader receives 404 NOT_PUBLISHED on a draft', async () => {
      const r = await app.inject({ method: 'GET', url: `/api/v1/documents/${draftId}`, headers: auth(reader) });
      expect(r.statusCode).toBe(404);
      expect(r.json().code).toBe('NOT_PUBLISHED');
      const ok = await app.inject({ method: 'GET', url: `/api/v1/documents/${publishedId}`, headers: auth(reader) });
      expect(ok.statusCode).toBe(200);
    });
    it('related and links hide the draft from the reader', async () => {
      const rel = await app.inject({ method: 'GET', url: `/api/v1/documents/${publishedId}/related`, headers: auth(reader) });
      expect(rel.json().items.some((x: { documentId: string }) => x.documentId === draftId)).toBe(false);
      const relE = await app.inject({ method: 'GET', url: `/api/v1/documents/${publishedId}/related`, headers: auth(editor) });
      expect(relE.json().items.some((x: { documentId: string }) => x.documentId === draftId)).toBe(true);
      const links = await app.inject({ method: 'GET', url: `/api/v1/documents/${publishedId}/links`, headers: auth(reader) });
      expect(links.json().out.some((l: { toDocumentId: string | null }) => l.toDocumentId === draftId)).toBe(false);
    });
    it('search hides draft documents and their steps from the reader', async () => {
      const r = await app.inject({ method: 'GET', url: '/api/v1/search?q=סודית', headers: auth(reader) });
      expect(r.json().total).toBe(0);
      const e = await app.inject({ method: 'GET', url: '/api/v1/search?q=סודית', headers: auth(editor) });
      expect(e.json().total).toBeGreaterThan(0);
    });
    it('backlinks of a hidden document are hidden too', async () => {
      const r = await app.inject({ method: 'GET', url: `/api/v1/documents/${draftId}/backlinks`, headers: auth(reader) });
      expect(r.statusCode).toBe(404);
    });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance.test.ts`
Expected: FAIL — reader sees the draft in the list (total 2) and gets 200 on the draft.

- [ ] **Step 7: Apply the rule in the repo**

`apps/api/src/modules/documents/repo.ts`:

Add after `getDocument` (line 155):
```ts
import { canReadUnpublished } from '../../lib/visibility.js';
import type { ReqUser } from '../../lib/user.js';
import { UNPUBLISHED_STATUSES } from '@wecom/shared';

/** `getDocument` plus the reader rule: an unpublished document is a 404 for users without `docs.read_unpublished`. */
export async function getVisibleDocument(q: Q, id: string, user: Pick<ReqUser, 'permissions'>): Promise<Document | null> {
  const doc = await getDocument(q, id);
  if (!doc) return null;
  if (!canReadUnpublished(user) && (UNPUBLISHED_STATUSES as readonly string[]).includes(doc.status))
    throw httpError(404, 'NOT_PUBLISHED', 'פריט זה אינו זמין כרגע');
  return doc;
}
```

`listCards` — add a 5th parameter and one `where` term:
```ts
export async function listCards(
  q: Q,
  query: ListDocumentsQuery,
  userId: string,
  categoryScopes: readonly string[] | null = null,
  readUnpublished = true,
): Promise<{ items: DocumentCard[]; total: number }> {
  // …existing params/p/where setup…
  const where: string[] = ['d.deleted_at is null'];
  if (!readUnpublished) where.push(`d.status in ('published','partial')`);
```

`linksFor` — filter both directions on the far document's status:
```ts
export async function linksFor(q: Q, id: string, readUnpublished = true) {
  const vis = readUnpublished ? '' : " and (l.to_document_id is null or exists (select 1 from documents t where t.id=l.to_document_id and t.status in ('published','partial')))";
  const visIn = readUnpublished ? '' : " and d.status in ('published','partial')";
  const [out, incoming] = await Promise.all([
    q.query(`select l.* from document_links l where l.from_document_id=$1${vis}`, [id]),
    q.query(
      `select l.* from document_links l join documents d on d.id=l.from_document_id where l.to_document_id=$1 and d.deleted_at is null${visIn}`,
      [id],
    ),
  ]);
  return { out: out.rows.map(mapLink), in: incoming.rows.map(mapLink) };
}
```

`relatedFor` — final lookup filters:
```ts
export async function relatedFor(q: Q, doc: Document, readUnpublished = true) {
  // …unchanged collection of candidate ids…
  const docs = await q.query(
    `select id, title, category from documents where id = any($1) and deleted_at is null${readUnpublished ? '' : " and status in ('published','partial')"}`,
    [ids],
  );
```

- [ ] **Step 8: Apply the rule in the routes**

`apps/api/src/modules/documents/routes.ts` — import `canReadUnpublished` from `'../../lib/visibility.js'` and change:

```ts
  // GET /documents
  const { items, total } = await repo.listCards(app.db, q, user.id, user.categoryScopes, canReadUnpublished(user));

  // GET /documents/:id
  const user = requireUser(req);
  const doc = await repo.getVisibleDocument(app.db, (req.params as { id: string }).id, user);
  if (!doc) throw notFound('המסמך');

  // GET /documents/:id/links
  const user = requireUser(req);
  const { id } = req.params as { id: string };
  if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
  return repo.linksFor(app.db, id, canReadUnpublished(user));

  // GET /documents/:id/related
  const user = requireUser(req);
  const doc = await repo.getVisibleDocument(app.db, (req.params as { id: string }).id, user);
  if (!doc) throw notFound('המסמך');
  return { items: await repo.relatedFor(app.db, doc, canReadUnpublished(user)) };

  // GET /documents/:id/backlinks
  const user = requireUser(req);
  const { id } = req.params as { id: string };
  if (!(await repo.getVisibleDocument(app.db, id, user))) throw notFound('המסמך');
  const items = await inboundFor(app.db, { kind: 'document', key: id });
  if (canReadUnpublished(user)) return { items };
  const ids = [...new Set(items.map((i) => i.documentId))];
  const ok = new Set(
    (await app.db.query(`select id from documents where id = any($1) and status in ('published','partial')`, [ids])).rows.map((r) => r.id as string),
  );
  return { items: items.filter((i) => ok.has(i.documentId)) };
```
The versions, diff and view routes keep `repo.getDocument` but must also refuse hidden documents: replace their `repo.getDocument(app.db, id)` existence checks with `repo.getVisibleDocument(app.db, id, user)` (GET `/versions`, GET `/versions/:v`, GET `/diff`, POST `/view`, POST/DELETE `/pin`).

`apps/api/src/modules/search/repo.ts` — signature and the two document-bearing groups:
```ts
export async function search(
  q: Q,
  query: SearchQuery,
  model: ModelClient | null = null,
  categoryScopes: readonly string[] | null = null,
  readUnpublished = true,
): Promise<SearchResponse> {
  // …
  const visTerm = readUnpublished ? '' : " and d.status in ('published','partial')";
  // steps query: `where d.deleted_at is null and (${cond})${stepScope}${visTerm}`
  // documents query: `from documents d where d.deleted_at is null and (${cond})${docScope}${visTerm}`
```
`apps/api/src/modules/search/routes.ts`:
```ts
import { canReadUnpublished } from '../../lib/visibility.js';
// …
return search(app.db, req.query as Parameters<typeof search>[1], model, user.categoryScopes, canReadUnpublished(user));
```

- [ ] **Step 9: Run the integration tests**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance.test.ts test/documents.test.ts test/search.test.ts`
Expected: PASS (existing tests use `makeUser` with all permissions, so they keep seeing drafts).

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/lib/visibility.ts apps/api/src/modules/documents apps/api/src/modules/search apps/api/test/unit/visibility.test.ts apps/api/test/governance.test.ts
git commit -m "feat(api): published-only visibility for read-only roles across list/get/related/links/backlinks/search"
```

---

### Task 3: Status changes, once-published protection, purge rule

**Files:**
- Modify: `apps/api/src/modules/documents/repo.ts` (`setStatus`, `hasPublishedVersion`), `apps/api/src/modules/documents/routes.ts` (POST `/status`, DELETE 409), `apps/api/src/modules/trash/repo.ts` (`purgeExpired`), `apps/api/test/governance.test.ts`, `apps/api/test/trash.test.ts`

**Interfaces:**
- Consumes: `SetStatusBodySchema`, `DocumentSchema`, `makeEvent('document.updated', …)`.
- Produces: `repo.setStatus(tx, id, status, userId): Promise<Document>`, `repo.hasPublishedVersion(q, id): Promise<boolean>`; route `POST /documents/:id/status`; `DELETE /documents/:id` → 409 `ONCE_PUBLISHED`.

- [ ] **Step 1: Failing tests** — append to `apps/api/test/governance.test.ts` inside `run('governance', …)`:

```ts
  describe('status and deletion', () => {
    it('marks a published document invalid with a reason and audits it', async () => {
      const id = (await create('נוהל ישן')).id;
      await publish(id);
      const denied = await app.inject({ method: 'POST', url: `/api/v1/documents/${id}/status`, headers: auth(reader), payload: { status: 'invalid', reason: 'x' } });
      expect(denied.statusCode).toBe(403);
      const r = await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${id}/status`,
        headers: auth(editor),
        payload: { status: 'invalid', reason: 'הוחלף בנוהל חדש' },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json().status).toBe('invalid');
      const a = await db.pool.query("select after from audit_log where action='docs.status' and entity_id=$1", [id]);
      expect(a.rows[0].after).toEqual({ status: 'invalid', reason: 'הוחלף בנוהל חדש' });
      // hidden from readers now
      const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(reader) });
      expect(g.json().code).toBe('NOT_PUBLISHED');
      // and back to draft is allowed
      const back = await app.inject({ method: 'POST', url: `/api/v1/documents/${id}/status`, headers: auth(editor), payload: { status: 'draft', reason: 'עריכה מחדש' } });
      expect(back.json().status).toBe('draft');
    });

    it('refuses to delete a once-published document', async () => {
      const id = (await create('פורסם פעם')).id;
      await publish(id);
      const d = await app.inject({ method: 'DELETE', url: `/api/v1/documents/${id}`, headers: auth(editor) });
      expect(d.statusCode).toBe(409);
      expect(d.json().code).toBe('ONCE_PUBLISHED');
      expect(d.json().details).toEqual({ allowed: ['invalid', 'archived'] });
      const still = await db.pool.query('select deleted_at from documents where id=$1', [id]);
      expect(still.rows[0].deleted_at).toBeNull();
    });

    it('still deletes a never-published draft', async () => {
      const id = (await create('טיוטה למחיקה')).id;
      const d = await app.inject({ method: 'DELETE', url: `/api/v1/documents/${id}`, headers: auth(editor) });
      expect(d.statusCode).toBe(200);
    });
  });
```

And in `apps/api/test/trash.test.ts`, after the existing `purgeExpired removes rows older than the window` test:
```ts
  it('purgeExpired never removes a document that has a published version', async () => {
    const r = await db.pool.query(
      `insert into documents(slug,title,category,wave,priority,status,current_version,deleted_at)
       values ('once-pub','x','sim',1,'m','archived',1, now() - interval '400 days') returning id`,
    );
    const id = r.rows[0].id as string;
    await db.pool.query(
      `insert into document_versions(document_id, version, snapshot, kind, label) values ($1,1,'{}','published','v1')`,
      [id],
    );
    const { purgeExpired } = await import('../src/modules/trash/repo.js');
    await purgeExpired(db.pool, 30);
    const still = await db.pool.query('select 1 from documents where id=$1', [id]);
    expect(still.rowCount).toBe(1);
  });
```
(The document row in that test was soft-deleted by SQL, not through the API, which is the only way such a row can exist after this task — the purge rule must hold regardless.)

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance.test.ts test/trash.test.ts`
Expected: FAIL — `/status` is 404 (route missing); delete returns 200; purge removes the row.

- [ ] **Step 3: Repo functions**

Append to `apps/api/src/modules/documents/repo.ts`:
```ts
export const hasPublishedVersion = async (q: Q, id: string): Promise<boolean> =>
  ((await q.query(`select 1 from document_versions where document_id=$1 and kind='published' limit 1`, [id])).rowCount ?? 0) > 0;

/** PRD §10: once-published items are never deleted; they move to 'invalid' or 'archived' (or back to 'draft' to be reworked). */
export async function setStatus(
  tx: Tx,
  id: string,
  status: 'invalid' | 'archived' | 'draft',
  userId: string,
): Promise<Document> {
  const r = await tx.query(
    `update documents set status=$2, updated_by=$3, updated_at=now(), etag=gen_random_uuid()::text
      where id=$1 and deleted_at is null returning id`,
    [id, status, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  return (await getDocument(tx, id))!;
}
```

`apps/api/src/modules/trash/repo.ts` — in `purgeExpired`, replace the loop body for `documents`:
```ts
  for (const table of ['documents', 'blocks', 'crm_fields', 'scripts']) {
    const guard =
      table === 'documents'
        ? ` and not exists (select 1 from document_versions v where v.document_id=documents.id and v.kind='published')`
        : '';
    const r = await pool.query(
      `delete from ${table} where deleted_at is not null and deleted_at < ${cutoff}${guard}`,
    );
    n += r.rowCount ?? 0;
  }
```

- [ ] **Step 4: Routes**

`apps/api/src/modules/documents/routes.ts` — import `SetStatusBodySchema` from `@wecom/shared`; add after the publish route:
```ts
  app.post(
    '/documents/:id/status',
    {
      config: { requires: ['docs.publish'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, body: SetStatusBodySchema, response: { 200: DocumentSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof SetStatusBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.category)) throw forbidden();
        const after = await repo.setStatus(tx, id, body.status, user.id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.status',
          entityType: 'document',
          entityId: id,
          before: { status: before.status },
          after: { status: after.status, reason: body.reason },
          requestId: req.id,
          ip: req.ip,
        });
        await app.events.publish(tx, makeEvent('document.updated', { documentId: id, actorId: user.id, etag: after.etag }));
        return after;
      });
    },
  );
```
In the DELETE handler, right after the scope check:
```ts
        if (await repo.hasPublishedVersion(tx, id))
          throw httpError(409, 'ONCE_PUBLISHED', 'פריט שפורסם בעבר אינו נמחק; העבר אותו ל"לא בתוקף" או לארכיון', {
            allowed: ['invalid', 'archived'],
          });
```

- [ ] **Step 5: Run**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance.test.ts test/trash.test.ts test/documents.test.ts`
Expected: PASS. If an existing test in `documents.test.ts` deletes a document it had published, change that test to delete an unpublished draft instead and note it in the commit body.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/documents apps/api/src/modules/trash/repo.ts apps/api/test/governance.test.ts apps/api/test/trash.test.ts
git commit -m "feat(api): status changes with reason, once-published delete guard, purge skips published items"
```

---

### Task 4: Ownership fields (patch, publish, names on cards and documents)

**Files:**
- Modify: `packages/shared/src/schemas/api.ts` (append two optional fields to `PatchDocumentBodySchema`), `apps/api/src/modules/documents/repo.ts` (`assembleMany`, `listCards`, `PATCH_COLUMNS`, `publishDocument`), `apps/api/test/governance.test.ts`

**Interfaces:**
- Consumes: `DocumentWave4FieldsSchema` fields (already merged into `DocumentSchema`/`DocumentCardSchema` by W0).
- Produces: `PatchDocumentBodySchema` accepts `ownerId?: uuid | null`, `editorId?: uuid | null`; `Document`/`DocumentCard` responses carry `ownerId, ownerName, editorId, editorName, approverId, approverName, publishedAt, sourceReviewNeeded, sourceReviewReason`; publish sets `approver_id = actor`, `published_at = now()`.
- Contract note for W1: W1 appends `docType, tags, worlds, topics, bodyHtml` to the same `.extend({...})` block; keep each field on its own line to make the merge trivial.

- [ ] **Step 1: Failing tests** — append to `apps/api/test/governance.test.ts`:

```ts
  describe('ownership', () => {
    it('patches owner and editor, and publish stamps approver and publishedAt', async () => {
      const owner = await makeUser(db.pool, { name: 'רונית מ.' });
      const id = (await create('עם בעלים')).id;
      const p = await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: auth(editor),
        payload: { ownerId: owner.id, editorId: editor.id },
      });
      expect(p.statusCode).toBe(200);
      expect(p.json().ownerId).toBe(owner.id);
      expect(p.json().ownerName).toBe('רונית מ.');
      expect(p.json().editorId).toBe(editor.id);
      expect(p.json().approverId).toBeNull();
      expect(p.json().publishedAt).toBeNull();
      await publish(id);
      const g = (await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(editor) })).json();
      expect(g.approverId).toBe(editor.id);
      expect(g.approverName).toBe(editor.name);
      expect(typeof g.publishedAt).toBe('string');
      const card = (await app.inject({ method: 'GET', url: '/api/v1/documents?q=בעלים', headers: auth(editor) })).json().items[0];
      expect(card.ownerName).toBe('רונית מ.');
      expect(card.sourceReviewNeeded).toBe(false);
    });
    it('rejects an unknown owner id with 400', async () => {
      const id = (await create('בעלים שגוי')).id;
      const p = await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: auth(editor),
        payload: { ownerId: '00000000-0000-4000-8000-000000000000' },
      });
      expect(p.statusCode).toBe(400);
      expect(p.json().code).toBe('UNKNOWN_USER');
    });
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance.test.ts -t ownership`
Expected: FAIL — `ownerId` is stripped by the body schema (400 or ignored).

- [ ] **Step 3: Shared schema (append-only)**

`packages/shared/src/schemas/api.ts`:
```ts
export const PatchDocumentBodySchema = DocumentSchema.pick({
  title: true,
  description: true,
  category: true,
  wave: true,
  priority: true,
  code: true,
  sourceRef: true,
})
  .partial()
  .extend({
    ownerId: IdSchema.nullable().optional(), // W2
    editorId: IdSchema.nullable().optional(), // W2
  });
```
Run `pnpm --filter @wecom/shared test` — still green.

- [ ] **Step 4: Repo — read side**

`assembleMany`: replace the first query with
```ts
    q.query(
      `select d.*, ou.display_name owner_name, eu.display_name editor_name, au.display_name approver_name
         from documents d
         left join users ou on ou.id=d.owner_id
         left join users eu on eu.id=d.editor_id
         left join users au on au.id=d.approver_id
        where d.id = any($1) and d.deleted_at is null`,
      [ids],
    ),
```
and add to the `DocumentSchema.parse({...})` object:
```ts
        ownerId: row.owner_id ?? null,
        ownerName: row.owner_name ?? null,
        editorId: row.editor_id ?? null,
        editorName: row.editor_name ?? null,
        approverId: row.approver_id ?? null,
        approverName: row.approver_name ?? null,
        publishedAt: iso(row.published_at),
        sourceReviewNeeded: row.source_review_needed ?? false,
        sourceReviewReason: row.source_review_reason ?? null,
```
`listCards`: add `left join users ou on ou.id=d.owner_id` to `base` and `ou.display_name owner_name` to the select list; add to the card parse:
```ts
        ownerId: r.owner_id ?? null,
        ownerName: r.owner_name ?? null,
        editorId: r.editor_id ?? null,
        approverId: r.approver_id ?? null,
        publishedAt: iso(r.published_at),
        sourceReviewNeeded: r.source_review_needed ?? false,
        sourceReviewReason: r.source_review_reason ?? null,
```

- [ ] **Step 5: Repo — write side**

`PATCH_COLUMNS` gains `ownerId: 'owner_id', editorId: 'editor_id'`. In `patchDocument`, before building `sets`, validate user ids:
```ts
  for (const key of ['ownerId', 'editorId'] as const) {
    const v = body[key];
    if (v) {
      const u = await tx.query('select 1 from users where id=$1 and active', [v]);
      if (!u.rowCount) throw httpError(400, 'UNKNOWN_USER', 'המשתמש שנבחר אינו קיים או אינו פעיל', { field: key });
    }
  }
```
(`users.active` exists per stage-1 §2; if the column is named differently in `0002_identity.js`, use that name.)

`publishDocument` — the update becomes:
```ts
  await tx.query(
    `update documents set current_version=$2, status=$3, updated_by=$4, updated_at=now(), etag=gen_random_uuid()::text,
            approver_id=$4, published_at=now()
      where id=$1`,
    [id, version, status, opts.actorId],
  );
```

- [ ] **Step 6: Run**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance.test.ts test/documents.test.ts test/search.test.ts test/blocks.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/schemas/api.ts apps/api/src/modules/documents/repo.ts apps/api/test/governance.test.ts
git commit -m "feat(api,shared): owner/editor on patch, approver + publishedAt on publish, names on cards and documents"
```

---

### Task 5: Source-review flag (raise on ingest, clear on publish or full rejection)

**Files:**
- Create: `apps/api/src/modules/documents/sourceReview.ts`, `apps/api/test/governance-source-review.test.ts`
- Modify: `apps/api/src/modules/sources/revisions.ts` (hooks), `apps/api/src/modules/sources/index.ts` (wiring), `apps/api/src/modules/documents/repo.ts` (`PublishOptions.sourceVersion`, clear in `publishDocument`), `apps/api/src/modules/documents/routes.ts` (POST `/source-review/clear`), `apps/api/src/modules/sources/suggestions.ts` (`decide`)

**Interfaces:**
- Consumes: `Notifier` (`app.notifier`), `Tx`, `SourceReviewClearBodySchema`, `SourceRevisionService.ingest`.
- Produces: `documentsForSource(q, sourceId)`, `markSourceReviewNeeded(tx, notifier, documentId, reason)`, `clearSourceReview(tx, documentId)`, `PublishOptions.sourceVersion?: number | null`, `SourceRevisionService(pool, queue, hooks?)`, route `POST /documents/:id/source-review/clear`.

- [ ] **Step 1: Failing tests**

`apps/api/test/governance-source-review.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { NotifyInput } from '@wecom/shared';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';
import { SourceRevisionService } from '../src/modules/sources/revisions.js';
import { parseText } from '../src/modules/sources/text.js';
import { markSourceReviewNeeded, documentsForSource } from '../src/modules/documents/sourceReview.js';
import { withTransaction } from '../src/lib/sql.js';

const run = integration ? describe : describe.skip;

run('source review flag', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  const sent: NotifyInput[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    app.notifier = { notify: async (n) => { sent.push(n); } };
    editor = await makeUser(db.pool, { name: 'עורך' });
  }, 180000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const createLinked = async (sourceId: string, ownerId: string) => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(editor),
        payload: { title: 'מקושר למקור', category: 'tech', wave: 1, priority: 'h', kind: 'steps' },
      })
    ).json() as { id: string };
    await db.pool.query('update documents set source_id=$2, owner_id=$3, editor_id=$4 where id=$1', [c.id, sourceId, ownerId, editor.id]);
    return c.id;
  };

  it('ingest raises the flag on every linked document and notifies owner + editor once', async () => {
    const owner = await makeUser(db.pool, { name: 'בעלת תוכן' });
    const svc = app.sourcesDeps.revisions; // see Step 4: registerSourcesModule exposes deps on the app for tests
    const { id: sourceId } = await svc.createSource({ kind: 'text', title: 'נהלים' }, editor.id);
    const docId = await createLinked(sourceId, owner.id);
    expect(await documentsForSource(db.pool, sourceId)).toEqual([docId]);

    await svc.ingest(sourceId, parseText('n.md', '4.8 בדיקת מהירות. בקש Speedtest.'), editor.id);
    const d = (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(editor) })).json();
    expect(d.sourceReviewNeeded).toBe(true);
    expect(d.sourceReviewReason).toMatch(/נהלים/);
    const n = sent.find((x) => x.entityId === docId)!;
    expect(n.kind).toBe('source');
    expect(new Set(n.userIds)).toEqual(new Set([owner.id, editor.id]));
  });

  it('publish clears the flag and records the source version', async () => {
    const svc = app.sourcesDeps.revisions;
    const { id: sourceId } = await svc.createSource({ kind: 'text', title: 'נהלים ב' }, editor.id);
    const docId = await createLinked(sourceId, editor.id);
    await withTransaction(db.pool, (tx) => markSourceReviewNeeded(tx, app.notifier, docId, 'בדיקה'));
    const g = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(editor) });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(editor), 'if-match': g.headers.etag as string },
      payload: minimalStructure,
    });
    const p = await app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/publish`, headers: auth(editor), payload: { label: 'v1' } });
    expect(p.json().document.sourceReviewNeeded).toBe(false);
  });

  it('an editor can clear the flag with a note, audited', async () => {
    const svc = app.sourcesDeps.revisions;
    const { id: sourceId } = await svc.createSource({ kind: 'text', title: 'נהלים ג' }, editor.id);
    const docId = await createLinked(sourceId, editor.id);
    await withTransaction(db.pool, (tx) => markSourceReviewNeeded(tx, app.notifier, docId, 'בדיקה'));
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/source-review/clear`,
      headers: auth(editor),
      payload: { note: 'השינוי במקור אינו משפיע על המסלול' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().sourceReviewNeeded).toBe(false);
    const a = await db.pool.query("select after from audit_log where action='docs.source_review_cleared' and entity_id=$1", [docId]);
    expect(a.rows[0].after).toEqual({ note: 'השינוי במקור אינו משפיע על המסלול' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance-source-review.test.ts`
Expected: FAIL — `sourceReview.js` not found.

- [ ] **Step 3: The flag module**

`apps/api/src/modules/documents/sourceReview.ts`:
```ts
import type { Notifier } from '@wecom/shared';
import type { Tx } from '../../lib/sql.js';
import type { Q } from './repo.js';

/** Live documents fed by a source: via `documents.source_id` or a `derived_from_source` link. */
export async function documentsForSource(q: Q, sourceId: string): Promise<string[]> {
  const r = await q.query(
    `select d.id from documents d
      where d.deleted_at is null
        and (d.source_id = $1 or exists (select 1 from document_links l where l.from_document_id=d.id and l.to_source_id=$1))
      order by d.title`,
    [sourceId],
  );
  return r.rows.map((x) => x.id as string);
}

/**
 * PRD §8: a change in the source marks the working view "נדרשת לבדיקה" and alerts the people
 * responsible. Idempotent — re-raising only refreshes the reason and timestamp; the alert is sent
 * once per raise (callers raise once per ingested revision).
 */
export async function markSourceReviewNeeded(tx: Tx, notifier: Notifier, documentId: string, reason: string): Promise<void> {
  const r = await tx.query(
    `update documents set source_review_needed=true, source_review_reason=$2, source_review_at=now()
      where id=$1 and deleted_at is null returning title, owner_id, editor_id`,
    [documentId, reason],
  );
  if (!r.rowCount) return;
  const { title, owner_id, editor_id } = r.rows[0] as { title: string; owner_id: string | null; editor_id: string | null };
  const userIds = [...new Set([owner_id, editor_id].filter((x): x is string => !!x))];
  if (!userIds.length) return;
  await notifier.notify({
    userIds,
    kind: 'source',
    title: 'שינוי במקור הידע: ' + title,
    body: reason,
    href: `/doc/${documentId}`,
    entityType: 'document',
    entityId: documentId,
  });
}

export async function clearSourceReview(tx: Tx, documentId: string): Promise<void> {
  await tx.query(
    `update documents set source_review_needed=false, source_review_reason=null, source_review_at=null where id=$1`,
    [documentId],
  );
}
```

- [ ] **Step 4: Hook the ingest path**

`apps/api/src/modules/sources/revisions.ts`:
```ts
export interface RevisionHooks {
  /** Runs after the revision row is committed and the job is queued (W2 raises the source-review flag here). */
  onIngested?: (info: { sourceId: string; revisionId: string; actorId: string | null }) => Promise<void>;
}

export class SourceRevisionService {
  constructor(
    readonly pool: pg.Pool,
    private readonly queue: JobQueue,
    private readonly hooks: RevisionHooks = {},
  ) {}
  // … in ingest(), after `await this.queue.send(...)`:
    if (this.hooks.onIngested) await this.hooks.onIngested({ sourceId, revisionId, actorId });
    return { revisionId, duplicate: false };
```

`apps/api/src/modules/sources/index.ts`:
```ts
import { withTransaction } from '../../lib/sql.js';
import { documentsForSource, markSourceReviewNeeded } from '../documents/sourceReview.js';
// …
  const revisions = new SourceRevisionService(
    app.db,
    { send: async (name, data, opts) => (app.boss ? app.boss.send(name, data, opts ?? {}) : null) },
    {
      onIngested: async ({ sourceId, revisionId, actorId }) => {
        const src = await app.db.query('select title from sources where id=$1', [sourceId]);
        const who = actorId
          ? ((await app.db.query('select display_name from users where id=$1', [actorId])).rows[0]?.display_name as string | undefined)
          : undefined;
        const reason = `גרסת מקור חדשה · ${src.rows[0]?.title ?? sourceId} · ${who ?? 'סנכרון'} · ${revisionId.slice(0, 8)}`;
        for (const docId of await documentsForSource(app.db, sourceId))
          await withTransaction(app.db, (tx) => markSourceReviewNeeded(tx, app.notifier, docId, reason));
      },
    },
  );
  // …
  app.decorate('sourcesDeps', deps); // tests reach the real services; add `sourcesDeps: PipelineDeps` to the fastify module augmentation in this file
```
Add the augmentation at the top of `index.ts`:
```ts
declare module 'fastify' {
  interface FastifyInstance {
    sourcesDeps: PipelineDeps;
  }
}
```

- [ ] **Step 5: Clear on publish and expose `sourceVersion`**

`apps/api/src/modules/documents/repo.ts`:
```ts
export interface PublishOptions {
  actorId: string | null;
  label: string;
  suggestionId?: string | null;
  markPartial?: boolean;
  kind?: 'published' | 'restore' | 'system' | 'sync';
  /** W4: the source-document version this working version was derived from. */
  sourceVersion?: number | null;
}
```
In `publishDocument`, the `update documents …` statement also sets `source_review_needed=false, source_review_reason=null, source_review_at=null`, and the versions insert becomes:
```ts
    'insert into document_versions(document_id, version, snapshot, author_id, label, kind, suggestion_id, source_version) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id',
    [id, version, JSON.stringify(published), opts.actorId, opts.label, opts.kind ?? 'published', opts.suggestionId ?? null, opts.sourceVersion ?? null],
```

- [ ] **Step 6: Clear route and full-rejection clear**

`apps/api/src/modules/documents/routes.ts` — import `SourceReviewClearBodySchema` and `clearSourceReview`:
```ts
  app.post(
    '/documents/:id/source-review/clear',
    {
      config: { requires: ['docs.edit'], scope: 'document' },
      schema: { tags: ['documents'], params: Params, body: SourceReviewClearBodySchema, response: { 200: DocumentSchema } },
    },
    async (req) => {
      const user = requireUser(req);
      const { id } = req.params as { id: string };
      const { note } = req.body as z.infer<typeof SourceReviewClearBodySchema>;
      return withTransaction(app.db, async (tx) => {
        const before = await repo.getDocument(tx, id);
        if (!before) throw notFound('המסמך');
        if (!hasScope(user, before.category)) throw forbidden();
        await clearSourceReview(tx, id);
        await audit(tx, {
          actorId: user.id,
          action: 'docs.source_review_cleared',
          entityType: 'document',
          entityId: id,
          before: { reason: before.sourceReviewReason ?? null },
          after: { note },
          requestId: req.id,
          ip: req.ip,
        });
        const after = (await repo.getDocument(tx, id))!;
        await app.events.publish(tx, makeEvent('document.updated', { documentId: id, actorId: user.id, etag: after.etag }));
        return after;
      });
    },
  );
```

`apps/api/src/modules/sources/suggestions.ts` — in `decide()`, after the `update suggestions …` statement and before `commit`, when `status === 'rejected'`:
```ts
      if (status === 'rejected') {
        // Every suggestion of this revision decided and none accepted/applied → the editor judged the
        // working view unaffected; the source-review flag on the targeted documents comes down.
        const left = await client.query(
          `select count(*) filter (where status='pending') pending,
                  count(*) filter (where status in ('accepted','applied')) kept,
                  array_agg(distinct target_document_id) filter (where target_document_id is not null) docs
             from suggestions where source_revision_id=$1`,
          [cur.sourceRevisionId],
        );
        const row0 = left.rows[0] as { pending: string; kept: string; docs: string[] | null };
        if (Number(row0.pending) === 0 && Number(row0.kept) === 0)
          for (const d of row0.docs ?? [])
            await client.query(
              `update documents set source_review_needed=false, source_review_reason=null, source_review_at=null where id=$1`,
              [d],
            );
      }
```
(`cur.sourceRevisionId` is the camelCase field the `row()` mapper in that file already produces from `source_revision_id`; verify the name at `suggestions.ts` line ~45 and use it exactly.)

- [ ] **Step 7: Run**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/governance-source-review.test.ts test/sources test/governance.test.ts && pnpm typecheck`
Expected: PASS; typecheck clean (the `revisions.test.ts` two-argument constructor still compiles because `hooks` is optional).

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/documents apps/api/src/modules/sources apps/api/test/governance-source-review.test.ts
git commit -m "feat(api): source-review flag raised on ingest, cleared on publish / full rejection / editor note; PublishOptions.sourceVersion"
```

---

### Task 6: Web components and hooks

**Files:**
- Create: `apps/web/src/api/hooks/governance.ts`, `apps/web/src/components/governance/StatusChip.tsx`, `StatusMenu.tsx`, `SourceReviewBadge.tsx`, `OwnerFields.tsx`, `UnavailablePage.tsx`, `apps/web/test/governance/Governance.test.tsx`
- Modify: `apps/web/src/lib/constants.ts` (`STATUS_LABEL.invalid`), `apps/web/test/msw/handlers.ts` (append handlers), `apps/web/test/msw/fixtures.ts` (optional fields on `docBrowsing`)

**Interfaces:**
- Consumes: generated `paths` for `/documents/{id}/status` and `/documents/{id}/source-review/clear` (after Task 7's client regeneration — until then run `pnpm --filter @wecom/api openapi && pnpm --filter @wecom/web generate:client` locally first), `useModal`, `useToast`, `useCan`, `DocumentCard`/`Document` types.
- Produces (mount points for W6, one line each):
  - `<StatusChip status={card.status} />` — replaces the inline chip logic in `DocCard.tsx`.
  - `statusMenuItems(card, { can, setStatus, prompt })` → `MenuItem[]` — spread into the `CardMenu` items in `LibraryPage.tsx`.
  - `<SourceReviewBadge doc={doc} onClear={…} />` — article header and card meta row, editors only.
  - `<OwnerFields doc={doc} onChange={(patch) => …} />` — inside W1's `MetadataPanel` (editor side pane).
  - `<UnavailablePage />` — rendered by `ArticlePage` when `docQ.error instanceof ApiError && error.code === 'NOT_PUBLISHED'`.
  - `useReadOnlyReader()` → `boolean` (true when the user lacks `docs.read_unpublished`) — hides status filters/chips in the library and search.

- [ ] **Step 1: Failing web tests**

`apps/web/test/governance/Governance.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { ModalProvider } from '../../src/components/ui/Modal.js';
import { StatusChip } from '../../src/components/governance/StatusChip.js';
import { SourceReviewBadge } from '../../src/components/governance/SourceReviewBadge.js';
import { OwnerFields } from '../../src/components/governance/OwnerFields.js';
import { UnavailablePage } from '../../src/components/governance/UnavailablePage.js';
import { StatusActions } from '../../src/components/governance/StatusMenu.js';
import { state } from '../msw/handlers.js';
import { fx } from '../msw/fixtures.js';

describe('governance components', () => {
  it('StatusChip labels every status in Hebrew', () => {
    renderWithProviders(
      <>
        <StatusChip status="invalid" />
        <StatusChip status="archived" />
        <StatusChip status="published" />
      </>,
    );
    expect(screen.getByText('לא בתוקף')).toBeInTheDocument();
    expect(screen.getByText('בארכיון')).toBeInTheDocument();
    expect(screen.queryByText('פורסם')).not.toBeInTheDocument(); // published renders no chip
  });

  it('StatusActions asks for a reason and posts the status change', async () => {
    renderWithProviders(
      <ModalProvider>
        <StatusActions doc={{ id: fx.docBrowsing.id, status: 'published', category: fx.docBrowsing.category }} />
      </ModalProvider>,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'סמן כלא בתוקף' }));
    const box = await screen.findByLabelText('סיבה');
    await userEvent.type(box, 'הוחלף בנוהל חדש');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(state.statusChanges).toEqual([{ id: fx.docBrowsing.id, status: 'invalid', reason: 'הוחלף בנוהל חדש' }]));
  });

  it('SourceReviewBadge shows the reason and clears with a note', async () => {
    renderWithProviders(
      <ModalProvider>
        <SourceReviewBadge doc={{ id: fx.docBrowsing.id, sourceReviewNeeded: true, sourceReviewReason: 'גרסת מקור חדשה · נהלים' }} />
      </ModalProvider>,
    );
    expect(screen.getByText(/נדרשת בדיקה/)).toBeInTheDocument();
    expect(screen.getByTitle('גרסת מקור חדשה · נהלים')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'סמן כנבדק' }));
    await userEvent.type(await screen.findByLabelText('הערה'), 'לא משפיע');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(state.sourceReviewCleared).toEqual([{ id: fx.docBrowsing.id, note: 'לא משפיע' }]));
  });

  it('OwnerFields emits a patch with the chosen ids', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <OwnerFields doc={{ ownerId: null, editorId: null, approverName: 'ענבר ל.', publishedAt: '2026-09-01T00:00:00.000Z' }} onChange={onChange} />,
    );
    const owner = await screen.findByLabelText('גורם מקצועי אחראי');
    await userEvent.selectOptions(owner, fx.me.user.id);
    expect(onChange).toHaveBeenCalledWith({ ownerId: fx.me.user.id });
    expect(screen.getByText(/מאשר: ענבר ל\./)).toBeInTheDocument();
  });

  it('UnavailablePage explains and links back', () => {
    renderWithProviders(<UnavailablePage />);
    expect(screen.getByRole('heading', { name: 'פריט זה אינו זמין כרגע' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'חזרה לספרייה' })).toHaveAttribute('href', '/library');
  });
});
```

- [ ] **Step 2: msw handlers and state (append)**

In `apps/web/test/msw/handlers.ts` add to `State`:
```ts
  statusChanges: { id: string; status: string; reason: string }[];
  sourceReviewCleared: { id: string; note: string }[];
```
initialise both as `[]` in `initial()`, and append handlers:
```ts
  http.post(`${B}/documents/:id/status`, async ({ params, request }) => {
    const b = (await request.json()) as { status: 'invalid' | 'archived' | 'draft'; reason: string };
    const doc = state.documents.get(params.id as string);
    if (!doc) return notFound();
    state.statusChanges.push({ id: params.id as string, status: b.status, reason: b.reason });
    const next = { ...doc, status: b.status };
    state.documents.set(doc.id, next);
    return HttpResponse.json(next);
  }),
  http.post(`${B}/documents/:id/source-review/clear`, async ({ params, request }) => {
    const b = (await request.json()) as { note: string };
    const doc = state.documents.get(params.id as string);
    if (!doc) return notFound();
    state.sourceReviewCleared.push({ id: params.id as string, note: b.note });
    const next = { ...doc, sourceReviewNeeded: false, sourceReviewReason: null };
    state.documents.set(doc.id, next);
    return HttpResponse.json(next);
  }),
  // OwnerFields picks people from the mentionable list wave 3 already exposes.
  http.get(`${B}/users/mentionable`, () =>
    HttpResponse.json({ items: [{ id: fx.me.user.id, displayName: fx.me.user.displayName, initials: fx.me.user.initials, email: fx.me.user.email }] }),
  ),
```
(If `GET /users/mentionable` is already handled by wave 3's msw additions, do not add a second handler.) In `apps/web/test/msw/fixtures.ts` add to `docBrowsing`: `ownerId: null, editorId: null, approverId: null, publishedAt: T, sourceReviewNeeded: false, tags: [], worlds: ['tech'], topics: []`.

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- governance`
Expected: FAIL — components not found.

- [ ] **Step 4: Constants and hooks**

`apps/web/src/lib/constants.ts` — `STATUS_LABEL` gains `invalid: 'לא בתוקף'` (keep the others).

`apps/web/src/api/hooks/governance.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import { useMe } from './me.js';

export type SettableStatus = 'invalid' | 'archived' | 'draft';

/** True for agents: the API hides unpublished items from them, so the UI hides status controls too. */
export function useReadOnlyReader(): boolean {
  const { data } = useMe();
  return !!data && !data.permissions.includes('docs.read_unpublished');
}

export function useSetStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: SettableStatus; reason: string }) =>
      unwrap(await api.POST('/documents/{id}/status', { params: { path: { id } }, body: { status, reason } })),
    onSuccess: (doc, { id }) => {
      qc.setQueryData(keys.doc(id), doc);
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useClearSourceReview() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, note }: { id: string; note: string }) =>
      unwrap(await api.POST('/documents/{id}/source-review/clear', { params: { path: { id } }, body: { note } })),
    onSuccess: (doc, { id }) => {
      qc.setQueryData(keys.doc(id), doc);
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

/** People pickable as owner/editor — wave 3's mentionable users list. */
export const useMentionable = (q = '') =>
  useQuery({
    queryKey: ['mentionable', q] as const,
    queryFn: async () => unwrap(await api.GET('/users/mentionable', { params: { query: { q } } })).items,
    staleTime: 60_000,
  });
```

- [ ] **Step 5: Components**

`apps/web/src/components/governance/StatusChip.tsx`:
```tsx
import type { DocumentStatus } from '@wecom/shared';
import { STATUS_LABEL } from '../../lib/constants.js';

const TONE: Record<DocumentStatus, string | null> = {
  draft: 'chip-amber',
  review: 'chip-amber',
  published: null, // no chip — the normal state
  partial: 'chip-amber',
  invalid: 'chip-red',
  archived: 'chip-gray',
};

/** One status chip for cards, article header and search rows. Renders nothing for `published`. */
export function StatusChip({ status }: { status: DocumentStatus }) {
  const tone = TONE[status];
  if (!tone) return null;
  return <span className={`chip ${tone}`}>{STATUS_LABEL[status]}</span>;
}
```

`apps/web/src/components/governance/StatusMenu.tsx`:
```tsx
import type { Category, DocumentStatus } from '@wecom/shared';
import type { MenuItem } from '../library/CardMenu.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { useCan } from '../../api/hooks/me.js';
import { useSetStatus, type SettableStatus } from '../../api/hooks/governance.js';

type Doc = { id: string; status: DocumentStatus; category: Category };

const ACTIONS: { status: SettableStatus; label: string; from: DocumentStatus[] }[] = [
  { status: 'invalid', label: 'סמן כלא בתוקף', from: ['published', 'partial', 'archived'] },
  { status: 'archived', label: 'העבר לארכיון', from: ['published', 'partial', 'invalid'] },
  { status: 'draft', label: 'החזר לטיוטה', from: ['invalid', 'archived'] },
];

/** Builds the status items for the card ⋯ menu. Returns [] when the user cannot publish this document. */
export function useStatusMenuItems(): (doc: Doc) => MenuItem[] {
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const set = useSetStatus();
  return (doc) => {
    if (!can('docs.publish', doc)) return [];
    return ACTIONS.filter((a) => a.from.includes(doc.status)).map((a) => ({
      label: a.label,
      run: async () => {
        const reason = await modal.prompt(a.label, 'סיבה', '', true);
        if (!reason?.trim()) return;
        try {
          await set.mutateAsync({ id: doc.id, status: a.status, reason: reason.trim() });
          toast('הסטטוס עודכן', 'ok');
        } catch {
          toast('עדכון הסטטוס נכשל', 'warn');
        }
      },
    }));
  };
}

/** Inline buttons for the article header (same actions, without the kebab). */
export function StatusActions({ doc }: { doc: Doc }) {
  const items = useStatusMenuItems()(doc);
  if (!items.length) return null;
  return (
    <span className="status-actions">
      {items.map((it) => (
        <button key={it.label} className="btn sm" onClick={() => void it.run()}>
          {it.label}
        </button>
      ))}
    </span>
  );
}
```

`apps/web/src/components/governance/SourceReviewBadge.tsx`:
```tsx
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { useCan } from '../../api/hooks/me.js';
import { useClearSourceReview } from '../../api/hooks/governance.js';

type Doc = { id: string; sourceReviewNeeded: boolean; sourceReviewReason?: string | null; category?: string };

/** Amber "נדרשת בדיקה" marker with the reason as tooltip; editors can clear it with a note. */
export function SourceReviewBadge({ doc }: { doc: Doc }) {
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const clear = useClearSourceReview();
  if (!doc.sourceReviewNeeded) return null;
  const editable = doc.category ? can('docs.edit', { category: doc.category as never }) : can('docs.edit');
  return (
    <span className="chip chip-amber source-review" title={doc.sourceReviewReason ?? ''}>
      ⚑ נדרשת בדיקה — המקור השתנה
      {editable ? (
        <button
          className="btn xs"
          onClick={async () => {
            const note = await modal.prompt('סימון כנבדק', 'הערה', '', true);
            if (!note?.trim()) return;
            try {
              await clear.mutateAsync({ id: doc.id, note: note.trim() });
              toast('סומן כנבדק', 'ok');
            } catch {
              toast('הפעולה נכשלה', 'warn');
            }
          }}
        >
          סמן כנבדק
        </button>
      ) : null}
    </span>
  );
}
```

`apps/web/src/components/governance/OwnerFields.tsx`:
```tsx
import { useMentionable } from '../../api/hooks/governance.js';
import { fmtDate } from '../../lib/format.js';

type Doc = { ownerId?: string | null; editorId?: string | null; approverName?: string | null; publishedAt?: string | null };

/** Owner + responsible editor selects for the editor's metadata panel; approver and publish date are read-only. */
export function OwnerFields({ doc, onChange }: { doc: Doc; onChange: (patch: { ownerId?: string | null; editorId?: string | null }) => void }) {
  const people = useMentionable();
  const opts = people.data ?? [];
  const select = (label: string, value: string | null | undefined, key: 'ownerId' | 'editorId') => (
    <label>
      {label}
      <select aria-label={label} value={value ?? ''} onChange={(e) => onChange({ [key]: e.target.value || null })}>
        <option value="">— לא הוגדר —</option>
        {opts.map((p) => (
          <option key={p.id} value={p.id}>
            {p.displayName}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <div className="form owner-fields">
      {select('גורם מקצועי אחראי', doc.ownerId, 'ownerId')}
      {select('עורך אחראי', doc.editorId, 'editorId')}
      <div className="muted">
        {doc.approverName ? `מאשר: ${doc.approverName}` : 'טרם אושר'}
        {doc.publishedAt ? ` · פורסם ${fmtDate(doc.publishedAt)}` : ''}
      </div>
    </div>
  );
}
```
(`fmtDate` — use the date formatter exported from `apps/web/src/lib/format.ts`; if its name differs, import that one.)

`apps/web/src/components/governance/UnavailablePage.tsx`:
```tsx
import { Link } from 'react-router-dom';
import { Empty } from '../ui/index.js';

/** Shown instead of the article when the API answers 404 NOT_PUBLISHED. */
export function UnavailablePage() {
  return (
    <div className="page center">
      <Empty title="פריט זה אינו זמין כרגע">
        <p>הפריט קיים אך אינו מפורסם, אינו בתוקף או הועבר לארכיון.</p>
        <Link className="btn primary" to="/library">
          חזרה לספרייה
        </Link>
      </Empty>
    </div>
  );
}
```

- [ ] **Step 6: Run web tests and typecheck**

Run: `pnpm --filter @wecom/web test -- governance && pnpm --filter @wecom/web typecheck`
Expected: PASS. (`typecheck` regenerates the client from `docs/api/openapi.json`; do Task 7 Step 1 first if the two routes are not in the committed file yet.)

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/constants.ts apps/web/src/api/hooks/governance.ts apps/web/src/components/governance apps/web/test/governance apps/web/test/msw
git commit -m "feat(web): governance components — status chip/actions, source-review badge, owner fields, unavailable page"
```

---

### Task 7: OpenAPI, full gate, lane report

**Files:**
- Modify: `docs/api/openapi.json` (regenerate), `apps/web/src/api/schema.d.ts` (regenerate, if committed), `.superpowers/sdd/program/progress.md` (append one line)
- Create: `.superpowers/sdd/program/W2-report.md`

- [ ] **Step 1: Regenerate the contract and the client**

Run: `pnpm --filter @wecom/api openapi && pnpm --filter @wecom/web generate:client && git diff --stat docs/api/openapi.json`
Expected: the diff adds `/api/v1/documents/{id}/status`, `/api/v1/documents/{id}/source-review/clear`, the new optional document fields and the two patch fields, nothing else.

- [ ] **Step 2: Full gate**

Run: `pnpm -r test && pnpm --filter @wecom/api typecheck && pnpm --filter @wecom/web typecheck && cd apps/api && RUN_INTEGRATION=1 pnpm test:int`
Expected: all green.

- [ ] **Step 3: Lane report** — `.superpowers/sdd/program/W2-report.md`:

```md
# W2 Governance — lane report
Branch: <name> · base main <sha> · tests: unit N / int N / web N green.
Produces: canReadUnpublished, visibilityWhere (apps/api/src/lib/visibility.ts); getVisibleDocument, setStatus, hasPublishedVersion (documents/repo.ts); markSourceReviewNeeded, clearSourceReview, documentsForSource (documents/sourceReview.ts); PublishOptions.sourceVersion; SourceRevisionService hooks.onIngested; routes POST /documents/:id/status, POST /documents/:id/source-review/clear; DELETE 409 ONCE_PUBLISHED; purge guard.
Web: StatusChip, useStatusMenuItems/StatusActions, SourceReviewBadge, OwnerFields, UnavailablePage, useReadOnlyReader, useSetStatus, useClearSourceReview.
Mounts for W6 (one line each): DocCard chips → <StatusChip status={card.status} />; LibraryPage CardMenu items → [...useStatusMenuItems()(card)]; ArticlePage header → <StatusChip/> + <SourceReviewBadge doc={doc}/> + <StatusActions doc={doc}/>; ArticlePage error branch → code==='NOT_PUBLISHED' ? <UnavailablePage/>; W1 MetadataPanel → <OwnerFields doc={doc} onChange={patch}/>; Library/Search status facet hidden when useReadOnlyReader().
Shared files touched (append-only): packages/shared/src/schemas/api.ts (PatchDocumentBodySchema.extend ownerId/editorId).
Deviations: <none | list>.
```

- [ ] **Step 4: Commit and ledger**

```bash
git add docs/api/openapi.json apps/web/src/api/schema.d.ts .superpowers/sdd/program/W2-report.md
git commit -m "chore(w2): regenerate OpenAPI + web client; lane report"
echo "W2 governance complete on branch $(git rev-parse --abbrev-ref HEAD) ($(git rev-parse --short HEAD)); report in .superpowers/sdd/program/W2-report.md" >> .superpowers/sdd/program/progress.md
git add .superpowers/sdd/program/progress.md && git commit -m "chore(ledger): W2 done"
```

---

## Self-review

**Spec coverage**
- §2.2 columns/status/`docs.read_unpublished`/purge rule → Tasks 1, 2, 3. `document_versions.source_version` → Tasks 1, 5.
- §3 Governance routes (`/status`, `/source-review/clear`, DELETE 409, visibility on list/get/related/links/backlinks/topic/search) → Tasks 2, 3, 5. Topic view is W1's route; it consumes `visibilityWhere` (documented in "Names this lane produces").
- §5.2 (flag on ingest, notify owner+editor, clear on publish / full rejection / editor note, `source_version` mapping) → Task 5.
- §5.5 (reader never receives hidden items, friendly page, status chips, invalid/archive with reason + audit, strike-through links) → Tasks 2, 3, 6. Strike-through rendering of links to invalid items is a W6 mount concern: `linksFor` already hides them for readers; for editors the link rows carry `toDocumentId` and the card cache carries status, so W6 styles `.link[data-status='invalid']` from `StatusChip`'s tone map — noted in the report.
- §6 isolation: no forbidden file is edited; `api.ts` touch is append-only.
- §7 tests: visibility both roles across list/get/related/links/backlinks/search (Task 2), 409 + purge (Task 3), status + audit (Task 3), flag set by ingest and cleared by publish/note (Task 5), web components (Task 6).

**Placeholder scan** — none; every step carries code, a command and an expected result.

**Type consistency** — `visibilityWhere(user, alias)` / `canReadUnpublished(user)` used identically in Tasks 2 and the produced-names table; `markSourceReviewNeeded(tx, notifier, documentId, reason)` matches its two call sites (Task 5 index.ts wiring and the test); `PublishOptions.sourceVersion` is optional so existing callers compile; `SourceRevisionService` third argument is optional so `revisions.test.ts` and `jobs.test.ts` keep compiling; `SettableStatus` in the hook equals `SetStatusBodySchema.status` options.

**Contract questions for the controller**
1. `PatchDocumentBodySchema` will be extended by both W1 (docType/tags/worlds/topics/bodyHtml) and W2 (ownerId/editorId) in the same `.extend({})` block of `packages/shared/src/schemas/api.ts`. Trivial merge, but confirm W1's plan uses the same `.partial().extend({...})` shape so the merge is line-level.
2. `OwnerFields` reads `GET /users/mentionable` (wave 3, now on main). If W6 prefers a dedicated `GET /users?active=true`, swap the hook; nothing else changes.
3. `app.decorate('sourcesDeps', deps)` in `sources/index.ts` is added so the flag test reaches the real `SourceRevisionService` without re-wiring. It is test-facing only; if the controller prefers not to decorate, the test can instead construct `SourceRevisionService` with the same `onIngested` hook inline (the hook body is 8 lines) — say which.
