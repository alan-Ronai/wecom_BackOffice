# Wave 4 — Closing the PRD gaps: taxonomy, governance, feedback, source documents, usage

Date: 2026-09-14 · Status: approved in brainstorming, awaiting written review
PRD: `אפיון פונקציונלי וארכיטקטורת ידע - מנהלת הידע הארגונית` (sections 1–13 + v1/future split)
Program context: `2026-09-13-kb-platform-program-and-lanes.md`, stage 1 design, wave 3 contracts in `docs/api/CONTRACTS-stage4-5.md` / `packages/shared/src/schemas/stage45.ts`.

## 0. Why and what

The gap analysis of 2026-09-14 against the PRD found, on main `ad99328`:

- Done: single source of truth with shared blocks and links (§2), guided and direct paths (§5), source layer vs working view with editor-gated suggestions (§8), versions/diff/restore/audit (§9), soft delete (§10), RBAC with editor/approver split (§11), free-text search (§7), per-user view counts (§13).
- Partial: content worlds are a fixed enum, topics are a bare integer, no item types (M/R/O/E/S/T/I), no tags on documents, no topic view, no rich source authoring, no published-only visibility, no "לא בתוקף", purge hard-deletes once-published items, no owner/editor/approver per item, no search log.
- Missing: the feedback mechanism (§12) entirely; editor alerts for source changes; usage analytics beyond view counts.

Wave 3 (running in parallel, contracts frozen) delivers notifications, the request-review/decision workflow, dashboards, telemetry, comments, presence, graph and admin identity. Wave 4 builds on those contracts and does not duplicate them.

Decisions taken with the product owner:

1. Source documents: **both** — an in-app rich source editor **and** two-way WordPress sync, with **HTML as the canonical format** (one format for editor, WordPress, docx import/export and the existing paragraph normalizer).
2. Taxonomy: **worlds and topics as tables with multi-membership**; RBAC scopes move to world slugs.
3. Item types: `docType` M/R/O/E/S/T/I on documents; **scripts are folded into documents as type T** with a `text` rendering kind.
4. Sequencing: **wave 4 starts now, in parallel with wave 3**, contracts first, additive-only touches to shared files, wiring at merge.
5. Execution model (ledger ruling of 2026-09-13 stands): parallel lanes in worktrees, no per-task review, one whole-branch review at the end.

## 1. Lanes

| Lane | Scope | Migrations |
|---|---|---|
| W0 Contracts | `packages/shared/src/schemas/wave4.ts`, permissions (migration 0029), events, queues, `Notifier` + `TaxonomyResolver` + `UsageRecorder` interfaces, contracts doc | 0029; reserves 0030–0035 for W1–W6 |
| W1 Taxonomy | worlds, topics, memberships, docType, tags, scripts fold, scope migration, topic page, facets, search filters | 0030 |
| W2 Governance | statuses (+`invalid`), published-only visibility, purge rule, owner/editor/approver, `published_at`, source-review flag | 0031 |
| W3 Feedback | feedback table, API, agent modal, editor queue, resolve-by-version, alerts, analytics | 0032 |
| W4 Source documents | HTML source docs + versions, assets, TipTap editor, docx import/export, ingest hook, WordPress render switch, source pane | 0033 |
| W5 Usage | search log, zero-result capture, telemetry kinds, `/analytics/usage`, analytics page | 0034 |
| W6 Integration gate | real e2e flows, contract test, merge playbook vs wave 3, review fixes | — |

0035 is reserved for W6 fix-ups (e.g. indexes discovered under e2e).

## 2. Data model

All new tables follow the stage-1 conventions (`id uuid`, timestamps, `created_by/updated_by` on content tables, soft delete only where stated).

### 2.1 Taxonomy (0030, W1)

