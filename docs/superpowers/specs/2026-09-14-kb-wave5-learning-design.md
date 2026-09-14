# Wave 5 — Learning & training: briefings, quizzes, completion tracking, knowledge refresh, approver role, gap detection

Date: 2026-09-14 · Status: written by the wave-3 session under the standing "continue implementing and improving everything" instruction; decisions below are rulings, not user answers, and are listed for review.
PRD: `docs/prd/prd-knowledge-manager.md` §13 "שלב עתידי - למידה והדרכה", "שלבים עתידיים יכללו", and the two inline deferrals in §11 and §13 (`docs/prd/future-phase.md`).
Program context: `2026-09-13-kb-platform-program-and-lanes.md`; waves 3–4 contracts in `docs/api/CONTRACTS-stage4-5.md`, `packages/shared/src/schemas/{stage45,wave4}.ts`.

## 0. What the PRD asks for

"על בסיס אותם פריטי ידע המערכת תוכל בהמשך: ליצור תדריך · ליצור שאלון ידע · לעקוב אחר השלמה · לזהות שינוי משמעותי בידע ולדרוש רענון ידע. התוכן שנכתב פעם אחת הופך גם לידע תפעולי וגם לבסיס ללמידה." Plus: switching on a distinct approver role (§11) and using usage data to find knowledge gaps (§13).

## 1. Rulings (decisions taken without the product owner; each with cost if wrong)

1. **Briefings and quizzes are derived from published documents, never free text.** A briefing is an ordered set of published document references with an editor-written intro and per-item note; a quiz is a set of questions each anchored to a document step. Cost: an editor who wants a free-form training page must write it as a `kind: 'text'` document first.
2. **Question generation is model-assisted with a deterministic fallback**, exactly like the source pipeline: branches become "what do you do if…" multiple-choice questions (options = branch labels), outcomes become "what is the next step" questions, CRM steps become "which field" questions; the local model may rewrite stems and add distractors, output schema-validated. Editors curate before publishing. Cost: question quality depends on step quality.
3. **Assignments target audiences, not individuals, by default**: audience = roles × worlds (e.g. "agents in intl"), resolved to users at assignment time and re-resolved nightly for joiners. Individual assignment exists for ad hoc cases. Cost: a user moved between worlds gets new assignments and keeps old completions.
4. **Completion = read acknowledgement for briefings ("קראתי והבנתי"), pass mark for quizzes (default 80%, configurable per quiz, up to 3 attempts by default).** Cost: no partial credit.
5. **"Significant change" is computed on publish** from the diff engine: any changed/added/removed outcome or branch option, any deleted step, any changed CRM field reference, or >40% of step text changed. Editors can override on the publish dialog ("שינוי מהותי – דרוש רענון" checkbox, pre-ticked when detected). A significant change **invalidates** completions of every learning item that references the document and creates a refresh assignment for affected users with a due date (default 7 days). Cost: false positives create refresh work; the override checkbox is the safety valve.
6. **Approver role switched on as configuration, not code**: a system role `approver` (permissions: `docs.publish`, `suggestions.apply`, `learning.publish` — no `docs.edit`) plus a workflow setting `review.requireApprover` (default off). When on, `review-decision` requires the `approver` role and `docs.publish` alone is not enough; leads keep both roles by default so nothing breaks on upgrade. Cost: none by default.
7. **Gap detection is a nightly job producing a ranked list with evidence**, not a model: zero-result search terms clustered by normalized stem (≥3 occurrences / 7 days), items with ≥3 open feedback of kind `no_answer`/`missing`, high-traffic items (top decile views) not updated for 180 days, topics with views but no `R`/`O` items, quizzes with a question failed by ≥50% of attempts. Each gap has a suggested action ("צור פריט", "עדכן", "הוסף שאלה") and can be dismissed with a reason. Cost: heuristics; thresholds are settings.
8. **Learning items respect governance**: only published documents can be referenced; an item whose document becomes `invalid`/`archived` is flagged "דורש עדכון" and hidden from new assignments.

## 2. Lanes

