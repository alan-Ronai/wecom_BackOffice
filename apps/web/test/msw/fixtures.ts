/**
 * Fixtures for every component test. Content mirrors `legacy/js/data.js` (the flagship
 * "איטיות גלישה" document, its shared blocks, CRM fields and version history) converted to the
 * stage-1 shared schemas: `step.id` → `step.key`, `desc` → `description`, `source` → `sourceRef`,
 * `block` → `blockId`. `fixtures.test.ts` parses all of it with the shared zod schemas, so any
 * contract drift in `@wecom/shared` fails the suite instead of silently changing the UI.
 */
import type {
  AuditEntry,
  Block,
  CrmField,
  Document,
  DocumentCard,
  Me,
  Note,
  Role,
  Script,
  Source,
  SourceRevision,
  Step,
  Suggestion,
  User,
  Version,
} from '@wecom/shared';
import { PERMISSIONS } from '@wecom/shared';
import type { GroupMap, Session, TrashItem } from '../../src/api/types.js';

export const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
export const U2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const D_BROWSING = '11111111-1111-4111-8111-111111111111';
export const D_INTL = '22222222-2222-4222-8222-222222222222';
export const D_CHURN = '33333333-3333-4333-8333-333333333333';
export const BLK_SIM = '44444444-4444-4444-8444-444444444441';
export const BLK_DEV = '44444444-4444-4444-8444-444444444442';
export const BLK_NET = '44444444-4444-4444-8444-444444444443';
export const BLK_SCRIPT = '44444444-4444-4444-8444-444444444444';
export const SRC_TECH = '55555555-5555-4555-8555-555555555551';
export const SRC_INTL = '55555555-5555-4555-8555-555555555552';
export const REV_1 = '66666666-6666-4666-8666-666666666661';
export const NOTE_1 = '77777777-7777-4777-8777-777777777771';
export const SUG_1 = '88888888-8888-4888-8888-888888888881';
export const ROLE_LEAD = '99999999-9999-4999-8999-999999999991';
export const ROLE_ADMIN = '99999999-9999-4999-8999-999999999992';

export const T = '2025-06-12T12:48:00.000Z';

/** Fills the schema defaults TypeScript still demands on the output type. */
const step = (s: Partial<Step> & Pick<Step, 'key' | 'num' | 'title'>): Step => ({
  blockRefs: [],
  deps: [],
  actions: [],
  outcomes: [],
  ...s,
});

export const me: Me = {
  user: {
    id: U1,
    subject: 'inbar@wecom.co.il',
    source: 'entra',
    email: 'inbar@wecom.co.il',
    displayName: 'ענבר ל.',
    initials: 'ע',
    active: true,
    lastLoginAt: T,
  },
  roles: ['lead'],
  permissions: [
    'docs.read',
    'docs.create',
    'docs.edit',
    'docs.publish',
    'docs.delete',
    'docs.restore',
    'blocks.edit',
    'fields.edit',
    'scripts.edit',
    'notes.write',
    'notes.moderate',
    'suggestions.review',
    'suggestions.apply',
    'sources.manage',
  ],
  categoryScopes: null,
  preferences: { theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false },
};