- `worlds(id, slug text unique, name text, description text default '', position int, active bool default true, created_at, updated_at, created_by, updated_by)`. Seeded from the six categories with the Hebrew labels in `CATEGORY_LABELS`.
- `topics(id, world_id → worlds, slug text, name text, description text default '', position int, active bool default true, timestamps)`; unique `(world_id, slug)`. Seeded from the legacy topic ids/titles in `apps/api/seed/cards.json` and `documents.json` (`_topicId`).
- `documents.category`: drop the check constraint; add FK `→ worlds(slug)` (on update cascade). It remains the **primary world**.
- `document_worlds(document_id → documents cascade, world_slug → worlds(slug) cascade, primary key (document_id, world_slug))`. Invariant: the primary world always has a row here (maintained by the documents repo on insert/patch).
- `document_topics(document_id, topic_id → topics cascade, primary key (document_id, topic_id))`. `documents.topic_id` is backfilled into this table and then dropped.
- `documents.doc_type text not null check (doc_type in ('M','R','O','E','S','T','I'))`. Backfill: rows with ≥1 phase → `R`; rows with no phases → `I`; kind `retention` → `R`.
- `documents.tags text[] not null default '{}'` with a GIN index; the search trigger folds tags into `search_text` weight B.
- `documents.kind` check extended to `('steps','retention','text')`; `documents.body_html text` (sanitized HTML, used by kind `text`).
- Scripts fold (same migration, single transaction): for each `scripts` row insert a document `{slug: 'script-' + short id, title, doc_type 'T', kind 'text', body_html '<p>'+escaped text with <br> per line+'</p>', tags, category: most common category among its refs, else 'ops', status 'published', current_version 1}` plus one `document_versions` row of kind `system` labelled "הומר מתסריט"; every `script_refs` row becomes a `document_links` row `(from_document_id = ref.document_id, from_step_key = ref.step_key, to_document_id = new doc, type 'link', origin 'explicit')`. Then drop `script_refs`, `scripts`. `down` recreates the tables from the T documents.
- RBAC: rename `user_roles.category_scope` → `world_scope` (values unchanged). `AuthUser.categoryScopes` is renamed `worldScopes` in shared (type alias kept for one release). Scope check: pass when `worldScopes` is null or intersects the document's world set (`document_worlds`).
- `CategorySchema` becomes `z.string().min(1)`; validity is checked against `worlds` at the API (400 `UNKNOWN_WORLD`).

### 2.2 Governance (0031, W2)

- `documents.status` check → `('draft','review','published','partial','invalid','archived')`. `DocumentStatusSchema` extended accordingly.
- `documents.owner_id uuid → users`, `editor_id uuid → users`, `approver_id uuid → users`, `published_at timestamptz`. Backfill `owner_id = editor_id = updated_by`, `published_at = max(document_versions.created_at where kind='published')`.
- `documents.source_review_needed bool not null default false`, `source_review_reason text`, `source_review_at timestamptz`.
- `document_versions.source_version int` (the source document version a working version was derived from; null when not applicable).
- New permission `docs.read_unpublished` (editor, lead, admin). Users without it receive only `published` and `partial` from list, get, related, links, backlinks, topic view and search.
- Trash purge: skip documents having ≥1 `document_versions` row of kind `published`. `DELETE /documents/:id` on such a document returns 409 `ONCE_PUBLISHED` with `{ allowed: ['invalid','archived'] }`.

### 2.3 Feedback (0032, W3)

- `feedback(id, document_id → documents, document_version int, doc_type text, world_slug text, step_key text null, kind text check in ('outdated','error','unclear','missing','process_fails','no_answer','other'), text text default '', status text check in ('new','in_review','needs_update','no_change','done') default 'new', user_id → users, created_at, assignee_id → users null, decision_note text null, decided_by → users null, decided_at timestamptz null, resolved_version int null)`. Indexes on `(document_id, created_at)`, `(status, created_at)`, `(kind)`.
- `feedback_alerts(id, document_id, kind text check in ('new','repeat','process_fails','anomaly'), window_start, window_end, count int, notified_at)` — dedupes repeat/anomaly alerts per window.
- New permission `feedback.manage` (editor, lead, admin).
- Kinds map to the PRD labels: outdated "המידע לא מעודכן", error "מצאתי טעות", unclear "ההנחיה לא ברורה", missing "חסר מידע", process_fails "התהליך לא עובד בפועל", no_answer "לא מצאתי תשובה למקרה שלי", other "אחר".

