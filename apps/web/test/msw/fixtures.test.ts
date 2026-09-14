import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  AdminSystemSchema,
  AuditEntrySchema,
  BlockListSchema,
  BlockSchema,
  BlockUsageSchema,
  CrmFieldSchema,
  DeleteResponseSchema,
  DiffResponseSchema,
  DocumentCardSchema,
  DocumentSchema,
  DraftResponseSchema,
  FieldListSchema,
  FieldUsageSchema,
  HealthResponseSchema,
  LinksResponseSchema,
  ListDocumentsResponseSchema,
  MeSchema,
  NoteLikeResponseSchema,
  NoteListSchema,
  NoteSchema,
  PreferencesSchema,
  PublishResponseSchema,
  RelatedResponseSchema,
  RoleSchema,
  ScriptListSchema,
  ScriptSchema,
  SearchResponseSchema,
  SessionSchema,
  SourceRevisionSchema,
  SourceSchema,
  SuggestionSchema,
  TrashItemSchema,
  TrashListSchema,
  UserRoleSchema,
  UserSchema,
  VersionListSchema,
  VersionSchema,
  paginated,
} from '@wecom/shared';
import {
  AdminUserRowSchema,
  AuditEntryDetailSchema,
  ConflictViewSchema,
  ConnectorRowSchema,
  ConnectorTypeInfoSchema,
  GroupsMapResponseSchema,
  IdentitySettingsSchema,
  IdentityTestResultSchema,
  RoleMatrixSchema,
  SyncLinkRowSchema,
  SyncQueueResponseSchema,
  SyncRunResultSchema,
} from '@wecom/shared';
import { fx, D_BROWSING, SUG_1, U1 } from './fixtures.js';
import {
  C_WP,
  LINK_CONFLICT,
  LINK_IMPORT,
  adminUsers,
  auditDetail,
  conflict,
  connectorTypes,
  identity,
  roleMatrix,
} from './stage5.js';
import { state } from './handlers.js';

const B = 'http://kb.test/api/v1';
const DOC = D_BROWSING;
const BLOCK = fx.blocks[0].id;
const FIELD = encodeURIComponent(fx.fields[0].name);
const SOURCE = fx.sources[0].id;

/* ── element-level fixtures ───────────────────────────────────────────────── */

describe('fixtures validate against shared schemas', () => {
  it('documents', () => {
    DocumentSchema.parse(fx.docBrowsing);
    DocumentSchema.parse(fx.docIntl);
    expect(fx.docBrowsing.phases.flatMap((p) => p.steps)).toHaveLength(15);
  });
  it('cards', () => {
    fx.cards.forEach((c) => DocumentCardSchema.parse(c));
    expect(fx.cards.length).toBeGreaterThan(5);
    expect(fx.cards.some((c) => c.status === 'partial')).toBe(true);
    expect(fx.cards.some((c) => c.status === 'draft')).toBe(true);
  });
  it('me / blocks / fields / scripts / notes / versions', () => {
    MeSchema.parse(fx.me);
    fx.blocks.forEach((b) => BlockSchema.parse(b));
    fx.fields.forEach((f) => CrmFieldSchema.parse(f));
    fx.scripts.forEach((s) => ScriptSchema.parse(s));
    fx.notes.forEach((n) => NoteSchema.parse(n));
    fx.versions.forEach((v) => VersionSchema.parse(v));
  });
  it('pipeline', () => {
    fx.sources.forEach((s) => SourceSchema.parse(s));
    SourceRevisionSchema.parse(fx.revision);
    fx.suggestions.forEach((s) => SuggestionSchema.parse(s));
    fx.trash.forEach((t) => TrashItemSchema.parse(t));
  });
  it('admin', () => {
    fx.roles.forEach((r) => RoleSchema.parse(r));
    fx.sessions.forEach((s) => SessionSchema.parse(s));
    fx.audit.forEach((a) => AuditEntrySchema.parse(a));
  });
  it('stage 5 — identity, admin rows, connectors, sync', () => {
    adminUsers.forEach((u) => AdminUserRowSchema.parse(u));
    // A source of each kind, so the screen's badges and its `source` filter both have something
    // to render; and a user with no role, which is what "ללא תפקיד" has to survive.
    expect(new Set(adminUsers.map((u) => u.source))).toEqual(new Set(['entra', 'paloalto', 'local']));
    expect(adminUsers.some((u) => !u.roles.length)).toBe(true);
    expect(adminUsers.some((u) => u.roles[0]?.categoryScope?.length)).toBe(true);
    IdentitySettingsSchema.parse(identity);
    RoleMatrixSchema.parse(roleMatrix);
    AuditEntryDetailSchema.parse(auditDetail);
    connectorTypes.forEach((t) => ConnectorTypeInfoSchema.parse(t));
    ConflictViewSchema.parse(conflict);
    // The merge screen is only interesting when both sides moved off the base.
    expect(conflict.link.state).toBe('conflict');
    expect(conflict.theirs.paragraphs.length).toBeGreaterThan(1);
  });
});