export const docBrowsing: Document = {
  id: D_BROWSING,
  slug: 'browsing',
  code: 'T-01',
  title: 'איטיות גלישה / חוסר גלישה',
  description: 'נוהל דיבאג מלא – משלב מסנן ראשוני עד טיפול עמוק במסלולי מקום ספציפי / בכל מקום',
  category: 'tech',
  wave: 1,
  priority: 'hh',
  kind: 'steps',
  status: 'published',
  currentVersion: 7,
  sourceId: SRC_TECH,
  sourceRef: 'פרק 4',
  related: [{ documentId: D_INTL, why: 'מסלול מקביל · APN, ריענון SIM' }],
  createdAt: T,
  updatedAt: T,
  etag: 'e7',
  phases: [
    {
      id: 'p1',
      label: 'שלב 1 – מסנן',
      note: 'ללא מעורבות לקוח',
      steps: [
        step({
          key: 's1',
          num: '1',
          title: 'בדיקת חסימת גלישה בארץ',
          sourceRef: '§4.1',
          actions: [
            { id: 'a1', text: 'פתח CRM ↗ שדה **"גלישה בארץ"**' },
            {
              id: 'a2',
              text: 'אם **"חסום"** → כנס לאזור האישי ↗ ביצוע פעולות ↗ גלישה ותוכן → הדלק את המתג',
            },
          ],
          outcomes: [
            { kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' },
            { kind: 'alert', text: '⚑ חסום – הפעל מתג גלישה' },
          ],
        }),
        step({
          key: 's2',
          num: '2',
          title: 'בדיקת סיום חבילת גלישה',
          sourceRef: '§4.2',
          actions: [{ id: 'a1', text: 'אזור אישי ↗ **"השימושים שלי"**' }],
          branch: {
            q: 'מה מוצג?',
            options: [
              {
                kind: 'if',
                label: 'ניצל 100%',
                text: 'הסבר ללקוח שהחבילה הסתיימה. הצע חבילה חדשה ↗ "רכישת נפח מתחדש".',
              },
              { kind: 'then', label: 'חבילה פעילה', text: 'המשך לשלב 3', goto: 's3' },
            ],
          },
        }),
        step({
          key: 's3',
          num: '3',
          title: 'בדיקות במכשיר הלקוח',
          sourceRef: '§4.3',
          blockId: BLK_DEV,
          outcomes: [
            { kind: 'ok', text: '✓ הסתדר – סיום השיחה' },
            { kind: 'next', text: '→ לא הסתדר – המשך לשלב 2 (מברר)', goto: 's4' },
          ],
        }),
      ],
    },
    {
      id: 'p2',
      label: 'שלב 2 – מברר',
      steps: [
        step({
          key: 's4',
          num: '4',
          title: 'סיווג סוג התקלה',
          sourceRef: '§4.4',
          script: '"אתה לא גולש בכלל, או שהגלישה איטית?"\n"זה קורה בכל מקום או רק במקום מסוים?"',
          branch: {
            q: 'לאיזה מסלול?',
            options: [
              { kind: 'if', label: 'מקום ספציפי', text: '→ **מסלול 1** (שלב 1א)', goto: 's4a' },
              { kind: 'then', label: 'בכל מקום', text: '→ **מסלול 2** (שלב 5)', goto: 's5' },
            ],
          },
        }),
      ],
    },
    {
      id: 'r1',
      label: 'מסלול 1 – מקום ספציפי',
      route: '1',
      steps: [
        step({
          key: 's4a',
          num: '1א',
          title: 'אימות המיקום',
          description: 'בירור: מחסן / ממ"ד / חדר תת-קרקעי / חדר ספציפי?',
          sourceRef: '§4.5',
          branch: {
            q: 'סוג מיקום?',
            options: [
              { kind: 'if', label: 'מיקום נקודתי', text: 'הסבר על כיסוי רשת → סיום שיחה' },
              { kind: 'then', label: 'אחר', text: 'המשך לבדיקת אנטנות', goto: 's4b' },
            ],
          },
        }),
        step({
          key: 's4b',
          num: '1ב',
          title: 'בדיקת אנטנות בסביבה',
          sourceRef: '§4.6',
          branch: {
            q: 'מצב אנטנות?',
            options: [
              { kind: 'if', label: 'אין אנטנות', text: 'תסריט פריסת רשת → הורדת לקוח מהקו' },
              {
                kind: 'then',
                label: 'יש אנטנות',
                text: 'בדוק אם עוד לקוחות מדווחים: אם כן → פתח טופס רדיו + GNETRUCK. אם לא → מסלול 2.',
                goto: 's6',
              },
            ],
          },
        }),
      ],
    },
    {
      id: 'r2',
      label: 'מסלול 2 – בכל מקום',
      route: '2',
      steps: [
        step({
          key: 's5',
          num: '5',
          title: 'בדיקת CRM – Prepaid / הונאה',
          sourceRef: '§4.7',
          branch: {
            q: 'מצב הלקוח?',
            options: [
              {
                kind: 'if',
                label: 'נוייד Prepaid / הונאה',
                text: 'פתח פנייה ל-IT → המתן לעדכון → חזור ללקוח',
              },
              { kind: 'then', label: 'תקין', text: 'המשך לבדיקת סימון רשת', goto: 's6' },
            ],
          },
        }),
        step({
          key: 's6',
          num: '6',
          title: 'בדיקת סימון רשת',
          sourceRef: '§4.8',
          script: '"איזה סימון מופיע ליד פסי הקליטה? (H+ / 3G / LTE / 5G)"',
          branch: {
            q: 'סימון שמוצג?',
            options: [
              {
                kind: 'if',
                label: '3G / H+ בלבד',
                text: 'הנחה לשנות הגדרת רשת → **4G/5G אוטומטי**.',
              },
              { kind: 'then', label: '5G / 4G / LTE', text: 'המשך לבדיקת APN', goto: 's7' },
            ],
          },
        }),
        step({
          key: 's7',
          num: '7',
          title: 'בדיקת APN',
          sourceRef: '§4.9',
          actions: [
            { id: 'a1', text: 'ודא שה-APN מוגדר ל-**WE**' },
            { id: 'a2', text: 'אם לא מוגדר → הגדר' },
          ],
          outcomes: [
            { kind: 'ok', text: '✓ הסתדר – סיום' },
            { kind: 'next', text: '→ לא הסתדר – שלב 8', goto: 's8' },
          ],
        }),
        step({
          key: 's8',
          num: '8',
          title: 'בדיקת מהירות גלישה',
          hint: 'רק אם מדובר באיטיות',
          sourceRef: '§4.10',
          actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ **Speedtest**' }],
          branch: {
            q: 'תוצאה?',
            options: [
              { kind: 'if', label: 'מעל 6 מגה', text: 'עדכן לקוח – תקין → סיום שיחה' },
              { kind: 'then', label: 'מתחת ל-6 מגה', text: 'המשך לריענון גלישה', goto: 's9' },
            ],
          },
        }),
        step({
          key: 's9',
          num: '9',
          title: 'ריענון גלישה במערכת',
          sourceRef: '§4.11',
          actions: [
            { id: 'a1', text: 'לחץ על מתג **"גלישה בארץ"** ← כבה ← הפעל מחדש' },
            { id: 'a2', text: 'בקש מלקוח לאתחל מכשיר' },
          ],
          outcomes: [
            { kind: 'ok', text: '✓ הסתדר – סיום' },
            { kind: 'next', text: '→ לא הסתדר – איפוס הגדרות רשת', goto: 's10' },
          ],
        }),
        step({
          key: 's10',
          num: '10',
          title: 'איפוס הגדרות רשת',
          sourceRef: '§4.12',
          blockId: BLK_NET,
          deps: ['s7'],
          outcomes: [
            { kind: 'ok', text: '✓ הסתדר – סיום' },
            { kind: 'next', text: '→ לא הסתדר – ריענון SIM', goto: 's11' },
          ],
        }),
        step({
          key: 's11',
          num: '11',
          title: 'ריענון SIM',
          sourceRef: '§4.13',
          blockId: BLK_SIM,
          deps: ['s7'],
          outcomes: [
            { kind: 'ok', text: '✓ הסתדר – סיום' },
            { kind: 'next', text: '→ לא הסתדר – SIM במכשיר אחר', goto: 's12' },
          ],
        }),
        step({
          key: 's12',
          num: '12',
          title: 'SIM במכשיר אחר',
          sourceRef: '§4.14',
          branch: {
            q: 'תוצאה?',
            options: [
              {
                kind: 'if',
                label: 'עבד במכשיר אחר',
                text: 'בעיה במכשיר → הפנה למעבדה → הורד מהקו',
              },
              {
                kind: 'then',
                label: 'לא עבד',
                text: 'יתכן ה-SIM פגום → החלפת SIM / eSIM',
                goto: 's13',
              },
            ],
          },
        }),
        step({
          key: 's13',
          num: '13',
          title: 'החלפת SIM / eSIM',
          sourceRef: '§4.15',
          tone: 'alert',
          actions: [
            { id: 'a1', text: '**eSIM** – עדיפות ראשונה: בצע בדיגיטל' },
            { id: 'a2', text: '**SIM פיזי** – שלח ללקוח להום סנטר' },
          ],
          outcomes: [
            { kind: 'ok', text: '✓ הסתדר – סיום' },
            { kind: 'alert', text: '⚑ לא הסתדר – פנייה למומחי תמיכה' },
          ],
        }),
      ],
    },
  ],
};

export const docIntl: Document = {
  ...docBrowsing,
  id: D_INTL,
  slug: 'no-data-abroad',
  code: 'R-02',
  title: 'אין גלישה בחו"ל',
  description: 'בדיקות מערכת, APN, זהות רשת, ריענון SIM, איפוס רשת',
  category: 'intl',
  wave: 1,
  currentVersion: 4,
  sourceId: SRC_INTL,
  related: [],
  etag: 'i4',
};

export const blocks: Block[] = [
  {
    id: BLK_SIM,
    slug: 'sim-refresh',
    title: 'ריענון SIM',
    kind: 'step',
    actions: [
      { id: 'b1', text: 'CRM ← מצב עריכה על המספר ← sim block lbl ← שמור' },
      { id: 'b2', text: 'שוב עריכה ← sim allow lbl ← שמור' },
      { id: 'b3', text: 'בקש מהלקוח לאתחל מכשיר' },
    ],
    outcomes: [
      { kind: 'ok', text: '✓ הסתדר – סיום' },
      { kind: 'next', text: '→ לא הסתדר – המשך' },
    ],
    currentVersion: 2,
    updatedAt: T,
  },
  {
    id: BLK_DEV,
    slug: 'device-checks',
    title: 'בדיקות במכשיר הלקוח',
    kind: 'step',
    description: 'עבור עם הלקוח על ההגדרות הבאות:',
    actions: [
      { id: 'b1', text: '**נתונים סלולריים** – אם כבוי → להדליק' },
      { id: 'b2', text: '**Wi-Fi** – אם דולק → לכבות' },
      { id: 'b3', text: '**נקודת גישה אישית** – אם דולקת → לכבות' },
    ],
    outcomes: [
      { kind: 'ok', text: '✓ הסתדר – סיום השיחה' },
      { kind: 'next', text: '→ לא הסתדר – המשך' },
    ],
    currentVersion: 1,
    updatedAt: T,
  },
  {
    id: BLK_NET,
    slug: 'network-reset',
    title: 'איפוס הגדרות רשת',
    kind: 'step',
    actions: [
      { id: 'b1', text: 'הנחה לקוח לבצע **איפוס הגדרות רשת** במכשיר' },
      { id: 'b2', text: 'הגדר APN מחדש לאחר האיפוס' },
    ],
    outcomes: [
      { kind: 'ok', text: '✓ הסתדר – סיום' },
      { kind: 'next', text: '→ לא הסתדר – המשך' },
    ],
    currentVersion: 1,
    updatedAt: T,
  },
  {
    id: BLK_SCRIPT,
    slug: 'opening-empathy',
    title: 'פתיחת שיחה – אמפתיה',
    kind: 'script',
    script: 'אני מבינה את ההרגשה, ומתנצלת על החוויה עד עכשיו. אעשה עבורך סדר וסגירה מקצה לקצה כבר בשיחה הזו.',
    actions: [],
    outcomes: [],
    currentVersion: 3,
    updatedAt: T,
  },
];

export const fields: CrmField[] = [
  { name: 'גלישה בארץ', status: 'ok', path: 'CRM ↗ פרטי קו', updatedAt: T },
  { name: 'השימושים שלי', status: 'ok', path: 'אזור אישי', updatedAt: T },
  { name: 'sim block lbl', status: 'ok', path: 'CRM ↗ מצב עריכה', updatedAt: T },
  { name: 'sim allow lbl', status: 'ok', path: 'CRM ↗ מצב עריכה', updatedAt: T },
  { name: 'APN', status: 'ok', path: 'מכשיר ↗ שמות נקודות גישה', updatedAt: T },
  {
    name: 'שירות נדידה',
    status: 'renamed',
    renamedTo: 'שירותי נדידה',
    path: 'CRM ↗ שירותים',
    updatedAt: T,
  },
  { name: 'נדידת נתונים', status: 'ok', path: 'מכשיר ↗ רשת סלולרית', updatedAt: T },
  { name: 'חסימת גלישה בחו"ל', status: 'new', path: 'CRM ↗ שירותים', updatedAt: T },
];

export const cards: DocumentCard[] = [
  {
    id: D_BROWSING,
    slug: 'browsing',
    title: docBrowsing.title,
    description: docBrowsing.description,
    category: 'tech',
    wave: 1,
    priority: 'hh',
    kind: 'steps',
    status: 'published',
    currentVersion: 7,
    updatedAt: T,
    stepCount: 15,
    linksOut: 3,
    linksIn: 1,
    views: 212,
    crmFields: ['גלישה בארץ', 'השימושים שלי', 'sim block lbl', 'sim allow lbl', 'APN'],
    hasSharedBlocks: true,
    pinned: true,
    authorName: 'ענבר ל.',
  },
  {
    id: D_INTL,
    slug: 'no-data-abroad',
    title: docIntl.title,
    description: docIntl.description,
    category: 'intl',
    wave: 1,
    priority: 'h',
    kind: 'steps',
    status: 'published',
    currentVersion: 4,
    updatedAt: T,
    stepCount: 8,
    linksOut: 4,
    linksIn: 2,
    views: 0,
    crmFields: ['APN'],
    hasSharedBlocks: false,
    pinned: false,
    authorName: 'אלון ר.',
  },
  {
    id: D_CHURN,
    slug: 'churn-debug',
    title: 'דיבאג נטישה',
    description: 'זיהוי לקוח המאותת נטישה, פתיחת שיחה נכונה, שלוש סיבות העזיבה',
    category: 'ops',
    wave: 1,
    priority: 'hh',
    kind: 'retention',
    status: 'published',
    currentVersion: 4,
    updatedAt: T,
    stepCount: 6,
    linksOut: 2,
    linksIn: 0,
    views: 88,
    crmFields: [],
    hasSharedBlocks: false,
    pinned: false,
    authorName: 'דנה ר.',
  },
  {
    id: 'aaaaaaaa-1111-4111-8111-000000000004',
    slug: 'esim-activation',
    title: 'הפעלת eSIM – קוד QR',
    description: 'דרישות מקדימות, שליחת QR, סריקה, טעויות נפוצות, אימות',
    category: 'sim',
    wave: 1,
    priority: 'hh',
    kind: 'steps',
    status: 'published',
    currentVersion: 3,
    updatedAt: T,
    stepCount: 7,
    linksOut: 1,
    linksIn: 1,
    views: 41,
    crmFields: ['סוג SIM'],
    hasSharedBlocks: false,
    pinned: false,
  },
  {
    id: 'aaaaaaaa-1111-4111-8111-000000000005',
    slug: 'high-bill',
    title: 'בירור חיוב גבוה / לא מזוהה',
    description: 'פירוק חיוב, השוואה לחודשים, שירותים נלווים',
    category: 'billing',
    wave: 2,
    priority: 'h',
    kind: 'steps',
    status: 'partial',
    currentVersion: 2,
    updatedAt: T,
    stepCount: 4,
    linksOut: 0,
    linksIn: 0,
    views: 12,
    crmFields: [],
    hasSharedBlocks: false,
    pinned: false,
  },
  {
    id: 'aaaaaaaa-1111-4111-8111-000000000006',
    slug: 'freeze-line',
    title: 'הקפאת קו זמנית',
    description: 'תנאי הקפאה, משך, עלות, חזרה לפעילות',
    category: 'plans',
    wave: 3,
    priority: 'l',
    kind: 'steps',
    status: 'draft',
    currentVersion: 0,
    updatedAt: T,
    stepCount: 2,
    linksOut: 0,
    linksIn: 0,
    views: 0,
    crmFields: [],
    hasSharedBlocks: false,
    pinned: false,
  },
  {
    id: 'aaaaaaaa-1111-4111-8111-000000000007',
    slug: 'roaming-package',
    title: 'רכישת חבילת חו"ל לפני טיסה',
    description: 'התאמת חבילה, מדינות, נפח, מועד הפעלה',
    category: 'intl',
    wave: 2,
    priority: 'm',
    kind: 'steps',
    status: 'published',
    currentVersion: 1,
    updatedAt: T,
    stepCount: 5,
    linksOut: 1,
    linksIn: 1,
    views: 9,
    crmFields: ['חבילת חו"ל'],
    hasSharedBlocks: false,
    pinned: false,
  },
  {
    id: 'aaaaaaaa-1111-4111-8111-000000000008',
    slug: 'customer-identification',
    title: 'זיהוי ואימות לקוח',
    description: 'פרטים נדרשים לכל פעולה, אימות מוגבר, ניסוח',
    category: 'ops',
    wave: 1,
    priority: 'h',
    kind: 'steps',
    status: 'published',
    currentVersion: 6,
    updatedAt: T,
    stepCount: 3,
    linksOut: 0,
    linksIn: 5,
    views: 130,
    crmFields: ['סטטוס קו'],
    hasSharedBlocks: false,
    pinned: false,
  },
];

export const scripts: Script[] = [
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
    title: 'סיווג תקלת גלישה',
    text: '"אתה לא גולש בכלל, או שהגלישה איטית?" · "זה קורה בכל מקום או רק במקום מסוים?"',
    tags: ['tech'],
    updatedAt: T,
  },
  {
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
    title: 'סימון רשת',
    text: '"איזה סימון מופיע ליד פסי הקליטה? (H+ / 3G / LTE / 5G)"',
    tags: ['tech'],
    updatedAt: T,
  },
];