### 2.4 Source documents (0033, W4)

- `source_documents(id, document_id → documents unique, html text not null default '', text text not null default '', hash text, current_version int default 0, etag text, updated_by, updated_at, created_at)`.
- `source_document_versions(id, source_document_id → source_documents cascade, version int, html text, author_id → users, label text default '', source_revision_id → source_revisions null, created_at)`; unique `(source_document_id, version)`.
- `assets(id, mime text, bytes bytea, sha256 text unique, size int, width int null, height int null, created_by, created_at)`. Max 10 MB per asset; allowed mimes `image/png, image/jpeg, image/gif, image/webp` (SVG rejected with 415).
- Existing `sources` rows of kind `docx`/`wordpress` map onto a source document per linked document: `source_documents.html` is initialised from the latest accepted `source_revisions.paragraphs` rendered to HTML (paragraph → `<p>`/`<hN>`), so the source pane is populated for every existing item.

### 2.5 Usage (0034, W5)

- `search_log(id, user_id → users, q text, filters jsonb, results int, took_ms int, at timestamptz default now())`; index `(at)`, partial index `(q) where results = 0`.
- Telemetry kinds (additive to wave 3's enum): `view_topic`, `search_click`.
- New permission `analytics.read` (lead, admin; editors get it too by default so content teams can see their own items).

## 3. API (`/api/v1`, all zod-validated from `wave4.ts`, in OpenAPI)

### Taxonomy (W1)
| Method | Path | Requires |
|---|---|---|
| GET | `/worlds` (`?includeInactive`) → `{ items: World[] }` with topic counts | docs.read |
| POST | `/worlds` · PATCH/DELETE `/worlds/:slug` (delete = deactivate; 409 if items remain and `force` absent) | taxonomy.manage |
| GET | `/worlds/:slug/topics` → `{ items: Topic[] }` with item counts | docs.read |
| POST | `/worlds/:slug/topics` · PATCH/DELETE `/topics/:id` | taxonomy.manage |
| PUT | `/worlds/reorder` · `/worlds/:slug/topics/reorder` `{ ids[] }` | taxonomy.manage |
| GET | `/topics/:id/items` → `TopicViewSchema` `{ topic, world, groups: { docType, items: TopicItem[] }[] }` (PRD order M,R,O,E,S,T,I; visibility-filtered) | docs.read |
| GET | `/tags?q=` → `{ items: { tag, count }[] }` | docs.read |
| GET | `/documents` gains `world`, `topic`, `docType`, `tag` (repeatable) | — |
| GET | `/search` gains the same filters; tag matches are their own group `tags` | — |
| PATCH | `/documents/:id` accepts `docType`, `tags`, `worlds[]`, `topics[]`, `ownerId`, `editorId`, `bodyHtml` | docs.edit |
| GET/POST/PUT/DELETE | `/scripts*` stay as adapters over `doc_type='T'` documents for one release (deprecated in OpenAPI) | as today |

New permission: `taxonomy.manage` (lead, admin).

### Governance (W2)
| Method | Path | Requires |
|---|---|---|
| POST | `/documents/:id/status` `{ status: 'invalid'|'archived'|'draft', reason }` → Document; audit `docs.status` | docs.publish |
| GET | `/documents/:id` etc. — visibility rule applied server-side; unpublished → 404 `NOT_PUBLISHED` for users without `docs.read_unpublished` | — |
| POST | `/documents/:id/source-review/clear` `{ note }` (editor decides the working view is unaffected) | docs.edit |

`DocumentCardSchema`/`DocumentSchema` gain `docType, tags, worlds, topics, ownerId, ownerName, editorId, editorName, approverId, approverName, publishedAt, sourceReviewNeeded, sourceReviewReason`.

### Feedback (W3)
| Method | Path | Requires |
|---|---|---|
| POST | `/documents/:id/feedback` `{ kind, text?, stepKey? }` → Feedback (server fills version, docType, world, user, time) | docs.read |
| GET | `/feedback` `?status&world&kind&documentId&assigneeId&page&pageSize` → paginated `FeedbackRow` (with title, docType, reporterName) | feedback.manage |
| GET | `/feedback/:id` → FeedbackDetail (feedback + document title + version label + link to `/doc/:id/:step`) | feedback.manage |
| PATCH | `/feedback/:id` `{ status?, assigneeId?, decisionNote? }` | feedback.manage |
| POST | `/feedback/:id/resolve` `{ version, decisionNote? }` → sets status `done`, `resolved_version` | feedback.manage |
| POST | `/documents/:id/publish` accepts optional `resolveFeedbackIds[]` (closes them with the new version in the same transaction) | docs.publish |
| GET | `/feedback/analytics` `?from&to&world` → `FeedbackAnalyticsSchema` `{ perItem[], byKind[], topItems[], meanHoursToClose, changeRate, recurringByTopic[] }` cached 60 s | feedback.manage |
| GET | `/documents/:id/feedback` → open feedback on an item (for the editor/publish dialog) | docs.edit |

Alerts (via `Notifier`): on create → owner + editor (`kind 'feedback'`); `process_fails` → also every user holding `docs.publish` in the item's world; repeat (≥3 in 7 days) and anomaly (≥2× the item's 30-day daily mean and ≥5) → owner + leads, deduped in `feedback_alerts`. Queue `feedback.digest` sends a daily summary per editor.

