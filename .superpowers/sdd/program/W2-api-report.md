# W2 Governance (api half) — lane report

Branch: `worktree-agent-a238cb5691ebcd944` · base `main 6259607` (wave 4 W0 merged).
Scope: plan `docs/superpowers/plans/2026-09-14-W2-governance.md` Tasks 1–5 and Task 7 (api half).
Task 6 (web components/hooks) is sub-lane **W2-web** and was **not** done here.

## Per-task status

| Task | Status | Commit |
|---|---|---|
| 1 — migration `0031_governance.js` + migrations.test assertions | done | `9c4097e` |
| 2 — visibility helper + list/get/related/links/backlinks/versions/diff/view/pin + search | done | `1b2d42d` |
| 3 — `POST /status`, once-published DELETE 409, purge guard | done | `03d274d` |
| 4 — owner/editor patch, approver + publishedAt on publish, names on cards/documents | done | `c3d64e0` |
| 5 — source-review flag (ingest → raise; publish / full rejection / editor note → clear); `PublishOptions.sourceVersion` | done | `c8ccf73` |
| 6 — web | **not this sub-lane** (W2-web) | — |
| 7 — OpenAPI regeneration + api gate + this report | done | (this commit) |

## Test counts (all green)

- `packages/shared`: 10 files / 47 tests.
- `apps/api` unit (`pnpm test`): 22 files / 84 tests run, 41 files skipped (integration-gated).
- `apps/api` integration (`RUN_INTEGRATION=1 pnpm test`): **63 files / 268 tests, all passed** — includes
  `governance.test.ts` (10), `governance-source-review.test.ts` (3), `unit/visibility.test.ts` (2),
  `migrations.test.ts` (5, one new), `trash.test.ts` (4, one new).
  `test/sources/routes.test.ts` (the known flake under load) passed in the full run.
- `apps/api typecheck`: clean (`tsc -p tsconfig.json --noEmit && tsc -p tsconfig.scripts.json`).
- OpenAPI: regenerated, diff is **additive only** (1167 insertions, 0 deletions) — the two new paths
  `/api/v1/documents/{id}/status` and `/api/v1/documents/{id}/source-review/clear`, plus the wave-4
  document fields and `ownerId`/`editorId` on `PatchDocumentBody`.
- Lint: `eslint` over `apps/api/src`, `apps/api/test`, `packages/shared/src` reports only the
  **pre-existing** `MIGRATION_COUNT is assigned a value but never used` in `apps/api/test/migrations.test.ts`
  (present verbatim at base `6259607`). The repo-wide `pnpm lint` additionally reports the pre-existing
  `dialogs` unused var in `apps/web/src/components/library/FieldsPage.tsx` (web, untouched by this lane).
  Prettier is clean on every file this lane touched.

## Exports other lanes consume

| Name | Signature | File |
|---|---|---|
| `canReadUnpublished` | `(user: Pick<ReqUser,'permissions'>) => boolean` | `apps/api/src/lib/visibility.ts` |
| `visibilityWhere` | `(user: Pick<ReqUser,'permissions'>, alias = 'd') => string` — `''` for editors, else `" and <alias>.status in ('published','partial')"` | `apps/api/src/lib/visibility.ts` |
| `VISIBLE_TO_READERS` | `readonly ['published','partial']` | `apps/api/src/lib/visibility.ts` |
| `getVisibleDocument` | `(q: Q, id: string, user: Pick<ReqUser,'permissions'>) => Promise<Document \| null>` — throws 404 `NOT_PUBLISHED` when hidden | `apps/api/src/modules/documents/repo.ts` |
| `setStatus` | `(tx: Tx, id: string, status: 'invalid'\|'archived'\|'draft', userId: string) => Promise<Document>` | `apps/api/src/modules/documents/repo.ts` |
| `hasPublishedVersion` | `(q: Q, id: string) => Promise<boolean>` | `apps/api/src/modules/documents/repo.ts` |
| `listCards` | `+ readUnpublished = true` (5th param) | `apps/api/src/modules/documents/repo.ts` |
| `linksFor` / `relatedFor` | `+ readUnpublished = true` (last param) | `apps/api/src/modules/documents/repo.ts` |
| `search` | `+ readUnpublished = true` (5th param) | `apps/api/src/modules/search/repo.ts` |
| `markSourceReviewNeeded` | `(tx: Tx, notifier: Notifier, documentId: string, reason: string) => Promise<void>` | `apps/api/src/modules/documents/sourceReview.ts` |
| `clearSourceReview` | `(tx: Tx, documentId: string) => Promise<void>` | `apps/api/src/modules/documents/sourceReview.ts` |
| `documentsForSource` | `(q: Q, sourceId: string) => Promise<string[]>` | `apps/api/src/modules/documents/sourceReview.ts` |
| `PublishOptions.sourceVersion` | `?: number \| null` — written to `document_versions.source_version`; publish also clears the source-review flag | `apps/api/src/modules/documents/repo.ts` |
| `RevisionHooks` / `SourceRevisionService` ctor | `(pool, queue, hooks?: { onIngested?: (i: { sourceId; revisionId; actorId }) => Promise<void> })` | `apps/api/src/modules/sources/revisions.ts` |
| Error codes | `NOT_PUBLISHED` (404), `ONCE_PUBLISHED` (409, `details: { allowed: ['invalid','archived'] }`), `UNKNOWN_USER` (400, `details: { field }`) | — |

