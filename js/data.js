/* wecom KB — seed data
   Everything the app knows out of the box lives here (plus js/data-docs.js for the
   21 converted PDF items). User changes are layered on top from localStorage. */
window.KB = window.KB || {};
KB.SEED_VERSION = 30;           // bump when seed content changes so stale saved copies get reconciled
KB.SEED = { docs: [] };

KB.USER = { name: 'ענבר ל.', initial: 'ע', role: 'עורכת · הרשאת פרסום', canPublish: true };

KB.CATS = {
  sim:     { label: 'SIM / eSIM',    short: 'SIM',   icon: '📶', color: '#2E5CE0' },
  tech:    { label: 'תמיכה טכנית',   short: 'טכני',  icon: '🔧', color: '#3A4A5C' },
  billing: { label: 'חיובים',        short: 'חיובים', icon: '💳', color: '#0E7A4F' },
  plans:   { label: 'מסלולים',       short: 'מסלולים', icon: '📋', color: '#6D3FD1' },
  intl:    { label: 'חו"ל ונדידה',   short: 'חו"ל',  icon: '✈️', color: '#0891B2' },
  ops:     { label: 'טיפול בשיחה',   short: 'שיחה',  icon: '🎧', color: '#C2410C' }
};
KB.PRI = {
  hh: { label: 'שכיח מאוד', cls: 'chip-red' },
  h:  { label: 'שכיח',      cls: 'chip-amber' },
  m:  { label: 'בינוני',    cls: 'chip-gray' },
  l:  { label: 'נמוך',      cls: 'chip-gray' }
};
KB.WAVES = { 1: 'גל 1 · הכי שכיח', 2: 'גל 2', 3: 'גל 3 · משלים' };

KB.SOURCES = [
  { id: 'topics',  file: 'topics.json',       kind: 'docs',    cats: ['sim', 'tech', 'billing', 'plans', 'ops'] },
  { id: 'intl',    file: 'intl-roaming.json', kind: 'docs',    cats: ['intl'] },
  { id: 'crm',     file: 'crm-fields.json',   kind: 'fields' },
  { id: 'scripts', file: 'scripts.json',      kind: 'scripts' }
];

/* CRM fields referenced from procedures. `status` drives the "3 שינויים" state:
   renamed / new fields need a review of the documents that mention them. */
KB.CRM_FIELDS = [
  { name: 'גלישה בארץ',     status: 'ok',      updated: '2025-06-10', path: 'CRM ↗ פרטי קו' },
  { name: 'השימושים שלי',   status: 'ok',      updated: '2025-05-28', path: 'אזור אישי' },
  { name: 'sim block lbl',  status: 'ok',      updated: '2025-06-10', path: 'CRM ↗ מצב עריכה' },
  { name: 'sim allow lbl',  status: 'ok',      updated: '2025-06-11', path: 'CRM ↗ מצב עריכה' },
  { name: 'APN',            status: 'ok',      updated: '2025-04-02', path: 'מכשיר ↗ שמות נקודות גישה' },
  { name: 'שירות נדידה',    status: 'renamed', renamedTo: 'שירותי נדידה', updated: '2025-06-11', path: 'CRM ↗ שירותים' },
  { name: 'נדידת נתונים',   status: 'ok',      updated: '2025-05-15', path: 'מכשיר ↗ רשת סלולרית' },
  { name: 'סוג SIM',        status: 'ok',      updated: '2025-03-20', path: 'CRM ↗ פרטי קו' },
  { name: 'חבילת חו"ל',     status: 'ok',      updated: '2025-05-15', path: 'CRM ↗ חבילות' },
  { name: 'VoLTE',          status: 'ok',      updated: '2025-02-11', path: 'CRM ↗ שירותים' },
  { name: 'Wi-Fi Calling',  status: 'ok',      updated: '2025-02-11', path: 'CRM ↗ שירותים' },
  { name: 'חסימת גלישה בחו"ל', status: 'new',  updated: '2025-06-12', path: 'CRM ↗ שירותים' },
  { name: 'סטטוס קו',       status: 'ok',      updated: '2025-01-30', path: 'CRM ↗ פרטי קו' },
  { name: 'ריענון SIM',     status: 'new',     updated: '2025-06-12', path: 'CRM ↗ פעולות (כפתור חדש)' }
];

/* Shared blocks: one source of truth, embedded by several steps (step.block = id). */
KB.BLOCKS = [
  { id: 'sim-refresh', title: 'ריענון SIM', kind: 'step',
    actions: [
      { id: 'b1', text: 'CRM ← מצב עריכה על המספר ← sim block lbl ← שמור' },
      { id: 'b2', text: 'שוב עריכה ← sim allow lbl ← שמור' },
      { id: 'b3', text: 'בקש מהלקוח לאתחל מכשיר' }
    ],
    outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – המשך' }],
    version: 2, updated: '2025-06-12', author: 'ענבר ל.' },
  { id: 'device-checks', title: 'בדיקות במכשיר הלקוח', kind: 'step',
    desc: 'עבור עם הלקוח על ההגדרות הבאות:',
    actions: [
      { id: 'b1', text: '**נתונים סלולריים** – אם כבוי → להדליק' },
      { id: 'b2', text: '**Wi-Fi** – אם דולק → לכבות' },
      { id: 'b3', text: '**נקודת גישה אישית** – אם דולקת → לכבות' },
      { id: 'b4', text: '**הגבלת צריכה / חוסך נתונים** – אם פעיל → לכבות' },
      { id: 'b5', text: '**VPN** – אם דולק → לכבות' },
      { id: 'b6', text: '**אפליקציות סינון** – אם קיימות → להסיר' },
      { id: 'b7', text: '**קו מנוהל** (מעסיק/חברה) → להפנות לחברה המנהלת' }
    ],
    outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום השיחה' }, { kind: 'next', text: '→ לא הסתדר – המשך' }],
    version: 1, updated: '2025-05-20', author: 'ענבר ל.' },
  { id: 'network-reset', title: 'איפוס הגדרות רשת', kind: 'step',
    actions: [
      { id: 'b1', text: 'הנחה לקוח לבצע **איפוס הגדרות רשת** במכשיר' },
      { id: 'b2', text: 'הגדר APN מחדש לאחר האיפוס' }
    ],
    outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – המשך' }],
    version: 1, updated: '2025-05-02', author: 'אלון ר.' },
  { id: 'opening-empathy', title: 'פתיחת שיחה – אמפתיה', kind: 'script',
    script: 'אני מבינה את ההרגשה, ומתנצלת על החוויה עד עכשיו. עברתי על הרישומים במערכת — אני כאן איתך ודואגת שתקבל טיפול מלא לשביעות רצונך. אעשה עבורך סדר וסגירה מקצה לקצה כבר בשיחה הזו.',
    version: 3, updated: '2025-06-01', author: 'דנה ר.' }
];