| Lane | Scope | Migrations |
|---|---|---|
| V0 Contracts | `packages/shared/src/schemas/wave5.ts`, permissions (`learning.read`, `learning.manage`, `learning.publish`, `gaps.read`, `gaps.manage`), events (`learning.assigned`, `learning.completed`, `learning.refresh_required`, `gap.detected`), queues (`learning.resolve_audiences`, `learning.reminders`, `gaps.detect`), route list (this document §3) | 0038 (permissions + roles) |
| V1 Learning content | briefings, quizzes, questions (generation with model + fallback), curation, publishing, versions | 0039 |
| V2 Assignments & tracking | audiences, assignments, completions, attempts, reminders, manager dashboard data, significant-change detection hook on publish, refresh assignments | 0040 |
| V3 Approver & gaps | approver role activation + workflow setting, gap detection job, gaps API, dismissals | 0041 |
| V4 Web | `/learning` (agent: my assignments, briefing reader with acknowledgement, quiz player), `/learning/manage` (editor: briefing/quiz builders with generated questions, assign dialog, completion dashboard), `/gaps`, approver settings on `/admin/identity` (workflow section), refresh banners on article, notifications | — |
| V5 Design | design turn 8 mockups for the above (before V4 starts; V4 implements from them) | — |
| V6 Integration & review | mounts, real e2e flows, whole-wave review + fix wave | 0042 reserved |

## 3. Data model

- `learning_items(id, kind check in ('briefing','quiz'), title, description, world_slug → worlds null, status check in ('draft','published','archived'), current_version int, pass_mark int null, max_attempts int null, estimated_minutes int null, created_by, updated_by, published_at, timestamps, deleted_at)`.
- `learning_item_versions(id, item_id, version, snapshot jsonb, author_id, label, created_at)` unique (item_id, version).
- `briefing_entries(id, item_id, position, document_id → documents, step_key null, note text default '')`.
- `quiz_questions(id, item_id, position, document_id → documents, step_key null, stem text, kind check in ('single','multi','order','free'), options jsonb [{id,text,correct}], explanation text default '', generated bool default false, model_conf numeric null)`.
- `learning_audiences(id, item_id, role_names text[], world_slugs text[], user_ids uuid[], due_days int default 14, created_by, created_at)`.
- `learning_assignments(id, item_id, item_version int, user_id, audience_id null, reason check in ('audience','manual','refresh'), assigned_at, due_at, status check in ('open','completed','overdue','invalidated'), completed_at null, invalidated_at null, invalidated_reason text null)` unique (item_id, user_id, item_version, reason).
- `learning_attempts(id, assignment_id, started_at, finished_at null, score int null, passed bool null, answers jsonb)`.
- `learning_acknowledgements(id, assignment_id, acknowledged_at, item_version)`.
- `document_change_flags(id, document_id, version, significant bool, reasons jsonb, decided_by, created_at)` — written on publish.
- `knowledge_gaps(id, kind check in ('zero_results','feedback_cluster','stale_high_traffic','topic_without_procedure','failed_question'), key text, title, evidence jsonb, score numeric, status check in ('open','dismissed','resolved'), dismissed_by, dismissed_reason, resolved_document_id null, first_seen_at, last_seen_at)` unique (kind, key).
- `app_settings` gets `workflow.requireApprover` (bool), `learning.defaultPassMark`, `learning.defaultMaxAttempts`, `learning.refreshDueDays`, `gaps.thresholds`.

## 4. API (`/api/v1`, all from `wave5.ts`, in OpenAPI)

Learning content (V1): `GET /learning/items?kind&status&world&q` · `POST /learning/items` · `GET/PATCH/DELETE /learning/items/:id` · `PUT /learning/items/:id/entries` (briefing) · `PUT /learning/items/:id/questions` (quiz) · `POST /learning/items/:id/generate` `{ documentIds[], perDocument?: number }` → generated questions (model + fallback, not saved until PUT) · `POST /learning/items/:id/publish` `{ label }` · `GET /learning/items/:id/versions` · `GET /learning/items/:id/preview` (agent view). Permissions: `learning.read` for GET on published, `learning.manage` for authoring, `learning.publish` to publish.

