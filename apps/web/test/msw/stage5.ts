/**
 * Fixtures and msw handlers for the stage-5 admin/identity and connectors/sync routes.
 *
 * Kept beside the stage-1 handlers rather than inside them so the two contracts stay legible:
 * these routes are typed from `@wecom/shared`'s zod schemas (see `src/api/stage5.ts`) rather than
 * from the generated `schema.d.ts`, and `fixtures.test.ts` parses every response below with the
 * matching schema — so a mock cannot drift from the contract the screens are built against.
 *
 * State is mutable so tests can assert side effects (enable/disable, resolve, revoke) and is reset
 * between tests by `resetStage5()`, which `handlers.ts#resetState` calls.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Phase } from '@wecom/shared';
import type {
  AdminUserRow,
  AuditEntryDetail,
  ConflictView,
  ConnectorRow,
  ConnectorTypeInfo,
  GroupSearchItem,
  IdentitySettings,
  ParityConnector,
  RoleMatrix,
  SyncLinkRow,
} from '../../src/api/stage5.js';
import { D_BROWSING, D_INTL, ROLE_ADMIN, ROLE_LEAD, T, U2, me } from './fixtures.js';

const B = '/api/v1';

export const ROLE_AGENT = '99999999-9999-4999-8999-999999999993';
export const U3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
export const U4 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4';
export const C_WP = 'cc111111-1111-4111-8111-111111111111';
export const C_FOLDER = 'cc222222-2222-4222-8222-222222222222';
export const LINK_CONFLICT = 'dd111111-1111-4111-8111-111111111111';
export const LINK_IMPORT = 'dd222222-2222-4222-8222-222222222222';
export const LINK_PUSH = 'dd333333-3333-4333-8333-333333333333';
export const LINK_SYNCED = 'dd444444-4444-4444-8444-444444444444';
export const AUDIT_1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';

/* ── identity ─────────────────────────────────────────────────────────────── */

export const identity: IdentitySettings = {
  oidc: {
    enabled: true,
    issuer: 'https://login.microsoftonline.com/wecom/v2.0',
    clientId: 'a1b2c3d4-0000-4000-8000-000000000001',
    hasSecret: true,
    redirectUri: 'https://kb.wecom.local/api/v1/auth/callback',
    groupsClaim: true,
  },
  paloalto: { enabled: true, host: 'gp.wecom.local', hasApiKey: true, subnets: ['10.20.4.0/24'] },
  local: { breakGlassEnabled: true },
  sessionHours: 8,
};

/* ── admin users (AdminUserRowSchema — roles, groups, session count) ──────── */

export const adminUsers: AdminUserRow[] = [
  {
    ...me.user,
    roles: [{ roleId: ROLE_LEAD, roleName: 'lead', categoryScope: null }],
    groups: ['KB-Editors', 'IT-Admins'],
    sessions: 2,
    createdAt: T,
  },
  {
    id: U2,
    subject: 'dana@wecom.co.il',
    source: 'entra',
    email: 'dana@wecom.co.il',
    displayName: 'דנה ר.',
    initials: 'ד',
    active: true,
    lastLoginAt: T,
    roles: [{ roleId: ROLE_LEAD, roleName: 'lead', categoryScope: ['intl'] }],
    groups: ['KB-Editors'],
    sessions: 1,
    createdAt: T,
  },
  {
    id: U3,
    subject: 'maya@wecom.co.il',
    source: 'paloalto',
    email: 'maya@wecom.co.il',
    displayName: 'מאיה כ.',
    initials: 'מ',
    active: true,
    lastLoginAt: T,
    roles: [{ roleId: ROLE_AGENT, roleName: 'agent', categoryScope: null }],
    groups: ['Support-L2'],
    sessions: 1,
    createdAt: T,
  },
  {
    id: U4,
    subject: 'omer@wecom.co.il',
    source: 'local',
    email: 'omer@wecom.co.il',
    displayName: 'עומר ל.',
    initials: 'ע',
    active: false,
    lastLoginAt: null,
    roles: [],
    groups: [],
    sessions: 0,
    createdAt: T,
  },
];

