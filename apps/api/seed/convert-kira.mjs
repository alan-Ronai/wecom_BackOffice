/**
 * Y5 — rebuild the roaming and domestic-reception base knowledge from Kira's source documents.
 *
 * Input: `seed/source/kira/{roaming,domestic}/*.docx` plus the two knowledge-map workbooks
 * (`מפת ידע רומינג.xlsx`, `מפת ידע בעיות קליטה בארץ.xlsx`), committed as delivered.
 * Output: an overlay on the JSON `convert-legacy.mjs` writes — `documents.json` and
 * `versions.json` are rewritten, the other seed files are untouched.
 *
 * Order (`pnpm --filter @wecom/api convert:kira` runs both):
 *   1. `convert-legacy.mjs` — the static legacy library, the base layer;
 *   2. this — the Kira overlay.
 * The overlay refuses to run twice over the same base (it would stack a second Kira version onto
 * the first), so re-running it alone is an error; re-run `convert:kira`, which starts from step 1.
 *
 * ── What maps to what ──────────────────────────────────────────────────────────────────────────
 * A Kira document that supersedes a legacy one KEEPS the legacy id and slug (links, notes, tests
 * and telemetry keyed on them survive) and its topic; the legacy content becomes the previous
 * version and the Kira content the next one. Every other Kira document is new, with a
 * deterministic id (`uuidFrom('doc:' + slug)`, the rule `convert-legacy.mjs` uses).
 *
 *   Kira file                                         code  → seed document
 *   roaming/M-00 תקלות ושירות בחול - אבחון מרכזי       M-00  → pdf-011 (supersedes "אבחון מרכזי לתקלות ושירות בחו"ל")
 *   roaming/R-01 אין קליטה אין רישום לרשת בחול         R-01  → pdf-012 (supersedes "אין קליטה / רישום לרשת בחו"ל")
 *   roaming/R-02 - אין גלישה בחול                      R-02  → pdf-013 (supersedes "אין גלישה בחו"ל")
 *   roaming/R-03 - תקלה באפליקציה מסוימת בחול          R-03  → pdf-014 (supersedes "תקלה באפליקציה מסוימת בחו"ל")
 *   roaming/R-04 תקלת שיחות בחול                       R-04  → pdf-015 (supersedes "תקלות שיחות בחו"ל")
 *   roaming/R-05 - תקלות הודעות בחול                   R-05  → pdf-016 (supersedes "תקלות הודעות בחו"ל")
 *   roaming/O-01 - בדיקות שירותי נדידה וחבילת חול      O-01  → (none: the delivered file is empty, 0 bytes)
 *   roaming/O-02 - בדיקה והפעלת נדידת נתונים במכשיר     O-02  → pdf-017 (supersedes "הפעלת נדידת נתונים במכשיר")
 *   roaming/O-03 - הגדרת APN בחול                      O-03  → pdf-018 (supersedes "בדיקה והגדרת APN בחו"ל")
 *   roaming/O-04 - תפעול STK ושינוי זהות רשת בחול      O-04  → pdf-019 (supersedes "תפעול STK ושינוי זהות רשת בחו"ל")
 *   roaming/O-05 - בחירת רשת ידנית בחול                O-05  → pdf-020 (supersedes "בחירת רשת ידנית בחו"ל")
 *   roaming/0-06 תאימות מכשירים בארהב ("0" is a typo) O-06  → kira-o-06 (new)
 *   roaming/E-01 - העברה למומחה בתקלת חול              E-01  → pdf-021 (supersedes "העברה למומחה בתקלת חו"ל")
 *   domestic/M10 - בעיות קליטה בארץ - אבחון מרכזי      M-10  → pdf-002 (supersedes "בעיות קליטה בארץ – שיחות וגלישה")
 *   domestic/R-11 - קליטה חלשה במקום מסוים             R-11  → kira-r-11 (new)
 *   domestic/R-12 - קליטה חלשה או ניתוקים בנסיעה       R-12  → kira-r-12 (new)
 *   domestic/R-13 - הרעה חדשה בקליטה באזור             R-13  → kira-r-13 (new)
 *   domestic/O-10 - בדיקת מפת כיסוי ואנטנות            O-10  → kira-o-10 (new)
 *   domestic/O-12 - הפעלת שיחות ברשת אלחוטית           O-12  → kira-o-12 (new)
 *   domestic/איפוס הגדרות רשת O-13                     O-13  → pdf-005 (supersedes "מדריך איפוס הגדרות רשת")
 *   domestic/E-10 הסלמה למומחה – בעיות קליטה בארץ      E-10  → kira-e-10 (new)
 *   domestic/T-10 - תיאום ציפיות רשת סלולארית          T-10  → kira-t-10 (new)
 *
 * Legacy documents Kira does not cover stay exactly as `convert-legacy.mjs` wrote them — among
 * them pdf-004 "לקוח לא מוצא רשת בחו"ל" and pdf-010 "תקלת גלישה בחו"ל", which were built from the
 * two OLD roaming documents the NEW set replaces (their fate is an owner decision, not a converter
 * one).
 *
 * Worlds and topics: roaming → world `intl`; domestic reception → world `tech`, all in one topic
 * "בעיות קליטה בארץ" (the legacy topic of the document M-10 supersedes, renamed by the
 * `_topicName` seed field). O-13 keeps its own legacy topic and joins that one as well.
 *
 * ── How a Word document becomes phases and steps ───────────────────────────────────────────────
 * mammoth (the library the wave-4 source import uses) turns the .docx into HTML; a bold line is a
 * heading or a decision label, a plain line or list item is content.
 *   - "שלב N - …" is a step; "מסלול א' - …" opens a phase of its own (R-04, R-05); the sections in
 *     SECTION_TITLES (purpose, "when to use", closing, rules for the agent, …) are steps too; in an
 *     operations (O) document a device name is a step.
 *   - Sections before the first working step form the phase "לפני שמתחילים"; the closing run
 *     (end of handling, flow summary, rules, sources) forms "סיכום וכללים".
 *   - Inside a step, a bold line that is not a heading is a decision label: what follows it is a
 *     branch option. "המשך לשלב N" / "המשך לשלב הבא" becomes the option's `goto`. The question the
 *     branch answers is the quoted question just above it, else the step title.
 *   - In a problem (R) document a device name inside a step is a sub-section → `extras.stages`.
 *   - "תסריט" marks the customer script (`script`); in T-10 a "הלקוח שואל/אומר "…"" section is an
 *     objection (`extras.objection`, customer line + agent answer).
 *   - Bold lines that are really emphasis (a document reference, a value such as the APN name, a
 *     sentence ending in "."), or that complete a short "…:" lead-in, stay content, in **bold**.
 *   - Editor notes left in the documents ("להוסיף לינק…", "לבקש משחר להשלים", "חסר מידע
 *     להשלמה:", "נדרש להשלים:") become the step `hint` "להשלמה: …", and the document's status is
 *     `partial` instead of `published`.
 *   - "הלקוח אומר "…"" and numbered questions ("1. האם…") inside one step each become a step of
 *     their own: the model has one branch per step, those sections carry several.
 * Codes written in the text (R-01, O-02, T-10, …) are linked by the API's own link detection when
 * the document is saved; a quoted document title with no code next to it becomes a
 * `[[doc:<id>|title]]` link (TITLE_LINKS). The knowledge maps add explicit `related` links
 * (see `mapLinks`). Reference errors in the sources that the knowledge map contradicts are
 * corrected by the ERRATA table — each one is listed there with the reason, and the converter
 * fails if a correction no longer matches its source text.
 *
 * Everything is deterministic: dates come from the documents' own properties, ids from slugs.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import mammoth from 'mammoth';
import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { DocumentSchema } from '@wecom/shared';
import { readSeedJson, writeSeedJson } from './json-out.mjs';

const SRC = fileURLToPath(new URL('./source/kira/', import.meta.url));
const DEBUG = process.argv.includes('--debug');

// --- ids (the same rule as convert-legacy.mjs) -------------------------------------------------
const uuidFrom = (s) => {
  const h = createHash('sha1').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const docId = (slug) => uuidFrom('doc:' + slug);
const blockId = (slug) => uuidFrom('block:' + slug);

// --- the file table ------------------------------------------------------------------------------
const WORLD = { roaming: 'intl', domestic: 'tech' };
const KIRA_AUTHOR_FALLBACK = 'Kira';
/** `supersedes`: the legacy slug whose id this document keeps; `slug`: a new document. */
const DOCS = [
  { code: 'M-00', set: 'roaming', file: /^M-00\b/, supersedes: 'pdf-011' },
  { code: 'R-01', set: 'roaming', file: /^R-01\b/, supersedes: 'pdf-012' },
  { code: 'R-02', set: 'roaming', file: /^R-02\b/, supersedes: 'pdf-013' },
  { code: 'R-03', set: 'roaming', file: /^R-03\b/, supersedes: 'pdf-014' },
  { code: 'R-04', set: 'roaming', file: /^R-04\b/, supersedes: 'pdf-015' },
  { code: 'R-05', set: 'roaming', file: /^R-05\b/, supersedes: 'pdf-016' },
  { code: 'O-01', set: 'roaming', file: /^O-01\b/, empty: true },
  { code: 'O-02', set: 'roaming', file: /^O-02\b/, supersedes: 'pdf-017' },
  { code: 'O-03', set: 'roaming', file: /^O-03\b/, supersedes: 'pdf-018' },
  { code: 'O-04', set: 'roaming', file: /^O-04\b/, supersedes: 'pdf-019' },
  { code: 'O-05', set: 'roaming', file: /^O-05\b/, supersedes: 'pdf-020' },
  { code: 'O-06', set: 'roaming', file: /^0-06\b/, slug: 'kira-o-06' },
  { code: 'E-01', set: 'roaming', file: /^E-01\b/, supersedes: 'pdf-021' },
  { code: 'M-10', set: 'domestic', file: /^M10\b/, supersedes: 'pdf-002' },
  { code: 'R-11', set: 'domestic', file: /^R-11\b/, slug: 'kira-r-11' },
  { code: 'R-12', set: 'domestic', file: /^R-12\b/, slug: 'kira-r-12' },
  { code: 'R-13', set: 'domestic', file: /^R-13\b/, slug: 'kira-r-13' },
  { code: 'O-10', set: 'domestic', file: /^O-10\b/, slug: 'kira-o-10' },
  { code: 'O-12', set: 'domestic', file: /^O-12\b/, slug: 'kira-o-12' },
  { code: 'O-13', set: 'domestic', file: /O-13\.docx$/, supersedes: 'pdf-005' },
  { code: 'E-10', set: 'domestic', file: /^E-10\b/, slug: 'kira-e-10' },
  { code: 'T-10', set: 'domestic', file: /^T-10\b/, slug: 'kira-t-10' },
];
const MAPS = { roaming: 'מפת ידע רומינג.xlsx', domestic: 'מפת ידע בעיות קליטה בארץ.xlsx' };
/** The domestic documents share the legacy topic of the document M-10 supersedes, renamed. */
const DOMESTIC_TOPIC_NAME = 'בעיות קליטה בארץ';
/** Wave and priority for a new document (a superseding one keeps the legacy values). */
const NEW_WAVE = { M: 1, R: 1, O: 2, E: 2, T: 2 };

