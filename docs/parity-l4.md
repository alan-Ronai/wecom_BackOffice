# L4 parity walk — `legacy/` against `apps/web`

Date: 2026-09-15 · Lane: parity-walk · Acceptance review §7 item 21 / S1-6

The L4 plan's acceptance matrix
(`docs/superpowers/plans/2026-09-13-L4-frontend-port.md`, "Feature-parity checklist") and the
stage-1 spec (`docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` §5,
"every capability in `legacy/README.md`'s screen table works against the API") are both written as
promises. This walks them.

**Method.** The legacy app was driven headless (Chromium against `file://…/legacy/index.html`) and
every screen the matrix names was captured — those are the `docs/parity/legacy-*.png` files cited
below. Its source was then read module by module, and every Hebrew UI string in
`legacy/js/*.js` (305 of them) was diffed against `apps/web/src/**`; the 45 that had no
counterpart were each traced to a behaviour and classified. The port was exercised against msw
both as a component suite (`pnpm --filter @wecom/web test`) and in a browser
(`VITE_MOCK_API=1 vite`, `docs/parity/port-*.png`).

**Status vocabulary**

| Status | Meaning |
|---|---|
| **parity** | The port does what legacy did. |
| **improved** | The port does more, or does it better, and nothing was lost. |
| **gap** | Legacy behaviour the port lost. Every one is pinned by a test under `apps/web/test/parity/`; the ones that were fixed in this lane say so. |
| **dropped** | Deliberately not ported, with the ruling that says so. |

**Counts** — 71 rows across the four matrices below: **34 parity**, **29 improved** (8 of them
rows where a gap found in this walk was closed), **6 new** (capabilities the port adds that legacy
never had), **2 dropped**. Section 6 names two further dropped behaviours that have no
legacy-versus-port row of their own. Ten gaps were found: **9 fixed here**, **1 left open**
(§5).

---

## 1. The design's eleven option cards

| # | Card | Legacy behaviour | Port behaviour | Status | Evidence |
|---|---|---|---|---|---|
| 1 | Library | Cards grouped by wave with a pinned rule on top, facets for wave / שכיח מאוד / עודכן החודש / מסמך חלקי, per-card meta that falls back through steps → views → links out → links in → shared block → CRM fields, ★ and ⋯ menu | Same grouping, same four facets, same fallback chain in `DocCard`, plus a list mode with J/K/X and a bulk bar | improved | `docs/parity/legacy-library.png`, `docs/parity/port-library.png`, `test/library/Library.test.tsx`, `test/library/LibraryQol.test.tsx` |
| 2 | Article · call mode | Timer, progress rail, jump strip, outcome picking with `goto`, skipped marks, summary for the CRM, reset | All of it, plus per-step "מה הלאה" hints and step-level comments/presence | improved | `docs/parity/legacy-article-call.png`, `docs/parity/port-article-call.png`, `test/article/Article.test.tsx`, `test/article/NextHint.test.tsx` |
| 3 | Ctrl K palette | Six result types, Tab cycles them, Ctrl ↵ opens in a tab, grouped results, local actions, result/file/ms footer | Server-backed search with the same six groups and footer, the same actions plus permission-gated operator destinations | improved | `docs/parity/legacy-palette.png`, `docs/parity/port-palette.png`, `test/palette/Palette.test.tsx`, `test/parity/palette.test.tsx` |
| 4 | Block editor | Block library, drag/drop, shared blocks, detach, `/` commands, autosave, pre-publish checks, live preview / JSON / Diff | All of it, plus undo/redo, templates, multi-step selection, a conflict banner and a source pane | improved | `docs/parity/legacy-editor.png`, `test/editor/Editor.test.tsx`, `test/editor/EditorQol.test.tsx` |
| 5 | Version history | Timeline with per-version stats, all/published/mine filter, side-by-side word diff, blame per step, JSON, restore | Same, computed server-side (`GET /documents/:id/diff`) instead of from a local snapshot | parity | `docs/parity/legacy-history.png`, `test/history/History.test.tsx`, `test/lib/diffSteps.test.ts` |
| 6 | Recycle bin | 30-day countdown with an urgency bar, impact, restore, bulk restore, empty | Same, permission-gated (`docs.restore`) and with a "skipped" answer when a published item cannot be purged | improved | `docs/parity/legacy-trash.png`, `test/trash/Trash.test.tsx`, `e2e/trash.spec.ts` |
| 7 | Dark mode | `Ctrl D`, the sidebar switch, the settings pill, light/dark/system | Same three entry points and the same three states, persisted per user through `PUT /me/preferences` | parity | `docs/parity/legacy-dark.png`, `test/settings/Settings.test.tsx` |
| 8 | Plex Hebrew bidi type system | Font pill, live mixed-script sample, and the two-column typography/bidi rules card | Same — the rules card was missing and is restored | improved (gap closed) | `docs/parity/legacy-settings.png`, `docs/parity/port-settings.png`, `test/parity/settings.test.tsx` |
| 9 | Word source workflow | Tracked changes → suggestions → accept/reject/edit → publish, changes-only/whole-document view, legend, rule-engine panel | Same flow against `GET /sources` and `/suggestions`, plus real ingest, sync links and a source-review flag | improved | `docs/parity/legacy-sources.png`, `test/sources/Sources.test.tsx` |
| 10 | Connected card | Step connections (same block / CRM fields / depends on / § source), related docs, hover peek naming the shared block | Same — the peek's shared-block line was missing and is restored | improved (gap closed) | `test/article/Article.test.tsx`, `test/parity/article.test.tsx` |
| 11 | Navigation QOL | Tabs (max 8), split view with block-synced scroll, Alt ←/→ history, hover peek, mobile drawer | Same, plus an explicit active-pane scope so the arrows drive the pane you clicked | improved | `test/shell/navStore.test.tsx`, `test/article/SplitPanes.test.tsx`, `test/shell/Shell.test.tsx` |