Assignments (V2): `POST /learning/items/:id/audiences` · `DELETE /learning/audiences/:id` · `POST /learning/items/:id/assign` `{ userIds[], dueDays? }` · `GET /learning/my` → open/overdue/completed with item summaries · `GET /learning/my/:assignmentId` → full briefing or quiz (questions without correct flags) · `POST /learning/my/:assignmentId/acknowledge` · `POST /learning/my/:assignmentId/attempts` → attempt id · `PUT /learning/attempts/:id` `{ answers }` → `{ score, passed, perQuestion }` · `GET /learning/items/:id/completion` (per audience/world/user, overdue list) · `GET /learning/dashboard?world` (completion rates, overdue, top failed questions) · `GET /documents/:id/learning` (items referencing the document, refresh state). Publish hook: `POST /documents/:id/publish` accepts `significantChange?: boolean`; response includes `changeFlag`.

Approver & gaps (V3): `GET/PUT /admin/workflow` `{ requireApprover, learning: {...}, gaps: {...} }` · `GET /gaps?kind&status` · `POST /gaps/:id/dismiss` `{ reason }` · `POST /gaps/:id/resolve` `{ documentId }` · `POST /gaps/detect` (manual run, `gaps.manage`).

Events: `learning.assigned { assignmentId, userId, itemId }`, `learning.completed { assignmentId, userId, itemId, passed }`, `learning.refresh_required { documentId, version, affectedUsers }`, `gap.detected { gapId, kind }`. Notifications kinds gain `learning`, `gap` (append-only).

## 5. Behaviour

- **Briefing reader**: intro, entries rendered with the article step renderer (read-only), progress per entry, "קראתי והבנתי" at the end → completion; version shown; if a referenced document changed significantly after assignment → banner "התוכן עודכן – יש לקרוא שוב".
- **Quiz player**: one question per screen, keyboard 1–4, review screen with explanations after submit, pass/fail, attempts left, retry.
- **Builder**: pick documents (search), generate questions per document, edit stems/options/explanations, drag order, set pass mark/attempts/estimate, preview, publish; assign dialog (roles × worlds, individuals, due days); completion dashboard with export CSV.
- **Refresh**: on publish with a significant change → completions of referencing items are invalidated, refresh assignments created (due `learning.refreshDueDays`), notification kind `learning` to each user, article shows "רענון ידע נדרש" for the affected user until done.
- **Gaps**: `/gaps` list ranked by score with evidence and actions; dismiss with reason; "צור פריט" opens the editor prefilled (title from the search term / topic); resolved when the linked document is published.
- **Approver**: `/admin/identity` workflow section toggles `requireApprover`; when on, review-decision by a non-approver → 403 `APPROVER_REQUIRED`; the review queue shows who can approve.

## 6. Isolation & merge

Branch point: main after the parked-items cleanup lane merges. Append-only shared files as in wave 4 §6; new modules `apps/api/src/modules/learning/`, `apps/api/src/modules/gaps/`; web under `apps/web/src/components/learning/**`, `gaps/**`; mounts by V6. Migrations 0038–0042. Merge order V0 → V1 → V2 → V3 → V4 → V6.

## 7. Testing & acceptance

Unit: question generation fallback per step shape; significant-change detector on real diffs; audience resolution; gap heuristics. Integration: every route + permission denial; publish → invalidation → refresh assignment; attempts scoring and max attempts; approver gate; gap job idempotence. Web: builder, player, reader, dashboard, gaps. Real e2e: editor builds a quiz from a document → assigns to agents in a world → agent passes it → dashboard shows completion → editor publishes a significant change → agent sees refresh assignment → gap list shows a zero-result term and "צור פריט" opens the editor.

Wave 5 is done when each PRD future-phase bullet has a green integration or e2e test, the approver switch works without breaking default deployments, and all gates (`test`, `test:int`, `e2e`, `e2e:real`, `E2E_OIDC=1 e2e:real`, OpenAPI contract) are green on main.
