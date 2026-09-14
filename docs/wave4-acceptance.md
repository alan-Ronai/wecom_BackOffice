# Wave 4 acceptance — PRD "גרסה ראשונה תכלול" → evidence

Every row points at a test that exists and passed in the final gate on `wave4/integration`.
Spec ids `W4-E2E-1..3` are the real-stack Playwright flows in `apps/web/e2e/real/`.

| PRD v1 bullet | Lanes | Evidence |
|---|---|---|
| ניהול עולמות תוכן ונושאים | W1, W6 | `apps/api/test/taxonomy.test.ts` (worlds/topics CRUD, reorder, deactivate 409 `WORLD_IN_USE`), `apps/api/test/int/taxonomy-migration.test.ts` (0030 backfill), `apps/web/test/taxonomy/TaxonomyAdmin.test.tsx`, `wave4-mounts.test.tsx` "lists worlds and their topics from the API", **W4-E2E-2** (an admin adds a world and a topic and the sidebar has them without a deploy) |
| יצירה וניהול של פריטי ידע — סוגים M/R/O/E/S/T/I, תגיות, מקור מלא | W1, W4, W6 | `apps/api/test/taxonomy.test.ts` (docType/tags/text kind, `/scripts*` folded onto `doc_type='T'`), `apps/api/test/fields-scripts.test.ts`, `apps/api/test/sourcedocs.test.ts` (save/version/restore/import/export/sanitize), `apps/api/test/sourcedocs-import.test.ts`, `apps/web/test/taxonomy/MetadataPanel.test.tsx`, `apps/web/test/source/*`, `wave4-mounts.test.tsx` "metadata and ownership panels", "text-kind item as a body", **W4-E2E-2**, **W4-E2E-3** |
| קישור בין פריטי ידע | existing L2 + W1 + W6 | `apps/api/test/documents.test.ts` (links/related/backlinks), `apps/api/test/stage4-graph.test.ts` (script nodes come from type-T documents after 0030), `wave4-mounts.test.tsx` "prev/next inside the topic" |
| תצוגת עבודה לנציג — תצוגת נושא, מעבר בין סוגים, מקור לצד עבודה | W1, W4, W6 | `apps/api/test/taxonomy.test.ts` (topic view grouped in PRD type order), `apps/web/test/taxonomy/TopicPage.test.tsx`, `wave4-mounts.test.tsx` (type badge, tags, pane modes, topic prev/next), **W4-E2E-2** |
| חיפוש, תגיות וסינון | W1, W6 | `apps/api/test/search.test.ts` (tags group, world/topic/docType/tag filters, the search log), `apps/api/test/int/search-embeddings.test.ts` (Hebrew stopwords), `apps/api/test/migrations.test.ts` "0035 keeps both the tags term and the Hebrew stopword filter", `apps/web/test/taxonomy/TaxonomyFacets.test.tsx`, `wave4-mounts.test.tsx` "passes the taxonomy filters from the URL", **W4-E2E-2** (tag URL filter) |
| הרשאות צפייה ועריכה — פורסם בלבד לצפייה, בעלים/עורך/מאשר | W2, W6 | `apps/api/test/governance.test.ts` (visibility on list/get/related/links/versions/diff/view/pin/search, 404 `NOT_PUBLISHED`, owner/editor/approver, 409 `ONCE_PUBLISHED`, purge guard), `apps/api/test/int/scope-leak.test.ts` "W2: an unpublished document leaks through no route to a read-only reader", `apps/api/test/int/wave4-seams.test.ts` (approver_id), `apps/web/test/governance/Governance.test.tsx`, `wave4-mounts.test.tsx` (unavailable page, status actions gated), **W4-E2E-2** (a reader cannot open a draft) |
| ניהול גרסאות וסטטוסים — לא בתוקף, ארכיון, קשר גרסת מקור ↔ גרסת עבודה | W2, W4, W6 | `apps/api/test/governance.test.ts` (status route + audit reason), `apps/api/test/governance-source-review.test.ts` (ingest raises the flag, publish/editor note clears it), `apps/api/test/int/wave4-seams.test.ts` "publish records the source version", `wave4-mounts.test.tsx` "marks an invalid item on its card", **W4-E2E-3** (source v2 + review flag + clear) |
| מנגנון משוב — 7 סוגים, הקשר אוטומטי, תור עורכים, 5 סטטוסים, קשר לגרסה, התראות, אנליטיקה | W3, W6 | `apps/api/test/feedback.test.ts` (auto-context, queue filters + counts, patch, resolve, publish `resolveFeedbackIds`, analytics), `apps/api/test/feedback-alerts.test.ts` (repeat/anomaly windows, digest, recipients, `PgNotifier` writes the wave-4 kind), `apps/api/test/unit/feedback-notifier.test.ts`, `apps/api/test/int/wave4-seams.test.ts` (notification kinds; publish closes the report), `apps/web/test/feedback/*` (3 files), `wave4-mounts.test.tsx` "publishes with the feedback the editor ticked", **W4-E2E-1** |
| נתוני שימוש בסיסיים — כניסות, משתמש, חיפושים, חיפושים ללא תוצאה, הנצפים ביותר, נושאים, תאריכי עדכון | W5, W6 | `apps/api/test/usage.test.ts` (recorder, `/analytics/usage` shape + 60 s cache, 403, search log, `zeroOnly`, `topTopics` from W1's tables), `apps/api/test/search.test.ts` (a row per search, and the search still answers when the log cannot be written), `apps/api/test/unit/usage-cache.test.ts`, `apps/web/test/analytics/Analytics.test.tsx`, `apps/api/test/int/wave4-seams.test.ts` "opening a topic feeds the usage analytics" |

Deferred by the spec (§8), not by this wave: briefings, quizzes, learning completion and
knowledge-refresh prompts; the approver *role* beyond the `approver_id` field and `docs.publish`.

## Parked

Each of these was a conscious call rather than an omission; the cost of being wrong is stated so
the next wave can reopen it cheaply.

| Item | Ruling | Cost if wrong |
|---|---|---|
| ~~`/scripts*` stay live as adapters over `doc_type='T'`, marked `deprecated: true`~~ · **closed in wave 5** | `apps/web/src/api/hooks/content.ts` (`useScripts`) still feeds the sidebar's source-file rows, `LibraryPage`'s export bundle and the palette. Deleting the routes was a bigger change than wave 4 needed. | Two representations of the same rows stay in the contract; a reader could write against the deprecated shape. Removing them is a web-only change once those three callers move to `GET /documents?docType=T`. |
| The `view_topic` telemetry kind is defined but never sent from the client | `telemetry_events.document_id` is a foreign key to `documents`, so a topic id could never land in it — `recordTelemetry` filters such a row out silently. Topic views are recorded server-side into W5's `topic_views` by `GET /topics/:id/items`, which is what `topTopics` reads. | The enum value and the widened check constraint (0026) are unused. Nothing reads them, so the only cost is a contract value with no producer. |
| ~~`TaxonomyFacets` offers type and tags; world and topic are chosen from the sidebar and the topic page~~ · **closed in wave 5** | The component is W1's and W6 may not restyle it. `?world=` and `?topic=` are honoured in the URL and passed to `GET /documents`, so a link reproduces any combination — only the *control* for those two is elsewhere. | An agent cannot narrow to a second world from the library toolbar. Adding two selects to `TaxonomyFacets` is self-contained. |
| The dashboard cache is per-process, keyed by scope **and** visibility | Wave 3's ruling, extended: a multi-worker deployment serves up to N snapshots ≤ 60 s old, which is what "cached 60 s" already allows. | Two workers can disagree for under a minute on a counts panel. |
| `POST /sync-links/:id/resolve` remains, deprecated | Wave 3's ruling, untouched here. | An old client keeps working; the contract carries two spellings. |
| ~~A pending push is not surfaced on the article~~ · **closed in wave 5** | After a remote edit *and* a local publish the sync link is `conflict`; resolving it is an operator action on `/sync`. The article's source-review flag answers a different question ("the source moved", an editorial decision) and the two are deliberately separate. | An editor can clear the review flag and believe the loop is closed while WordPress still shows the old text. A badge on the article reading the link state would close it. |
| Frontend I10 pin-state item from wave 2 | Already closed by `apps/web/test/article/PageOneIndependence.test.tsx`; listed because the wave-2 ledger still names it as open. | None. |

## Fix wave — API

Rows appended by the wave-4 final-review fix pass (`fix/wave4-api`). Everything Critical and
Important in packages A and B, plus C-C2/C-I2/C-I5 and the API halves of D-C2/D-I9, was fixed;
these are the items deliberately left open, with the reasoning.

| Item | Ruling | Cost if wrong |
|---|---|---|
| ~~**A-M4**~~ · **closed in wave 5** — `topicView` returns the topic and world metadata before applying scope, and `recordTopicView` fires for a topic the caller cannot read | The metadata is a name and a description, not content, and the item list is correctly empty. Turning an out-of-scope world into a 404 changes the shape of a route the web is being rebuilt against in the same wave, and D-C2 already stops the article page from inflating `topic_views` — the larger half of the pollution. | A scoped caller can confirm a topic exists in another world and learn its name and item count, and a deliberate visit to such a topic still records a view. A 404 on the world check plus recording only on a non-empty result closes both; it is ~5 lines in `taxonomy/routes.ts`. |
| ~~**A-M13**~~ · **closed in wave 5** — the seed's `_usedIn` → `document_links` insert lost the `on conflict do nothing` the old `script_refs` insert had | `document_links` has no unique constraint to conflict on, so restoring the guard means adding one — and `document_links` legitimately carries several rows per pair (different `from_step_key`, `type`, `origin`). Picking the right constraint is a schema decision, not a seed fix. | A duplicated `_usedIn` entry in the fixture produces duplicate edges. The graph dedupes by `edgeKey`; `/scripts`'s `usedIn` does not, so a script would list the same document twice. |
| **A-M14** — `user_roles.world_scope` has no FK to `worlds(slug)` while `documents.category` has one with `on update cascade` | Latent: `patchWorld` cannot change a slug (`WorldPatchSchema` omits it), so nothing can drift today. A `text[]` column cannot take a plain FK — it needs either a join table or a trigger, which is a schema change wave 4 does not otherwise need. | If slug editing is ever added, documents follow the rename through the cascade and every user's scope silently stops matching — a scoped user quietly seeing nothing. Whoever adds slug editing must add the join table with it. |
| **B-M1** — the W1/W2 schema probes (`hasColumn` for `owner_id`/`editor_id`/`doc_type`, `to_regclass('document_topics')`, `probeCapabilities`, the `body_html` probe) always take the "present" branch now | The reviewer's own ruling was "drop probes, fallbacks and those two cases in W7". Removing them also means deleting the `feedback-alerts.test.ts` cases that keep the pre-W2 fallback alive, which is a test change unrelated to any Critical here. The `body_html` probe went with B-I2's rewrite; the rest stayed. | Two extra round trips on every uncached `/analytics/usage`, and a permanent second code path that is never exercised in production and cannot rot visibly. |
| ~~**B-M5**~~ · **closed in wave 5** — `resolveOne` accepts any `(document_id, version)` that exists | §5.4 describes the picker as "the newest published version created *after* the feedback", and `getFeedbackDetail` already computes that list as `laterVersions`. Enforcing it server-side is a behaviour change to a route the web drawer drives, and it wants to land with the drawer, not against it. | An editor can resolve a report against an older version, or against a `kind='system'` row, and the "closed with version N" record then says something untrue. The fix is one `exists` against `laterVersions`' predicate. |
| ~~**B-M10**~~ · **closed in wave 5** — a historical source version is served with the *current* etag | `getSourceVersion` selects `s.etag` (live) alongside `v.html`, so a client that opens version 3, edits and PUTs with that etag passes `If-Match` even though current is 7. Fixing it properly means giving each version its own etag (a column and a backfill); reusing the version number as a weak etag would change the `If-Match` contract mid-wave. B-I3 narrows the window by making the header mandatory, but does not close this. | An edit made on top of an old version can overwrite a newer one without a 412. Reachable only from the history pane's edit path. |
| ~~**B-M14**~~ · **closed in wave 5** — `POST /assets` trusts the client's declared mime | The 4-mime allowlist plus `nosniff` and the immutable cache header keep this off the XSS path; the cost is cosmetic. Sniffing magic bytes wants to live next to `imageSize`, which already parses those same headers, and that is a small refactor rather than a guard. | A non-image labelled `image/png` is stored, `imageSize` reads garbage dimensions, and the docx exporter sizes a broken box around it. |
| **B-M15** (partially) — `gcUnreferencedAssets` extracting ids into a join table on save | Done as far as one pass over each HTML column with a regexp rather than an assets × versions cross product, which removes the quadratic term. A real `asset_refs` join table maintained on save is a schema plus a write-path change, and the gc runs weekly. | The gc scans every HTML row once per run. Fine at this size; revisit if the source corpus grows an order of magnitude. |

Two further notes for the ledger, neither a parked item:

- **A-I8's stated symptom is not quite right, but its root cause is.** The review says restoring
  0007's function on a wave-4 rollback makes "a query containing a Hebrew stopword stop matching".
  It does not: with 0007's definition the *index* keeps the stopwords while `kb_tsquery` strips
  them from the query, so the query is a subset of the vector and still matches. What actually
  breaks is the invariant 0027 exists to hold — the two sides tokenise differently, and rows
  written before and after the rollback are indexed inconsistently. The fix (restore 0027's
  definition, which is what is live when 0030 runs) is the same either way, and the new
  `migrations.test.ts` case asserts the index side still strips stopwords after rolling back
  through 0030.
- **A leak the new boundary rows caught that nothing in the review names.** `loadGraph` drops
  orphaned catalogue nodes only `if (scopes)`. W4 gives every source document a `sources` row
  titled after its document, so an unscoped *reader* was handed `source:<id>` nodes labelled with
  the titles of drafts. The gate is now `scopes || !readUnpublished`.

## Fix wave — web

The web half of the wave-4 final review (findings D, and C-C1/C-I1/C-I3/C-I4/C-M3/C-M4/C-M8).
Everything Critical and Important in that package is fixed on `fix/wave4-web`, built against the
merged API contracts — `record` on `GET /topics/:id/items` and `SourceDocumentSchema.latestRevisionId`
are both live, so the two temporary shims the web carried against them are gone. What follows is
what was deliberately **not** fixed, with the reasoning, in the style of the Parked table above.

| Item | Ruling | Cost if wrong |
|---|---|---|
| ~~Worlds and topics are ordered with ↑/↓ buttons, not drag (D-M4)~~ · **closed in wave 5** (drag added *on top of* the buttons, which stay) | Spec §5.3 says "drag ordering". The substitution is deliberate and, I think, better: arrow buttons are keyboard-accessible where drag is not, they carry `aria-label`s, and they are correctly `disabled` at the ends of the list. Recorded here so nobody "fixes" it back to drag without reading this. | An admin reordering twenty worlds clicks more than they would drag. Adding drag *on top* of the buttons is self-contained; replacing them with drag would lose the keyboard path. |
| `TopicPage` is eagerly imported while the other four wave-4 routes are lazy (D-M19) | `routes.tsx:78-83` draws the boundary by "who opens it and when": the topic page is on the agent's ordinary path from the sidebar, so paying for it in the entry chunk is the cheaper trade. The reviewer reached the same conclusion. | `useTopicView` and the taxonomy hooks sit in the entry chunk. One line in `routes.tsx` moves it behind `lazy()` if the entry bundle becomes the thing to cut. |
| ~~`react/no-unstable-nested-components` is not enabled (D-I11's second half)~~ · **closed in wave 5** | The rule needs `eslint-plugin-react`, which this repo does not install; the ruling was "otherwise just hoist", and the component is hoisted (`RichText.tsx`, `ToolbarButton`). | The next component declared inside a render is caught by review rather than by lint. Adding the plugin is a root-`.eslintrc.cjs` change plus one dependency. |