### Source documents (W4)
| Method | Path | Requires |
|---|---|---|
| GET | `/documents/:id/source` → `SourceDocument` (html, text, version, etag, updatedBy, updatedAt) or 204 when none | docs.read (visibility rule applies) |
| PUT | `/documents/:id/source` `{ html, label? }` + `If-Match` → SourceDocument; sanitizes, versions, ingests | docs.edit |
| GET | `/documents/:id/source/versions` · `/versions/:v` · POST `/restore/:v` | docs.read / docs.edit |
| POST | `/documents/:id/source/import` multipart `.docx` → SourceDocument (mammoth → sanitize → PUT path) | docs.edit |
| GET | `/documents/:id/source/export.docx` → `application/vnd.openxmlformats-officedocument.wordprocessingml.document` | docs.read |
| POST | `/assets` multipart → `{ id, url, mime, size }` | docs.edit |
| GET | `/assets/:id` → bytes, `Cache-Control: public, max-age=31536000, immutable` | docs.read |

### Usage (W5)
| Method | Path | Requires |
|---|---|---|
| GET | `/analytics/usage` `?from&to&world` → `UsageAnalyticsSchema` `{ itemViews[], topItems[], topTopics[], viewers[], zeroResultTerms[], staleness[] }` cached 60 s | analytics.read |
| GET | `/analytics/search-log` `?zeroOnly&page` → paginated rows | analytics.read |

### Events (additive to `packages/shared/src/events.ts`)
`feedback.created { feedbackId, documentId, kind }`, `feedback.updated { feedbackId, status }`, `source_document.saved { documentId, version, actorId }`, `taxonomy.changed { entity: 'world'|'topic', id }`.

### Queues (additive to `QUEUES`)
`feedback.digest` (daily), `feedback.alerts` (every 10 min, evaluates repeat/anomaly windows), `assets.gc` (weekly, deletes assets unreferenced by any source document version).

## 4. Shared interfaces (W0)

```ts
// packages/shared/src/wave4/notifier.ts
export interface Notifier {
  notify(n: { userIds: string[]; kind: 'feedback'|'source'|'system'; title: string; body?: string; href?: string; entityType?: string; entityId?: string }): Promise<void>;
}
// packages/shared/src/wave4/taxonomy.ts
export interface TaxonomyResolver {
  worldsOf(documentId: string): Promise<string[]>;        // slugs, primary first
  usersWithPermissionInWorld(permission: string, world: string): Promise<string[]>;
}
```