---

## 2. The L4 acceptance matrix, row by row

| Legacy capability (L4 checklist) | Legacy behaviour | Port behaviour | Status | Evidence |
|---|---|---|---|---|
| Library by wave/priority, category routes | `#/library/:cat`, three wave rules, priority chip | `/library/:category`, same rules and chip | parity | `test/library/Library.test.tsx` "groups cards" |
| Pinned section, ★ pin/unpin, P key | Pin in `localStorage`, optimistic star, `P` from the article | Pin through `POST/DELETE /documents/:id/pin`, optimistic, `P` in the article scope | parity | `test/api/hooks.test.tsx`, `test/article/PageOneIndependence.test.tsx` |
| Auto card: CRM fields changing this week | Two most-used fields + this week's changes, links to `/fields` | Same card, same two groups | parity | `test/library/Library.test.tsx` "auto CRM card" |
| Import/export JSON & CSV | `KB.exportAll`, CSV with `title,desc,cat,wave,pri` | Same toolbar pair; the export bundle keeps the `scripts` key. The `pri` column was being ignored and is honoured again | improved (gap closed) | `LibraryPage.tsx` toolbar, `test/parity/csv-import.test.tsx` |
| Article call mode: ↑↓, 1–3, ↵, timer, reset | As above | As above | parity | `test/article/Article.test.tsx` "walks steps" |
| Jump strip + G-then-number, skipped marks | `G` arms for 1500 ms, digits buffer for 450 ms, `↵` commits, skipped count with route label | Identical timings and the same hint/armed states | parity | `test/article/Article.test.tsx` "jumps with G" |
| Trail + source § | Breadcrumb + active step + "מקור: …" | Same | parity | `test/article/Article.test.tsx` |
| Step connections (block, CRM, deps, source) | Four-cell grid; the § cell navigates to the source | Same four cells, same navigation | parity | `test/article/Article.test.tsx` "connections for s11" |
| Related docs (auto), CRM fields, shared blocks panel | Panel tab "קשרים" with three sections + card map | Same three sections + card map, related computed server-side | parity | `test/article/Article.test.tsx` panel assertions |
| Notes with likes, N key | Note per step, like counter, `N` opens a prompt | Same, server-backed, optimistic like | parity | `test/article/Article.test.tsx` "adds a note" |
| Summary for CRM, C key | `summaryText()` and copy | Same string, same key | parity | `test/article/Article.test.tsx` summary text |
| Card map | "מפת הכרטיס" block | Same | parity | `CardMap.tsx`, `test/article/Article.test.tsx` |
| Hover peek with open/tab/split | 350 ms to show, 220 ms to hide, three buttons, shared-block line | Same timings and buttons; shared-block line restored | improved (gap closed) | `test/parity/article.test.tsx`, `test/article/PageOneIndependence.test.tsx` |
| Tabs strip, Alt T, W close, Alt ←/→ | Max 8 tabs, replace-active unless new, Alt ←/→ RTL-aware | Same cap and replace rule, same RTL-aware direction | parity | `test/shell/navStore.test.tsx`, `test/shell/Shell.test.tsx` |
| Split view with block-synced scroll, Ctrl \ | Sync by nearest `.step[data-block]`, banner names the shared block | Same algorithm and banner, plus a per-pane keyboard scope | improved | `test/article/SplitPanes.test.tsx`, `e2e/call-mode.spec.ts` |
| Ctrl K palette: types, Tab | As above | As above | parity | `test/palette/Palette.test.tsx`, `e2e/search.spec.ts` |
| Editor: block library, drag/drop, shared blocks, detach | Drag a block onto a step or the drop zone; "נתק העתק" | Same, plus a selection bar that blocks/detaches many steps at once | improved | `test/editor/Editor.test.tsx` "inserts a shared block" |
| Editor: `/` slash commands, autosave, JSON export, review request, publish | Nine `/` commands; autosave to `localStorage`; "בקשת סקירה" flips a local flag | Seven `/` commands (two missing, see gaps); autosave to `PUT /documents/:id/draft`; review request is a real queue with a decision | improved **and** gap | `test/editor/Editor.test.tsx`, `test/review/Review.test.tsx`, `test/parity/editor-pickers.test.tsx` |
| Pre-publish checks | `checkList()` rows in the side pane | Same rows | parity | `test/lib/editorModel.test.ts` "flags empty steps" |
| Live preview / JSON / Diff tabs | Three tabs with a hint line | Same three, plus a "מקור" tab on a saved item | improved | `test/editor/Editor.test.tsx` tab switching |
| Version history, compare, blame, JSON, restore | As above | As above | parity | `test/history/History.test.tsx`, `e2e/publish-restore.spec.ts` |
| Trash: countdown, impact, restore, bulk, empty | As above | As above | parity | `test/trash/Trash.test.tsx` |
| Sources: tracked changes, suggestions accept/reject/edit/publish | As above | As above | parity | `test/sources/Sources.test.tsx` |
| Dark mode Ctrl D, Plex/Rubik switch, settings | As above | As above; Ctrl D now confirms the switch again | improved (gap closed) | `test/parity/shell-keys.test.tsx`, `test/settings/Settings.test.tsx` |
| Keymap `?` | `KB.KEYMAP`, 17 rows | Derived from `lib/keys.ts`, so it cannot drift from what is bound | improved | `test/shell/Shell.test.tsx` (`?` opens modal) |
| Mobile drawer / responsive | `☰` + scrim, `Escape` closes | Same, plus a focus trap and a skip link | improved | `test/shell/Shell.test.tsx` at 400 px |
| New: login with providers | — | Entra/Palo Alto/local | new | `test/auth/Login.test.tsx`, `e2e/login.spec.ts` |
| New: permission-aware controls | — | `useCan` throughout | new | `test/admin/Admin.test.tsx` |
| New: live updates (SSE) | — | `useEvents` invalidates by event | new | `test/api/events.test.tsx` |
| New: admin users/roles/groups/sessions/audit, system status | — | `/admin/*` | new | `test/admin/*` |