/* Conversation scripts (scripts.json) — searchable from the palette and insertable in the editor. */
KB.SCRIPTS = [
  { id: 'sc-classify',   title: 'סיווג תקלת גלישה',          text: '"אתה לא גולש בכלל, או שהגלישה איטית?" · "זה קורה בכל מקום או רק במקום מסוים?"', usedIn: ['browsing'] },
  { id: 'sc-netmark',    title: 'סימון רשת',                  text: '"איזה סימון מופיע ליד פסי הקליטה? (H+ / 3G / LTE / 5G)"', usedIn: ['browsing'] },
  { id: 'sc-empathy',    title: 'פתיחה – אמפתיה + בעלות',      text: 'אני מבינה לגמרי את התחושה ומתנצלת על כך. אני רואה שבשיחות הקודמות כבר ניסו לסייע, אז חשוב לי שהפעם אנחנו באמת סוגרים את זה.', usedIn: ['churn'] },
  { id: 'sc-price',      title: 'יתרונות wecom – מחיר',        text: 'אנחנו גם אטרקטיביים במחיר, גם עם שירות אנושי זמין ופריסה טכנית מתקדמת (5G, פתרונות ביתיים), וגם שקופים וחדשניים.', usedIn: ['churn'] },
  { id: 'sc-callback',   title: 'סגירה – חוזרת אליך',          text: 'קבענו: אני עושה בדיקה / התאמה, חוזרת אליך עד ___ ב___. אם משהו מתעכב – אני יוצרת קשר.', usedIn: ['churn'] },
  { id: 'sc-travel',     title: 'תיאום ציפיות – קליטה בנסיעה', text: 'ברשת סלולרית בזמן נסיעה יש מעבר בין אנטנות, זה טבעי ולא מצביע על תקלה נקודתית.', usedIn: ['pdf_002'] },
  { id: 'sc-coverage',   title: 'תיאום ציפיות – כיסוי',        text: 'רמת הקליטה מושפעת מגורמים סביבתיים — בנייה גבוהה, מבנים ממוגנים, זכוכית אנטי-סאן, מרתפים.', usedIn: ['pdf_002'] }
];