Production implementations: `Notifier` writes wave 3's `notifications` table and publishes `notification.created`; until wave 3 merges, a `LogNotifier` (pino) is registered so the API still boots. `TaxonomyResolver` is implemented by W1's repo; W2/W3/W5 code against the interface and tests use fakes. Both are decorated as `app.notifier` and `app.taxonomy` from one plugin file owned by W0.

## 5. Behaviour

### 5.1 Source editor (W4)
- TipTap (StarterKit + Table, Image, Link, TextAlign, Underline), `dir="rtl"` default, Hebrew toolbar. Server-side sanitizer allowlist: `h1–h4, p, ul, ol, li, table, thead, tbody, tr, th, td, img[src=/api/v1/assets/*] (data: URIs rejected), a[href http(s)], strong, em, u, s, blockquote, code, pre, br, hr, span[dir], bdi`. Anything else is stripped; the stored HTML is therefore always renderable by WordPress and the docx exporter.
- Images: paste/drop → `POST /assets` → `<img src="/api/v1/assets/:id">`. Export embeds bytes into the docx; WordPress push uploads to `wp/v2/media` and rewrites `src`; pull rewrites WordPress media URLs back to assets (downloaded once, deduped by sha256).
- Import: mammoth docx → HTML → sanitizer → normal save path (label "יובא מ-Word"). Export: HTML walker in `packages/shared/src/format/htmlToDocx.ts` driving the `docx` package (headings, lists, tables, images, links, bold/italic/underline). Loss is limited to styling outside the allowlist; the export dialog says so.
- Autosave every 3 s through `GET/PUT/DELETE /documents/:id/source/draft` (stored in `drafts` under key `source:<documentId>`, per user); explicit "שמור גרסה" → `PUT /source` with label → version. Etag conflict → the same dialog the step editor uses.
- Article page pane modes: working / source / split (persisted in preferences). Source pane renders sanitized HTML read-only; editors get "ערוך מקור"; imported items get the raw docx download from the latest revision (`GET /sources/:id/revisions/:rev/raw`, added by W4).

### 5.2 Source change → working view (W2 + W4)
- Every source save (in-app or WordPress inbound) → `source_document_versions` row → `SourceRevisionService.ingest(sourceId, paragraphs, actorId, rawHtml)` → suggestions (existing pipeline) → `documents.source_review_needed = true`, reason "גרסת מקור N · <name>" → `Notifier` to owner + editor.
- Publishing the working view clears the flag and writes `document_versions.source_version = source_documents.current_version`. `POST /source-review/clear` clears it with a note (audit `docs.source_review_cleared`). Rejecting all pending suggestions of that revision also clears it.
- Nothing changes the working view without an editor action (PRD §8).

### 5.3 Taxonomy & navigation (W1)
- Sidebar lists active worlds from `GET /worlds`, topics nested (lazy). Admin tab `/admin/taxonomy`: worlds and topics with drag ordering, active toggle, counts.
- `/topic/:id`: header (world, description), rows per docType in PRD order with Hebrew labels (M אבחון, R טיפול, O תפעול, E הסלמה, S מומחה, T תסריט, I מידע), each card: type badge, worlds chips, description, tags, updated date. Article header shows the badge plus prev/next within the topic.
- Library facets: world, topic, docType, tag + existing wave/flags; state in URL query. Search results carry the badge and honour the same filters.
- Editor metadata panel: docType, primary world, extra worlds, topics, tags (autocomplete from `/tags`), owner, responsible editor. Text-kind items (T/I) edit `bodyHtml` with the same TipTap component in a compact mode.

### 5.4 Feedback (W3)
- Fixed button "דיווח על בעיה / משוב" in the article header and per step (step passes `stepKey`). Modal: 7 radios, short text (max 1000), read-only auto-context (item, type, world, version, step). Submit → toast; anonymous is not an option (user is captured).
- `/feedback` (editors): status tabs (חדש / בבדיקה / דורש עדכון / לא נדרש שינוי / טופל), filters (world, docType, kind, item, assignee), row → drawer (context, version label, "פתח מסמך" deep link to `/doc/:id/:step`, decision note, assignee, status, "נסגר בגרסה" picker prefilled with the newest published version created after the feedback). Analytics tab renders `/feedback/analytics`.
- Publish dialog lists open feedback on the item with checkboxes → `resolveFeedbackIds`.

