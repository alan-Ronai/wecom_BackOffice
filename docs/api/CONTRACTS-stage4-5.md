# Stage 4–5 API contract (authoritative for wave 3)

Schemas: `packages/shared/src/schemas/stage45.ts`. Every route below validates with those schemas, appears in `docs/api/openapi.json`, and is what `apps/web` calls. Permissions are from the catalogue; `scope: 'document'` applies category scopes.

## Stage 4 — connected data (module `graph`, `explorer`, `dashboards`; owner: backend lane A)

| Method | Path | Query/Body | Response | Requires |
|---|---|---|---|---|
| GET | `/graph` | `GraphQuerySchema` | `GraphResponseSchema` | docs.read |
| GET | `/graph/impact/:nodeId` | — (`doc:<id>` / `block:<id>` / `field:<name>` / `source:<id>`) | `ImpactResponseSchema` | docs.read |
| GET | `/fields/:name/page` | — | `FieldPageSchema` | docs.read |
| POST | `/fields/:name/rename` | `FieldRenameBodySchema` | `FieldRenameResultSchema` (creates a version per updated document, label = body.label) | fields.edit |
| GET | `/blocks/:id/page` | — | `BlockPageSchema` | docs.read |
| GET | `/data/files` | — | `DataFilesResponseSchema` (sources of kind json/csv) | docs.read |
| GET | `/data/files/:sourceId/preview` | `DataPreviewQuerySchema` | `DataPreviewSchema` | docs.read |
| PUT | `/data/files/:sourceId/mapping` | `PutMappingBodySchema` | `DataFileSchema` | sources.manage |
| POST | `/data/files/:sourceId/reimport` | — | `ReimportResultSchema` (runs the rows through the pipeline as suggestions) | sources.manage |
| POST | `/data/files` | multipart json/csv | `DataFileSchema` | sources.manage |
| GET | `/dashboards` | — | `DashboardSchema` (cached 60 s) | docs.read |
| POST | `/telemetry` | `TelemetryBatchSchema` | 204 | docs.read |
| GET | `/documents/:id/backlinks` | — | `{ items: { documentId, title, stepKey, type }[] }` | docs.read |

Tables (migrations `0010_telemetry.js`, `0011_data_mapping.js`): `telemetry_events(id, user_id, kind, document_id, step_key, at)`; `sources.mapping jsonb` already exists — reuse; `sources.columns text[]` added.

## Stage 5 — collaboration (module `collab`; owner: backend lane B)

| Method | Path | Body | Response | Requires |
|---|---|---|---|---|
| GET | `/notifications` | `NotificationsQuerySchema` | `NotificationsResponseSchema` | docs.read |
| POST | `/notifications/read` | `{ ids?: uuid[]; all?: boolean }` | `{ unread: number }` | docs.read |
| GET | `/users/mentionable?q=` | — | `{ items: MentionCandidateSchema[] }` | notes.write |
| GET | `/documents/:id/comments` | — | `{ items: CommentSchema[] }` | docs.read |
| POST | `/documents/:id/comments` | `CommentBodySchema` (`@displayName` tokens resolved to mentions → notifications) | `CommentSchema` | notes.write |
| POST | `/comments/:id/resolve` · `/comments/:id/like` · DELETE `/comments/:id` | — | `CommentSchema` / 204 | notes.write (own) / notes.moderate |
| POST | `/documents/:id/request-review` | `RequestReviewBodySchema` | `ReviewRequestSchema` (document.status → `review`; notifies leads or reviewerIds) | docs.edit |
| POST | `/documents/:id/review-decision` | `ReviewDecisionBodySchema` | `ReviewRequestSchema` (approve → publish with label; changes → status `draft`) | docs.publish |
| GET | `/reviews` | `PaginationQuerySchema` + `status?` | `ReviewQueueResponseSchema` | docs.publish |
| GET/POST | `/views` · PATCH/DELETE `/views/:id` | `SavedViewBodySchema` | `SavedViewSchema` / `{ items }` | docs.read |
| GET/POST | `/templates` · PATCH/DELETE `/templates/:id` | `TemplateBodySchema` | `TemplateSchema` / `{ items }` (5 built-ins seeded from legacy presets) | docs.read / docs.edit |
| GET | `/documents/:id/presence` · POST `/documents/:id/presence` (heartbeat, 30 s TTL) | — | `PresenceSchema` / 204 | docs.read |
| POST | `/documents/bulk` | `BulkDocumentsBodySchema` | `BulkResultSchema` | per action (docs.edit / docs.delete / docs.publish) |
| GET | `/drafts/new` · PUT `/drafts/new` | `DraftBody` | draft envelope (server-side draft for `/edit/new`) | docs.create |