/**
 * Knowledge-map ids that name a supplied document under another id: the visual sheet of the
 * domestic map numbers the device operations D-10..D-12 while the documents are O-12/O-13
 * (O-14 was not supplied); the roaming tracking sheet lists the US-compatibility document as
 * H-03 while the document itself is O-06.
 */
const MAP_ALIASES = { 'D-10': 'O-12', 'D-11': 'O-13', 'D-12': 'O-14', 'H-03': 'O-06' };

/**
 * Reference corrections. Each fixes a code in a Kira document that its own title text and the
 * knowledge map contradict; each `find` must occur in the converted text exactly as written.
 */
const ERRATA = [
  // M-00 still uses an older numbering for the calls/messages routes. The roaming map ("22 פריטי
  // ידע" rows 6–7) routes incoming calls to R-04 and messages to R-05; R-06 does not exist.
  { code: 'M-00', find: 'R-05 שיחות נכנסות בחו"ל', replace: 'R-04 שיחות נכנסות בחו"ל' },
  { code: 'M-00', find: 'R-06 הודעות בחו"ל', replace: 'R-05 הודעות בחו"ל' },
  { code: 'M-00', find: 'שיחות נכנסות R-05', replace: 'שיחות נכנסות R-04' },
  { code: 'M-00', find: 'הודעות R-06', replace: 'הודעות R-05' },
  // R-05 points at "O-06 בחירת רשת ידנית בחו"ל" twice; manual network selection is O-05 (O-06 is
  // the US device-compatibility list).
  { code: 'R-05', find: 'O-06 בחירת רשת ידנית בחו"ל', replace: 'O-05 בחירת רשת ידנית בחו"ל', count: 2 },
  // R-11 cites "T30 - תיאום ציפיות רשת סלולארית"; that document is T-10.
  { code: 'R-11', find: 'T30 - תיאום ציפיות', replace: 'T-10 - תיאום ציפיות' },
];

/**
 * Quoted titles that name a document without its code. `slug` targets a legacy document
 * ("איטיות או חוסר גלישה בישראל" is the legacy browsing procedure, T-01).
 */