export const notes: Note[] = [
  {
    id: NOTE_1,
    documentId: D_BROWSING,
    stepKey: 's8',
    authorId: U2,
    authorName: 'דנה ר.',
    text: 'שלב 8: Speedtest חוסם ב-Wi-Fi של הלקוח — לבקש לכבות לפני.',
    likes: 4,
    likedByMe: false,
    createdAt: T,
  },
];

export const versions: Version[] = [5, 6, 7].map((v) => ({
  documentId: D_BROWSING,
  version: v,
  kind: 'published' as const,
  label: ['מיזוג "ריענון SIM" לבלוק משותף', 'שינוי סף Speedtest 5→6 מגה', 'הוספת שלב 13 · החלפת SIM/eSIM'][
    v - 5
  ],
  authorId: U1,
  authorName: v === 6 ? 'אלון ר.' : 'ענבר ל.',
  createdAt: T,
}));

export const sources: Source[] = [
  {
    id: SRC_TECH,
    kind: 'docx',
    connectorId: null,
    externalId: null,
    title: 'נהלי תמיכה טכנית',
    ext: '.docx',
    syncState: 'pending',
    lastHash: 'h41',
    lastSyncedAt: T,
    linkedDocuments: 7,
    pendingSuggestions: 3,
    updatedAt: T,
  },
  {
    id: SRC_INTL,
    kind: 'docx',
    connectorId: null,
    externalId: null,
    title: 'חו"ל ונדידה – מדריך מלא',
    ext: '.docx',
    syncState: 'synced',
    lastHash: 'h12',
    lastSyncedAt: T,
    linkedDocuments: 14,
    pendingSuggestions: 0,
    updatedAt: T,
  },
];

