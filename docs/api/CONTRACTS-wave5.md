# Wave 5 API contract (authoritative for lanes V1–V6)

Schemas: `packages/shared/src/schemas/wave5.ts` (+ the two additive fields merged into `PublishBodySchema` / `PublishResponseSchema` in `api.ts`, and the two kinds appended to `NotificationKindSchema` in `stage45.ts`). Every route validates with those schemas, appears in `docs/api/openapi.json`, and is what `apps/web` calls. Spec: `docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md`.

## Migrations

| Lane | File | Owns |
|---|---|---|
| V0 | `0038_wave5_permissions_settings.js` | learning/gaps permissions + grants, the `approver` system role, `notifications.kind` widened with `learning`/`gap`, the `app_settings` row `workflow` (done) |
| V1 | `0039` | learning_items, learning_item_versions, briefing_entries, quiz_questions |
| V2 | `0040` | learning_audiences, learning_assignments, learning_attempts, learning_acknowledgements, document_change_flags |
| V3 | `0041` | knowledge_gaps |
| V6 | `0042` | seams/fixes found in integration (may be empty → do not create) |

The wave-3 cleanup lane owns `0037` (already on main).

## Canonical names produced by V0 (import these; do not rename)

| Concern | Name |
|---|---|
| Permissions | `learning.read` (agent+), `learning.manage` (editor+), `learning.publish` (lead+, approver), `gaps.read` (editor+), `gaps.manage` (lead+) |
| Role | `DEFAULT_ROLES.approver = ['docs.read','docs.read_unpublished','notes.write','docs.publish','suggestions.apply','learning.publish']` — a system role, seeded by 0038, deliberately outside the agent→editor→lead nesting (no `docs.edit`) |
| Events | `learning.assigned { assignmentId, userId, itemId }`, `learning.completed { assignmentId, userId, itemId, passed }`, `learning.refresh_required { documentId, version, affectedUsers }`, `gap.detected { gapId, kind }` |
| Notification kinds | `NotificationKindSchema` += `'learning'`, `'gap'` |
| Queues | `QUEUES.learningResolveAudiences = 'learning.resolve_audiences'`, `QUEUES.learningReminders = 'learning.reminders'`, `QUEUES.gapsDetect = 'gaps.detect'` |
| Settings | `app_settings.key = 'workflow'` → `WorkflowSettings` JSON; `getWorkflowSettings(q)` / `putWorkflowSettings(tx, patch, actorId)` in `apps/api/src/lib/workflowSettings.ts`; `WORKFLOW_SETTINGS_KEY` from `wave5.ts` |
| Schemas added | `SourceVersionSchema { documentId, version }`; `LearningItemSchema.sourceVersions` and `LearningVersionSchema.sourceVersions` (default `[]`); `WorkflowSettingsSchema.learning.defaultMaxAttempts` nullable, default `null` (unlimited retakes); `StartAttemptResponseSchema { attemptId, attemptNo }`; `AssignResultSchema { assigned, skipped }`; `LearningVersionsResponseSchema { items }`; `PlayerQuestionSchema.id` required; `DocumentLearningSchema.refreshAssignmentId`; `PublishBodySchema.significantChange?: boolean`; `PublishResponseSchema.changeFlag?: ChangeFlag`; a type alias for every exported schema |

The stored `workflow` value is a **patch**, never the full object: `getWorkflowSettings` parses it through `WorkflowSettingsSchema`, so every key a lane does not store still reads back as its default. Add settings keys to the schema, never to the migration.

## Shared files a lane may touch (append-only)

`apps/api/src/modules/index.ts` (one import + one list entry), `apps/web/src/routes.tsx` (route entries), `packages/shared/src/events.ts` (new names + payloads only), `packages/shared/src/permissions.ts` (new names + role additions only), `apps/api/src/plugins/boss.ts` (`QUEUES` entries), `apps/web/src/api/keys.ts` (new keys).

`packages/shared/src/schemas/stage45.ts` is **V0-only** for this wave, and only `NotificationKindSchema`: the two wave 5 kinds are already appended, so no lane needs to touch the file.

**Never** edit: `apps/api/src/app.ts`, `apps/web/src/components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`, `ReviewsPage.tsx`, `IdentityPage.tsx`. Ship a component plus a documented one-line mount in your lane report; V6 mounts it.

Runtime holders are wave 4's, unchanged: `app.notifier`, `app.taxonomy`, `app.usage` (`apps/api/src/plugins/wave4.ts`). Call `setNotifier(app, …)` and friends from your own module `index.ts`; never reassign `app.usage = …`.

## Routes