/* Library cards. docId links a card to a written procedure; cards without one are placeholders. */
KB.TOPICS = [
  { id: 1,  cat: 'sim', wave: 1, pri: 'hh', title: 'הפעלת SIM פיזי חדש', desc: 'שלבי הפעלה, זיהוי לקוח, בדיקת סטטוס קו, מה לומר ללקוח' },
  { id: 2,  cat: 'sim', wave: 1, pri: 'hh', title: 'הפעלת eSIM – קוד QR', desc: 'דרישות מקדימות, שליחת QR, סריקה, טעויות נפוצות, אימות' },
  { id: 3,  cat: 'sim', wave: 1, pri: 'h',  title: 'מעבר SIM פיזי ↔ eSIM', desc: 'בדיקת תאימות, ביטול פרופיל ישן, הפקה מחדש' },
  { id: 4,  cat: 'sim', wave: 1, pri: 'h',  title: 'תקלה אחרי הפעלת SIM/eSIM', desc: 'אבחון, רענון קו, APN, הסלמה' },
  { id: 5,  cat: 'sim', wave: 1, pri: 'h',  title: 'QR לא נסרק / קוד לא התקבל', desc: 'סיבות, שליחה מחדש, בדיקת מצלמה, חלופות' },
  { id: 6,  cat: 'sim', wave: 2, pri: 'm',  title: 'החלפת SIM אבוד/גנוב', desc: 'חסימה מיידית, אימות מוגבר, הנפקה חדשה' },
  { id: 7,  cat: 'sim', wave: 2, pri: 'm',  title: 'בירור סטטוס משלוח SIM', desc: 'בדיקת הזמנה, שליח, נקודת איסוף' },
  { id: 8,  cat: 'sim', wave: 2, pri: 'm',  title: 'איסוף SIM מהום סנטר', desc: 'תנאי איסוף, מה לקוח צריך להביא' },
  { id: 9,  cat: 'sim', wave: 2, pri: 'm',  title: 'תאימות מכשיר – VoLTE/eSIM/5G', desc: 'בדיקת דגם, גרסת מערכת, הסבר מגבלות' },
  { id: 10, cat: 'sim', wave: 2, pri: 'm',  title: 'קווים שנרכשו ולא הופעלו', desc: 'בדיקת סטטוס, הדרכת הפעלה, סגירת טיפול' },
  { id: 11, cat: 'tech', wave: 1, pri: 'hh', title: 'איטיות גלישה / חוסר גלישה', desc: 'נוהל דיבאג מלא – מסנן ראשוני, מברר, מסלולי מקום ספציפי / בכל מקום', docId: 'browsing' },
  { id: 12, cat: 'tech', wave: 1, pri: 'h',  title: 'גלישה איטית / ניתוקים', desc: 'אזור, דור רשת, עומס, מכשיר, שיפור', docId: 'pdf_001' },
  { id: 13, cat: 'intl', wave: 1, pri: 'h',  title: 'הגדרת APN במכשיר', desc: 'בחו"ל: ערך APN נדרש, איפוס לברירת מחדל, לפי יצרן', docId: 'pdf_018' },
  { id: 14, cat: 'tech', wave: 1, pri: 'h',  title: 'אין קליטה / אין שירות', desc: 'רשת, SIM, מצב טיסה, אזור גיאוגרפי, איפוס', docId: 'pdf_002' },
  { id: 15, cat: 'tech', wave: 1, pri: 'h',  title: 'לא מצליח להוציא/לקבל שיחות', desc: 'חסימות, חוב, VoLTE, קליטה, מצב קו', docId: 'pdf_007' },
  { id: 16, cat: 'tech', wave: 2, pri: 'm',  title: 'שיחות מתנתקות / שמע ירוד', desc: 'אזור, מכשיר, VoLTE, קליטה, SIM', docId: 'pdf_008' },
  { id: 17, cat: 'tech', wave: 2, pri: 'm',  title: 'בעיות VoLTE ומכשירים ישנים', desc: 'זיהוי חוסר תמיכה, חלופות, הסבר', docId: 'pdf_003' },
  { id: 18, cat: 'tech', wave: 2, pri: 'm',  title: 'בעיות SMS וקודי אימות', desc: 'קבלת SMS, חסימות, קודי בנקים, איפוס', docId: 'pdf_009' },
  { id: 19, cat: 'tech', wave: 2, pri: 'm',  title: 'Hotspot לא עובד', desc: 'תמיכה בחבילה, APN, הגדרות שיתוף' },
  { id: 20, cat: 'tech', wave: 1, pri: 'h',  title: 'טרבלשוטינג בסיסי: כיבוי ואיפוס', desc: 'סדר פעולות אחיד, הסבר ללקוח, מתי להסלים', docId: 'pdf_005' },
  { id: 21, cat: 'billing', wave: 1, pri: 'hh', title: 'בירור חיוב גבוה / לא מזוהה', desc: 'פירוק חיוב, השוואה לחודשים, שירותים נלווים' },
  { id: 22, cat: 'billing', wave: 1, pri: 'hh', title: 'הסבר חשבונית וסעיפי חיוב', desc: 'מבנה חשבונית, קבועים/משתנים, זיכויים, מע"מ' },
  { id: 23, cat: 'billing', wave: 1, pri: 'h',  title: 'תשלום חוב / חסימת קו', desc: 'בדיקת יתרה, אפשרויות תשלום, הסרת חסימה' },
  { id: 24, cat: 'billing', wave: 1, pri: 'h',  title: 'עדכון אמצעי תשלום / אשראי', desc: 'אימות לקוח, עדכון כרטיס, פג תוקף, הוראת קבע' },
  { id: 25, cat: 'billing', wave: 2, pri: 'm',  title: 'זיכויים והחזרים', desc: 'בדיקת זכאות, SLA, עדכון לקוח, הסלמה' },
  { id: 26, cat: 'billing', wave: 2, pri: 'm',  title: 'שליחת חשבונית / אישור תשלום', desc: 'סוגי מסמכים, אימות, זמני שליחה' },
  { id: 27, cat: 'plans', wave: 1, pri: 'h',  title: 'שינוי מסלול / הוזלת חבילה', desc: 'מסלול נוכחי, הצעות זמינות, השפעה על התחייבויות' },
  { id: 28, cat: 'plans', wave: 1, pri: 'h',  title: 'צירוף קו / שדרוג 5G', desc: 'תנאי הצטרפות, בדיקת מכשיר, עלויות, הפעלה' },
  { id: 29, cat: 'plans', wave: 1, pri: 'h',  title: 'ניתוק / ביטול קו', desc: 'אימות, סיבת ניתוק, שימור, מועד, אישור' },
  { id: 30, cat: 'plans', wave: 3, pri: 'l',  title: 'הקפאת קו זמנית', desc: 'תנאי הקפאה, משך, עלות, חזרה לפעילות' },
  { id: 31, cat: 'plans', wave: 2, pri: 'm',  title: 'העברת בעלות על קו', desc: 'מסמכים, אימות שני צדדים, השפעה על חיובים' },
  { id: 32, cat: 'plans', wave: 1, pri: 'h',  title: 'עדכון פרטי לקוח', desc: 'כתובת, מייל, טלפון, פרטי חיוב, אימות' },
  { id: 33, cat: 'plans', wave: 2, pri: 'm',  title: 'ניוד מספרים', desc: 'שלבי ניוד, סטטוס, זמני השלמה, תקלות' },
  { id: 34, cat: 'intl', wave: 1, pri: 'm',  title: 'רכישת חבילת חו"ל לפני טיסה', desc: 'התאמת חבילה, מדינות, נפח, מועד הפעלה' },
  { id: 35, cat: 'intl', wave: 2, pri: 'm',  title: 'תקלת גלישה/קליטה בחו"ל', desc: 'Roaming, בחירת רשת ידנית, APN', docId: 'pdf_010' },
  { id: 36, cat: 'intl', wave: 2, pri: 'm',  title: 'בירור תעריפי חו"ל / חיוב אחרי חזרה', desc: 'הסבר תעריפים, חריגה, טיפול' },
  { id: 42, cat: 'intl', wave: 1, pri: 'hh', title: 'אבחון מרכזי לתקלות ושירות בחו"ל', desc: 'זיהוי תקלה ראשוני, הפניה למסלול הנכון: קליטה, גלישה, שיחות, הודעות', docId: 'pdf_011' },
  { id: 43, cat: 'intl', wave: 1, pri: 'hh', title: 'אין קליטה / רישום לרשת בחו"ל', desc: 'שירות נדידה, נדידת נתונים, בחירת רשת ידנית, ארה"ב', docId: 'pdf_012' },
  { id: 44, cat: 'intl', wave: 1, pri: 'h',  title: 'אין גלישה בחו"ל', desc: 'בדיקות מערכת, APN, זהות רשת, ריענון SIM, איפוס רשת', docId: 'pdf_013' },
  { id: 45, cat: 'intl', wave: 2, pri: 'm',  title: 'תקלה באפליקציה מסוימת בחו"ל', desc: 'הרשאות נתונים, חוסך נתונים, הפניה לספק האפליקציה', docId: 'pdf_014' },
  { id: 46, cat: 'intl', wave: 2, pri: 'h',  title: 'תקלות שיחות בחו"ל', desc: 'שיחות יוצאות/נכנסות, קידומת חיוג, רשת מארחת, VoLTE', docId: 'pdf_015' },
  { id: 47, cat: 'intl', wave: 2, pri: 'h',  title: 'תקלות הודעות בחו"ל', desc: 'שליחה/קבלה, קוד אימות, רשת מארחת, זהות רשת', docId: 'pdf_016' },
  { id: 48, cat: 'intl', wave: 2, pri: 'm',  title: 'הפעלת נדידת נתונים במכשיר', desc: 'לפי יצרן: iPhone, Samsung, שיאומי, וואווי, פיקסל ועוד', docId: 'pdf_017' },
  { id: 50, cat: 'intl', wave: 3, pri: 'l',  title: 'תפעול STK ושינוי זהות רשת בחו"ל', desc: 'מתי לבצע שינוי זהות פרטנר, מתי להימנע', docId: 'pdf_019' },
  { id: 51, cat: 'intl', wave: 2, pri: 'm',  title: 'בחירת רשת ידנית בחו"ל', desc: 'חיבור ידני למפעיל מאושר, לפי יצרן, ארה"ב בנפרד', docId: 'pdf_020' },
  { id: 52, cat: 'intl', wave: 2, pri: 'h',  title: 'העברה למומחה בתקלת חו"ל', desc: 'מתי להעביר, מה לתעד לפני ההעברה', docId: 'pdf_021' },
  { id: 53, cat: 'intl', wave: 2, pri: 'm',  title: 'לקוח לא מוצא רשת בחו"ל', desc: 'בחירת רשת ידנית, מצב טיסה, נדידה – מדריך קצר', docId: 'pdf_004' },
  { id: 37, cat: 'ops', wave: 1, pri: 'h',  title: 'זיהוי ואימות לקוח', desc: 'פרטים נדרשים לכל פעולה, אימות מוגבר, ניסוח' },
  { id: 38, cat: 'ops', wave: 2, pri: 'm',  title: 'ניתוב והעברת שיחה', desc: 'מתי להעביר, מה לתעד, מניעת העברה חוזרת' },
  { id: 39, cat: 'ops', wave: 2, pri: 'm',  title: 'תיאום Callback / מעקב', desc: 'מתי לפתוח, SLA, עדכון לקוח, סגירת מעגל' },
  { id: 40, cat: 'ops', wave: 3, pri: 'm',  title: 'תלונות, הסלמות, קושי תקשורתי', desc: 'לקוח מתוסכל, בקשת מנהל, מחסום שפה', docId: 'pdf_006' },
  { id: 41, cat: 'ops', wave: 1, pri: 'hh', title: 'דיבאג נטישה', desc: 'זיהוי לקוח מאותת נטישה, 3 מסלולי טיפול, תסריטי שיחה והתנגדויות', docId: 'churn' }
];

