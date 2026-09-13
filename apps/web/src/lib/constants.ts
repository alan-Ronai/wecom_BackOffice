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