---

## 3. Every keyboard shortcut in `legacy/`

Legacy's own card (`KB.KEYMAP`, `docs/parity/legacy-keymap.png`) lists seventeen; two more chords
are bound in the code without appearing on it. Hebrew-layout aliases are listed because legacy
accepted them and the port has to.

| Chord | Legacy | Port | Status | Evidence |
|---|---|---|---|---|
| `Ctrl K` | Palette, "חיפוש בכל המקורות" | Same | parity | `test/palette/Palette.test.tsx` |
| `Ctrl D` | Theme toggle **and a toast naming the new mode** | Same — the toast was missing and is restored | improved (gap closed) | `test/parity/shell-keys.test.tsx` |
| `Ctrl \` | Split; warns off a document; opens the palette when there is nothing to pair with; confirms on close | Same — all three answers were missing and are restored | improved (gap closed) | `test/parity/shell-keys.test.tsx` |
| `Alt T` | Palette in `newtab` mode | Same | parity | `test/shell/Shell.test.tsx` |
| `Alt ←` / `Alt →` | Back/forward, swapped under `dir=rtl` | Same swap | parity | `Shell.tsx`, `test/shell/navStore.test.tsx` |
| `↑` `↓` | Previous/next step in call mode | Same; in split view they drive the pane you clicked | improved | `test/article/SplitPanes.test.tsx` |
| `↵` | Scroll the active step into view | Same | parity | `test/article/Article.test.tsx` |
| `1`–`3` | Pick outcome or branch option | Same; the `?` card now says "בשלבים שיש בהם תוצאות", which is what the binding always did | improved | `lib/keys.ts`, `test/article/Article.test.tsx` |
| `G` then digits | Jump to a step by its number | Same, same timings | parity | `test/article/Article.test.tsx` |
| `N` / `מ` | Add an agent note to the step | Same | parity | `test/article/Article.test.tsx` |
| `P` / `פ` | Pin / unpin | Same, and also pins the cursor row in the library list | improved | `test/article/PageOneIndependence.test.tsx` |
| `C` / `ב` | Copy the CRM summary | Same | parity | `test/article/Article.test.tsx` |
| `E` / `ק` | Edit the document | Same | parity | `lib/keys.ts`, `lib/keyboard.ts` |
| `H` / `י` | Version history | Same | parity | `lib/keys.ts` |
| `W` / `'` | Close the tab | Same | parity | `test/shell/Shell.test.tsx` |
| `?` | Keymap card | Same, rendered from the binding registry | improved | `test/shell/Shell.test.tsx` |
| `Esc` | Close overlay / leave split / close drawer | Same, with a declared scope order instead of `stopPropagation` races | improved | `lib/keys.ts`, `test/lib/keys.test.tsx` |
| `Ctrl ק` | Also opened the palette — legacy read `ק` as the Hebrew `k`, but `ק` is the physical **E** key; the real Hebrew `k` (`ל`) did nothing | `Ctrl ל` opens the palette, `ק` is `E` (edit) | improved · legacy bug not reproduced | `lib/keyboard.ts` `HEBREW_KEY_ALIASES` |
| Palette-local `↑ ↓ ↵ Tab Esc`, `Ctrl ↵` | Navigate, open, cycle type, close, open in a tab; the selected row is scrolled into view | Same — the scroll-into-view was missing and is restored | improved (gap closed) | `test/parity/palette.test.tsx` |
| Editor-local `↵` / `Backspace` in an action, `/` menu `↑ ↓ ↵ Esc` | Split/merge an action row; drive the slash menu | Same | parity | `test/editor/Editor.test.tsx` |
| — (new) | — | `Ctrl Z` / `Ctrl Shift Z` / `Ctrl Y` undo-redo, `Shift R` request review, `J`/`K`/`X` list mode | new | `test/lib/editorHistory.test.tsx`, `test/library/LibraryQol.test.tsx` |