/* ─── Built-in document 1: איטיות גלישה / חוסר גלישה ─────────────────────── */
KB.SEED.docs.push({
  id: 'browsing', topicId: 11, code: 'T-01',
  title: 'איטיות גלישה / חוסר גלישה',
  desc: 'נוהל דיבאג מלא – משלב מסנן ראשוני עד טיפול עמוק במסלולי מקום ספציפי / בכל מקום',
  cat: 'tech', wave: 1, pri: 'hh', src: 'topics',
  version: 7, updated: '2025-06-12', author: 'ענבר ל.', status: 'published', kind: 'steps',
  sourceDoc: { id: 'tech-procedures', ref: 'פרק 4' },
  related: [{ docId: 'pdf_003', why: 'מוזכר בשלב 13 · משתף 2 שדות' }, { docId: 'pdf_002', why: '4 שלבים זהים (ריענון SIM)' }, { docId: 'pdf_013', why: 'מסלול מקביל · APN, ריענון SIM' }],
  phases: [
    { id: 'p1', label: 'שלב 1 – מסנן', note: 'ללא מעורבות לקוח', steps: [
      { id: 's1', num: '1', title: 'בדיקת חסימת גלישה בארץ', source: '§4.1',
        actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה **"גלישה בארץ"**' }, { id: 'a2', text: 'אם **"חסום"** → כנס לאזור האישי ↗ ביצוע פעולות ↗ גלישה ותוכן → הדלק את המתג' }],
        outcomes: [{ kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' }, { kind: 'alert', text: '⚑ חסום – הפעל מתג גלישה' }] },
      { id: 's2', num: '2', title: 'בדיקת סיום חבילת גלישה', source: '§4.2',
        actions: [{ id: 'a1', text: 'אזור אישי ↗ **"השימושים שלי"**' }],
        branch: { q: 'מה מוצג?', options: [
          { kind: 'if', label: 'ניצל 100%', text: 'הסבר ללקוח שהחבילה הסתיימה. הצע חבילה חדשה ↗ "רכישת נפח מתחדש". אם ירצה להפסיק חידוש חודשי – לעלות לקו.' },
          { kind: 'then', label: 'חבילה פעילה', text: 'המשך לשלב 3', goto: 's3' } ] } },
      { id: 's3', num: '3', title: 'בדיקות במכשיר הלקוח', source: '§4.3', block: 'device-checks',
        outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום השיחה' }, { kind: 'next', text: '→ לא הסתדר – המשך לשלב 2 (מברר)', goto: 's4' }] }
    ] },
    { id: 'p2', label: 'שלב 2 – מברר', steps: [
      { id: 's4', num: '4', title: 'סיווג סוג התקלה', source: '§4.4', script: '"אתה לא גולש בכלל, או שהגלישה איטית?"\n"זה קורה בכל מקום או רק במקום מסוים?"',
        branch: { q: 'לאיזה מסלול?', options: [
          { kind: 'if', label: 'מקום ספציפי', text: '→ **מסלול 1** (שלב 1א)', goto: 's4a' },
          { kind: 'then', label: 'בכל מקום', text: '→ **מסלול 2** (שלב 5)', goto: 's5' } ] } }
    ] },
    { id: 'r1', label: 'מסלול 1 – מקום ספציפי', route: '1', steps: [
      { id: 's4a', num: '1א', title: 'אימות המיקום', desc: 'בירור: מחסן / ממ"ד / חדר תת-קרקעי / חדר ספציפי?', source: '§4.5',
        branch: { q: 'סוג מיקום?', options: [
          { kind: 'if', label: 'מיקום נקודתי', text: 'הסבר על כיסוי רשת → סיום שיחה' },
          { kind: 'then', label: 'אחר', text: 'המשך לבדיקת אנטנות', goto: 's4b' } ] } },
      { id: 's4b', num: '1ב', title: 'בדיקת אנטנות בסביבה', source: '§4.6',
        branch: { q: 'מצב אנטנות?', options: [
          { kind: 'if', label: 'אין אנטנות', text: 'תסריט פריסת רשת → הורדת לקוח מהקו' },
          { kind: 'then', label: 'יש אנטנות', text: 'בדוק אם עוד לקוחות מדווחים: אם כן → פתח טופס רדיו + GNETRUCK (עדכון עד 3 שעות). אם לא → עבור למסלול 2 מסעיף 2.', goto: 's6' } ] } }
    ] },
    { id: 'r2', label: 'מסלול 2 – בכל מקום', route: '2', steps: [
      { id: 's5', num: '5', title: 'בדיקת CRM – Prepaid / הונאה', source: '§4.7',
        branch: { q: 'מצב הלקוח?', options: [
          { kind: 'if', label: 'נוייד Prepaid / הונאה', text: 'פתח פנייה ל-IT → המתן לעדכון → חזור ללקוח' },
          { kind: 'then', label: 'תקין', text: 'המשך לבדיקת סימון רשת', goto: 's6' } ] } },
      { id: 's6', num: '6', title: 'בדיקת סימון רשת', source: '§4.8', script: '"איזה סימון מופיע ליד פסי הקליטה? (H+ / 3G / LTE / 5G)"',
        branch: { q: 'סימון שמוצג?', options: [
          { kind: 'if', label: '3G / H+ בלבד', text: 'הנחה לשנות הגדרת רשת → **4G/5G אוטומטי**. הסתדר? סיום. אחרת: המשך.' },
          { kind: 'then', label: '5G / 4G / LTE', text: 'המשך לבדיקת APN', goto: 's7' } ] } },
      { id: 's7', num: '7', title: 'בדיקת APN', source: '§4.9',
        actions: [{ id: 'a1', text: 'ודא שה-APN מוגדר ל-**WE**' }, { id: 'a2', text: 'אם לא מוגדר → הגדר' }],
        outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – שלב 8', goto: 's8' }] },
      { id: 's8', num: '8', title: 'בדיקת מהירות גלישה', hint: 'רק אם מדובר באיטיות', source: '§4.10',
        actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ **Speedtest**' }],
        branch: { q: 'תוצאה?', options: [
          { kind: 'if', label: 'מעל 6 מגה', text: 'עדכן לקוח – תקין → סיום שיחה' },
          { kind: 'then', label: 'מתחת ל-6 מגה', text: 'המשך לריענון גלישה', goto: 's9' } ] } },
      { id: 's9', num: '9', title: 'ריענון גלישה במערכת', source: '§4.11',
        actions: [{ id: 'a1', text: 'לחץ על מתג **"גלישה בארץ"** ← כבה ← הפעל מחדש' }, { id: 'a2', text: 'בקש מלקוח לאתחל מכשיר' }],
        outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – איפוס הגדרות רשת', goto: 's10' }] },
      { id: 's10', num: '10', title: 'איפוס הגדרות רשת', source: '§4.12', block: 'network-reset', deps: ['s7'],
        outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – ריענון SIM', goto: 's11' }] },
      { id: 's11', num: '11', title: 'ריענון SIM', source: '§4.13', block: 'sim-refresh', deps: ['s7'],
        outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – SIM במכשיר אחר', goto: 's12' }] },
      { id: 's12', num: '12', title: 'SIM במכשיר אחר', source: '§4.14',
        branch: { q: 'תוצאה?', options: [
          { kind: 'if', label: 'עבד במכשיר אחר', text: 'בעיה במכשיר → הפנה למעבדה → הורד מהקו' },
          { kind: 'then', label: 'לא עבד', text: 'יתכן ה-SIM פגום → החלפת SIM / eSIM', goto: 's13' } ] } },
      { id: 's13', num: '13', title: 'החלפת SIM / eSIM', source: '§4.15', tone: 'alert',
        actions: [{ id: 'a1', text: '**eSIM** – עדיפות ראשונה: בצע בדיגיטל' }, { id: 'a2', text: '**SIM פיזי** – שלח ללקוח להום סנטר' }],
        outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'alert', text: '⚑ לא הסתדר – פנייה למומחי תמיכה' }] }
    ] }
  ],
  notes: [
    { id: 'n1', author: 'דנה ר.', ts: Date.now() - 3 * 864e5, stepId: 's8', text: 'שלב 8: Speedtest חוסם ב-Wi-Fi של הלקוח — לבקש לכבות לפני.', likes: 4 }
  ]
});

/* ─── Built-in document 2: דיבאג נטישה (retention) ───────────────────────── */
KB.SEED.docs.push({
  id: 'churn', topicId: 41,
  title: 'דיבאג נטישה',
  desc: 'מדריך לנציגים לזיהוי לקוח המאותת נטישה, פתיחת שיחה נכונה, וטיפול בשלוש הסיבות העיקריות לעזיבה',
  cat: 'ops', wave: 1, pri: 'hh', src: 'topics',
  version: 4, updated: '2025-06-01', author: 'דנה ר.', status: 'published', kind: 'retain',
  sourceDoc: { id: 'retention', ref: 'פרק 1' },
  related: [{ docId: 'browsing', why: 'דיבאג טכני לסיבה 1' }, { docId: 'pdf_003', why: 'Wi-Fi Calling כפתרון בית' }],
  phases: [
    { id: 'p0', label: 'שלב 0 – זיהוי סימני אזהרה', steps: [
      { id: 'c0', num: '0', title: 'זיהוי סימני אזהרה',
        signals: [
          { label: 'סימנים מילוליים ישירים', tone: 'red', items: ['"לא משתלם לי להישאר"', '"אני שוקל לעבור"', '"נמאס לי"', '"תבטלו כבר"'] },
          { label: 'סימנים עקיפים / רמיזות', tone: 'blue', items: ['בודק חשבוניות', 'שואל על קנס יציאה', 'שואל על ניוד מספר', 'מבקש סיכום במייל'] }
        ],
        outcomes: [{ kind: 'next', text: '→ זוהה איתות – פתיחת שיחה', goto: 'c1' }] }
    ] },
    { id: 'p1', label: 'פתיחת שיחה מומלצת', steps: [
      { id: 'c1', num: '1', title: 'פתיחת שיחה – ידיעה, בעלות, תוצאה', block: 'opening-empathy',
        pillars: [{ label: 'ידיעה', text: '"עברתי על הרישומים"', tone: 'ok' }, { label: 'בעלות', text: '"אני כאן איתך"', tone: 'warn' }, { label: 'תוצאה', text: '"סגירה כבר בשיחה הזו"', tone: 'red' }],
        branch: { q: 'מה הסיבה לעזיבה?', options: [
          { kind: 'if', label: 'טכני / קליטה', text: '→ סיבה 1', goto: 'c2' },
          { kind: 'if', label: 'מחיר / עלויות', text: '→ סיבה 2', goto: 'c3' },
          { kind: 'then', label: 'שירות / טרטור', text: '→ סיבה 3', goto: 'c4' } ] } }
    ] },
    { id: 'p2', label: 'שלוש הסיבות העיקריות', steps: [
      { id: 'c2', num: '2', icon: '📡', title: 'סיבה 1 – בעיות טכניות / קליטה', desc: '"אין קליטה / ניתוקים / אינטרנט איטי – עובר חברה"',
        stages: [
          { label: 'שלב 1 – אמפתיה + בעלות', script: '"אני מבינה לגמרי את התחושה ומתנצלת על כך. אני רואה שבשיחות הקודמות כבר ניסו לסייע, אז חשוב לי שהפעם אנחנו באמת סוגרים את זה. אני כאן איתך עד שתקבל פתרון לשביעות רצונך."' },
          { label: 'שלב 2 – בדיקות טכניות', actions: ['פעל לפי **דיבאג קליטה** – התייחס לתיעודים קודמים ואשר מול הלקוח [[doc:browsing]]'], script: '"בדקתי את פרטי הקו והאזור שלך. יש לי כמה פתרונות כדי שתוכל להישאר יציב ומחובר בלי להתאמץ."' },
          { label: 'שלב 3 – פתרונות להציע', actions: ['**Wi-Fi Calling** – כפתרון בית / משרד', 'בדיקת אזור / תשתית / מכשיר / החלפת SIM לפי הצורך', 'במידת הצורך – העמקה הנדסית ומעקב יזום עד מענה'] }
        ],
        objection: { q: '"ניסיתי הכול, זה לא יעזור."', a: '"מבינה לגמרי למה זה נשמע לך ככה, אבל ההבדל עכשיו הוא שאני רואה את כל מה שנעשה עד היום ומרכזת עבורך את הטיפול מקצה לקצה. אני מפעילה עכשיו בדיקה ממוקדת באזור שלך ודואגת לוודא שWi-Fi Calling פעיל ומוגדר נכון. אם לא תרגיש שיפור – אני זו שאחזור אליך עם חלופה."' },
        outcomes: [{ kind: 'ok', text: '✓ נפתר / נקבע מעקב – סגירת שיחה', goto: 'c5' }, { kind: 'next', text: '→ מיצינו – סגירה מכבדת', goto: 'c5' }] },
      { id: 'c3', num: '3', icon: '💰', title: 'סיבה 2 – מחיר / עלויות', desc: '"יקר" / "קיבלתי הצעה זולה יותר" / "חיוב לא ברור"',
        script: '"אני עושה לך עכשיו סדר בחיובים ובחבילה, ומוודאת שאתה מקבל את המקסימום שמתאים לשימוש שלך – בלי לשלם על מה שלא צריך."',
        stages: [
          { label: 'מה מציעים', actions: ['בדיקת שימוש ↔ התאמת חבילה אמיתית (לא "להוזיל בכל מחיר")', 'בירור / תיקון חיוב לא ברור + זיכוי לפי מדיניות', 'הטבה נקודתית – כחלק מפתרון כולל, לא "פלסטר"'] },
          { label: 'יתרונות wecom – תסריט שיחה', script: '"אנחנו גם אטרקטיביים במחיר, גם עם שירות אנושי זמין ופריסה טכנית מתקדמת (5G, פתרונות ביתיים), וגם שקופים וחדשניים: אתה יודע בדיוק מה יש לך, ואנחנו מתאימים את החבילה לשימוש שלך כדי שלא תשלם סתם."' }
        ],
        objection: { q: '"קיבלתי 10 ש״ח פחות אצל המתחרה."', a: '"אפשר להוריד מחיר בכל מקום – אבל חשוב שלא תאבד מהירות / כיסוי / שירות אנושי כשצריך. אני מתאימה לך עכשיו חבילה שתשמור על הערכים האלה ועדיין תהיה משתלמת."' },
        outcomes: [{ kind: 'ok', text: '✓ הותאמה חבילה – סגירת שיחה', goto: 'c5' }, { kind: 'next', text: '→ מיצינו – סגירה מכבדת', goto: 'c5' }] },
      { id: 'c4', num: '4', icon: '😤', title: 'סיבה 3 – שירות / חוויה / טרטור', desc: '"אי אפשר להשיג אתכם" / "הבטיחו וחזרו בהם" / "עברתי נציגים"',
        script: '"אני מצטערת על החוויה. זמני המתנה חריגים אינם הסטנדרט אצלנו. מעכשיו אני אחראית לטיפול מקצה לקצה – כדי שלא תצטרך לחזור שוב."',
        stages: [
          { label: 'לקוח שעבר כמה ידיים', script: '"ראיתי שעברת כבר כמה ידיים ושזה עדיין לא נפתר. מעכשיו אני מטפלת בזה אישית ודואגת לסגור הכול מול הגורמים הרלוונטיים עד שתקבל מענה ברור וסופי."' },
          { label: 'הבטחות שלא קוימו', script: '"אני רואה לפי התיעוד במערכת בדיוק מה הובטח לך, ואני אדאג שזה יקרה בפועל. מעכשיו אני מטפלת בזה אישית ומעדכנת אותך עד שזה נסגר."' }
        ],
        objection: { q: '"לא מאמין, אמרו לי כבר."', a: '"אני מבינה אותך, וזה נשמע באמת לא פשוט. תן לי הזדמנות להראות לך שהשירות שלנו הרבה יותר טוב ממה שחווית עד עכשיו. אני כאן כדי לטפל בזה כמו שצריך – עד שזה נפתר!"' },
        outcomes: [{ kind: 'ok', text: '✓ בעלות אחת + צעד הבא – סגירת שיחה', goto: 'c5' }, { kind: 'next', text: '→ מיצינו – סגירה מכבדת', goto: 'c5' }] }
    ] },
    { id: 'p3', label: 'סגירת שיחה', steps: [
      { id: 'c5', num: '5', title: 'סגירת שיחה',
        pillars: [{ label: 'טרם מיצינו פתרונות', text: '"קבענו: אני עושה בדיקה / התאמה, חוזרת אליך עד ___ ב___. אם משהו מתעכב – אני יוצרת קשר."', tone: 'ok' }, { label: 'מיצינו / לקוח לא מעוניין', text: 'מכבדים את רצון הלקוח ומשאירים גשר חיובי לחזרה. לא לכפות.', tone: 'gray' }],
        principles: ['בעלות אחת ברורה – הלקוח יודע מי אחראי ומה הצעד הבא', 'ידיעה, לא חקירה – "עברתי על הרישומים שלך" מקל ומרגיע', 'ערך + טכנולוגיה + שקיפות – לא "מחיר או שירות" אלא גם וגם וגם', 'שקט תפעולי – Wi-Fi Calling, התאמות חבילה, מעקב יזום', 'מדד הצלחה: הלקוח יצא עם בעל בית + צעד הבא מתוארך + תחושת שליטה', 'כבוד לרצון הלקוח – מתעקש לא לדבר? מכבדים ומשאירים גשר חיובי'],
        outcomes: [{ kind: 'ok', text: '✓ תועד ב-CRM – סיום' }] }
    ] }
  ],
  notes: []
});

/* ─── Seeded version history for the flagship document (mirrors the real edit trail) ── */
KB.SEED.versions = {
  browsing: [
    { v: 3, ts: Date.parse('2025-04-14T10:00:00'), author: 'מערכת', label: 'שוחזר מסל מיחזור', kind: 'system' },
    { v: 4, ts: Date.parse('2025-05-02T09:30:00'), author: 'ענבר ל.', label: 'ניסוח מחדש של שלב 1–3', kind: 'published' },
    { v: 5, ts: Date.parse('2025-05-20T14:10:00'), author: 'ענבר ל.', label: 'מיזוג "ריענון SIM" לבלוק משותף', kind: 'published',
      patch: [{ stepId: 's8', branch: { q: 'תוצאה?', options: [{ kind: 'if', label: 'מעל 5 מגה', text: 'עדכן לקוח – תקין → סיום שיחה' }, { kind: 'then', label: 'מתחת ל-5 מגה', text: 'המשך לריענון גלישה', goto: 's9' }] } },
              { stepId: 's11', block: null, actions: [{ id: 'a1', text: 'CRM ← מצב עריכה על המספר ← sim block lbl ← שמור' }, { id: 'a2', text: 'שוב עריכה ← sim allow lbl ← שמור' }, { id: 'a3', text: 'בקש מלקוח לאתחל מכשיר' }] },
              { stepId: 's13', remove: true }] },
    { v: 6, ts: Date.parse('2025-06-03T11:45:00'), author: 'אלון ר.', label: 'שינוי סף Speedtest 5→6 מגה', kind: 'published',
      patch: [{ stepId: 's11', block: null, actions: [{ id: 'a1', text: 'CRM ← מצב עריכה על המספר ← sim block lbl ← שמור' }, { id: 'a2', text: 'שוב עריכה ← sim allow lbl ← שמור' }, { id: 'a3', text: 'בקש מלקוח לאתחל מכשיר' }] },
              { stepId: 's13', remove: true }] },
    { v: 7, ts: Date.parse('2025-06-12T12:48:00'), author: 'ענבר ל.', label: 'הוספת שלב 13 · החלפת SIM/eSIM', kind: 'published', current: true }
  ]
};

/* ─── Source documents (Word / Excel) with tracked changes awaiting processing ── */
KB.SOURCE_DOCS = [
  { id: 'tech-procedures', title: 'נהלי תמיכה טכנית', ext: '.docx', version: 41, time: '12:48', editor: 'ענבר ל.', edits: 3, linkedCards: 7,
    chapter: 'פרק 4 · איטיות גלישה / חוסר גלישה', pages: 'עמ\' 12–14', status: 'pending',
    paragraphs: [
      { ref: '4.8', title: 'בדיקת מהירות גלישה.', runs: [
        { t: 'בקש מהלקוח להריץ ' }, { t: 'Speedtest', code: true }, { t: '. ' },
        { t: 'מעל 5 מגה', del: true }, { t: ' ' }, { t: 'מעל 6 מגה', add: true },
        { t: ' – עדכן לקוח שהקו תקין וסיים שיחה. ' },
        { t: 'יש לוודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה.', add: true },
        { t: ' מתחת לסף – המשך לריענון גלישה.' } ] },
      { ref: '4.14', title: 'בעיות גלישה ברכב (Android Auto / CarPlay).', isNew: true, runs: [
        { t: 'אם הלקוח מדווח על איטיות רק בעת חיבור למערכת הרכב – בדוק אם המכשיר מחובר ל-Wi-Fi של הרכב. הנחה לכבות Wi-Fi ברכב ולהשאיר Bluetooth. אם לא עזר → המשך לבדיקת APN (4.7).', add: true } ] },
      { ref: '4.11', title: 'ריענון SIM.', runs: [
        { t: 'ב-CRM: מצב עריכה על המספר ← ' }, { t: 'sim block lbl', code: true }, { t: ' ← שמור. שוב עריכה ← ' }, { t: 'sim allow lbl', code: true }, { t: ' ← שמור. ' },
        { t: 'בקש מהלקוח לאתחל מכשיר ', chg: true }, { t: 'ולחכות 90 שניות', add: true, chg: true }, { t: ' לפני בדיקה חוזרת.', chg: true } ] },
      { ref: '4.1', title: 'בדיקת חסימת גלישה בארץ.', unchanged: true, runs: [
        { t: 'פתח CRM ↗ שדה ' }, { t: 'גלישה בארץ', code: true }, { t: '. אם "חסום" → אזור אישי ↗ ביצוע פעולות ↗ גלישה ותוכן → הדלק את המתג.' } ] },
      { ref: '4.9', title: 'בדיקת APN.', unchanged: true, runs: [ { t: 'ודא שה-' }, { t: 'APN', code: true }, { t: ' מוגדר ל-' }, { t: 'WE', code: true }, { t: '. אם לא מוגדר → הגדר.' } ] }
    ],
    /* What the rule engine derives from the tracked changes above. Applying a suggestion mutates the library. */
    suggestions: [
      { id: 'a', tag: 'עדכון שלב', tone: 'amber', title: 'סף Speedtest 5 → 6 מגה + ניתוק Wi-Fi', conf: 0.96,
        why: 'ערך מספרי שונה בפסקה 4.8 + הוראה חדשה. משפיע על שלב 8 בכרטיס "איטיות גלישה".',
        diff: 'מעל 5 מגה → מעל 6 מגה · + פעולה: "ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה"', anchor: '§4.8', target: 'איטיות גלישה · שלב 8',
        apply: { type: 'update-step', docId: 'browsing', stepId: 's8',
                 addActions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה'],
                 branch: { q: 'תוצאה?', options: [{ kind: 'if', label: 'מעל 6 מגה', text: 'עדכן לקוח – תקין → סיום שיחה' }, { kind: 'then', label: 'מתחת ל-6 מגה', text: 'המשך לריענון גלישה', goto: 's9' }] } } },
      { id: 'b', tag: 'כרטיס חדש', tone: 'green', title: 'בעיות גלישה ברכב (Android Auto / CarPlay)', conf: 0.81,
        why: 'פסקה חדשה 4.14 עם תבנית "אם → בדוק → הנחה → אם לא עזר". מפנה ל-4.7 (APN) — קישור ייווצר אוטומטית.',
        diff: 'כרטיס: תמיכה טכנית · גל 2 · 3 שלבים · קישור יוצא: "איטיות גלישה §7" · שדה CRM: אין', anchor: '§4.14', target: 'כרטיס חדש',
        apply: { type: 'new-doc', doc: {
          id: 'car-browsing', title: 'בעיות גלישה ברכב (Android Auto / CarPlay)', desc: 'איטיות רק בחיבור למערכת הרכב: Wi-Fi של הרכב, Bluetooth, APN',
          cat: 'tech', wave: 2, pri: 'm', src: 'topics', kind: 'steps', status: 'published', sourceDoc: { id: 'tech-procedures', ref: '§4.14' },
          phases: [{ id: 'p1', label: 'שלבי הטיפול', steps: [
            { id: 's1', num: '1', title: 'תיחום: רק ברכב?', actions: [{ id: 'a1', text: 'שאל: "האיטיות מופיעה רק כשהמכשיר מחובר ל-Android Auto / CarPlay?"' }], outcomes: [{ kind: 'next', text: '→ כן – שלב 2', goto: 's2' }, { kind: 'alert', text: '⚑ לא – עבור ל-[[doc:browsing]]' }], source: '§4.14' },
            { id: 's2', num: '2', title: 'Wi-Fi של הרכב', actions: [{ id: 'a1', text: 'בדוק אם המכשיר מחובר ל-**Wi-Fi** של הרכב' }, { id: 'a2', text: 'הנחה לכבות Wi-Fi ברכב ולהשאיר **Bluetooth**' }], outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא עזר – שלב 3', goto: 's3' }], source: '§4.14' },
            { id: 's3', num: '3', title: 'בדיקת APN', actions: [{ id: 'a1', text: 'המשך לבדיקת APN לפי [[doc:browsing|איטיות גלישה §7]]' }], outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }], source: '§4.14' }
          ] }] } } },
      { id: 'c', tag: 'עדכון בלוק משותף', tone: 'red', title: 'ריענון SIM: המתנה של 90 שניות', conf: 0.92,
        why: 'הפסקה ממופה לבלוק "ריענון SIM" שמשמש 5 כרטיסים. אישור יעדכן את כולם.',
        diff: '"בקש מהלקוח לאתחל מכשיר" → "…ולחכות 90 שניות לפני בדיקה חוזרת" · משפיע על כל הכרטיסים שמטמיעים את הבלוק', anchor: '§4.11', target: '⧉ ריענון SIM',
        apply: { type: 'update-block', blockId: 'sim-refresh', actions: [
          { id: 'b1', text: 'CRM ← מצב עריכה על המספר ← sim block lbl ← שמור' }, { id: 'b2', text: 'שוב עריכה ← sim allow lbl ← שמור' }, { id: 'b3', text: 'בקש מהלקוח לאתחל מכשיר ולחכות 90 שניות לפני בדיקה חוזרת' } ] } }
    ] },
  { id: 'intl-guide', title: 'חו"ל ונדידה – מדריך מלא', ext: '.docx', version: 12, time: '09:15', editor: 'אלון ר.', edits: 0, linkedCards: 14, status: 'synced',
    chapter: 'פרק 2 · אין גלישה בחו"ל', pages: 'עמ\' 6–9',
    paragraphs: [
      { ref: '2.1', title: 'תיחום התקלה.', unchanged: true, runs: [{ t: 'שאל: "הגלישה לא עובדת בכלל או שרק אפליקציה מסוימת לא עובדת?" רק אפליקציה מסוימת → מסלול R-03.' }] },
      { ref: '2.2', title: 'בדיקות מערכת.', unchanged: true, runs: [{ t: 'ודא: שירותי נדידה פעילים בקו, אין חסימת גלישה בחו"ל, קיימת חבילת חו"ל בתוקף, המדינה כלולה בחבילה.' }] }
    ], suggestions: [] },
  { id: 'retention', title: 'שימור ונטישה', ext: '.docx', version: 5, time: '16:40', editor: 'דנה ר.', edits: 0, linkedCards: 5, status: 'synced',
    chapter: 'פרק 1 · דיבאג נטישה', pages: 'עמ\' 2–5',
    paragraphs: [
      { ref: '1.1', title: 'זיהוי סימני אזהרה.', unchanged: true, runs: [{ t: 'סימנים מילוליים: "לא משתלם לי להישאר", "אני שוקל לעבור". סימנים עקיפים: בודק חשבוניות, שואל על קנס יציאה.' }] }
    ], suggestions: [] },
  { id: 'crm-sheet', title: 'שדות CRM', ext: '.xlsx', version: 9, time: '14:02', editor: 'IT', edits: 0, linkedCards: 38, status: 'synced', fields: true,
    chapter: 'גיליון · שדות פעילים', pages: '38 שורות',
    paragraphs: [
      { ref: 'A12', title: 'שירות נדידה → שירותי נדידה', runs: [{ t: 'שירות נדידה', del: true }, { t: ' ' }, { t: 'שירותי נדידה', add: true }, { t: ' · שינוי שם שדה · 3 מסמכים מפנים לשם הישן' }] },
      { ref: 'A37', title: 'חסימת גלישה בחו"ל', isNew: true, runs: [{ t: 'שדה חדש · CRM ↗ שירותים · בוליאני', add: true }] },
      { ref: 'A38', title: 'ריענון SIM (כפתור)', isNew: true, runs: [{ t: 'כפתור חדש · CRM ↗ פעולות · מחליף את sim block lbl / sim allow lbl בעתיד', add: true }] }
    ], suggestions: [] }
];

/* Editor "יסודות" presets — reusable action snippets carried over from the previous
   step-builder so writers can insert proven wording in one click. */
KB.PRESETS = [
  { group: 'שאלות בירור', items: ['מה בדיוק לא עובד?', 'מתי זה התחיל?', 'זה בכל מקום או רק כאן?', 'כמה זמן הבעיה קיימת?', 'האם זה קרה בעבר?'] },
  { group: 'בדיקות מערכת (ללא לקוח)', items: ['בדיקת שדה "גלישה בארץ" ב-CRM', 'בדיקת ניצול חבילת גלישה – אזור אישי ← השימושים שלי', 'בדיקת Prepaid / חשד הונאה → פנייה ל-IT', 'בדיקת כיסוי אנטנות באזור', 'בדיקת סטטוס SIM במערכת', 'בדיקת חוב פתוח'] },
  { group: 'פעולות במכשיר הלקוח', items: ['נתונים סלולריים – אם כבוי → להדליק', 'Wi-Fi – אם דולק → לכבות', 'סימון רשת → שנה ל-4G/5G אוטומטי', 'APN → הגדרה נכונה ל-WE', 'איפוס הגדרות רשת', 'כיבוי והדלקת מכשיר'] },
  { group: 'פעולות נציג', items: ['ריענון גלישה – מתג "גלישה בארץ" כבה/הפעל', 'פתיחת פנייה ל-IT', 'פתיחת טופס רדיו + GNETRUCK', 'ביצוע זיכוי / החזר', 'שינוי מסלול / חבילה'] },
  { group: 'הפניה / אסקלציה', items: ['מומחי תמיכה – לאחר מיצוי כל השלבים', 'מעבדה – בעיית מכשיר', 'הום סנטר – החלפת SIM פיזי', 'מנהל / שימור – לקוח מתוסכל'] },
  { group: 'סגירה', items: ['Wi-Fi Calling – הצע כפתרון מניעתי', 'תיאום callback / מעקב', 'תיעוד כל הפעולות שבוצעו', 'שאלת שביעות רצון'] }
];
