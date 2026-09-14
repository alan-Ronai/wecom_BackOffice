/**
 * Stage 5 — collaboration: notifications, inline comments with mentions, the review
 * queue, saved views, step templates and editor presence.
 *
 * `presence` is a table rather than an in-memory map on purpose: the API runs behind
 * nginx and may be more than one process, so a heartbeat written by one worker has to
 * be visible to a GET served by another. Rows are TTL'd by `last_seen_at`, not deleted
 * on disconnect — a browser that is killed never sends a goodbye.
 */
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
const now = (pgm) => ({ type: 'timestamptz', notNull: true, default: pgm.func('now()') });

/** `legacy/js/data.js` `KB.PRESETS` — the phrasing agents already know, as step templates. */
const PRESETS = [
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
];

/** One phase whose steps are the preset items — the shape `PhaseSchema` validates. */
const phasesOf = (preset) => [
  {
    id: 'p1',
    label: preset.group,
    steps: preset.items.map((text, i) => ({
      key: 's' + (i + 1),
      num: String(i + 1),
      title: text,
      blockRefs: [],
      deps: [],
      actions: [{ id: 'a1', text }],
      outcomes: [],
    })),
  },
];

exports.up = (pgm) => {
  pgm.createTable('notifications', {
    id: id(pgm),
    user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    kind: {
      type: 'text',
      notNull: true,
      check: "kind in ('suggestion','sync','mention','review','publish','system')",
    },
    title: { type: 'text', notNull: true },
    body: { type: 'text', notNull: true, default: '' },
    href: 'text',
    entity_type: 'text',
    entity_id: 'text',
    created_at: now(pgm),
    read_at: 'timestamptz',
  });
  pgm.createIndex('notifications', ['user_id', 'created_at']);
  pgm.createIndex('notifications', 'user_id', {
    name: 'notifications_unread_idx',
    where: 'read_at is null',
  });

  pgm.createTable('comments', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    step_key: 'text',
    author_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    text: { type: 'text', notNull: true },
    // Resolved at write time so a renamed user never silently changes an old comment.
    mentions: { type: 'jsonb', notNull: true, default: '[]' },
    resolved_at: 'timestamptz',
    resolved_by: { type: 'uuid', references: 'users' },
    created_at: now(pgm),
  });
  pgm.createIndex('comments', ['document_id', 'created_at']);

  pgm.createTable(
    'comment_likes',
    {
      comment_id: { type: 'uuid', notNull: true, references: 'comments', onDelete: 'cascade' },
      user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
      created_at: now(pgm),
    },
    { constraints: { primaryKey: ['comment_id', 'user_id'] } },
  );

  pgm.createTable('review_requests', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
    requested_by: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    reviewer_ids: { type: 'uuid[]', notNull: true, default: '{}' },
    note: 'text',
    status: {
      type: 'text',
      notNull: true,
      default: 'open',
      check: "status in ('open','approved','changes')",
    },
    decided_by: { type: 'uuid', references: 'users' },
    decision_note: 'text',
    created_at: now(pgm),
    decided_at: 'timestamptz',
  });
  pgm.createIndex('review_requests', ['status', 'created_at']);
  // At most one open request per document: a second "send to review" updates the first.
  pgm.createIndex('review_requests', 'document_id', {
    name: 'review_requests_open_idx',
    unique: true,
    where: "status = 'open'",
  });

  pgm.createTable('saved_views', {
    id: id(pgm),
    owner_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
    name: { type: 'text', notNull: true },
    query: { type: 'jsonb', notNull: true, default: '{}' },
    shared: { type: 'boolean', notNull: true, default: false },
    created_at: now(pgm),
  });
  pgm.addConstraint('saved_views', 'saved_views_owner_name_unique', { unique: ['owner_id', 'name'] });

  pgm.createTable('templates', {
    id: id(pgm),
    name: { type: 'text', notNull: true, unique: true },
    description: { type: 'text', notNull: true, default: '' },
    category: { type: 'text', check: "category in ('sim','tech','billing','plans','intl','ops')" },
    kind: { type: 'text', notNull: true, default: 'steps', check: "kind in ('steps','retention')" },
    phases: { type: 'jsonb', notNull: true, default: '[]' },
    built_in: { type: 'boolean', notNull: true, default: false },
    created_by: { type: 'uuid', references: 'users' },
    created_at: now(pgm),
    updated_at: now(pgm),
  });

  pgm.createTable(
    'presence',
    {
      document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' },
      user_id: { type: 'uuid', notNull: true, references: 'users', onDelete: 'cascade' },
      since: now(pgm),
      last_seen_at: now(pgm),
    },
    { constraints: { primaryKey: ['document_id', 'user_id'] } },
  );
  pgm.createIndex('presence', 'last_seen_at');

  const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  for (const p of PRESETS)
    pgm.sql(
      `insert into templates(name, description, kind, phases, built_in)
       values (${q(p.group)}, '', 'steps', ${q(JSON.stringify(phasesOf(p)))}::jsonb, true)`,
    );
};

exports.down = (pgm) => {
  pgm.dropTable('presence');
  pgm.dropTable('templates');
  pgm.dropTable('saved_views');
  pgm.dropTable('review_requests');
  pgm.dropTable('comment_likes');
  pgm.dropTable('comments');
  pgm.dropTable('notifications');
};