const TITLE_LINKS = [
  { title: 'תאימות מכשירים ורשתות בארה"ב', code: 'O-06' },
  { title: 'תאימות מכשירים ורשתות בארצות הברית', code: 'O-06' },
  { title: 'העברה למומחה בתקלת חו"ל', code: 'E-01' },
  { title: 'אין קליטה או רישום לרשת בחו"ל', code: 'R-01' },
  { title: 'בחירת רשת ידנית בחו"ל', code: 'O-05' },
  { title: 'אבחון מרכזי לתקלות ושירות בחו"ל', code: 'M-00' },
  { title: 'בדיקה והפעלת נדידת נתונים במכשיר', code: 'O-02' },
  { title: 'איטיות או חוסר גלישה בישראל', slug: 'browsing' },
];

/** The legacy steps that referenced a shared block keep the reference in the Kira version. */
const BLOCK_REFS = {
  'R-02': { 'שלב 8 - עדיין אין גלישה': ['sim-refresh'], 'שלב 9 - איפוס הגדרות רשת': ['network-reset'] },
  'E-01': { 'לפני ההעברה ודא': ['sim-refresh'] },
};

// --- section vocabulary --------------------------------------------------------------------------
const INTRO_TITLES = new Set([
  'מטרת המסמך',
  'מתי משתמשים במסמך?',
  'לפני שמתחילים',
  'לפני הבדיקה',
  'לפני ביצוע האיפוס',
  'ערך APN נדרש',
]);
const CLOSING_TITLES = new Set([
  'סיום טיפול',
  'סיום הטיפול',
  'סיום טיפול הנציג',
  'תוצאת הבדיקה',
  'תוצאת הטיפול',
  'זרימת הטיפול בקיצור',
  'סדר העבודה לנציג',
  'מפת ההפניות לנציג',
  'כלל מנחה לנציג',
  'חשוב לנציג',
  'מקורות',
  'מקורות תפעול',
]);
const FLOW_TITLES = new Set(['זרימת הטיפול בקיצור', 'סדר העבודה לנציג', 'מפת ההפניות לנציג']);
const ALERT_TITLES = new Set(['כלל מנחה לנציג', 'חשוב לנציג']);
const SECTION_TITLES = new Set([
  ...INTRO_TITLES,
  ...CLOSING_TITLES,
  'מתי לא להשתמש במסמך?',
  'מתי מעבירים למומחה?',
  'לפני ההעברה ודא',
  'מה מתעדים לפני ההעברה?',
  'מקרים שמחייבים המשך טיפול מקצועי',
  'מה קורה לאחר ההעברה?',
  'מתי מסלימים למומחה?',
  'מתי לא מסלימים למומחה בנושא רדיו?',
  'מידע חובה לפני ההעברה',
  'תיאום ציפיות לפני ההעברה',
  'לפני העברה למומחה',
  'הגדרות גלישה',
  'מדריכים לפי סוג מכשיר',
  'לאחר האיפוס',
  'לאחר שינוי APN',
  'לאחר הפעלת נדידת נתונים',
  'אם אף מפעיל אינו מאפשר רישום',
  'הלקוח נמצא בארצות הברית',
  'אם הלקוח שואל למה צריך לבצע איפוס',
]);
/** Per-document headings the shared vocabulary cannot know. */
const DOC_SECTIONS = {
  'O-06': ['מכשירי Samsung', 'מכשירי Apple', 'יתר המכשירים'],
  'T-10': [
    'מגבלת כיסוי באזור',
    'מיסוך בתוך מבנה',
    'קליטה חלשה או ניתוקים בזמן נסיעה',
    'הרעה חדשה באזור שהיה תקין',
    'העברה למומחה',
    'הלקוח שואל "מתי זה ייפתר?"',
    'הלקוח שואל "אתם הולכים לשפר את הקליטה באזור?"',
    'הלקוח אומר "אז אין לכם פתרון בשבילי?"',
    'הלקוח שואל "זה אומר שתמיד תהיה לי קליטה חלשה?"',
  ],
};
const DEVICE_RE =
  /^(אייפון|iPhone|סמסונג|Samsung|שיאומי|Xiaomi|וואווי|Huawei|גוגל פיקסל|Google Pixel|מוטורולה|רילמי|Realme|אופו|Oppo|Vivo|Nothing Phone|OnePlus|וואן פלוס|אנדרואיד|מכשיר אנדרואיד אחר)(?=$|[\s/:])/;
const TODO_RE = /^(להוסיף לינק|לבקש מ|חסר מידע להשלמה|נדרש להשלים)/;
const STEP_RE = /^שלב\s*(\d+)\s*[-–:]?\s*(.*)$/;
const ROUTE_RE = /^מסלול\s+([א-ת])['׳]\s*[-–]\s*(.+)$/;
const SUBSTEP_RE = /^(\d+\s*[.\-–]\s*\S.*|הלקוח אומר\s*".*)$/;
const OBJECTION_RE = /^(?:אם )?הלקוח (?:שואל|אומר)\s*"(.+?)"\??$/;
const CODE_AT_START = /^"?\s*(\d?[A-Z0]-?\d{1,2}|[A-Z]\d{2})\b/;
const PATH_ROOTS = new Set(['הגדרות', 'Settings', 'שמות נקודות גישה', 'טלפון']);

const plain = (md) => md.replace(/\*\*/g, '');
const words = (s) => plain(s).trim().split(/\s+/).filter(Boolean).length;
const isQuote = (s) => /^["“„]/.test(plain(s).trim());
const norm = (s) =>
  plain(s)
    .replace(/[:\s]+$/, '')
    .trim();

// --- .docx → blocks ------------------------------------------------------------------------------
const ENTITIES = { quot: '"', amp: '&', lt: '<', gt: '>', apos: "'", nbsp: ' ', '#39': "'" };
const decode = (s) =>
  s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, e) => {
    if (e[0] === '#')
      return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return ENTITIES[e] ?? m;
  });
const BR = ' ';

/** mammoth HTML → [{ tag: 'p'|'li', md }] where `md` carries `**` for bold and BR for <br>. */
function htmlBlocks(html) {
  const out = [];
  let cur = null;
  let href = null;
  let anchorText = '';
  for (const tok of html.match(/<[^>]+>|[^<]+/g) ?? []) {
    if (tok[0] !== '<') {
      const t = decode(tok);
      if (cur) cur.md += t;
      if (href !== null) anchorText += t;
      continue;
    }
    const m = tok.match(/^<(\/?)([a-z0-9]+)([^>]*)>$/i);
    if (!m) continue;
    const [, close, name, attrs] = m;
    if (/^(p|li|h[1-6])$/.test(name)) {
      if (!close) cur = { tag: name === 'li' ? 'li' : 'p', md: '' };
      else if (cur) {
        out.push(cur);
        cur = null;
      }
    } else if (name === 'strong' || name === 'b') {
      if (cur) cur.md += '**';
    } else if (name === 'br') {
      if (cur) cur.md += BR;
    } else if (name === 'a') {
      if (!close) {
        href = attrs.match(/href="([^"]*)"/)?.[1] ?? '';
        anchorText = '';
      } else {
        if (cur && href && anchorText.trim() !== href) cur.md += ` ${decode(href)}`;
        href = null;
      }
    }
  }
  return out;
}