---

## 4. Every preference

Legacy kept all of these in `localStorage` under `wecom_kb2_state_v1.prefs`. Spec §5 moves
per-user state to `GET/PUT /me/preferences`, which is why the storage differs on every row.

| Preference | Legacy | Port | Status | Evidence |
|---|---|---|---|---|
| `theme` (`null` \| light \| dark) | Three-way pill + `Ctrl D` + sidebar switch; `null` follows `prefers-color-scheme` | Same three states and three entry points, stored per user | parity | `test/settings/Settings.test.tsx`, `lib/prefs.ts` |
| `font` (plex \| rubik) | Settings pill and a palette action, applied live to `<html data-font>` | Same pill, same palette action, same attribute | parity | `test/settings/Settings.test.tsx` |
| `panel` (bool) | Hides the article's right-hand panel | Same | parity | `test/settings/Settings.test.tsx` |
| `callMode` (bool) | Toggled only from the article's call pill | Same pill **and** a settings row, so it can be set before a call | improved | `SettingsDialog.tsx`, `test/article/Article.test.tsx` |
| `sideExpanded` (bool) | Rail vs full sidebar on doc/edit/history/sources | `sidebarExpanded`, same routes | parity | `test/shell/Shell.test.tsx` |
| `reviewRequests` (map) | A local flag per draft; the chip read "בסקירה" and nothing else happened | Replaced by a real review queue with a decision and an audit row | improved | `test/review/Review.test.tsx` |
| — (new) | — | `paneMode` (work / source), wave 4 | new | `test/source/PaneModeToggle.test.tsx` |
| Call progress (`S.calls`) | `localStorage`, shared across browser tabs and outliving the shift | `sessionStorage` per spec §5 ("call-mode progress stays client-side since it's per call") | dropped · spec §5 | `lib/callState.ts`, `test/lib/callState.test.ts` |
| "איפוס נתונים מקומיים" | Wiped every edit, pin, note, version and the trash, restoring the seed | Clears only session state (tabs, call progress, drafts); content lives on the server and has a trash and a version history of its own | dropped · spec §2, §5 | `SettingsDialog.tsx` |