export const revision: SourceRevision = {
  id: REV_1,
  sourceId: SRC_TECH,
  hash: 'h41',
  accepted: false,
  importedAt: T,
  importedBy: null,
  paragraphs: [
    {
      ref: '4.8',
      heading: 'בדיקת מהירות גלישה.',
      runs: [
        { t: 'בקש מהלקוח להריץ ' },
        { t: 'Speedtest', code: true },
        { t: '. ' },
        { t: 'מעל 5 מגה', del: true },
        { t: ' ' },
        { t: 'מעל 6 מגה', add: true },
        { t: ' – עדכן לקוח שהקו תקין וסיים שיחה. ' },
        { t: 'יש לוודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.', add: true },
      ],
    },
    {
      ref: '4.1',
      heading: 'בדיקת חסימת גלישה בארץ.',
      runs: [{ t: 'פתח CRM ↗ שדה גלישה בארץ. אם "חסום" → הדלק את המתג.' }],
    },
  ],
};

export const suggestions: Suggestion[] = [
  {
    id: SUG_1,
    sourceRevisionId: REV_1,
    anchor: '§4.8',
    type: 'update-step',
    title: 'סף Speedtest 5 → 6 מגה + ניתוק Wi-Fi',
    targetDocumentId: D_BROWSING,
    targetStepKey: 's8',
    targetBlockId: null,
    payload: {
      type: 'update-step',
      addActions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה'],
      patch: {},
    },
    editedPayload: null,
    confidence: 0.96,
    rationale: 'ערך מספרי שונה בפסקה 4.8',
    status: 'pending',
    createdAt: T,
  },
];

