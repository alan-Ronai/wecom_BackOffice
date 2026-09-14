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
  IdentitySettings,
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

export const connectorTypes: ConnectorTypeInfo[] = [
  {
    id: 'wordpress',
    name: 'WordPress',
    capabilities: { read: true, write: true, webhooks: true, identity: false },
    configSchema: {
      type: 'object',
      required: ['baseUrl', 'username', 'appPassword'],
      properties: {
        baseUrl: {
          type: 'string',
          format: 'uri',
          title: 'כתובת האתר',
          examples: ['https://help.wecom.co.il'],
        },
        username: { type: 'string', title: 'משתמש WordPress' },
        appPassword: { type: 'string', writeOnly: true, title: 'סיסמת אפליקציה' },
        postTypes: {
          type: 'array',
          items: { type: 'string' },
          title: 'סוגי תוכן',
          default: ['page', 'post'],
          description: 'מופרדים בפסיק',
        },
        status: { type: 'string', enum: ['publish', 'draft'], title: 'סטטוס בדחיפה', default: 'draft' },
        webhookSecret: { type: 'string', writeOnly: true, title: 'סוד ה-webhook' },
      },
    },
  },
  {
    id: 'folder',
    name: 'תיקייה ברשת',
    capabilities: { read: true, write: false, webhooks: false, identity: false },
    configSchema: {
      type: 'object',
      required: ['path'],
      properties: {
        path: { type: 'string', title: 'נתיב תיקייה', examples: ['\\\\fs01\\kb\\procedures'] },
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
      appPassword: '••••',
      postTypes: ['page', 'post'],
      status: 'draft',
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

/* ── mutable state ────────────────────────────────────────────────────────── */

interface Stage5State {
  identity: IdentitySettings;
  connectors: ConnectorRow[];
  links: SyncLinkRow[];
  runs: string[];
  resolved: { id: string; resolution: string }[];
  synced: { id: string; direction: string }[];
  deleted: string[];
}

const initial = (): Stage5State => ({
  identity: JSON.parse(JSON.stringify(identity)) as IdentitySettings,
  connectors: initialConnectors(),
  links: initialLinks(),
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