---

## 5. Gaps found

Nine were fixed in this lane; one is left open. Every one is pinned by a test under
`apps/web/test/parity/`.

### Fixed here

| # | Gap | Fix | Test |
|---|---|---|---|
| G1 | The last outcome in a document advanced to nothing and said nothing. Legacy: `✓ סיום המסמך · הסיכום מוכן להעתקה` — the one moment in a call when `C` is the next action and it is not on screen anywhere else. | `useCall.pickOutcome` toasts when there is no next step (6 lines) | `test/parity/call-mode.test.tsx` |
| G2 | `Ctrl \` off a document was a silent `return`. | `navStore.toggleSplit` warns "פיצול מסך זמין מתוך מסמך" | `test/parity/shell-keys.test.tsx` |
| G3 | `Ctrl \` with one open tab was also a silent return — and one tab is the normal state at the start of a shift, so the chord looked broken the first time it was pressed. Legacy opened the palette in `split` mode. | `navStore.toggleSplit` opens the palette | `test/parity/shell-keys.test.tsx` |
| G4 | Closing the split said nothing. Legacy: "פיצול מסך בוטל". | `navStore.toggleSplit`, so every entry point (chord, Escape, ⫿, ✕) reports it | `test/parity/shell-keys.test.tsx` |
| G5 | `Ctrl D` switched the theme silently. | `Shell.toggleTheme` toasts "◐ מצב כהה" / "○ מצב בהיר" | `test/parity/shell-keys.test.tsx` |
| G6 | The settings dialog had lost the two-column typography/bidi rules card — one of the design's eleven option cards, and the only written form of the contract every `<Fmt>` call implements. The stylesheet still had `.type-rules`; nothing rendered into it. | `SettingsDialog` renders the card | `test/parity/settings.test.tsx` |
| G7 | The palette never scrolled its selection into view (the box shows ~6 rows and holds up to 40), and in `newtab`/`split` mode it offered fields, blocks and scripts as the answer to "which document?" — picking one navigated to `/doc/<field name>`. | `Palette` scrolls `.ri.on` into view; rows are narrowed to hits that name a document when the palette is asking for one, and `split` resolves a hit the same way `newtab` does | `test/parity/palette.test.tsx` |
| G8 | The CRM note under an action said "שדה CRM · תקין" and dropped legacy's "· ב-N מסמכים"; the hover peek always showed the description and never legacy's "משתף איתך: ⧉ <block> (שלב N)"; and `document.title` never changed, so every browser tab, history entry and bookmark read "wecom · מאגר ידע פנימי". | `StepView` renders `usedIn` (already on `GET /fields`); `Peek` computes the shared blocks from two already-cached documents; `navStore` names the route and the article reports its own title | `test/parity/article.test.tsx`, `test/parity/document-title.test.tsx` |
| G9 | CSV import read four of the five documented columns and hard-coded `priority: 'm'`, so an import of the shape `legacy/README.md` publishes flattened every card to "בינוני" — and priority is what the library groups and facets by, so the whole import landed in the wrong place with nothing to say so. | `LibraryPage.importFile` reads `pri`, falling back to `'m'` for an empty or unknown value exactly as legacy did (1 line) | `test/parity/csv-import.test.tsx` |

### Left open

| # | Gap | Why it is not fixed here | Estimate |
|---|---|---|---|
| G10 | The editor's two picker quick-commands. Legacy offered `+ שדה CRM` and `+ קישור` on each step's adder row and `CRM שדה` / `↗ קישור למסמך` in the `/` menu; each opened a `<select>` (over `crm-fields.json`, or over every other document) and appended `פתח CRM ↗ שדה <name>` or `המשך לפי [[doc:<id>]]`. The port has neither. The **capability** is intact — `<Fmt>` still detects a field in free text and resolves `[[doc:id]]`, and the action placeholder says so — but an editor now has to type the exact field name, or a raw uuid, from memory. That is worse than legacy, where document ids were slugs. | Two new dialogs plus wiring in three files (`DropZone`'s `SlashCommand` union and command list, `EditorPage`'s `onCommand` switch and `applyBasic`, `StepEditor`'s adder row), past the ≤ 30-line in-place budget this lane works to. | ~90 lines across 3 files, half a day with tests. The existing `useModal` + `useFields` + `useDocuments` hooks cover everything it needs; no API or schema change. |

---

## 6. Deliberately dropped

| Behaviour | Ruling |
|---|---|
| A card with no document behind it ("כרטיס ללא מסמך · לחץ לכתיבה", `KB.openTopic`'s "✚ כתוב עכשיו" modal) | Legacy had a `KB.TOPICS` list separate from `KB.SEED.docs`, so a card could exist without one. Spec §2 has a single `documents` table and §4's `GET /documents` "returns cards" — a card *is* a document. The placeholder state has no representation to render. |
| Per-kind trash impact wording ("N מסמכים חסרים בלוק", "מיפוי נשמר") | Spec §2: 'Impact ("N קישורים שבורים") = count of `document_links` pointing at the deleted entity' — one computation and one wording for every entity kind. |
| Call progress surviving a browser restart | Spec §5: "call-mode progress stays client-side (sessionStorage) since it's per call". |
| "איפוס נתונים מקומיים" restoring the seed library | Spec §2 and §5: content is server-side with its own trash, version history and audit log; a browser-local reset can no longer mean what it meant. The row remains, scoped to session state, and says so. |

---

## 7. Re-running this walk

```
pnpm install && pnpm -r build
pnpm --filter @wecom/web test          # includes test/parity/*
pnpm --filter @wecom/web e2e
```

The legacy screenshots were taken by driving `file://…/legacy/index.html` with Chromium at
1440×900; the port's by `VITE_MOCK_API=1 vite` at the same size, skipping the onboarding tour.