/* ── response-envelope contract ───────────────────────────────────────────── */

/**
 * The real guard: every handler's *response body* is parsed with the response schema the API
 * declares for that route. Validating only element schemas (as this file used to) let the whole
 * `{ items }` / `{ document, version, auditId }` / 204 drift through unnoticed.
 *
 * `.strict()` is deliberately not used — the API is allowed to add fields — but a missing or
 * mis-shaped field fails here rather than at runtime in front of a user.
 */
const okAudit = z.object({ ok: z.literal(true), auditId: z.string() });
const roleWithAudit = RoleSchema.extend({ auditId: z.string() });

type Case = [name: string, init: RequestInit & { url: string }, schema: z.ZodTypeAny | null];

const GET = (url: string): RequestInit & { url: string } => ({ url, method: 'GET' });
const POST = (url: string, body?: unknown): RequestInit & { url: string } => ({
  url,
  method: 'POST',
  ...(body === undefined
    ? {}
    : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
});
const PUT = (url: string, body: unknown): RequestInit & { url: string } => ({
  url,
  method: 'PUT',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});
const PATCH = (url: string, body: unknown): RequestInit & { url: string } => ({
  url,
  method: 'PATCH',
  body: JSON.stringify(body),
  headers: { 'content-type': 'application/json' },
});
const DEL = (url: string): RequestInit & { url: string } => ({ url, method: 'DELETE' });

/** `null` schema means "204, and the body must be empty". */
const cases: Case[] = [
  ['GET /auth/me', GET(`${B}/auth/me`), MeSchema],
  [
    'GET /auth/providers',
    GET(`${B}/auth/providers`),
    z.object({
      providers: z.array(z.enum(['entra', 'local'])),
      fallback: z.enum(['none', 'paloalto']),
    }),
  ],
  [
    'POST /auth/local',
    POST(`${B}/auth/local`, { email: 'a@b.c', password: 'x' }),
    z.object({ ok: z.literal(true) }),
  ],
  ['POST /auth/logout', POST(`${B}/auth/logout`), z.object({ ok: z.literal(true) })],

  ['GET /documents', GET(`${B}/documents`), ListDocumentsResponseSchema],
  ['GET /documents/:id', GET(`${B}/documents/${DOC}`), DocumentSchema],
  ['PATCH /documents/:id', PATCH(`${B}/documents/${DOC}`, { title: 'x' }), DocumentSchema],
  ['GET /documents/:id/versions', GET(`${B}/documents/${DOC}/versions`), VersionListSchema],
  ['GET /documents/:id/versions/:v', GET(`${B}/documents/${DOC}/versions/6`), DocumentSchema],
  ['GET /documents/:id/diff', GET(`${B}/documents/${DOC}/diff?from=6&to=7`), DiffResponseSchema],
  ['GET /documents/:id/related', GET(`${B}/documents/${DOC}/related`), RelatedResponseSchema],
  ['GET /documents/:id/links', GET(`${B}/documents/${DOC}/links`), LinksResponseSchema],
  ['GET /documents/:id/notes', GET(`${B}/documents/${DOC}/notes`), NoteListSchema],
  ['GET /documents/:id/draft (none saved)', GET(`${B}/documents/${DOC}/draft`), null],
  [
    'PUT /documents/:id/draft',
    PUT(`${B}/documents/${DOC}/draft`, { payload: { a: 1 } }),
    DraftResponseSchema,
  ],
  ['DELETE /documents/:id/draft', DEL(`${B}/documents/${DOC}/draft`), null],
  [
    'POST /documents/:id/publish',
    POST(`${B}/documents/${DOC}/publish`, { label: 'v' }),
    PublishResponseSchema,
  ],
  ['POST /documents/:id/restore/:v', POST(`${B}/documents/${DOC}/restore/6`), PublishResponseSchema],
  ['POST /documents/:id/pin', POST(`${B}/documents/${DOC}/pin`), null],
  ['DELETE /documents/:id/pin', DEL(`${B}/documents/${DOC}/pin`), null],
  ['POST /documents/:id/view', POST(`${B}/documents/${DOC}/view`), null],
  ['DELETE /documents/:id', DEL(`${B}/documents/${DOC}`), DeleteResponseSchema],

  [
    'POST /documents/:id/notes',
    POST(`${B}/documents/${DOC}/notes`, { stepKey: null, text: 'n' }),
    NoteSchema,
  ],

  ['GET /blocks', GET(`${B}/blocks`), BlockListSchema],
  ['GET /blocks/:id', GET(`${B}/blocks/${BLOCK}`), BlockSchema],
  ['GET /blocks/:id/usage', GET(`${B}/blocks/${BLOCK}/usage`), BlockUsageSchema],
  ['DELETE /blocks/:id', DEL(`${B}/blocks/${BLOCK}`), DeleteResponseSchema],

  ['GET /fields', GET(`${B}/fields`), FieldListSchema],
  ['GET /fields/:name/usage', GET(`${B}/fields/${FIELD}/usage`), FieldUsageSchema],
  ['DELETE /fields/:name', DEL(`${B}/fields/${FIELD}`), z.object({ auditId: z.string() })],

  ['GET /scripts', GET(`${B}/scripts`), ScriptListSchema],

  ['GET /search', GET(`${B}/search?q=sim`), SearchResponseSchema],
  ['GET /search (filtered)', GET(`${B}/search?q=sim&types=documents`), SearchResponseSchema],

  ['GET /trash', GET(`${B}/trash`), TrashListSchema],
  [
    'POST /trash/:type/:id/restore',
    POST(`${B}/trash/document/${fx.trash[0].id}/restore`),
    z.object({ auditId: z.string() }),
  ],
  ['POST /trash/restore-all', POST(`${B}/trash/restore-all`), z.object({ restored: z.number().int() })],
  ['DELETE /trash', DEL(`${B}/trash`), z.object({ purged: z.number().int() })],

  ['GET /sources', GET(`${B}/sources`), z.object({ items: z.array(SourceSchema) })],
  [
    'POST /sources/:id/process',
    POST(`${B}/sources/${SOURCE}/process`),
    z.object({ revisionId: z.string(), created: z.number().int(), used: z.string() }),
  ],
  ['GET /sources/:id/revisions/:rev', GET(`${B}/sources/${SOURCE}/revisions/latest`), SourceRevisionSchema],

  ['GET /suggestions', GET(`${B}/suggestions`), paginated(SuggestionSchema)],
  ['POST /suggestions/:id/accept', POST(`${B}/suggestions/${SUG_1}/accept`), SuggestionSchema],
  [
    'POST /suggestions/publish',
    POST(`${B}/suggestions/publish`, { sourceId: SOURCE }),
    z.object({ applied: z.number().int(), versions: z.array(z.string()) }),
  ],

  ['GET /me/preferences', GET(`${B}/me/preferences`), PreferencesSchema],

  ['GET /admin/users', GET(`${B}/admin/users`), paginated(AdminUserRowSchema)],
  ['PATCH /admin/users/:id', PATCH(`${B}/admin/users/${U1}`, { active: true }), okAudit],
  ['GET /admin/roles', GET(`${B}/admin/roles`), z.object({ items: z.array(RoleSchema) })],
  [
    'POST /admin/roles',
    POST(`${B}/admin/roles`, { name: 'r', description: 'd', permissions: [] }),
    roleWithAudit,
  ],
  ['DELETE /admin/roles/:id', DEL(`${B}/admin/roles/${fx.roles[0].id}`), okAudit],
  ['GET /admin/groups-map', GET(`${B}/admin/groups-map`), GroupsMapResponseSchema],
  ['PUT /admin/groups-map', PUT(`${B}/admin/groups-map`, { entries: [] }), okAudit],
  ['GET /admin/sessions', GET(`${B}/admin/sessions`), z.object({ items: z.array(SessionSchema) })],
  ['DELETE /admin/sessions/:id', DEL(`${B}/admin/sessions/${fx.sessions[0].id}`), okAudit],
  ['GET /admin/audit', GET(`${B}/admin/audit`), paginated(AuditEntrySchema)],
  ['GET /system/health', GET(`${B}/system/health`), HealthResponseSchema],
  ['GET /admin/system', GET(`${B}/admin/system`), AdminSystemSchema],
  [
    'POST /admin/users',
    POST(`${B}/admin/users`, { email: 'new@wecom.co.il', password: 'x'.repeat(12), displayName: 'חדש' }),
    UserSchema.extend({ roles: z.array(UserRoleSchema) }),
  ],

  ['POST /notes/:id/like', POST(`${B}/notes/${fx.notes[0].id}/like`), NoteLikeResponseSchema],
  ['DELETE /notes/:id', DEL(`${B}/notes/${fx.notes[0].id}`), null],

  /* ── stage 5: admin & identity ─────────────────────────────────────────── */
  ['GET /admin/roles/matrix', GET(`${B}/admin/roles/matrix`), RoleMatrixSchema],
  ['GET /admin/audit/:id', GET(`${B}/admin/audit/${fx.audit[0].id}`), AuditEntryDetailSchema],
  ['GET /admin/identity', GET(`${B}/admin/identity`), IdentitySettingsSchema],
  [
    'PUT /admin/identity',
    PUT(`${B}/admin/identity`, { sessionHours: 12, oidc: { clientSecret: 'new-secret' } }),
    IdentitySettingsSchema,
  ],
  [
    'POST /admin/identity/test',
    POST(`${B}/admin/identity/test`, { provider: 'oidc' }),
    IdentityTestResultSchema,
  ],

  /* ── stage 5: connectors & sync ────────────────────────────────────────── */
  [
    'GET /connectors/types',
    GET(`${B}/connectors/types`),
    z.object({ items: z.array(ConnectorTypeInfoSchema) }),
  ],
  ['GET /connectors', GET(`${B}/connectors`), z.object({ items: z.array(ConnectorRowSchema) })],
  ['GET /connectors/:id', GET(`${B}/connectors/${C_WP}`), ConnectorRowSchema],
  ['PATCH /connectors/:id', PATCH(`${B}/connectors/${C_WP}`, { enabled: false }), ConnectorRowSchema],
  ['POST /connectors/:id/run', POST(`${B}/connectors/${C_WP}/run`), SyncRunResultSchema],
  [
    'POST /connectors/:id/test',
    POST(`${B}/connectors/${C_WP}/test`),
    z.object({ ok: z.boolean(), message: z.string() }),
  ],
  [
    'POST /connectors/test',
    POST(`${B}/connectors/test`, { type: 'wordpress', config: { baseUrl: 'https://x.example' } }),
    z.object({ ok: z.boolean(), message: z.string() }),
  ],
  ['GET /sync/links', GET(`${B}/sync/links`), SyncQueueResponseSchema],
  ['GET /sync/links/:id/conflict', GET(`${B}/sync/links/${LINK_CONFLICT}/conflict`), ConflictViewSchema],
  [
    'POST /sync/links/:id/sync',
    POST(`${B}/sync/links/${LINK_IMPORT}/sync`, { direction: 'import' }),
    SyncRunResultSchema,
  ],
  [
    'POST /sync/links/:id/resolve',
    POST(`${B}/sync/links/${LINK_CONFLICT}/resolve`, { resolution: 'ours' }),
    SyncLinkRowSchema,
  ],
];

describe('msw handlers answer the published response envelopes', () => {
  // Sequential: a few cases deliberately depend on the one before (draft empty → saved → deleted).
  it.each(cases)('%s', async (_name, init, schema) => {
    const { url, ...rest } = init;
    const res = await fetch(url, rest);
    expect(res.status, `${_name} → ${res.status}`).toBeLessThan(300);
    if (schema === null) {
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      return;
    }
    schema.parse(await res.json());
  });

  it('rejects a suggestions publish with no sourceId, like the route does', async () => {
    const res = await fetch(`${B}/suggestions/publish`, { method: 'POST' });
    expect(res.status).toBe(400);
  });

  it('rejects a local login posted with `username`, like the route does', async () => {
    const res = await fetch(`${B}/auth/local`, {
      method: 'POST',
      body: JSON.stringify({ username: 'a', password: 'b' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('answers 204 for an absent draft and the full envelope once one is saved', async () => {
    // The whole reason the editor could tell "no draft yet" from "the draft query failed".
    const empty = await fetch(`${B}/documents/${DOC}/draft`);
    expect(empty.status).toBe(204);
    expect(await empty.text()).toBe('');

    await fetch(`${B}/documents/${DOC}/draft`, {
      method: 'PUT',
      body: JSON.stringify({ payload: { title: 'wip' } }),
      headers: { 'content-type': 'application/json' },
    });
    const saved = await fetch(`${B}/documents/${DOC}/draft`);
    expect(saved.status).toBe(200);
    const body = DraftResponseSchema.parse(await saved.json());
    expect(body.payload).toEqual({ title: 'wip' });
    expect(body.otherEditors).toEqual([]);
  });

  it('requires a current If-Match on a structure save, like the route does', async () => {
    const doc = await (await fetch(`${B}/documents/${DOC}`)).json();
    const body = JSON.stringify({ phases: doc.phases });
    const h = { 'content-type': 'application/json' };

    // 428 without the precondition at all.
    const missing = await fetch(`${B}/documents/${DOC}/structure`, { method: 'PUT', body, headers: h });
    expect(missing.status).toBe(428);

    // 412 with a stale one.
    const stale = await fetch(`${B}/documents/${DOC}/structure`, {
      method: 'PUT',
      body,
      headers: { ...h, 'if-match': 'definitely-stale' },
    });
    expect(stale.status).toBe(412);

    // 200 with the current one — and PATCH rotates it, so the old etag stops working.
    const ok = await fetch(`${B}/documents/${DOC}/structure`, {
      method: 'PUT',
      body,
      headers: { ...h, 'if-match': doc.etag },
    });
    expect(ok.status).toBe(200);
    const patched = await (
      await fetch(`${B}/documents/${DOC}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: 'rotated' }),
        headers: h,
      })
    ).json();
    expect(patched.etag).not.toBe(doc.etag);
  });

  it('honours ?types= as a comma-separated list of group names', async () => {
    const res = await fetch(`${B}/search?q=sim&types=documents`);
    const body = SearchResponseSchema.parse(await res.json());
    expect(body.groups.map((g) => g.type)).toEqual(['documents']);
    expect(state.views).toBeDefined();
  });
});