### 5.5 Visibility & statuses (W2)
- Users without `docs.read_unpublished` never receive draft/review/invalid/archived items; article shows "פריט זה אינו זמין כרגע" on `NOT_PUBLISHED`. Status filter hidden for them.
- Editors: status chips everywhere; card menu "סמן כלא בתוקף" / "העבר לארכיון" with a reason (audit). Links to invalid items: strikethrough + tooltip for editors, hidden for read-only users. Invalid/archived items are excluded from the active goto/related graph but kept in versions and links tables.

### 5.6 Usage (W5)
- Search writes `search_log` after the response is sent (`reply.then`). `/analytics`: item views, topic views, zero-result searches with "צור פריט" shortcut for editors, staleness table (item, owner, last update, last published). Reuses wave 3 dashboard cards when present; plain tables otherwise.

## 6. Isolation from wave 3 and merge playbook

- Branch point: main `ad99328`. Lanes W1–W5 each in their own worktree; W0 lands on main before dispatch.
- Shared files a lane may touch, **append-only**: `apps/api/src/modules/index.ts` (one import + one list entry), `apps/web/src/routes.tsx` (route entries), `packages/shared/src/events.ts` (new names + payloads), `packages/shared/src/permissions.ts` (new names, role additions), `apps/api/src/plugins/boss.ts` (`QUEUES` entries), migrations in the lane's reserved number. Everything else new-file or in the lane's own module directory.
- Not touched by lanes: `stage45.ts`, `app.ts`, `Shell.tsx`/`Sidebar.tsx`, `ArticlePage.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`. Lanes ship components plus a documented one-line mount; W6 performs the mounts after both waves merge.
- Merge order: W0 (done) → W1 → W2 → W4 → W3 → W5 → W6. Wave 3 merges when ready; the second wave to land rebases; conflicts are confined to the append-only files above.
- Contract test (OpenAPI equals committed file) must be green at every merge.

## 7. Testing

- Unit (Vitest, shared): sanitizer allowlist and XSS cases, htmlToDocx walker, docx→HTML import mapping, scope intersection, feedback analytics math, search-log row shape, topic-view grouping order.
- API integration (real Postgres): every new route and permission denial; visibility rule on list/get/related/links/backlinks/topic/search; purge skip and 409 on once-published delete; scripts fold up/down on seed data with link parity; source save → version + ingest + flag; resolve writes `resolved_version`; publish with `resolveFeedbackIds`; etag conflicts on source save; asset limits; alerts dedupe.
- Web (Vitest + MSW): topic page grouping, feedback modal auto-context, metadata panel, source editor round-trip, hidden status controls for read-only users, analytics page fallbacks.
- Real e2e (Playwright, real stack, extends `pnpm e2e:real`):
  1. agent reports feedback → editor sees queue → edits source document → suggestion accepted → publish closes feedback with new version → analytics shows it;
  2. admin adds world + topic → editor tags item into it → agent finds it by tag and topic page → read-only user cannot open a draft in that topic;
  3. WordPress stub edit → source version + review flag → editor clears/publishes → push renders source HTML.

## 8. Out of scope

Future-phase PRD items (briefings, quizzes, learning completion tracking, knowledge-refresh prompts). Wave 3's review workflow, notifications table, dashboards and comments (consumed, not rebuilt). A separate "approver" role activation beyond the fields and the existing `docs.publish` split.

## 9. Acceptance

Wave 4 is done when: every PRD v1 bullet ("גרסה ראשונה תכלול") maps to a green integration or e2e test; a read-only user sees only published/partial items everywhere; an admin can add a world and a topic without a deploy; an editor can author a source document with a table and an image, export it to Word, and see WordPress receive it; an agent's feedback travels to a closed status linked to a published version; the analytics page lists zero-result searches; `pnpm test`, `test:int`, `e2e:real` and the contract test are green on main.