/* ── role matrix ──────────────────────────────────────────────────────────── */

export const roleMatrix: RoleMatrix = {
  permissions: [
    { name: 'docs.read', resource: 'מסמכים', description: 'צפייה בספריית הידע' },
    { name: 'docs.edit', resource: 'מסמכים', description: 'עריכת טיוטות' },
    { name: 'docs.publish', resource: 'מסמכים', description: 'פרסום גרסה' },
    { name: 'fields.edit', resource: 'מסמכים', description: 'עריכת שדות CRM' },
    { name: 'suggestions.apply', resource: 'הצעות', description: 'החלת הצעות על מסמכים' },
    { name: 'connectors.manage', resource: 'ניהול', description: 'הגדרת מחברים' },
    { name: 'users.manage', resource: 'ניהול', description: 'ניהול משתמשים' },
    { name: 'roles.manage', resource: 'ניהול', description: 'ניהול תפקידים והרשאות' },
    { name: 'audit.read', resource: 'ניהול', description: 'קריאת יומן הביקורת' },
    { name: 'system.admin', resource: 'ניהול', description: 'הגדרות מערכת וזהות' },
  ],
  roles: [
    { id: ROLE_AGENT, name: 'agent', system: true, permissions: ['docs.read'], users: 41 },
    {
      id: ROLE_LEAD,
      name: 'lead',
      system: true,
      permissions: ['docs.read', 'docs.edit', 'docs.publish', 'fields.edit', 'suggestions.apply'],
      users: 12,
    },
    {
      id: ROLE_ADMIN,
      name: 'admin',
      system: true,
      permissions: [
        'docs.read',
        'docs.edit',
        'docs.publish',
        'fields.edit',
        'suggestions.apply',
        'connectors.manage',
        'users.manage',
        'roles.manage',
        'audit.read',
        'system.admin',
      ],
      users: 5,
    },
    {
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2',
      name: 'צוות חו"ל',
      system: false,
      permissions: ['docs.read', 'docs.edit'],
      users: 9,
    },
  ],
};

/* ── audit detail ─────────────────────────────────────────────────────────── */

export const auditDetail: AuditEntryDetail = {
  id: AUDIT_1,
  action: 'docs.publish',
  entityType: 'document',
  entityId: D_BROWSING,
  actorName: 'ענבר ל.',
  ip: '10.0.0.7',
  requestId: 'req-1',
  at: T,
  diff: [
    { path: 'currentVersion', before: 6, after: 7 },
    { path: 'status', before: 'draft', after: 'published' },
    {
      path: 'phases[0].steps[3].description',
      before: 'בקש בדיקת מהירות',
      after: 'בקש בדיקת מהירות בחיבור סלולרי',
    },
  ],
  before: { currentVersion: 6, status: 'draft' },
  after: { currentVersion: 7, status: 'published' },
};

/* ── connectors ───────────────────────────────────────────────────────────── */

/**
 * The WordPress entry is a **transcript** of what `describeConfigSchema` emits for
 * `WpConfigSchema` — field for field, constraint for constraint — not a plausible-looking
 * invention. It used to be an invention: `appPassword`, a `status` enum, a `page`/`post`
 * default, and no `categoryMap`. None of those exist, and because the contract said
 * `configSchema` was merely "an object", nothing could tell. That is the gap the connector
 * wizard fell into (walkthrough W-1): the API published `{type, fields, required}`, the wizard
 * read `properties`, and the fixture agreed with neither — so the msw tests rendered a form that
 * no deployment ever produced while the real one rendered no fields at all.
 *
 * `ConnectorTypeInfoSchema` is strict now, and `test/msw/fixtures.test.ts` parses this against
 * it, so a shape drift here is a failing test rather than a fiction.
 */
