# Wave 5 — Learning & training: briefings, quizzes, completion tracking, knowledge refresh, approver role, gap detection

Date: 2026-09-15 · Status: approved by the product owner in brainstorming (2026-09-15) — adopted from the wave-3 session's 2026-09-14 draft with the changes marked **[owner decision]** and **[wave-5 session]** below. Owner: the wave-4/5 session.
PRD: `docs/prd/prd-knowledge-manager.md` §13 "שלב עתידי - למידה והדרכה", "שלבים עתידיים יכללו", and the two inline deferrals in §11 and §13 (`docs/prd/future-phase.md`).
Program context: `2026-09-13-kb-platform-program-and-lanes.md`; waves 3–4 contracts in `docs/api/CONTRACTS-stage4-5.md`, `packages/shared/src/schemas/{stage45,wave4}.ts`.

## 0. What the PRD asks for

"על בסיס אותם פריטי ידע המערכת תוכל בהמשך: ליצור תדריך · ליצור שאלון ידע · לעקוב אחר השלמה · לזהות שינוי משמעותי בידע ולדרוש רענון ידע. התוכן שנכתב פעם אחת הופך גם לידע תפעולי וגם לבסיס ללמידה." Plus: switching on a distinct approver role (§11) and using usage data to find knowledge gaps (§13).

## 1. Rulings (decisions taken without the product owner; each with cost if wrong)

1. **[owner decision] Briefings and quizzes are standalone learning items derived from published documents, never free text.** A briefing is an ordered set of one or more published document references (any documents; a whole topic is a picker shortcut that expands to its items) with an editor-written intro and a per-item note; a quiz is a set of questions each anchored to a document step. **On publish, the learning item's version snapshot records the `current_version` of every referenced document**, so the refresh rule (§1.5) compares against exactly what the learner saw. Cost: an editor who wants a free-form training page must write it as a `kind: 'text'` document first.
2. **Question generation is model-assisted with a deterministic fallback**, exactly like the source pipeline: branches become "what do you do if…" multiple-choice questions (options = branch labels), outcomes become "what is the next step" questions, CRM steps become "which field" questions; the local model may rewrite stems and add distractors, output schema-validated. Editors curate before publishing. Cost: question quality depends on step quality.
3. **Assignments target audiences, not individuals, by default**: audience = roles × worlds (e.g. "agents in intl"), resolved to users at assignment time and re-resolved nightly for joiners. Individual assignment exists for ad hoc cases. Cost: a user moved between worlds gets new assignments and keeps old completions.
4. **[owner decision] Completion = read acknowledgement for briefings ("קראתי והבנתי"); for quizzes a pass mark (default 80%, configurable per quiz) with unlimited retakes — an assignment is complete when a passing attempt exists.** `max_attempts` stays in the model as nullable (null = unlimited, the default) so a cap can be switched on later without a migration; managers see every attempt and score. Cost: no partial credit; a user can brute-force a small quiz by retaking (mitigated by the attempt history being visible).
5. **"Significant change" is computed on publish** from the diff engine: any changed/added/removed outcome or branch option, any deleted step, any changed CRM field reference, or >40% of step text changed. Editors can override on the publish dialog ("שינוי מהותי – דרוש רענון" checkbox, pre-ticked when detected). A significant change **invalidates** completions of every learning item that references the document and creates a refresh assignment for affected users with a due date (default 7 days). Cost: false positives create refresh work; the override checkbox is the safety valve.
6. **Approver role switched on as configuration, not code**: a system role `approver` (permissions: `docs.publish`, `suggestions.apply`, `learning.publish` — no `docs.edit`) plus a workflow setting `review.requireApprover` (default off). When on, `review-decision` requires the `approver` role and `docs.publish` alone is not enough; leads keep both roles by default so nothing breaks on upgrade. Cost: none by default.
7. **Gap detection is a nightly job producing a ranked list with evidence**, not a model: zero-result search terms clustered by normalized stem (≥3 occurrences / 7 days), items with ≥3 open feedback of kind `no_answer`/`missing`, high-traffic items (top decile views) not updated for 180 days, topics with views but no `R`/`O` items, quizzes with a question failed by ≥50% of attempts. Each gap has a suggested action ("צור פריט", "עדכן", "הוסף שאלה") and can be dismissed with a reason. Cost: heuristics; thresholds are settings.
8. **Learning items respect governance**: only published documents can be referenced; an item whose document becomes `invalid`/`archived` is flagged "דורש עדכון" and hidden from new assignments.

## 2. Lanes **[wave-5 session]**