Tables (`0020_collab.js`): `notifications`, `comments`, `comment_likes`, `review_requests`, `saved_views`, `templates`, `presence` (or Redis-less in-memory with DB fallback: use the table). SSE events added to `packages/shared/src/events.ts` (additive): `notification.created`, `comment.created`, `review.requested`, `review.decided`, `presence.changed`.

## Stage 5 — admin & identity (module `admin`; owner: backend lane B)

| Method | Path | Body | Response | Requires |
|---|---|---|---|---|
| GET | `/admin/users` | `AdminUsersQuerySchema` | `paginated(AdminUserRowSchema)` | users.manage |
| GET | `/admin/roles/matrix` | — | `RoleMatrixSchema` | roles.manage |
| GET | `/admin/audit/:id` | — | `AuditEntryDetailSchema` (computed before/after diff rows) | audit.read |
| GET/PUT | `/admin/identity` | `IdentitySettingsPutSchema` | `IdentitySettingsSchema` (secrets write-only; stored in `app_settings`, env is the fallback) | system.admin |
| POST | `/admin/identity/test` | `{ provider }` | `IdentityTestResultSchema` (OIDC discovery fetch; Palo Alto op command) | system.admin |
| GET | `/admin/groups/search` | `GroupSearchQuerySchema` | `GroupSearchResponseSchema` — Graph `startswith(displayName,…)` on the client-credentials token; **503 `OIDC_NOT_CONFIGURED`** with no issuer, **502 `GRAPH_UNAVAILABLE`** on a Graph failure | roles.manage |
| GET | `/admin/groups-map` | — | `GroupsMapResponseSchema` — each row gains `lastSyncedAt`, stamped by the nightly `identity.sync` job. Null means "saved, not yet applied to anyone". Stored in `system_state` under `identity.groups_map.last_synced_at`, not a `groups_map` column: migrations 0026–0028 were taken by this wave and 0029 by wave 4, leaving no free number for an `alter table` | roles.manage |

## Stage 5 — connectors & sync UI (existing L6 routes, plus; owner: backend lane B)

| Method | Path | Response | Requires |
|---|---|---|---|
| GET | `/connectors/types` | `{ items: ConnectorTypeInfoSchema[] }` | connectors.manage |
| GET | `/connectors` | `{ items: ConnectorRowSchema[] }` (secrets masked) | connectors.manage |
| GET | `/sync/links` | `SyncQueueResponseSchema` | sources.manage |
| GET | `/sync/links/:id/conflict` | `ConflictViewSchema` | sources.manage |
| POST | `/sync/links/:id/resolve` | `ResolveConflictBodySchema` → `SyncLinkRowSchema` | suggestions.apply |
| POST | `/connectors/:id/run` | `SyncRunResultSchema` | connectors.manage |
| GET | `/sync/parity?connectorId=` | `ParityResponseSchema` — per link both sides' content hashes (`localHash`, `remoteHash`, `baseRemoteHash`, `remoteUpdatedAt`) plus `unlinked.documents` / `unlinked.remote`. The remote listing is cached 60 s per connector; `remoteAvailable: false` and `unlinkedReason: 'remote_unavailable'` distinguish an outage from a deletion (`'remote_missing'`) | sources.manage |
| POST | `/sync/links` | `SyncLinkCreateBodySchema` → `SyncLinkRowSchema` (201). Creates the link **unsynced** — no `base_remote_hash`, no `last_synced_at`, state `pending_import` — so the first run establishes the baseline. 409 `ALREADY_LINKED` when either end is taken | sources.manage |

Existing L6 routes keep their paths; where the L6 response differs from these schemas, the backend adapts to these schemas (they are the contract the UI is built against).

## Web routes (owner: frontend lanes C/D/E)

`/data`, `/data/:sourceId`, `/graph`, `/fields/:name`, `/blocks/:id`, `/dashboards`, `/notifications`, `/reviews`, `/admin/identity`, `/admin/connectors`, `/admin/connectors/new`, `/sync`, `/sync/conflicts/:id`, plus the existing routes.