export const connectorTypes: ConnectorTypeInfo[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    capabilities: { read: true, write: true, webhooks: true, identity: false },
    configSchema: {
      type: 'object',
      required: ['baseUrl', 'username', 'applicationPassword', 'webhookSecret'],
      additionalProperties: false,
      properties: {
        baseUrl: {
          type: 'string',
          title: 'כתובת האתר',
          description: 'כתובת הבסיס של אתר ה-WordPress, ללא /wp-json',
          examples: ['https://kb.example.com'],
          format: 'uri',
        },
        username: {
          type: 'string',
          title: 'שם משתמש',
          description: 'משתמש WordPress שה-Application Password שייך לו',
          minLength: 1,
        },
        applicationPassword: {
          type: 'string',
          title: 'סיסמת אפליקציה',
          description: 'Application Password מתוך פרופיל המשתמש ב-WordPress',
          writeOnly: true,
          format: 'password',
          minLength: 1,
        },
        postTypes: {
          type: 'array',
          title: 'סוגי תוכן',
          description: 'נתיבי ה-REST של סוגי התוכן לייבוא, מופרדים בפסיק',
          examples: ['posts, pages'],
          items: { type: 'string' },
          minItems: 1,
          default: ['posts'],
        },
        categoryMap: {
          type: 'object',
          title: 'מיפוי קטגוריות',
          description: 'קטגוריית WordPress = קטגוריה במאגר (sim, tech, billing, plans, intl, ops)',
          additionalProperties: { type: 'string' },
          default: {},
        },
        webhookSecret: {
          type: 'string',
          title: 'סוד ה-webhook',
          description: 'לפחות 8 תווים; אותו ערך מוגדר בתוסף שבאתר (openssl rand -hex 16)',
          writeOnly: true,
          format: 'password',
          minLength: 8,
        },
      },
    },
  },
  {
    /**
     * A second type, so the wizard's type step has something to choose between and the
     * connectors table has a row with no webhooks. Deliberately *not* one of the two the
     * registry ships — this fixture is a deployment's answer, and a deployment may carry a
     * connector this repo does not. Its shape still has to be the published one.
     */
    id: 'folder',
    name: 'תיקייה ברשת',
    capabilities: { read: true, write: false, webhooks: false, identity: false },
    configSchema: {
      type: 'object',
      required: ['path'],
      additionalProperties: false,
      properties: {
        path: {
          type: 'string',
          title: 'נתיב תיקייה',
          examples: ['\\\\fs01\\kb\\procedures'],
          minLength: 1,
        },
        recursive: { type: 'boolean', title: 'כולל תת-תיקיות', default: true },
      },
    },
  },
];

const initialConnectors = (): ConnectorRow[] => [
  {
    id: C_WP,
    type: 'wordpress',
    name: 'WordPress',
    enabled: true,
    schedule: '*/30 * * * *',
    lastRunAt: T,
    lastStatus: 'ok',
    health: { ok: true, detail: 'REST API פתוח' },
    config: {
      baseUrl: 'https://help.wecom.co.il',
      username: 'kb-bot',
      applicationPassword: '••••',
      postTypes: ['posts', 'pages'],
      categoryMap: { 'sim-cards': 'sim' },
      webhookSecret: '••••',
    },
    links: 38,
    conflicts: 1,
  },
  {
    id: C_FOLDER,
    type: 'folder',
    name: 'תיקיית Word',
    enabled: false,
    schedule: null,
    lastRunAt: null,
    lastStatus: 'never',
    health: null,
    config: { path: '\\\\fs01\\kb\\procedures', recursive: true },
    links: 0,
    conflicts: 0,
  },
];

/* ── sync links ───────────────────────────────────────────────────────────── */