| Lane | Scope | Migrations |
|---|---|---|
| V0 Contracts | reconcile `packages/shared/src/schemas/wave5.ts` (already on main, 4662248) with this spec: unlimited attempts, document versions in briefing/quiz snapshots, `significantChange` on `PublishBodySchema`, type aliases; permissions (`learning.read`, `learning.manage`, `learning.publish`, `gaps.read`, `gaps.manage`), events (`learning.assigned`, `learning.completed`, `learning.refresh_required`, `gap.detected`), queues (`learning.resolve_audiences`, `learning.reminders`, `gaps.detect`), `docs/api/CONTRACTS-wave5.md` | 0038 (permissions + `approver` system role + settings defaults) |
| V1 Learning content (api) | briefings, quizzes, questions (generation with model + rule fallback), curation, publishing with document-version snapshot, versions, preview | 0039 |
| V2 Assignments & tracking (api) | audiences, assignments, completions, attempts, acknowledgements, reminders, completion/dashboard data, significant-change detection hook on publish, refresh assignments, `GET /documents/:id/learning` | 0040 |
| V3 Approver & gaps (api) | approver role activation + `workflow.requireApprover` gate on review-decision, gap detection job, gaps API, dismiss/resolve, `/admin/workflow` | 0041 |
| V4a Agent web | `/learning` (my assignments), briefing reader with acknowledgement, quiz player, article banners ("רענון ידע נדרש", "התוכן עודכן"), notifications wiring | — |
| V4b Editor web | `/learning/manage` builders (briefing + quiz, generated questions, curation), assign dialog (roles × worlds, individuals, due days), completion dashboard + CSV, `/gaps`, workflow section on `/admin/identity` | — |
| V6 Integration | mounts (shell nav, article banners, publish dialog checkbox, review queue approver hint), real e2e flows, whole-wave review + fix wave, **and the three wave-4 follow-ups from the acceptance review**: F-4 (`wordpress-source.spec.ts` poll budget via `expect.poll`), A-4 (feedback modal shows `T · תסריט`, not the raw letter), E-1 (publish keeps `source_review_needed` with reason "ממתין לדחיפה/קונפליקט" when the document's sync link is `conflict` or `pending_push`, using the wave-3 session's `GET /documents/:id/sync-state`) | 0042 reserved |

The design-mockup lane in the draft is dropped: the design project is out of the loop (owner decision 2026-09-14); V4a/V4b lay out from the article/editor conventions already on main.

V1, V2 and V3 run in parallel with V4a and V4b (web halves build against `wave5.ts` + MSW, then switch to the generated client at V6, exactly as wave 4 did). Web halves must not touch `apps/api`; api halves must not touch `apps/web`.

## 3. Data model

- `learning_items(id, kind check in ('briefing','quiz'), title, description, world_slug → worlds null, status check in ('draft','published','archived'), current_version int, pass_mark int null (quiz; default from settings, 80), max_attempts int null (null = unlimited, the default), estimated_minutes int null, created_by, updated_by, published_at, timestamps, deleted_at)`.
- `learning_item_versions(id, item_id, version, snapshot jsonb, author_id, label, created_at)` unique (item_id, version). The snapshot carries `documents: [{ documentId, version }]` — the `current_version` of every referenced document at publish time **[owner decision]**.
- `briefing_entries(id, item_id, position, document_id → documents, step_key null, note text default '')`.
- `quiz_questions(id, item_id, position, document_id → documents, step_key null, stem text, kind check in ('single','multi','order','free'), options jsonb [{id,text,correct}], explanation text default '', generated bool default false, model_conf numeric null)`.
- `learning_audiences(id, item_id, role_names text[], world_slugs text[], user_ids uuid[], due_days int default 14, created_by, created_at)`.
- `learning_assignments(id, item_id, item_version int, user_id, audience_id null, reason check in ('audience','manual','refresh'), assigned_at, due_at, status check in ('open','completed','overdue','invalidated'), completed_at null, invalidated_at null, invalidated_reason text null)` unique (item_id, user_id, item_version, reason).
- `learning_attempts(id, assignment_id, attempt_no int, started_at, finished_at null, score int null, passed bool null, answers jsonb)`; unlimited unless `learning_items.max_attempts` is set.
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

Branch point: current main for V0 and the lane worktrees (V0 lands on main immediately, docs and contracts only touch additive files); the **first code merge into main waits until the wave-3 session's parked-items cleanup lane (migration 0037) has landed**, then V6's integration branch merges main and finishes. Concurrent `e2e:real` runs must set distinct `E2E_PG_PORT`/`E2E_API_PORT`/`E2E_WEB_PORT` (main 37dd05f derives the container name from the port). Append-only shared files as in wave 4 §6; new modules `apps/api/src/modules/learning/`, `apps/api/src/modules/gaps/`; web under `apps/web/src/components/learning/**`, `gaps/**`; mounts by V6. Migrations 0038–0042. Merge order (into `wave5/integration`): V0 (on main) → V1 → V2 → V3 → V4a → V4b → V6 seams; then `wave5/integration` → main.

## 7. Testing & acceptance

Unit: question generation fallback per step shape; significant-change detector on real diffs; audience resolution; gap heuristics. Integration: every route + permission denial; publish → invalidation → refresh assignment; attempts scoring with unlimited retakes and with a configured cap; approver gate on and off; gap job idempotence; a learning item's snapshot pins document versions and a non-significant publish does not invalidate. Web: builder, player, reader, dashboard, gaps. Real e2e: editor builds a quiz from a document → assigns to agents in a world → agent passes it → dashboard shows completion → editor publishes a significant change → agent sees refresh assignment → gap list shows a zero-result term and "צור פריט" opens the editor.

Wave 5 is done when each PRD future-phase bullet has a green integration or e2e test, the approver switch works without breaking default deployments, and all gates (`test`, `test:int`, `e2e`, `e2e:real`, `E2E_OIDC=1 e2e:real`, OpenAPI contract) are green on main.