export const trash: TrashItem[] = [
  {
    type: 'document',
    id: D_CHURN,
    title: 'Hotspot לא עובד',
    meta: 'תמיכה טכנית · topics.json#19 · v2 · 4 שלבים',
    deletedBy: 'אלון ר.',
    deletedAt: T,
    purgeAt: new Date(Date.now() + 12 * 864e5).toISOString(),
    impact: { brokenLinks: 2, documents: [{ id: D_BROWSING, title: docBrowsing.title }] },
  },
];

export const roles: Role[] = [
  {
    id: ROLE_LEAD,
    name: 'lead',
    description: 'מנהלת צוות · פרסום ומחיקה',
    system: true,
    permissions: me.permissions,
  },
  {
    id: ROLE_ADMIN,
    name: 'admin',
    description: 'מנהל מערכת',
    system: true,
    permissions: [...PERMISSIONS],
  },
];

// `GET /admin/users` now answers `AdminUserRowSchema` rows (stage 5) — see `test/msw/stage5.ts`,
// which owns that fixture so the row shape lives next to the handler that serves it.

export const groupsMap: GroupMap[] = [{ idpGroupId: 'g-leads', idpGroupName: 'KB-Leads', roleId: ROLE_LEAD }];

export const sessions: Session[] = [
  {
    id: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
    userId: U1,
    ip: '10.0.0.7',
    userAgent: 'Chrome/128',
    createdAt: T,
    lastSeenAt: T,
    expiresAt: T,
    revokedAt: null,
  },
];

