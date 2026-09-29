## Y5

**Base knowledge refresh from Kira's source documents.** Branch `waveY/Y5`.

The roaming ("NEW ROAMING") and domestic-reception Kira documents and both knowledge-map workbooks
are committed under `apps/api/seed/source/kira/{roaming,domestic}/` (the OLD roaming documents and
the zips are not). `apps/api/seed/convert-kira.mjs` overlays them on the legacy library:

```bash
pnpm --filter @wecom/api convert:kira   # = convert-legacy.mjs, then convert-kira.mjs
```

A superseding document keeps the legacy id and slug; the legacy content becomes its previous
version (label "ייבוא מהספרייה הסטטית") and the Kira content the next one (label "רענון ידע בסיס ·
מקור Kira", author from the .docx properties). New documents get `uuidFrom('doc:' + slug)`, the rule
`convert-legacy.mjs` uses. Legacy documents Kira does not cover are unchanged.

### Kira file → seeded document

| Kira file                                         | Code | Document id                            | Slug        | Title (seeded)                   | New / supersedes                                    | Status    | Version | Steps |
| ------------------------------------------------- | ---- | -------------------------------------- | ----------- | -------------------------------- | --------------------------------------------------- | --------- | ------- | ----- |
| roaming/M-00 תקלות ושירות בחול - אבחון מרכזי      | M-00 | `4f2238c4-3191-4387-8de1-31f9333681ee` | `pdf-011`   | תקלות ושירות בחו"ל - אבחון מרכזי | supersedes "אבחון מרכזי לתקלות ושירות בחו"ל"        | published | 3 → 4   | 12    |
| roaming/R-01 אין קליטה אין רישום לרשת בחול        | R-01 | `de037d38-7d17-4730-8c19-d3aa2704ddaf` | `pdf-012`   | אין קליטה או רישום לרשת בחו"ל    | supersedes "אין קליטה / רישום לרשת בחו"ל"           | partial   | 4 → 5   | 9     |
| roaming/R-02 - אין גלישה בחול                     | R-02 | `68347add-1dd7-43e5-8519-aac95e92dcb1` | `pdf-013`   | אין גלישה בחו"ל                  | supersedes "אין גלישה בחו"ל"                        | published | 4 → 5   | 12    |
| roaming/R-03 - תקלה באפליקציה מסוימת בחול         | R-03 | `234b98bc-fa1c-4c85-8c31-766b7ae81cd6` | `pdf-014`   | תקלה באפליקציה מסוימת בחו"ל      | supersedes "תקלה באפליקציה מסוימת בחו"ל"            | published | 4 → 5   | 9     |
| roaming/R-04 תקלת שיחות בחול                      | R-04 | `b37ca8e1-6950-41c8-8f62-2c0515beabfb` | `pdf-015`   | תקלות שיחות בחו"ל                | supersedes "תקלות שיחות בחו"ל"                      | published | 4 → 5   | 13    |
| roaming/R-05 - תקלות הודעות בחול                  | R-05 | `f956f3d2-323b-4645-83f2-b6b05ae762f9` | `pdf-016`   | תקלות הודעות בחו"ל               | supersedes "תקלות הודעות בחו"ל"                     | published | 2 → 3   | 13    |
| roaming/O-01 - בדיקות שירותי נדידה וחבילת חול     | O-01 | —                                      | —           | —                                | not imported: the delivered file is empty (0 bytes) | —         | —       | —     |
| roaming/O-02 - בדיקה והפעלת נדידת נתונים במכשיר   | O-02 | `e2c50192-2a99-40bc-88d3-d29109342509` | `pdf-017`   | בדיקה והפעלת נדידת נתונים במכשיר | supersedes "הפעלת נדידת נתונים במכשיר"              | published | 3 → 4   | 14    |
| roaming/O-03 - הגדרת APN בחול                     | O-03 | `7377218d-b9b4-4452-8d18-8f0228dea8f9` | `pdf-018`   | בדיקה והגדרת APN בחו"ל           | supersedes "בדיקה והגדרת APN בחו"ל"                 | published | 2 → 3   | 11    |
| roaming/O-04 - תפעול STK ושינוי זהות רשת בחול     | O-04 | `500f1fa7-f70f-4c12-89e4-11d1cfba08a6` | `pdf-019`   | תפעול STK ושינוי זהות רשת בחו"ל  | supersedes "תפעול STK ושינוי זהות רשת בחו"ל"        | partial   | 2 → 3   | 2     |
| roaming/O-05 - בחירת רשת ידנית בחול               | O-05 | `0dcc9d72-bf6b-4124-82e4-96303cb404ae` | `pdf-020`   | בחירת רשת ידנית בחו"ל            | supersedes "בחירת רשת ידנית בחו"ל"                  | published | 2 → 3   | 10    |
| roaming/0-06 תאימות מכשירים בארהב                 | O-06 | `c54e6998-3944-4ab9-8baa-3b6127779327` | `kira-o-06` | תאימות מכשירים בארה"ב            | new                                                 | published | 1       | 4     |
| roaming/E-01 - העברה למומחה בתקלת חול             | E-01 | `8805f83f-191e-47aa-8f94-bf20f3cffd2d` | `pdf-021`   | העברה למומחה בתקלת חו"ל          | supersedes "העברה למומחה בתקלת חו"ל"                | partial   | 2 → 3   | 6     |
| domestic/M10 - בעיות קליטה בארץ - אבחון מרכזי     | M-10 | `ba744440-a357-43b3-83e0-03c2fabe7ebc` | `pdf-002`   | בעיות קליטה בארץ - אבחון מרכזי   | supersedes "בעיות קליטה בארץ – שיחות וגלישה"        | published | 4 → 5   | 7     |
| domestic/R-11 - קליטה חלשה במקום מסוים            | R-11 | `0ff33f50-521a-485e-80a3-683f9d59c4c4` | `kira-r-11` | קליטה חלשה במקום מסוים           | new                                                 | published | 1       | 8     |
| domestic/R-12 - קליטה חלשה או ניתוקים בנסיעה      | R-12 | `cf0fdf75-1fd7-4d33-84a4-661e3e4577d9` | `kira-r-12` | קליטה חלשה או ניתוקים בנסיעה     | new                                                 | published | 1       | 10    |
| domestic/R-13 - הרעה חדשה בקליטה באזור            | R-13 | `59a5565b-da73-4a82-89e8-1153bc5a667f` | `kira-r-13` | הרעה חדשה בקליטה באזור           | new                                                 | published | 1       | 11    |
| domestic/O-10 - בדיקת מפת כיסוי ואנטנות           | O-10 | `145fe6f9-be12-41c2-8b69-7be74b127015` | `kira-o-10` | בדיקת מפת כיסוי ואנטנות          | new                                                 | partial   | 1       | 7     |
| domestic/O-12 - הפעלת שיחות ברשת אלחוטית          | O-12 | `e721043a-e35f-4bad-8965-b40cbf9d228f` | `kira-o-12` | הפעלת שיחות ברשת אלחוטית         | new                                                 | published | 1       | 13    |
| domestic/איפוס הגדרות רשת O-13                    | O-13 | `511a7481-eea1-469b-8c9e-cb5f745202ad` | `pdf-005`   | איפוס הגדרות רשת                 | supersedes "מדריך איפוס הגדרות רשת"                 | published | 2 → 3   | 17    |
| domestic/E-10 הסלמה למומחה – בעיות קליטה בארץ     | E-10 | `be099868-fa30-4f64-8550-604088e0c98f` | `kira-e-10` | הסלמה למומחה – בעיות קליטה בארץ  | new                                                 | published | 1       | 7     |
| domestic/T-10 - תיאום ציפיות רשת סלולארית         | T-10 | `bcade3f2-9855-489a-87c0-7d3c7beec47f` | `kira-t-10` | תיאום ציפיות רשת סלולארית        | new                                                 | published | 1       | 11    |
| roaming/מפת ידע רומינג.xlsx                       | —    | —                                      | —           | —                                | explicit `related` links (M-00 → R/O/E/O-06, …)     | —         | —       | —     |
| domestic/מפת ידע בעיות קליטה בארץ.xlsx            | —    | —                                      | —           | —                                | explicit `related` links (M-10 → R-11..R-13, …)     | —         | —       | —     |

Worlds: roaming → `intl`; domestic → `tech`, all nine domestic documents in the topic "בעיות קליטה
בארץ" (`topic-14`, the legacy topic of the document M-10 supersedes, renamed); O-13 also keeps its
own legacy topic. `partial` = the source carries an explicit "to complete" note (shown as the step
hint "להשלמה: …").

### Evidence

- **Deterministic:** `convert:kira` run twice — the second time with `convert:legacy` under
  `TZ=America/New_York` and the overlay under `TZ=Asia/Tokyo` — gives byte-identical
  `apps/api/seed/*.json` (sha1 compared). `convert:legacy` alone now regenerates the committed legacy
  JSON byte-identically as well (time zone and the bundle's clock pinned, output through Prettier).
- **Contract:** every generated document and version snapshot is parsed with `DocumentSchema` by
  the converter; the ERRATA table fails the run if a correction no longer matches its source text.
- **Empty database, repo seed command:** `pnpm migrate` + `pnpm seed` on a fresh Postgres →
  `seeded { documents: 31, cards: 29, topics: 52, blocks: 4, fields: 14, scripts: 7, versions: 48,
notes: 1 }`. SQL spot checks: all 21 Kira documents present with the doc type of their code, ids
  above, `current_version` = legacy + 1 on the superseded ones with both versions in
  `document_versions`; T-10 steps carry their scripts; M-00 has 22 outgoing document edges.
- **Tests:** `apps/api/test/seed.test.ts` — document count 23 → 31 (the only changed assertion) and
  a new "Kira base knowledge" suite: superseded ids/slugs/versions stable, new documents typed and
  in their world, O-01 absent, the domestic topic membership, map and text links present
  (incl. the R-05 erratum), no dangling `related` or `document_links` targets, R-02 keeps its two
  shared-block references, T-10 scripts and objections, O-04 partial with its hint.
- **Gates:** typecheck (all packages) ✓ · lint (eslint + prettier) ✓ · shared unit 123/123 ✓ ·
  api unit 280 passed (494 integration-only skipped) ✓ · api integration (`RUN_INTEGRATION=1`,
  run in two halves) 119/119 files, 774/774 tests ✓ (`test/int` 32 files / 211 tests; the rest
  87 files / 563 tests).
- **Other seed consumers:** the AI eval harness cases (`packages/model/eval/cases/*.json`) carry
  their own synthetic documents (ids `1111…`/`2222…`/`3333…`) and reference no seed document — none
  is affected. The web e2e specs that name seed titles run against msw fixtures, except the real-stack
  ones, which only use the legacy "איטיות גלישה / חוסר גלישה" (unchanged). `load-fixture`/perf build
  their own data.

### Known gaps carried over from the sources (owner to decide)

- **Not supplied, referenced:** O-01 (empty file), R-10, R-14, O-11, O-14, S-10 (specialist route),
  H-01/H-02 (roaming packages list, operators list), H-11, the separate "אין קליטה / אין שירות
  בארץ" diagnosis, the SMS verification-code document, the CSP-profile operations document, a
  domestic APN document ("O-32"). References stay as plain text; knowledge-map links to them are
  skipped (the converter prints the list).
- **Corrected references (ERRATA in the converter):** M-00 "R-05 שיחות נכנסות" → R-04 and "R-06
  הודעות" → R-05 (the map routes incoming calls to R-04, messages to R-05); R-05 "O-06 בחירת רשת
  ידנית" (×2) → O-05; R-11 "T30" → T-10.
- **Left as written:** M-10 "M30 / R33" and R-12 "M-30" (the slow-browsing diagnosis; the quoted
  title is linked to the legacy browsing procedure T-01); M-10's last option ends mid-sentence in the
  source; drafting notes such as "אין באפשרותי לאשר…" and "במסמך ההשוואה הקיים אצלכם" are in the
  source text and were kept verbatim.
- **Legacy documents built from the OLD roaming set** (`pdf-004` "לקוח לא מוצא רשת בחו"ל",
  `pdf-010` "תקלת גלישה בחו"ל") and the two legacy reception scripts linked from M-10 are untouched.