Routes added: `POST /documents/:id/status` (`docs.publish`, scope `document`) and
`POST /documents/:id/source-review/clear` (`docs.edit`, scope `document`); `DELETE /documents/:id` now
409s with `ONCE_PUBLISHED` when a published version exists; `purgeExpired` never hard-deletes a
document that has a `kind='published'` version.

Migration `0031_governance.js`: `documents.owner_id/editor_id/approver_id/published_at/source_review_needed/
source_review_reason/source_review_at`, `document_versions.source_version`, constraint
`documents_status_check`, partial index `documents_source_review_idx`, plus the owner/editor/approver/
published_at backfill.

## Shared / append-only files touched

- `packages/shared/src/schemas/api.ts` — `PatchDocumentBodySchema` gained `.extend({ ownerId, editorId })`,
  one field per line. **W1-api adds `docType, tags, worlds, topics, bodyHtml` to the same `.extend({})`** —
  expect a trivial line-level merge inside that block.
- `docs/api/openapi.json` — regenerated (additive only).
- No edits to `stage45.ts`, `apps/api/src/app.ts`, or anything under `apps/web/`.
- `apps/api/src/modules/index.ts`, `packages/shared/src/events.ts`, `packages/shared/src/permissions.ts`
  and `apps/api/src/plugins/boss.ts` were **not** touched (no additions needed).

## Wave 3 routes that still lack the visibility rule (for W6)

`visibilityWhere` / `getVisibleDocument` were applied to everything the plan names. These wave-3 and
stage-4/5 read paths return document-derived rows and are **not** yet filtered — they were merged after
the plan was written and belong to W6's reconciliation pass:

- `apps/api/src/modules/graph/routes.ts` — the graph/impact endpoints (`inboundFor`/`outboundFor` and the
  graph walk) return documents regardless of status. Only `GET /documents/:id/backlinks`, which W2 owns,
  is filtered.
- `apps/api/src/modules/collab/comments.ts` (`GET /documents/:id/comments`, `docs.read` + `scope: 'document'`)
  — reachable by a reader on an unpublished document. `collab/reviews.ts` is `docs.edit`/`docs.publish`
  gated, so readers cannot reach it; no change needed there.
- `apps/api/src/modules/explorer/routes.ts` and `apps/api/src/modules/dashboards/routes.ts` — stage-4
  explorer rows and dashboard aggregates count/list unpublished documents.
- `apps/api/src/modules/notes/routes.ts` and `apps/api/src/modules/drafts/routes.ts` — note/draft lookups
  are keyed by document id (`docs.read` + `scope: 'document'`) with no status check.
- `apps/api/src/modules/collab/views.ts` — saved views are user data, not document rows; listed only so
  W6 can confirm no change is needed.
- `apps/api/src/modules/trash/routes.ts` — the trash list is `docs.delete`-gated, so readers cannot reach
  it; no change needed, noted for completeness.

Each of these needs a one-line `visibilityWhere(user, '<alias>')` appended to its `where`, or a
`getVisibleDocument` existence check where it looks a single document up.

## Deviations from the plan

1. **`app.decorate('sourcesDeps', deps)` was dropped** (plan Task 5 Step 4 / contract question #3).
   `registerSourcesModule` runs inside the encapsulated `/api/v1` scope, so a root-level
   `app.sourcesDeps` is unreachable from a test holding the root instance, and `apps/api/src/app.ts`
   may not be edited by this lane. `apps/api/test/governance-source-review.test.ts` instead ingests
   through `POST /api/v1/sources/upload`, which exercises the real `onIngested` wiring end to end —
   strictly better coverage than a hand-built service. The fastify module augmentation was removed too,
   so no type claims a decorator that does not exist at root.
2. **`app.notifier` is swapped, not reassigned.** The plan's test wrote `app.notifier = { notify }`;
   W0 ships `app.notifier` as a delegating `NotifierHolder`, so the test calls
   `app.notifier.swap({ notify })` per the W0 contract.
3. **Extra visibility coverage.** Beyond the routes the plan lists, `getVisibleDocument` also guards
   `GET /documents/:id/versions`, `GET /documents/:id/versions/:v`, `GET /documents/:id/diff`,
   `POST /documents/:id/view` and `POST /documents/:id/pin` — the plan's Task 2 Step 8 asked for this
   explicitly in its closing paragraph.
4. **Worktree base.** The worktree was created at `c8f0147` (wave 3 lane C) rather than the briefed
   `6259607`; it was fast-forwarded to `6259607` before any work, so the branch base is as briefed.
5. Migration `0031` sorts before the pre-existing `0038`–`0041`; `migrate.test.ts` (apply-once +
   idempotent) and the roll-back-to-empty check both pass.