const initialLinks = (): SyncLinkRow[] => [
  {
    id: LINK_CONFLICT,
    connectorId: C_WP,
    connectorName: 'WordPress',
    documentId: D_BROWSING,
    title: 'איטיות גלישה',
    externalId: '214',
    remoteUrl: 'https://help.wecom.co.il/page/214',
    state: 'conflict',
    baseLocalVersion: 7,
    currentLocalVersion: 8,
    remoteChanged: true,
    localChanged: true,
    lastSyncedAt: T,
  },
  {
    id: LINK_IMPORT,
    connectorId: C_WP,
    connectorName: 'WordPress',
    documentId: D_INTL,
    title: 'חו"ל ונדידה',
    externalId: '215',
    remoteUrl: 'https://help.wecom.co.il/page/215',
    state: 'pending_import',
    baseLocalVersion: 4,
    currentLocalVersion: 4,
    remoteChanged: true,
    localChanged: false,
    lastSyncedAt: T,
  },
  {
    id: LINK_PUSH,
    connectorId: C_WP,
    connectorName: 'WordPress',
    documentId: D_BROWSING,
    title: 'Hotspot לא עובד',
    externalId: '216',
    remoteUrl: 'https://help.wecom.co.il/page/216',
    state: 'pending_push',
    baseLocalVersion: 5,
    currentLocalVersion: 6,
    remoteChanged: false,
    localChanged: true,
    lastSyncedAt: T,
  },
  {
    id: LINK_SYNCED,
    connectorId: C_WP,
    connectorName: 'WordPress',
    documentId: D_INTL,
    title: 'ריענון SIM',
    externalId: '217',
    remoteUrl: 'https://help.wecom.co.il/page/217',
    state: 'synced',
    baseLocalVersion: 3,
    currentLocalVersion: 3,
    remoteChanged: false,
    localChanged: false,
    lastSyncedAt: T,
  },
];

/* ── the conflict under `/sync/conflicts/:id` ─────────────────────────────── */

const step = (key: string, num: string, title: string, description: string, sourceRef: string) => ({
  key,
  num,
  title,
  description,
  sourceRef,
  blockRefs: [] as string[],
  deps: [] as string[],
  actions: [],
  outcomes: [],
});

const phases = (descriptions: [string, string, string][]): Phase[] => [
  {
    id: 'p1',
    label: 'אבחון',
    steps: descriptions.map(([ref, title, text], i) => step(`s${i + 7}`, String(i + 7), title, text, ref)),
  },
];

export const conflict: ConflictView = {
  link: initialLinks()[0],
  base: {
    version: 7,
    phases: phases([
      ['§7', 'מצב חיסכון בסוללה', 'ודא שהלקוח לא במצב חיסכון בסוללה.'],
      ['§8', 'בדיקת מהירות', 'בקש מהלקוח להריץ בדיקת מהירות. אם התוצאה מתחת ל-5 מגה, המשך לשלב 9.'],
      ['§9', 'ריענון גלישה', 'בצע ריענון גלישה מהצד שלנו והמתן.'],
    ]),
  },
  ours: {
    version: 8,
    phases: phases([
      ['§7', 'מצב חיסכון בסוללה', 'ודא שהלקוח לא במצב חיסכון בסוללה.'],
      ['§8', 'בדיקת מהירות', 'בקש מהלקוח להריץ בדיקת מהירות. אם התוצאה מתחת ל-6 מגה, המשך לשלב 9.'],
      ['§9', 'ריענון גלישה', 'בצע ריענון גלישה מהצד שלנו והמתן.'],
    ]),
  },
  theirs: {
    hash: 'a91c4f2',
    updatedAt: T,
    paragraphs: [
      { ref: '§7', heading: 'מצב חיסכון בסוללה', text: 'ודא שהלקוח לא במצב חיסכון בסוללה.' },
      {
        ref: '§8',
        heading: 'בדיקת מהירות',
        text: 'בקש מהלקוח להריץ בדיקת מהירות כשהוא מנותק מ-Wi-Fi. אם התוצאה מתחת ל-5 מגה, המשך לשלב 9.',
      },
      { ref: '§10', heading: 'תקלת רשת', text: 'אם לא נפתר, פתח תקלה לרשת.' },
    ],
  },
};

/* ── wave 3: the Entra group directory behind `GET /admin/groups/search` ──── */

/**
 * `KB-New` is already in `fx.groupsMap`, so the search can show a result that must come back
 * disabled — offering a group that is already mapped would produce a duplicate row nobody wants.
 */
export const directoryGroups: GroupSearchItem[] = [
  { id: 'g-editors', displayName: 'KB-Editors', description: 'עורכי ידע' },
  { id: 'g-new', displayName: 'KB-New' },
  { id: 'g-support', displayName: 'Support-L2', description: 'נציגי רמה 2' },
];