### V1 Learning content

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/learning/items` | `LearningItemsQuerySchema` | `LearningItemsResponseSchema` (without `learning.manage`, published only) | learning.read |
| POST | `/learning/items` | `LearningItemCreateSchema` | `LearningItemSchema` | learning.manage |
| GET | `/learning/items/:id` | — | `LearningItemSchema` | learning.read |
| PATCH | `/learning/items/:id` | `LearningItemPatchSchema` | `LearningItemSchema` | learning.manage |
| DELETE | `/learning/items/:id` | — | 204 (soft delete) | learning.manage |
| PUT | `/learning/items/:id/entries` | `PutEntriesBodySchema` | `LearningItemSchema` (briefing; published documents only) | learning.manage |
| PUT | `/learning/items/:id/questions` | `PutQuestionsBodySchema` | `LearningItemSchema` (quiz) | learning.manage |
| POST | `/learning/items/:id/generate` | `GenerateQuestionsBodySchema` | `GenerateQuestionsResponseSchema` (model + rule fallback; not saved until PUT) | learning.manage |
| POST | `/learning/items/:id/publish` | `LearningPublishBodySchema` | `LearningVersionSchema` (snapshots `sourceVersions` = every referenced document's `current_version`) | learning.publish |
| GET | `/learning/items/:id/versions` | — | `LearningVersionsResponseSchema` | learning.read |
| GET | `/learning/items/:id/preview` | — | `PlayerItemSchema` (agent view) | learning.read |

`passMark` and `maxAttempts` are filled from `getWorkflowSettings()` when the create/patch body omits them; `maxAttempts: null` means unlimited retakes and is the default.

### V2 Assignments & tracking

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| POST | `/learning/items/:id/audiences` | `AudienceCreateSchema` | `AudienceSchema` (`resolvedUsers` from the immediate resolution) | learning.manage |
| DELETE | `/learning/audiences/:id` | — | 204 | learning.manage |
| POST | `/learning/items/:id/assign` | `AssignBodySchema` | `AssignResultSchema` | learning.manage |
| GET | `/learning/my` | — | `MyLearningResponseSchema` | learning.read |
| GET | `/learning/my/:assignmentId` | — | `PlayerItemSchema` (no `correct` flags) | learning.read, own assignment only |
| POST | `/learning/my/:assignmentId/acknowledge` | — | `AssignmentSchema` (briefing completion) | learning.read, own assignment only |
| POST | `/learning/my/:assignmentId/attempts` | — | `StartAttemptResponseSchema` (201) | learning.read, own assignment only |
| PUT | `/learning/attempts/:id` | `AttemptAnswersSchema` | `AttemptResultSchema` | learning.read, own attempt only |
| GET | `/learning/items/:id/completion` | — | `CompletionResponseSchema` | learning.manage, world-scoped |
| GET | `/learning/dashboard` | `?world` | `LearningDashboardSchema` | learning.manage, world-scoped |
| GET | `/documents/:id/learning` | — | `DocumentLearningSchema` (`refreshAssignmentId` = the caller's open refresh assignment, else null) | docs.read |
| POST | `/documents/:id/publish` | + `PublishBodySchema.significantChange` | + `PublishResponseSchema.changeFlag` | docs.publish |

A significant change invalidates the completions of every learning item referencing the document and creates refresh assignments due in `workflow.learning.refreshDueDays`, each with a `learning` notification.

### V3 Approver & gaps

| Method | Path | Body / Query | Response | Requires |
|---|---|---|---|---|
| GET | `/admin/workflow` | — | `WorkflowSettingsSchema` | docs.read — the values are non-secret booleans and thresholds, and the review queue has to know whether `requireApprover` is on |
| PUT | `/admin/workflow` | `WorkflowSettingsPutSchema` | `WorkflowSettingsSchema` (deep-merged) | system.admin |
| GET | `/gaps` | `GapsQuerySchema` | `GapsResponseSchema` | gaps.read |
| POST | `/gaps/:id/dismiss` | `GapDismissBodySchema` | `GapSchema` | gaps.manage |
| POST | `/gaps/:id/resolve` | `GapResolveBodySchema` | `GapSchema` | gaps.manage |
| POST | `/gaps/detect` | — | `GapDetectResultSchema` (manual run of the `gaps.detect` job) | gaps.manage |

Approver gate: when `workflow.requireApprover` is on, the review-decision route returns 403 `APPROVER_REQUIRED` for a caller who lacks the `approver` role, even with `docs.publish`. Off by default, so nothing changes on upgrade.

## Web routes (owner in parentheses)

`/learning` (V4a), `/learning/:assignmentId` (V4a), `/learning/manage` (V4b), `/learning/manage/new` (V4b), `/learning/manage/:id` (V4b), `/gaps` (V4b); the workflow section on `/admin/identity` (V4b).

Mounts performed by V6: sidebar entries, the article banners ("רענון ידע נדרש", "התוכן עודכן"), the publish dialog's "שינוי מהותי" checkbox, and the review queue's approver hint. V0 has already filled the bell's two wave 5 icons in `NotificationList.tsx` (`learning` 🎓, `gap` 🧭) because that map is exhaustive over `NotificationKindSchema` by design; V4a owns any new filter tab there.
