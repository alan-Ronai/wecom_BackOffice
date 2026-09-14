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

Replacing a default: W1 calls `setTaxonomy(app, new PgTaxonomy(app.db))`, W3 `setNotifier(...)`, W5 `setUsage(...)` from the lane's own module `index.ts` (imported from `apps/api/src/plugins/wave4.ts`). The decorators are delegating holders, so the call works from an encapsulated module context; never reassign `app.usage = …` (it would only shadow the property in that child).

Telemetry kinds `view_topic` / `search_click` are added to wave 3's `TelemetryEventSchema` by W6 after merge (W5 must not edit `stage45.ts`). W5 filters by primary world (`documents.category`) until W6 widens to `document_worlds`.

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
| PATCH | `/documents/:id` | + `docType, tags, worlds, topics, bodyHtml` (W1) — `ownerId, editorId` are added by W2 | `DocumentSchema` | docs.edit |
| * | `/scripts*` | unchanged shapes, served from `doc_type='T'` documents, `deprecated: true` in OpenAPI | as today | |

### W2 Governance

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| POST | `/documents/:id/status` | `SetStatusBodySchema` | `DocumentSchema` | docs.publish |
| POST | `/documents/:id/source-review/clear` | `SourceReviewClearBodySchema` | `DocumentSchema` | docs.edit |
| PATCH | `/documents/:id` | + `ownerId, editorId` (nullable) | `DocumentSchema` | docs.edit |
| DELETE | `/documents/:id` | — | 409 `ONCE_PUBLISHED { allowed: ['invalid','archived'] }` when a published version exists | docs.delete |

Visibility: without `docs.read_unpublished`, list/get/related/links/backlinks/topic/search return only `published`/`partial`; get on an unpublished id → 404 `NOT_PUBLISHED`.

### W3 Feedback

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| POST | `/documents/:id/feedback` | `CreateFeedbackBodySchema` | `FeedbackSchema` | docs.read |
| GET | `/documents/:id/feedback` | — | `DocumentFeedbackResponseSchema` (open only) | docs.edit |
| GET | `/feedback` | `FeedbackQuerySchema` | `FeedbackListResponseSchema` | feedback.manage |
| GET | `/feedback/:id` | — | `FeedbackDetailSchema` | feedback.manage |
| PATCH | `/feedback/:id` | `FeedbackPatchBodySchema` | `FeedbackRowSchema` | feedback.manage |
| POST | `/feedback/:id/resolve` | `FeedbackResolveBodySchema` | `FeedbackRowSchema` | feedback.manage |
| GET | `/feedback/analytics` | `FeedbackAnalyticsQuerySchema` | `FeedbackAnalyticsSchema` (60 s cache) | feedback.manage |
| POST | `/documents/:id/publish` | `PublishBodySchema.resolveFeedbackIds` | unchanged | docs.publish |

### W4 Source documents

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/documents/:id/source` | — | `SourceDocumentSchema` or 204 | docs.read |
| PUT | `/documents/:id/source` | `PutSourceDocumentBodySchema` + `If-Match` | `SourceDocumentSchema` (412 on etag mismatch) | docs.edit |
| GET | `/documents/:id/source/versions` | — | `SourceDocumentVersionsResponseSchema` | docs.read |
| GET | `/documents/:id/source/versions/:v` | — | `SourceDocumentSchema` (that version) | docs.read |
| POST | `/documents/:id/source/restore/:v` | — | `SourceDocumentSchema` | docs.edit |
| POST | `/documents/:id/source/import` | multipart `.docx` | `SourceDocumentSchema` | docs.edit |
| GET | `/documents/:id/source/export.docx` | — | docx bytes | docs.read |
| GET | `/sources/:id/revisions/:rev/raw` | — | original upload bytes | docs.read |
| GET | `/documents/:id/source/draft` | — | `{ html, updatedAt }` or 204 (per-user autosave in `drafts`, key `source:<id>`) | docs.edit |
| PUT | `/documents/:id/source/draft` | `{ html }` | 204 | docs.edit |
| DELETE | `/documents/:id/source/draft` | — | 204 | docs.edit |
| POST | `/assets` | multipart image | `AssetSchema` | docs.edit |
| GET | `/assets/:id` | — | bytes, immutable cache | docs.read |

### W5 Usage

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/analytics/usage` | `UsageAnalyticsQuerySchema` | `UsageAnalyticsSchema` (60 s cache) | analytics.read |
| GET | `/analytics/search-log` | `SearchLogQuerySchema` | `SearchLogResponseSchema` | analytics.read |

## Web routes (owner in parentheses)

`/topic/:id` (W1), `/admin/taxonomy` (W1), `/feedback` (W3), `/feedback/:id` (W3), `/analytics` (W5), `/doc/:id` pane modes + `/edit/:id/source` (W4). Mount points in shell/article/editor/library are performed by W6.