/* ── wave 3: the parity report (design 4d) ────────────────────────────────── */

export const D_UNLINKED = 'bbbb1111-1111-4111-8111-111111111111';
export const REMOTE_UNLINKED = '311';

/**
 * Deliberately not a copy of the queue rows: the report exists to show the three things the queue
 * cannot — a remote hash that has moved off its baseline, a local fingerprint, and the two lists of
 * things with no link at all.
 */
const initialParity = (): ParityConnector[] => [
  {
    connectorId: C_WP,
    connectorName: 'WordPress',
    remoteAvailable: true,
    items: [
      {
        ...initialLinks()[0],
        localHash: 'a91c4f2de0b1c3a4f5e6d7c8b9a0112233445566778899aabbccddeeff001122',
        remoteHash: '7d02be9aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff0',
        baseRemoteHash: 'c4480ffaa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff0',
        remoteUpdatedAt: T,
      },
      {
        ...initialLinks()[3],
        localHash: '92f70de11223344556677889900aabbccddeeff00112233445566778899aabb0',
        remoteHash: '92f70de11223344556677889900aabbccddeeff00112233445566778899aabb0',
        baseRemoteHash: '92f70de11223344556677889900aabbccddeeff00112233445566778899aabb0',
        remoteUpdatedAt: T,
      },
    ],
    unlinked: {
      documents: [
        {
          documentId: D_UNLINKED,
          title: 'מסמך ללא קישור',
          category: 'tech',
          currentVersion: 3,
          updatedAt: T,
        },
      ],
      remote: [
        {
          externalId: REMOTE_UNLINKED,
          title: 'עמוד שאין לו מסמך',
          hash: '1fa90c6aa11bb22cc33dd44ee55ff6600112233445566778899aabbccddeeff0',
          kind: 'page',
          url: 'https://help.wecom.co.il/page/311',
          updatedAt: T,
        },
      ],
    },
  },
  {
    connectorId: C_FOLDER,
    connectorName: 'תיקיית Word',
    // The folder connector has never run, so its remote side is genuinely unreadable. A fixture
    // where every connector answers cleanly would never exercise the banner that says so.
    remoteAvailable: false,
    items: [],
    unlinked: { documents: [], remote: [] },
  },
];

/* ── mutable state ────────────────────────────────────────────────────────── */

interface Stage5State {
  identity: IdentitySettings;
  connectors: ConnectorRow[];
  links: SyncLinkRow[];
  parity: ParityConnector[];
  created: { connectorId: string; documentId: string; externalId: string }[];
  runs: string[];
  resolved: { id: string; resolution: string }[];
  synced: { id: string; direction: string }[];
  deleted: string[];
}

const initial = (): Stage5State => ({
  identity: JSON.parse(JSON.stringify(identity)) as IdentitySettings,
  connectors: initialConnectors(),
  links: initialLinks(),
  parity: initialParity(),
  created: [],
  runs: [],
  resolved: [],
  synced: [],
  deleted: [],
});

export const stage5State: Stage5State = initial();

export function resetStage5(): void {
  Object.assign(stage5State, initial());
}

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });

const counts = (links: SyncLinkRow[]) => ({
  synced: links.filter((l) => l.state === 'synced').length,
  pendingImport: links.filter((l) => l.state === 'pending_import').length,
  pendingPush: links.filter((l) => l.state === 'pending_push').length,
  conflict: links.filter((l) => l.state === 'conflict').length,
});

/* ── handlers ─────────────────────────────────────────────────────────────── */