/** Clean one block's markup; may split it in two where a <br> separated two real lines. */
function cleanBlock(b) {
  let md = b.md
    .replace(/[‎‏‪-‮﻿]/g, '')
    .replace(/\*\*(\s*)\*\*/g, '$1') // `</strong><strong>` and empty bold runs
    .replace(/ /g, ' ');
  // A <br> next to an arrow is part of a flow line; between short fragments it separates menu
  // levels ("הגדרות › סלולרי"); anywhere else it separates two lines.
  const segs = md.split(BR).map((s) => s.trim());
  let lines;
  if (segs.length === 1) lines = [md];
  else {
    lines = [segs[0]];
    for (const s of segs.slice(1)) {
      const prev = lines[lines.length - 1];
      if (!s) continue;
      if (/[↓→←↑]$/.test(plain(prev).trim()) || /^[↓→←↑]/.test(plain(s)))
        lines[lines.length - 1] = `${prev} ${s}`;
      else if (/:$/.test(plain(prev).trim()) || /^https?:\/\//.test(s))
        lines[lines.length - 1] = `${prev} ${s}`;
      else if (words(prev.split(' › ').pop()) <= 7 && words(s) <= 7 && !/[.:]/.test(plain(prev + s)))
        lines[lines.length - 1] = `${prev} › ${s}`;
      else lines.push(s);
    }
  }
  return lines
    .map((l) => {
      let t = l
        .replace(/\s*([↓→←])\s*/g, ' $1 ')
        .replace(/[ \t]+/g, ' ')
        .trim();
      t = tidyBold(t);
      const p = plain(t).trim();
      const bold =
        !!p &&
        t.startsWith('**') &&
        t.endsWith('**') &&
        !plain(t.slice(2, -2)).includes('**') &&
        !t.slice(2, -2).includes('**');
      return { tag: b.tag, md: bold ? p : t, text: p, bold };
    })
    .filter((x) => x.text);
}
/** Move whitespace out of bold runs and drop empty ones: `** R-03 **` → `**R-03**`. */
function tidyBold(t) {
  const parts = t.split('**');
  if (parts.length % 2 === 0) return plain(t); // unbalanced — keep the words, drop the markup
  let out = parts[0];
  for (let i = 1; i < parts.length; i += 2) {
    const inner = parts[i];
    const lead = inner.match(/^\s*/)[0];
    const trail = inner.match(/\s*$/)[0];
    const core = inner.trim();
    out += core ? `${lead}**${core}**${trail}` : inner;
    out += parts[i + 1];
  }
  return out.replace(/\s+/g, ' ').trim();
}

async function readDocx(file) {
  const buf = readFileSync(file);
  const { value: html } = await mammoth.convertToHtml({ buffer: buf });
  const zip = await JSZip.loadAsync(buf);
  const core = (await zip.file('docProps/core.xml')?.async('string')) ?? '';
  const prop = (t) => core.match(new RegExp(`<${t}[^>]*>([^<]*)</${t}>`))?.[1];
  const iso = (s) => (s ? new Date(s).toISOString() : undefined);
  return {
    blocks: htmlBlocks(html).flatMap(cleanBlock),
    author: prop('dc:creator') || prop('cp:lastModifiedBy') || KIRA_AUTHOR_FALLBACK,
    createdAt: iso(prop('dcterms:created')),
    updatedAt: iso(prop('dcterms:modified')),
  };
}

// --- blocks → document ---------------------------------------------------------------------------
const stripCode = (s) =>
  s
    .replace(/^\s*\d?[A-Z0]-?\d{1,2}\s*[-–]?\s*/, '')
    .replace(/[.\s]+$/, '')
    .trim();

function headingOf(b, code) {
  if (!b.bold || b.tag === 'li') return null;
  const t = b.text.trim();
  const n = norm(t);
  let m;
  if ((m = t.match(STEP_RE))) return { kind: 'step', num: m[1], title: m[2].trim() || `שלב ${m[1]}`, raw: t };
  if ((m = t.match(ROUTE_RE))) return { kind: 'route', letter: m[1], title: t, raw: t };
  if (SECTION_TITLES.has(n) || SECTION_TITLES.has(t) || (DOC_SECTIONS[code] ?? []).includes(n))
    return { kind: 'section', title: n, raw: t };
  if (/^עדיין\s.*\?$/.test(t)) return { kind: 'section', title: t, raw: t };
  if (code[0] === 'O' && DEVICE_RE.test(t) && words(t) <= 12) return { kind: 'device', title: n, raw: t };
  return null;
}

/** Content, not a decision label: a document reference, an emphasised value or sentence. */
const isEmphasis = (b, prev, titleCodes) =>
  CODE_AT_START.test(b.text) ||
  TITLE_LINKS.some((l) => b.text.includes(l.title)) ||
  titleCodes.some((t) => b.text.includes(t)) ||
  /[.]$/.test(b.text.trim()) ||
  words(b.text) > 12 ||
  (prev && /:$/.test(prev.text.trim()) && words(prev.text) <= 6 && !prev.bold);

function splitSections(blocks, code) {
  // title zone: leading bold lines (and a plain repeat of the title)
  let i = 0;
  let title = '';
  while (i < blocks.length && !headingOf(blocks[i], code)) {
    const b = blocks[i];
    const t = stripCode(b.text);
    const hasBold = b.bold || b.md.includes('**');
    if (!hasBold && !(title && t === title)) break;
    if (!title && t) title = t;
    i++;
  }
  const sections = [];
  let cur = null;
  for (; i < blocks.length; i++) {
    const h = headingOf(blocks[i], code);
    if (h) {
      cur = { ...h, blocks: [] };
      sections.push(cur);
      continue;
    }
    if (!cur) {
      cur = { kind: 'section', title: 'הנחיה כללית', raw: '', blocks: [] };
      sections.push(cur);
    }
    cur.blocks.push(blocks[i]);
  }
  // An empty device heading directly over a numbered step names that step (O-03: "אייפון" /
  // "שלב 1 - בדיקת הגדרת APN").
  for (let k = sections.length - 2; k >= 0; k--)
    if (sections[k].kind === 'device' && !sections[k].blocks.length && sections[k + 1].kind === 'step') {
      sections[k + 1].title = `${sections[k].title} — ${sections[k + 1].title}`;
      sections[k + 1].device = true;
      sections.splice(k, 1);
    }
  // An empty heading directly over device headings is their common title (O-12: "שלב 2 - הפעלת
  // השירות לפי סוג מכשיר" / "iPhone", "Samsung", …).
  for (let k = sections.length - 2; k >= 0; k--)
    if (!sections[k].blocks.length && sections[k].kind !== 'route' && sections[k + 1].kind === 'device') {
      for (let j = k + 1; j < sections.length && sections[j].kind === 'device'; j++) {
        sections[j].title = `${sections[k].title} — ${sections[j].title}`;
        if (sections[k].kind === 'step')
          Object.assign(sections[j], { kind: 'step', num: sections[k].num, device: true });
      }
      sections.splice(k, 1);
    }
  return { title, sections };
}

/** Merge a lead-in with the line it introduces; keep list items as their own lines. */
function mergeLines(lines) {
  const out = [];
  for (const l of lines) {
    if (l.barrier) {
      out.push(l);
      continue;
    }
    const prev = out[out.length - 1];
    if (prev?.barrier) {
      out.push({ ...l });
      continue;
    }
    const pt = prev ? plain(prev.md).trim() : '';
    const lt = plain(l.md).trim();
    if (
      prev &&
      !prev.li &&
      !l.li &&
      PATH_ROOTS.has(pt.split(/:\s/).pop()) &&
      !/[.:]$/.test(lt) &&
      (lt.includes(' › ') || words(lt) <= 12)
    )
      prev.md = `${prev.md} › ${l.md}`;
    else if (prev && !prev.li && !l.li && /:$/.test(pt) && words(pt.split(/:\s/).pop()) <= 6)
      prev.md = `${prev.md} ${l.md}`;
    else if (prev && !l.li && isQuote(l.md) && /(^|\s)[A-Z]-?\d{1,2}$/.test(pt))
      prev.md = `${prev.md} ${l.md}`;
    else out.push({ ...l });
  }
  return out.filter((l) => !l.barrier);
}
const joinText = (lines) =>
  mergeLines(lines)
    .map((l) => (l.li ? `• ${l.md}` : l.md))
    .join(' ');

function buildBody(blocks, ctx) {
  const pre = [];
  const options = [];
  const stages = [];
  const hints = [];
  const scripts = [];
  let objection = null;
  let mode = 'pre';
  let target = pre;
  let prev = null;
  for (const b of blocks) {
    const line = { md: b.md, li: b.tag === 'li' };
    if (mode === 'todo') {
      if (b.tag === 'li') {
        hints[hints.length - 1] += (hints[hints.length - 1].endsWith(':') ? ' ' : '; ') + b.text;
        continue;
      }
      mode = 'body';
    }
    if (/^תסריט:?$/.test(b.text.trim())) {
      mode = 'script';
      target.push({ barrier: true }); // a lead-in above the script does not run on past it
      prev = b;
      continue;
    }
    if (mode === 'script') {
      if (isQuote(b.md)) {
        scripts.push(plain(b.md));
        prev = b;
        continue;
      }
      mode = 'body';
    }
    if (objection && objection.a === null && isQuote(b.md)) {
      objection.a = plain(b.md);
      prev = b;
      continue;
    }
    if (b.bold && b.tag !== 'li') {
      const t = b.text.trim();
      let m;
      if (TODO_RE.test(t)) {
        hints.push(t);
        mode = 'todo';
        prev = b;
        continue;
      }
      // A bold line straight under a decision label is that option's first line, not a new one
      // (O-04: "קיימת זהות פרטנר" / "אין לנווט את הלקוח לתפריט STK").
      const underLabel = options.length && target === options[options.length - 1].lines && !target.length;
      if (!underLabel && !isEmphasis(b, prev, ctx.titleCodes)) {
        if (ctx.code[0] === 'R' && DEVICE_RE.test(t)) {
          stages.push({ label: t, lines: [] });
          target = stages[stages.length - 1].lines;
        } else if (ctx.code[0] === 'T' && !objection && (m = t.match(OBJECTION_RE))) {
          objection = { q: m[1], a: null };
          target = pre;
        } else {
          options.push({ label: norm(t) || t, lines: [] });
          target = options[options.length - 1].lines;
        }
        prev = b;
        continue;
      }
      line.md = `**${b.text.trim()}**`;
    }
    target.push(line);
    prev = b;
  }
  return { pre, options, stages, hints, scripts, objection };
}

/** Sub-steps: several "הלקוח אומר "…"" / "1. האם…" blocks in one section. */
function splitSubsteps(section) {
  const parts = [{ label: null, blocks: [] }];
  for (const b of section.blocks) {
    if (b.bold && b.tag !== 'li' && SUBSTEP_RE.test(b.text.trim()))
      parts.push({ label: b.text.trim(), blocks: [] });
    else parts[parts.length - 1].blocks.push(b);
  }
  if (parts.length === 1) return [{ title: section.title, blocks: section.blocks }];
  const out = [];
  if (parts[0].blocks.length) out.push({ title: section.title, blocks: parts[0].blocks });
  for (const p of parts.slice(1)) out.push({ title: `${section.title} — ${p.label}`, blocks: p.blocks });
  return out;
}

function flowActions(blocks) {
  const lines = [];
  let joinNext = false;
  let label = null;
  for (const b of blocks) {
    const t = b.md.trim();
    if (/^[↓→←]$/.test(plain(t))) {
      joinNext = lines.length > 0;
      continue;
    }
    if (b.bold && b.tag !== 'li' && !CODE_AT_START.test(b.text)) {
      label = b.text.trim();
      joinNext = false;
      continue;
    }
    let text = b.tag === 'li' ? `• ${t}` : t;
    if (label) {
      text = /^[→←↓]/.test(plain(text)) ? `**${label}** ${text}` : `**${label}** → ${text}`;
      label = null;
      lines.push(text);
    } else if (joinNext) lines[lines.length - 1] += ` ↓ ${text}`;
    else if (
      lines.length &&
      (/^[→←]/.test(plain(text)) || (isQuote(text) && /[A-Z]-?\d{1,2}$/.test(plain(lines[lines.length - 1]))))
    )
      lines[lines.length - 1] += ` ${text}`;
    else lines.push(text);
    joinNext = /[↓→]$/.test(plain(text));
    if (joinNext) lines[lines.length - 1] = lines[lines.length - 1].replace(/\s*[↓→]$/, '');
  }
  if (label) lines.push(`**${label}**`);
  return lines;
}

// --- links ----------------------------------------------------------------------------------------
function applyErrata(code, text, used) {
  let out = text;
  for (const [i, e] of ERRATA.entries()) {
    if (e.code !== code) continue;
    const n = out.split(e.find).length - 1;
    if (n) {
      out = out.split(e.find).join(e.replace);
      used[i] = (used[i] ?? 0) + n;
    }
  }
  return out;
}
function linkTitles(text, byCode, bySlug, selfCode) {
  let out = text;
  for (const l of TITLE_LINKS) {
    if (l.code === selfCode) continue;
    const target = l.code ? byCode.get(l.code) : bySlug.get(l.slug);
    if (!target) throw new Error(`TITLE_LINKS: no document for ${l.code ?? l.slug}`);
    if (l.code && out.includes(l.code)) continue; // the code already links it
    for (const form of [`"${l.title}"`, `**"${l.title}"**`, `**${l.title}**`, l.title]) {
      if (!out.includes(form)) continue;
      out = out.split(form).join(`[[doc:${target.id}|${l.title}]]`);
      break;
    }
  }
  return out;
}

// --- knowledge maps -------------------------------------------------------------------------------
async function readWorkbook(file) {
  const xp = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@', textNodeName: '#t' });
  const zip = await JSZip.loadAsync(readFileSync(file));
  const str = (n) =>
    n === undefined || n === null ? '' : typeof n === 'object' ? String(n['#t'] ?? '') : String(n);
  const ss = zip.file('xl/sharedStrings.xml')
    ? xp.parse(await zip.file('xl/sharedStrings.xml').async('string'))
    : null;
  const shared = [].concat(ss?.sst?.si ?? []).map((si) =>
    si.t !== undefined
      ? str(si.t)
      : []
          .concat(si.r ?? [])
          .map((r) => str(r.t))
          .join(''),
  );
  const wb = xp.parse(await zip.file('xl/workbook.xml').async('string'));
  const rels = xp.parse(await zip.file('xl/_rels/workbook.xml.rels').async('string'));
  const target = new Map([].concat(rels.Relationships.Relationship).map((r) => [r['@Id'], r['@Target']]));
  const sheets = {};
  for (const s of [].concat(wb.workbook.sheets.sheet)) {
    const p = 'xl/' + target.get(s['@r:id']).replace(/^\/?xl\//, '');
    const ws = xp.parse(await zip.file(p).async('string'));
    const rows = [];
    for (const row of [].concat(ws.worksheet.sheetData.row ?? [])) {
      const cells = {};
      for (const c of [].concat(row.c ?? [])) {
        let v = c.v ?? c.is?.t;
        if (c['@t'] === 's') v = shared[Number(v)];
        const text = str(v).trim();
        if (text && text !== 'NaN') cells[c['@r'].replace(/\d+$/, '')] = text;
      }
      if (Object.keys(cells).length) rows.push(cells);
    }
    sheets[s['@name']] = rows;
  }
  return sheets;
}

const codesIn = (s) => [...(s ?? '').matchAll(/\b([A-Z])-(\d{2})\b/g)].map((m) => MAP_ALIASES[m[0]] ?? m[0]);
const RANK = { M: 0, R: 1, O: 2, D: 2, H: 2, T: 2, E: 3, S: 3 };

/** Explicit `related` edges read off the two knowledge maps; unresolvable ids are reported. */
function mapLinks(maps) {
  const edges = [];
  const add = (from, to, why) => edges.push({ from, to, why: why.replace(/\s+/g, ' ').trim() });

  // Roaming · "22 פריטי ידע": every decision point of the central diagnosis → its target document.
  for (const r of maps.roaming['22 פריטי ידע'].slice(1)) {
    const [to] = codesIn(r.G);
    if (to) add('M-00', to, `מפת ידע רומינג · ${r.A}: ${r.B}`);
  }
  // Roaming · "מעקב מסמכים": gap notes that ask for links ("להשלים קישורים O-01/O-02/O-05").
  for (const r of maps.roaming['מעקב מסמכים'].slice(1))
    if (/קישור/.test(r.G ?? '') && /^[A-Z]-\d{2}$/.test(r.A ?? ''))
      for (const to of codesIn(r.G)) add(r.A, to, `מפת ידע רומינג · ${r.C}: ${r.G}`);
  // Roaming · "מה עוד חסר בחו"ל": "איפה ישמש" — the documents that use each item.
  const GAP_SUBJECT = [
    [/בדיקת שירותי נדידה/, 'O-01'],
    [/רשימת מפעילים/, 'H-02'],
    [/STK/, 'O-04'],
    [/העברה למומחה/, 'E-01'],
    [/תאימות מכשירים/, 'O-06'],
    [/חבילות חו"ל/, 'H-01'],
  ];
  for (const r of maps.roaming['מה עוד חסר בחו"ל'].slice(1)) {
    const subject = GAP_SUBJECT.find(([re]) => re.test(r.B ?? ''))?.[1];
    if (subject) for (const from of codesIn(r.F)) add(from, subject, `מפת ידע רומינג · ${r.B}`);
  }
  // Domestic · visual map: the central diagnosis routes to each reception route.
  for (const r of maps.domestic['מפת ידע ויזואלית'])
    for (const v of Object.values(r)) {
      const m = v.match(/^(R-\d{2})\s*\n?([\s\S]*)$/);
      if (m) add('M-10', m[1], `מפת ידע בעיות קליטה בארץ · ${m[2].replace(/\n/g, ' ')}`);
    }
  // Domestic · "פריטי ידע": "R-11 / O-10" — the item lives in both; the route uses the other.
  for (const r of maps.domestic['פריטי ידע'].slice(1)) {
    const codes = codesIn(r.E);
    for (let a = 0; a < codes.length; a++)
      for (let b = a + 1; b < codes.length; b++)
        if (RANK[codes[a][0]] < RANK[codes[b][0]])
          add(codes[a], codes[b], `מפת ידע בעיות קליטה בארץ · ${r.C}: ${r.D}`);
  }
  return edges;
}

// --- main -----------------------------------------------------------------------------------------
const documents = readSeedJson('documents.json');
const versions = readSeedJson('versions.json');
const blocks = readSeedJson('blocks.json');
if (documents.some((d) => (d.sourceRef ?? '').startsWith('Kira · ')))
  throw new Error(
    'documents.json already carries the Kira overlay — run `convert:kira`, which starts from convert:legacy',
  );

const bySlug = new Map(documents.map((d) => [d.slug, d]));
const blockIds = new Set(blocks.map((b) => b.id));

// every source file must be in the table, and every table row must find its file
const files = {};
for (const set of Object.keys(WORLD)) {
  for (const f of readdirSync(path.join(SRC, set))) {
    if (f === MAPS[set] || f.startsWith('.')) continue;
    const rows = DOCS.filter((d) => d.set === set && d.file.test(f));
    if (rows.length !== 1) throw new Error(`source/kira/${set}/${f}: ${rows.length} table rows match`);
    files[rows[0].code] = path.join(set, f);
  }
}
for (const d of DOCS) if (!files[d.code]) throw new Error(`no source file for ${d.code}`);

// identities first: every document's id, slug and code must be known before text is linked
const plan = DOCS.filter((d) => !d.empty).map((d) => {
  const legacy = d.supersedes ? bySlug.get(d.supersedes) : null;
  if (d.supersedes && !legacy) throw new Error(`${d.code}: legacy ${d.supersedes} not found`);
  const slug = legacy ? legacy.slug : d.slug;
  return { ...d, legacy, slug, id: legacy ? legacy.id : docId(slug), world: WORLD[d.set] };
});
const byCode = new Map(documents.filter((d) => d.code).map((d) => [d.code, d]));
for (const p of plan) byCode.set(p.code, { id: p.id, slug: p.slug, code: p.code });

const maps = {
  roaming: await readWorkbook(path.join(SRC, 'roaming', MAPS.roaming)),
  domestic: await readWorkbook(path.join(SRC, 'domestic', MAPS.domestic)),
};
const edges = mapLinks(maps);
const unresolvedMap = new Set();
const unresolvedText = new Map();
const erratumHits = {};
const domesticTopic = plan.find((p) => p.code === 'M-10').legacy._topicId;
const report = [];

const out = [];
for (const p of plan) {
  const src = await readDocx(path.join(SRC, files[p.code]));
  const { title, sections } = splitSections(src.blocks, p.code);
  if (!title) throw new Error(`${p.code}: no title`);
  const titleCodes = TITLE_LINKS.map((l) => l.title);
  const text = (md) => linkTitles(applyErrata(p.code, md, erratumHits), byCode, bySlug, p.code);

  // phases
  const firstMain = sections.findIndex((s) => !(INTRO_TITLES.has(s.title) || s.title === 'הנחיה כללית'));
  let closingFrom = sections.length;
  while (
    closingFrom > 0 &&
    CLOSING_TITLES.has(sections[closingFrom - 1].title) &&
    closingFrom - 1 > firstMain
  )
    closingFrom--;
  const phases = [];
  const phaseFor = (key, label) => {
    let ph = phases.find((x) => x.key === key);
    if (!ph) phases.push((ph = { key, id: `p${phases.length}`, label, steps: [] }));
    return ph;
  };
  let route = null;
  let n = 0;
  sections.forEach((s, idx) => {
    if (s.kind === 'route') {
      route = s;
      // A route with no numbered steps of its own (R-04/R-05 "מסלול ג'") is one step.
      if (!s.blocks.length) return;
      s = { ...s, title: s.title.replace(ROUTE_RE, '$2').trim() };
    }
    const ph =
      firstMain === -1 || idx < firstMain
        ? phaseFor('intro', 'לפני שמתחילים')
        : idx >= closingFrom
          ? phaseFor('closing', 'סיכום וכללים')
          : route
            ? phaseFor('route:' + route.letter, route.title.replace(/\s*[-–]\s*/, ' — '))
            : phaseFor('main', 'שלבי הטיפול');
    const refs = BLOCK_REFS[p.code]?.[s.raw] ?? [];
    const parts = FLOW_TITLES.has(s.title)
      ? [{ title: s.title, blocks: s.blocks, flow: true }]
      : splitSubsteps(s);
    for (const part of parts) {
      n++;
      const key = `s${n}`;
      const step = {
        key,
        num: String(n),
        title: part.title,
        hint: undefined,
        tone: ALERT_TITLES.has(s.title) ? 'alert' : undefined,
        blockRefs: refs.map(blockId),
        script: undefined,
        sourceRef:
          s.kind === 'step'
            ? `${route ? route.title.split(/\s*[-–]/)[0] + ' · ' : ''}שלב ${s.num}`
            : `§${idx + 1}`,
        deps: [],
        actions: [],
        outcomes: [],
        branch: undefined,
        extras: undefined,
      };
      if (part.flow) {
        step.actions = flowActions(part.blocks).map((t, i) => ({ id: `${key}a${i + 1}`, text: text(t) }));
      } else {
        const body = buildBody(part.blocks, { code: p.code, titleCodes });
        // T-10: a "הלקוח שואל "…"" section is an objection — the customer's line and the script.
        const om =
          p.code[0] === 'T' && !body.objection && body.scripts.length ? s.title.match(OBJECTION_RE) : null;
        if (om) body.objection = { q: om[1], a: body.scripts.splice(0).join(' ') };
        let pre = mergeLines(body.pre);
        let q = step.title;
        if (body.options.length && pre.length) {
          const last = plain(pre[pre.length - 1].md).trim();
          const qm = last.match(/^(?:שאל:\s*)?(["“„].*[?؟]["”]?)$/);
          if (qm && !pre[pre.length - 1].li) {
            q = qm[1];
            pre = pre.slice(0, -1);
          }
        }
        step.actions = pre.map((l, i) => ({ id: `${key}a${i + 1}`, text: text(l.md) }));
        if (body.options.length)
          step.branch = {
            q: text(q),
            options: body.options.map((o) => ({ kind: 'if', label: o.label, text: text(joinText(o.lines)) })),
          };
        if (body.stages.length || body.objection) {
          step.extras = {};
          if (body.stages.length)
            step.extras.stages = body.stages.map((st) => ({
              label: st.label,
              actions: mergeLines(st.lines).map((l) => text(l.md)),
            }));
          if (body.objection)
            step.extras.objection = { q: body.objection.q, a: text(body.objection.a ?? '') };
        }
        if (body.scripts.length) step.script = text(body.scripts.join(' '));
        if (body.hints.length) step.hint = 'להשלמה: ' + body.hints.join(' · ');
      }
      step._phase = ph;
      step._num = s.kind === 'step' ? s.num : null;
      ph.steps.push(step);
    }
  });

  // branch targets: "המשך לשלב N" / "המשך לשלב הבא" within the same phase
  for (const ph of phases)
    ph.steps.forEach((st, i) => {
      for (const o of st.branch?.options ?? []) {
        const t = plain(o.text);
        let goto;
        const m = t.match(/המשך לשלב (\d+)/);
        if (m) goto = ph.steps.find((x) => x._num === m[1])?.key;
        else if (/המשך לשלב הבא/.test(t)) goto = ph.steps[i + 1]?.key;
        if (goto) o.goto = goto;
      }
    });

  const allSteps = phases.flatMap((ph) => ph.steps);
  const purpose = allSteps.find((s) => INTRO_TITLES.has(s.title)) ?? allSteps[0];
  const status = allSteps.some((s) => s.hint) ? 'partial' : 'published';
  const docType = p.code[0];
  const doc = {
    id: p.id,
    slug: p.slug,
    code: p.code,
    title,
    description: purpose?.actions[0]
      ? plain(purpose.actions[0].text).replace(/\[\[doc:[\w-]+\|([^\]]+)\]\]/g, '$1')
      : '',
    category: p.world,
    wave: p.legacy ? p.legacy.wave : NEW_WAVE[docType],
    priority: p.legacy ? p.legacy.priority : 'm',
    kind: 'steps',
    status,
    currentVersion: p.legacy ? p.legacy.currentVersion + 1 : 1,
    sourceId: null,
    sourceRef: `Kira · ${files[p.code]}`,
    phases: phases.map((ph) => ({
      id: ph.id,
      label: ph.label,
      steps: ph.steps.map((s) => {
        const c = { ...s };
        delete c._phase;
        delete c._num;
        for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
        return c;
      }),
    })),
    related: [],
    createdAt: p.legacy ? p.legacy.createdAt : src.createdAt,
    updatedAt: src.updatedAt,
  };

  // codes the text names that no document carries
  const allText = JSON.stringify(doc.phases);
  // (a hyphenated code, or a code written without its hyphen as a document reference: "M30 - …")
  for (const m of allText.matchAll(/\b([A-Z]-\d{2})\b|\b([MROET]\d{2})\s*-\s/g)) {
    const c = m[1] ?? m[2];
    if (byCode.has(c)) continue;
    if (!unresolvedText.has(p.code)) unresolvedText.set(p.code, new Set());
    unresolvedText.get(p.code).add(c);
  }

  out.push({
    plan: p,
    doc,
    author: src.author,
    topicId:
      p.set === 'domestic'
        ? p.code === 'O-13'
          ? p.legacy._topicId
          : domesticTopic
        : (p.legacy?._topicId ?? null),
  });
}

// related edges from the maps, deduplicated per (from, to)
for (const e of edges) {
  const from = out.find((o) => o.plan.code === e.from);
  const to = byCode.get(e.to);
  if (!from || !to || e.from === e.to) {
    unresolvedMap.add(`${e.from} → ${e.to}`);
    continue;
  }
  if (from.doc.related.some((r) => r.documentId === to.id)) continue;
  from.doc.related.push({ documentId: to.id, why: e.why });
}

for (const [i, e] of ERRATA.entries())
  if ((erratumHits[i] ?? 0) !== (e.count ?? 1))
    throw new Error(
      `ERRATA[${i}] (${e.code} "${e.find}") matched ${erratumHits[i] ?? 0}×, expected ${e.count ?? 1}`,
    );

// --- assemble -------------------------------------------------------------------------------------
const nextDocs = [...documents];
const nextVersions = [...versions];
const strip = (d) => Object.fromEntries(Object.entries(d).filter(([k]) => !k.startsWith('_')));
for (const o of out) {
  const { doc, plan: p } = o;
  DocumentSchema.parse(doc); // fail loudly if a conversion drifts from the contract
  for (const s of doc.phases.flatMap((ph) => ph.steps))
    for (const b of s.blockRefs) if (!blockIds.has(b)) throw new Error(`${p.code}: block ${b} missing`);
  const row = { ...doc, _author: o.author, _topicId: o.topicId };
  if (o.topicId === domesticTopic) row._topicName = DOMESTIC_TOPIC_NAME;
  if (p.code === 'O-13') row._extraTopicIds = [domesticTopic];
  if (p.legacy) {
    const i = nextDocs.findIndex((d) => d.id === p.legacy.id);
    nextDocs[i] = row;
    if (nextVersions.some((v) => v.slug === p.slug))
      throw new Error(`${p.code}: legacy history exists for ${p.slug}`);
    nextVersions.push({
      slug: p.slug,
      version: p.legacy.currentVersion,
      label: 'ייבוא מהספרייה הסטטית',
      kind: 'published',
      author: p.legacy._author,
      at: p.legacy.updatedAt,
      snapshot: (DocumentSchema.parse(strip(p.legacy)), strip(p.legacy)),
    });
  } else nextDocs.push(row);
  nextVersions.push({
    slug: p.slug,
    version: doc.currentVersion,
    label: 'רענון ידע בסיס · מקור Kira',
    kind: 'published',
    author: o.author,
    at: doc.updatedAt,
    snapshot: doc,
  });
  report.push(
    `${p.code.padEnd(5)} ${files[p.code].padEnd(52)} → ${doc.id} ${doc.slug.padEnd(10)} ${p.legacy ? 'supersedes "' + p.legacy.title + '"' : 'new'} · "${doc.title}" · ${doc.phases.length} phases / ${doc.phases.reduce((a, ph) => a + ph.steps.length, 0)} steps · ${doc.related.length} related · ${doc.status}`,
  );
}

// every related link in the final library resolves
const finalIds = new Set(nextDocs.map((d) => d.id));
for (const d of nextDocs)
  for (const r of d.related ?? [])
    if (!finalIds.has(r.documentId)) throw new Error(`${d.slug}: dangling related ${r.documentId}`);

if (DEBUG)
  for (const o of out) {
    console.log(`\n######## ${o.plan.code} ${o.doc.title} [${o.doc.status}]\n  desc: ${o.doc.description}`);
    for (const ph of o.doc.phases) {
      console.log(`  == ${ph.id} ${ph.label}`);
      for (const s of ph.steps) {
        console.log(
          `   [${s.key} #${s.num} ${s.sourceRef}${s.tone ? ' ALERT' : ''}] ${s.title}${s.hint ? '  (hint: ' + s.hint + ')' : ''}${s.blockRefs.length ? ' blocks:' + s.blockRefs.length : ''}`,
        );
        for (const a of s.actions) console.log(`      › ${a.text}`);
        if (s.script) console.log(`      SCRIPT: ${s.script}`);
        if (s.branch) {
          console.log(`      ? ${s.branch.q}`);
          for (const op of s.branch.options)
            console.log(`        [${op.label}]${op.goto ? ' →' + op.goto : ''} ${op.text}`);
        }
        for (const st of s.extras?.stages ?? [])
          console.log(`        {${st.label}} ${st.actions.join(' | ')}`);
        if (s.extras?.objection)
          console.log(`        OBJ q=${s.extras.objection.q} a=${s.extras.objection.a}`);
      }
    }
    console.log(
      '  related:',
      o.doc.related
        .map((r) => [...byCode.values()].find((x) => x.id === r.documentId)?.code ?? r.documentId)
        .join(', '),
    );
  }

console.log(report.join('\n'));
console.log('skipped: O-01 (empty source file)');
if (unresolvedMap.size)
  console.log('knowledge-map links with no supplied document:', [...unresolvedMap].join(', '));
for (const [c, s] of unresolvedText) console.log(`codes in ${c} with no document:`, [...s].join(', '));

await writeSeedJson('documents.json', nextDocs);
await writeSeedJson('versions.json', nextVersions);