export const audit: AuditEntry[] = [
  {
    id: 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1',
    actorId: U1,
    actorName: 'ענבר ל.',
    action: 'docs.publish',
    entityType: 'document',
    entityId: D_BROWSING,
    before: { currentVersion: 6 },
    after: { currentVersion: 7 },
    ip: '10.0.0.7',
    requestId: 'req-1',
    at: T,
  },
];

/** `GET /admin/system` — the operator diagnostic view (AdminSystemSchema). */
export const system = {
  db: true,
  model: false,
  modelName: 'qwen2.5:3b-instruct-q4_K_M',
  queue: 0,
  queues: { 'connector.run': 0, 'source.process': 0 },
  backup: { ok: true, latestFile: 'kb-2026-09-12.dump', ageHours: 8 },
  connectors: [
    {
      id: '55555555-5555-4555-8555-55555555c001',
      name: 'wecom-wordpress',
      type: 'wordpress',
      enabled: true,
      lastStatus: 'ok',
      lastRunAt: T,
      conflicts: 0,
    },
  ],
  sources: { pending: 1, error: 0 },
  suggestions: { pending: 1 },
  version: '0.1.0',
  uptimeSec: 600,
};

export const health = {
  ok: true,
  db: true,
  model: false,
  queue: 0,
  version: '0.1.0',
  uptimeSec: 10,
};

export const fx = {
  me,
  docBrowsing,
  docIntl,
  cards,
  blocks,
  fields,
  scripts,
  notes,
  versions,
  sources,
  revision,
  suggestions,
  trash,
  roles,
  groupsMap,
  sessions,
  audit,
  health,
  system,
};

export type Fixtures = typeof fx;
export type { User };
