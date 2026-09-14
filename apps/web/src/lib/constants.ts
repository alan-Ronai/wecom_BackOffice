import type { Category, Priority } from '@wecom/shared';

/** Ported verbatim from legacy/js/data.js — labels, icons and colours the UI reads. */
export const CATS: Record<Category, { label: string; short: string; icon: string; color: string }> = {
  sim: { label: 'SIM / eSIM', short: 'SIM', icon: '📶', color: '#2E5CE0' },
  tech: { label: 'תמיכה טכנית', short: 'טכני', icon: '🔧', color: '#3A4A5C' },
  billing: { label: 'חיובים', short: 'חיובים', icon: '💳', color: '#0E7A4F' },
  plans: { label: 'מסלולים', short: 'מסלולים', icon: '📋', color: '#6D3FD1' },
  intl: { label: 'חו"ל ונדידה', short: 'חו"ל', icon: '✈️', color: '#0891B2' },
  ops: { label: 'טיפול בשיחה', short: 'שיחה', icon: '🎧', color: '#C2410C' },
};
export const CAT_KEYS = Object.keys(CATS) as Category[];

export const PRI: Record<Priority, { label: string; cls: string }> = {
  hh: { label: 'שכיח מאוד', cls: 'chip-red' },
  h: { label: 'שכיח', cls: 'chip-amber' },
  m: { label: 'בינוני', cls: 'chip-gray' },
  l: { label: 'נמוך', cls: 'chip-gray' },
};

export const WAVES: Record<1 | 2 | 3, string> = {
  1: 'גל 1 · הכי שכיח',
  2: 'גל 2',
  3: 'גל 3 · משלים',
};

/** The data-source rows in the sidebar (legacy KB.SOURCES). */
export const SOURCE_FILES: {
  id: string;
  file: string;
  kind: 'docs' | 'fields' | 'scripts';
  cats?: Category[];
}[] = [
  { id: 'topics', file: 'topics.json', kind: 'docs', cats: ['sim', 'tech', 'billing', 'plans', 'ops'] },
  { id: 'intl', file: 'intl-roaming.json', kind: 'docs', cats: ['intl'] },
  { id: 'crm', file: 'crm-fields.json', kind: 'fields' },
  { id: 'scripts', file: 'scripts.json', kind: 'scripts' },
];

/** Editor "יסודות" presets — reusable action snippets (legacy KB.PRESETS). */
export const PRESETS: { group: string; items: string[] }[] = [
  {
    group: 'שאלות בירור',
    items: [
      'מה בדיוק לא עובד?',
      'מתי זה התחיל?',
      'זה בכל מקום או רק כאן?',
      'כמה זמן הבעיה קיימת?',
      'האם זה קרה בעבר?',
    ],
  },
  {
    group: 'בדיקות מערכת (ללא לקוח)',
    items: [
      'בדיקת שדה "גלישה בארץ" ב-CRM',
      'בדיקת ניצול חבילת גלישה – אזור אישי ← השימושים שלי',
      'בדיקת Prepaid / חשד הונאה → פנייה ל-IT',
      'בדיקת כיסוי אנטנות באזור',
      'בדיקת סטטוס SIM במערכת',
      'בדיקת חוב פתוח',
    ],
  },
  {
    group: 'פעולות במכשיר הלקוח',
    items: [
      'נתונים סלולריים – אם כבוי → להדליק',
      'Wi-Fi – אם דולק → לכבות',
      'סימון רשת → שנה ל-4G/5G אוטומטי',
      'APN → הגדרה נכונה ל-WE',
      'איפוס הגדרות רשת',
      'כיבוי והדלקת מכשיר',
    ],
  },
  {
    group: 'פעולות נציג',
    items: [
      'ריענון גלישה – מתג "גלישה בארץ" כבה/הפעל',
      'פתיחת פנייה ל-IT',
      'פתיחת טופס רדיו + GNETRUCK',
      'ביצוע זיכוי / החזר',
      'שינוי מסלול / חבילה',
    ],
  },
  {
    group: 'הפניה / אסקלציה',
    items: [
      'מומחי תמיכה – לאחר מיצוי כל השלבים',
      'מעבדה – בעיית מכשיר',
      'הום סנטר – החלפת SIM פיזי',
      'מנהל / שימור – לקוח מתוסכל',
    ],
  },
  {
    group: 'סגירה',
    items: [
      'Wi-Fi Calling – הצע כפתרון מניעתי',
      'תיאום callback / מעקב',
      'תיעוד כל הפעולות שבוצעו',
      'שאלת שביעות רצון',
    ],
  },
];