export const stage5Handlers: RequestHandler[] = [
  // Stage 5 moved `GET /admin/users` to `AdminUserRowSchema` (roles with scope, groups, session
  // count) and gave it the q/source/role/active filters the screen drives.
  http.get(`${B}/admin/users`, ({ request }) => {
    const u = new URL(request.url);
    const q = u.searchParams.get('q');
    const source = u.searchParams.get('source');
    const role = u.searchParams.get('role');
    const active = u.searchParams.get('active');
    let items = adminUsers;
    if (q) items = items.filter((x) => x.displayName.includes(q) || (x.email ?? '').includes(q));
    if (source) items = items.filter((x) => x.source === source);
    if (role) items = items.filter((x) => x.roles.some((r) => r.roleId === role || r.roleName === role));
    if (active) items = items.filter((x) => x.active === (active === 'true'));
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),

  http.get(`${B}/admin/identity`, () => HttpResponse.json(stage5State.identity)),
  http.put(`${B}/admin/identity`, async ({ request }) => {
    const body = (await request.json()) as Record<string, Record<string, unknown> | number>;
    const s = stage5State.identity;
    if (body.oidc && typeof body.oidc === 'object') {
      const o = body.oidc as Record<string, unknown>;
      // Secrets are write-only: the response never echoes one back, only `hasSecret`.
      s.oidc = {
        ...s.oidc,
        ...(o.enabled !== undefined ? { enabled: !!o.enabled } : {}),
        ...(o.issuer !== undefined ? { issuer: o.issuer as string | null } : {}),
        ...(o.clientId !== undefined ? { clientId: o.clientId as string | null } : {}),
        ...(o.redirectUri !== undefined ? { redirectUri: o.redirectUri as string | null } : {}),
        hasSecret: o.clientSecret ? true : s.oidc.hasSecret,
      };
    }
    if (body.paloalto && typeof body.paloalto === 'object') {
      const p = body.paloalto as Record<string, unknown>;
      s.paloalto = {
        ...s.paloalto,
        ...(p.enabled !== undefined ? { enabled: !!p.enabled } : {}),
        ...(p.host !== undefined ? { host: p.host as string | null } : {}),
        ...(p.subnets !== undefined ? { subnets: p.subnets as string[] } : {}),
        hasApiKey: p.apiKey ? true : s.paloalto.hasApiKey,
      };
    }
    if (typeof body.sessionHours === 'number') s.sessionHours = body.sessionHours;
    return HttpResponse.json(s);
  }),
  http.post(`${B}/admin/identity/test`, async ({ request }) => {
    const { provider } = (await request.json()) as { provider: 'oidc' | 'paloalto' };
    return HttpResponse.json(
      provider === 'oidc'
        ? { provider, ok: true, message: 'גילוי OIDC הצליח · 3 מפתחות חתימה', details: { keys: 3 } }
        : { provider, ok: false, message: 'השער לא השיב בתוך 5 שניות' },
    );
  }),

  http.get(`${B}/admin/roles/matrix`, () => HttpResponse.json(roleMatrix)),
  http.get(`${B}/admin/audit/:id`, ({ params }) =>
    HttpResponse.json({ ...auditDetail, id: String(params.id) }),
  ),

  http.get(`${B}/connectors/types`, () => HttpResponse.json({ items: connectorTypes })),
  // Ordered before `/connectors/:id` so the literal segment wins.
  http.post(`${B}/connectors/test`, async ({ request }) => {
    const { config } = (await request.json()) as { type: string; config: Record<string, unknown> };
    return typeof config?.baseUrl === 'string' && String(config.baseUrl).startsWith('https://')
      ? HttpResponse.json({ ok: true, message: 'מחובר · WordPress 6.6 · 38 עמודים' })
      : HttpResponse.json({ ok: false, message: 'כתובת האתר חייבת להיות https' });
  }),
  http.get(`${B}/connectors`, () => HttpResponse.json({ items: stage5State.connectors })),
  http.post(`${B}/connectors`, async ({ request }) => {
    const b = (await request.json()) as {
      type: string;
      name: string;
      config: Record<string, unknown>;
      schedule?: string | null;
      enabled?: boolean;
    };
    const row: ConnectorRow = {
      id: 'cc333333-3333-4333-8333-333333333333',
      type: b.type,
      name: b.name,
      enabled: b.enabled ?? true,
      schedule: b.schedule ?? null,
      lastRunAt: null,
      lastStatus: 'never',
      health: null,
      config: b.config,
      links: 0,
      conflicts: 0,
    };
    stage5State.connectors.push(row);
    return HttpResponse.json(row, { status: 201 });
  }),
  http.get(`${B}/connectors/:id`, ({ params }) => {
    const c = stage5State.connectors.find((x) => x.id === params.id);
    return c ? HttpResponse.json(c) : notFound();
  }),
  http.patch(`${B}/connectors/:id`, async ({ params, request }) => {
    const c = stage5State.connectors.find((x) => x.id === params.id);
    if (!c) return notFound();
    const b = (await request.json()) as Partial<ConnectorRow> & { config?: Record<string, unknown> };
    if (b.name !== undefined) c.name = b.name;
    if (b.enabled !== undefined) c.enabled = b.enabled;
    if (b.schedule !== undefined) c.schedule = b.schedule;
    // Merge, not replace — the client sends only the keys that changed, precisely so the secrets
    // it was never given survive a save.
    if (b.config) c.config = { ...c.config, ...b.config };
    return HttpResponse.json(c);
  }),
  http.delete(`${B}/connectors/:id`, ({ params }) => {
    stage5State.deleted.push(String(params.id));
    stage5State.connectors = stage5State.connectors.filter((x) => x.id !== params.id);
    return new HttpResponse(null, { status: 204 });
  }),
  http.post(`${B}/connectors/:id/run`, ({ params }) => {
    stage5State.runs.push(String(params.id));
    return HttpResponse.json({ imported: 2, pushed: 1, conflicts: 0, errors: [] });
  }),
  http.post(`${B}/connectors/:id/test`, ({ params }) => {
    const c = stage5State.connectors.find((x) => x.id === params.id);
    return c ? HttpResponse.json({ ok: true, message: 'מחובר · WordPress 6.6 · 38 עמודים' }) : notFound();
  }),

  http.get(`${B}/sync/links`, ({ request }) => {
    const u = new URL(request.url);
    const state = u.searchParams.get('state');
    const connectorId = u.searchParams.get('connectorId');
    const q = u.searchParams.get('q');
    let items = stage5State.links;
    if (state) items = items.filter((l) => l.state === state);
    if (connectorId) items = items.filter((l) => l.connectorId === connectorId);
    if (q) items = items.filter((l) => l.title.includes(q));
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      pageSize: 50,
      // Counts describe the whole queue, not the filtered page — the tabs must not renumber
      // themselves when a tab is selected.
      counts: counts(stage5State.links),
    });
  }),
  /**
   * The article header's badge. Mirrors the server's ordering: the most urgent state of the
   * document's links wins, and a document with no link at all is `overall: 'unlinked'`.
   */
  http.get(`${B}/documents/:id/sync-state`, ({ params }) => {
    const rank = { conflict: 0, pending_push: 1, pending_import: 2, synced: 3 } as const;
    const links = stage5State.links
      .filter((l) => l.documentId === params.id)
      .sort((a, b) => rank[a.state] - rank[b.state])
      .map((l) => {
        const c = stage5State.connectors.find((x) => x.id === l.connectorId);
        return {
          linkId: l.id,
          connectorId: l.connectorId,
          connectorName: l.connectorName,
          connectorType: c?.type ?? 'wordpress',
          externalId: l.externalId,
          remoteUrl: l.remoteUrl,
          state: l.state,
          localChanged: l.localChanged,
          remoteChanged: l.remoteChanged,
          currentLocalVersion: l.currentLocalVersion,
          baseLocalVersion: l.baseLocalVersion,
          lastSyncedAt: l.lastSyncedAt,
          connectorLastStatus: c?.lastStatus ?? null,
          connectorLastRunAt: c?.lastRunAt ?? null,
        };
      });
    const overall = links[0]?.state ?? 'unlinked';
    const flagReason =
      overall === 'conflict'
        ? 'קונפליקט בסנכרון – המקור המרוחק והפריט השתנו שניהם'
        : overall === 'pending_push'
          ? 'ממתין לדחיפה למקור המרוחק'
          : null;
    return HttpResponse.json({ documentId: params.id, overall, flagReason, links });
  }),
  http.get(`${B}/sync/links/:id/conflict`, ({ params }) => {
    const link = stage5State.links.find((l) => l.id === params.id);
    return link ? HttpResponse.json({ ...conflict, link }) : notFound();
  }),
  http.post(`${B}/sync/links/:id/resolve`, async ({ params, request }) => {
    const link = stage5State.links.find((l) => l.id === params.id);
    if (!link) return notFound();
    const b = (await request.json()) as { resolution: string };
    stage5State.resolved.push({ id: link.id, resolution: b.resolution });
    link.state = 'synced';
    link.remoteChanged = false;
    link.localChanged = false;
    link.lastSyncedAt = T;
    return HttpResponse.json(link);
  }),
  /**
   * Prefix search, as Graph's `startswith(displayName,…)` does it — matching "contains" here would
   * let a screen pass against a mock the real directory cannot answer.
   */
  http.get(`${B}/admin/groups/search`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    if (!q.trim())
      return HttpResponse.json({ code: 'BAD_REQUEST', message: 'נדרש מונח חיפוש' }, { status: 400 });
    return HttpResponse.json({
      items: directoryGroups.filter((g) => g.displayName.toLowerCase().startsWith(q.trim().toLowerCase())),
    });
  }),

  http.get(`${B}/sync/parity`, ({ request }) => {
    const connectorId = new URL(request.url).searchParams.get('connectorId');
    return HttpResponse.json({
      connectors: connectorId
        ? stage5State.parity.filter((c) => c.connectorId === connectorId)
        : stage5State.parity,
    });
  }),
  // Ordered before `/sync/links/:id/…` is irrelevant (different method), but kept beside the queue
  // handler so the two writes to `sync_links` are read together.
  http.post(`${B}/sync/links`, async ({ request }) => {
    const b = (await request.json()) as { connectorId: string; documentId: string; externalId: string };
    const report = stage5State.parity.find((c) => c.connectorId === b.connectorId);
    if (!report) return notFound();
    if (
      stage5State.created.some((c) => c.externalId === b.externalId || c.documentId === b.documentId) ||
      report.items.some((i) => i.externalId === b.externalId || i.documentId === b.documentId)
    )
      return HttpResponse.json(
        { code: 'ALREADY_LINKED', message: 'הפריט המרוחק כבר מקושר למסמך אחר' },
        { status: 409 },
      );
    stage5State.created.push(b);
    const doc = report.unlinked.documents.find((d) => d.documentId === b.documentId);
    // The server creates the link unsynced; the mock must not invent a baseline the real one
    // deliberately refuses to write.
    const row: SyncLinkRow = {
      id: 'dd999999-9999-4999-8999-999999999999',
      connectorId: b.connectorId,
      connectorName: report.connectorName,
      documentId: b.documentId,
      title: doc?.title ?? 'מסמך',
      externalId: b.externalId,
      remoteUrl: null,
      state: 'pending_import',
      baseLocalVersion: 0,
      currentLocalVersion: doc?.currentVersion ?? 0,
      remoteChanged: true,
      localChanged: (doc?.currentVersion ?? 0) !== 0,
      lastSyncedAt: null,
    };
    report.unlinked.documents = report.unlinked.documents.filter((d) => d.documentId !== b.documentId);
    report.unlinked.remote = report.unlinked.remote.filter((r) => r.externalId !== b.externalId);
    return HttpResponse.json(row, { status: 201 });
  }),

  http.post(`${B}/sync/links/:id/sync`, async ({ params, request }) => {
    const link = stage5State.links.find((l) => l.id === params.id);
    if (!link) return notFound();
    const b = (await request.json()) as { direction: 'import' | 'push' };
    stage5State.synced.push({ id: link.id, direction: b.direction });
    link.state = 'synced';
    return HttpResponse.json({
      imported: b.direction === 'import' ? 1 : 0,
      pushed: b.direction === 'push' ? 1 : 0,
      conflicts: 0,
      errors: [],
    });
  }),
];
