# Wave Y — closing the parked items (waves 4–6)

Base: `wave6/gate` @ 1858816 (wave 6 final gate running in parallel). Lanes branch from that SHA and
merge into `waveY/integration`, which merges the finished `wave6/gate` before its own gate.
Migrations: 0055–0059 (nothing on any branch uses them; 0050–0054 are wave 6).

## Owner decisions (2026-09-29)

1. **Scope rule (wave 5 A-M6)** — reads stay "any overlap"; **writes** (edit, publish, delete,
   status changes) require the caller to hold **every** world the entity spans. App-wide:
   documents, blocks, fields, learning items. Unscoped (org-wide) roles are unaffected.
2. **Source-review flag (wave 5 A-M11)** — a human publish **keeps** an existing flag while a sync
   link is `pending_push`/`conflict`, and **never raises** one that was clear.
3. **Revision diffs (wave 6 A-M7)** — keep full `meta->'diffs'` for the newest 20 revisions per
   source plus any revision a suggestion references; older revisions keep counts only. Nightly job.
4. **VM items** — the owner runs them; this wave leaves a runbook, not results.

## Lanes

### Y1 — scope & governance (API) · migration 0055
- A-M6 (w5): writes need all worlds — one predicate in `lib/user.ts` (`hasAllScopes`), used by
  every write guard; reads unchanged. Tests per entity kind incl. multi-world learning item.
- A-M8 (w5): `canSeeById` lean loader sharing one visibility rule with `canSee`; `visible()` in
  learning routes uses it.
- A-M11 (w5): keep-never-raise in `documents/repo.ts`; test both directions.
- A-M14 (w4): `user_roles.world_scope` integrity — trigger rejecting unknown slugs + cascade on
  slug rename (0055).
- B-M1 (w4): remove the always-true schema probes (`hasColumn` owner/editor/doc_type,
  `to_regclass('document_topics')`, `probeCapabilities`, `body_html`) and the pre-W2 fallback
  tests that keep them alive.

### Y2 — data & storage (API) · migrations 0056–0057
- B-M15 (w4): `asset_refs` join table maintained on every HTML save; `gcUnreferencedAssets`
  reads it; backfill in 0056.
- A-M7 (w6): diff pruning job per decision 3 (+ `pruned_at`/counts in meta), registered in jobs.
- A-M4 (w6): `embeddingMapping` as one lateral query; eval rules scores must stay identical.
- A-M5 (w6, second half): migration 0051 and the API share one resolver module (plain JS,
  importable by both).
- w4 `view_topic` telemetry kind: remove the dead enum value and narrow the check (0057).
- w4 deprecated `POST /sync-links/:id/resolve`: remove if no client calls it; contract + openapi.

### Y3 — full-stack follow-ups (shared + API + web) · migration 0058 if needed
- B-M6 (w6): `proposed_edits` frame carries the tool message id; `ChatPane` uses it.
- B-M12 (w6): `GET /ai/conversations` (admin) gains `q` (message-body search) and `page`; the
  transcript browser gets a search box and paging.
- B-M16 (w6): contract doc line 184 corrected to the code's gate; code gate unchanged.
- A-M4 follow-up (w5): `failedQuestionMin` / `topicViewsMin` become `WorkflowSettings.gaps` keys
  (same defaults) with two inputs on the admin workflow form.
- w6: SuggestionsPanel lists suggestions of **all** sources of a multi-source document.
- w6: eval precision stored as a real column instead of in `notes`.

### Y4 — web accessibility & robustness
- B-M5 (w5): `DocumentPicker` as a real combobox (aria-activedescendant, arrow keys, Enter/Escape).
- B-M6 (w5): every `role="button" tabIndex={0}` in the app gets Enter/Space (or becomes a
  `<button>`), plus a lint/test guard so new ones cannot land.
- B-M11 (w5): `dirty` guard on the briefing and quiz builders (B-C2 pattern).
- B-M17 (w5): e2e-only raised local sign-in rate limit (env, refused in production) so the helper
  never sleeps 2 × 61 s; production limit and its test unchanged.

## Not reopened (standing rulings, reviewer agreed)
Quiz preview omits `correct`; change-preview second read; no separate OIDC spec; A-I3 attempt
cycles; per-process dashboard cache; TopicPage eager import. The ledger records why.

## Close-out
`waveY/integration` merges all lanes + finished `wave6/gate`; one review; full gate; acceptance doc
`docs/waveY-acceptance.md` strikes each item with its evidence; VM runbook appended to
`docs/pilot-readiness.md`.