/** Legacy KB.KEYMAP — the `?` overlay. */
export const KEYMAP: [string, string][] = [
  ['Ctrl K', 'חיפוש בכל המקורות'],
  ['Ctrl D', 'מצב כהה / בהיר'],
  ['Ctrl \\', 'פיצול מסך'],
  ['Alt T', 'פתיחת מסמך בלשונית חדשה'],
  ['Alt ← / →', 'היסטוריה אחורה / קדימה'],
  ['↑ ↓', 'מעבר בין שלבים (מצב שיחה)'],
  ['↵', 'פתיחת השלב הנוכחי'],
  ['1 – 3', 'בחירת תוצאה בשלב'],
  ['G ואז מספר', 'קפיצה לשלב'],
  ['N', 'הערת נציג לשלב'],
  ['P', 'הצמד / בטל הצמדה'],
  ['C', 'העתקת סיכום לתיעוד'],
  ['E', 'עריכת המסמך'],
  ['H', 'היסטוריית גרסאות'],
  ['W', 'סגירת הלשונית'],
  ['?', 'מפת הקיצורים'],
  ['Esc', 'סגירת חלון / חזרה'],
];

/** How many days an item survives in the trash before the nightly purge. */
export const TRASH_DAYS = 30;

export const STATUS_LABEL: Record<string, string> = {
  draft: 'טיוטה',
  review: 'בסקירה',
  published: 'פורסם',
  partial: 'מסמך חלקי',
  archived: 'בארכיון',
};

/* ── stage 4 · connected data ───────────────────────────────────────────── */

/** `MappingFieldSchema` — the card fields a data-file column can be mapped onto. */
export const MAPPING_FIELDS: [string, string][] = [
  ['title', 'כותרת'],
  ['description', 'תיאור'],
  ['category', 'קטגוריה'],
  ['wave', 'גל'],
  ['priority', 'שכיחות'],
  ['code', 'קוד'],
  ['stepTitle', 'כותרת שלב'],
  ['stepAction', 'פעולה בשלב'],
  ['stepOutcome', 'תוצאת שלב'],
  ['ignore', '— התעלם'],
];
export const MAPPING_LABEL: Record<string, string> = Object.fromEntries(MAPPING_FIELDS);

/** `syncState` of a source, with the chip class the legacy palette already defines. */
export const SYNC_STATE: Record<string, { label: string; cls: string; mark: string }> = {
  synced: { label: 'מסונכרן', cls: 'chip-green', mark: '✓' },
  pending: { label: 'ממתין לעיבוד', cls: 'chip-amber', mark: '⚠' },
  processing: { label: 'בעיבוד', cls: 'chip-blue', mark: '⟳' },
  error: { label: 'שגיאה', cls: 'chip-red', mark: '✗' },
};

/** `LinkTypeSchema` — the edge types the relationship graph renders and filters by. */
export const LINK_TYPES: [string, string][] = [
  ['next', 'הבא'],
  ['prerequisite', 'תנאי מוקדם'],
  ['link', 'קישור'],
  ['shares_block', 'אותו בלוק'],
  ['same_field', 'אותו שדה CRM'],
  ['derived_from_source', 'נגזר ממקור'],
  ['related', 'קשור'],
];
export const LINK_TYPE_LABEL: Record<string, string> = Object.fromEntries(LINK_TYPES);

/**
 * `GraphNodeKindSchema` — icon, Hebrew label and the token each kind is painted with. Documents
 * override the colour with their category colour from `CATS`, which is where the legacy palette
 * already encodes "which part of the knowledge base is this".
 */
export const NODE_KINDS: Record<string, { label: string; plural: string; icon: string; color: string }> = {
  document: { label: 'מסמך', plural: 'מסמכים', icon: '📄', color: 'var(--navy-soft)' },
  block: { label: 'בלוק', plural: 'בלוקים', icon: '⧉', color: 'var(--info)' },
  field: { label: 'שדה CRM', plural: 'שדות CRM', icon: '▦', color: 'var(--red)' },
  source: { label: 'מקור', plural: 'מקורות', icon: '§', color: 'var(--warn)' },
  script: { label: 'תסריט', plural: 'תסריטים', icon: '“', color: 'var(--ok)' },
};
export const NODE_KIND_KEYS = Object.keys(NODE_KINDS);
