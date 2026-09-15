/**
 * Every stage-5 handler response, parsed with the schema its route is built to.
 *
 * The stage-4 and collab surfaces already had a suite like this; stage 5 did not, and the cost of
 * that was exact: for a whole wave `GET /connectors/{id}` answered the list's row shape in the
 * mock while `openapi.json` published a masked-detail shape, the edit form read `.config` off it,
 * got `undefined`, and PATCHed the blank back — and thirteen unit tests plus four e2e specs stayed
 * green the entire time, because they were all asking the same mock the same wrong question.
 *
 * What makes this file worth having is the pair of assertions on the connector routes. The two
 * shapes have since been converged — all four routes answer `ConnectorRowSchema` — so what is
 * checked now is that they *stay* converged: the detail routes are parsed with the list's schema,
 * and the fields whose absence caused the bug (`config`, and the counts) are asserted present
 * rather than merely optional.
 */
import { describe, expect, it } from 'vitest';
import {
  AdminUserRowSchema,
  AuditEntryDetailSchema,
  ConflictViewSchema,
  ConnectorRowSchema,
  ConnectorTypeInfoSchema,
  GroupSearchResponseSchema,
  IdentitySettingsSchema,
  ParityResponseSchema,
  RoleMatrixSchema,
  SyncLinkRowSchema,
  SyncQueueResponseSchema,
  SyncRunResultSchema,
  paginated,
} from '@wecom/shared';
import {
  C_FOLDER,
  C_WP,
  D_UNLINKED,
  LINK_CONFLICT,
  LINK_IMPORT,
  REMOTE_UNLINKED,
  AUDIT_1,
} from './stage5.js';

const B = 'http://kb.test/api/v1';
const get = async (path: string) => (await fetch(`${B}${path}`)).json();
const send = async (method: string, path: string, body?: unknown) =>
  (
    await fetch(`${B}${path}`, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    })
  ).json();

describe('stage-5 handlers answer the published envelopes', () => {
  it('GET /admin/identity carries only the has-a-secret flags, never a secret', async () => {
    const body = IdentitySettingsSchema.parse(await get('/admin/identity'));
    expect(body.oidc.hasSecret).toBe(true);
    expect(JSON.stringify(body)).not.toMatch(/clientSecret|apiKey"\s*:\s*"/);
  });

  it('GET /admin/users', async () => {
    const body = paginated(AdminUserRowSchema).parse(await get('/admin/users?page=1&pageSize=50'));
    expect(body.items.length).toBeGreaterThan(0);
    // All four identity sources are represented, which is what the source badges render.
    expect(new Set(body.items.map((u) => u.source))).toEqual(
      new Set(['entra', 'paloalto', 'local', 'entra']),
    );
  });

  it('GET /admin/roles/matrix', async () => {
    const body = RoleMatrixSchema.parse(await get('/admin/roles/matrix'));
    expect(body.roles.some((r) => r.system)).toBe(true);
    expect(body.roles.some((r) => !r.system)).toBe(true);
  });

  it('GET /admin/audit/{id}', async () => {
    const body = AuditEntryDetailSchema.parse(await get(`/admin/audit/${AUDIT_1}`));
    expect(body.diff.length).toBeGreaterThan(0);
  });

  it('GET /connectors/types', async () => {
    const body = (await get('/connectors/types')) as { items: unknown[] };
    body.items.forEach((t) => ConnectorTypeInfoSchema.parse(t));
    expect(body.items.length).toBeGreaterThan(1);
  });

  it('GET /connectors carries config and the counts the table renders', async () => {
    const body = (await get('/connectors')) as { items: unknown[] };
    body.items.forEach((c) => ConnectorRowSchema.parse(c));
    expect(body.items.length).toBeGreaterThan(1);
  });

  it('GET /connectors/{id} answers the SAME shape as the list', async () => {
    const body = ConnectorRowSchema.parse(await get(`/connectors/${C_WP}`));
    // The field whose absence loaded the edit form blank and PATCHed the blank back.
    expect(body.config.baseUrl).toBe('https://help.wecom.co.il');
    // Secrets are masked on the way out, which is what lets the wizard omit them on save.
    expect(body.config.applicationPassword).toBe('••••');
  });

  it('POST /connectors and PATCH /connectors/{id} answer that shape too', async () => {
    ConnectorRowSchema.parse(
      await send('POST', '/connectors', { type: 'folder', name: 'תיקייה נוספת', config: { path: '\\\\x' } }),
    );
    const patched = ConnectorRowSchema.parse(
      await send('PATCH', `/connectors/${C_FOLDER}`, { config: { recursive: false } }),
    );
    // A partial config PATCH merges rather than replaces — the key the client did not send
    // survives, which is what lets it omit the masked secrets it was never given.
    expect(patched.config.path).toBe('\\\\fs01\\kb\\procedures');
    expect(patched.config.recursive).toBe(false);
  });

  it('POST /connectors/test and POST /connectors/{id}/test answer {ok, message}', async () => {
    const dry = (await send('POST', '/connectors/test', {
      type: 'wordpress',
      config: { baseUrl: 'https://help.wecom.co.il' },
    })) as Record<string, unknown>;
    expect(Object.keys(dry).sort()).toEqual(['message', 'ok']);
    const saved = (await send('POST', `/connectors/${C_WP}/test`)) as Record<string, unknown>;
    expect(Object.keys(saved).sort()).toEqual(['message', 'ok']);
  });

  it('POST /connectors/{id}/run', async () => {
    SyncRunResultSchema.parse(await send('POST', `/connectors/${C_WP}/run`));
  });

  it('GET /sync/links carries the counts the queue tabs render', async () => {
    const body = SyncQueueResponseSchema.parse(await get('/sync/links?page=1&pageSize=50'));
    expect(body.counts.conflict).toBeGreaterThan(0);
    expect(body.items.length).toBe(body.total);
  });

  it('GET /sync/links/{id}/conflict', async () => {
    const body = ConflictViewSchema.parse(await get(`/sync/links/${LINK_CONFLICT}/conflict`));
    // All three sides are present, which is what the three-column merge screen needs.
    expect(body.base.phases?.length).toBeGreaterThan(0);
    expect(body.ours.phases.length).toBeGreaterThan(0);
    expect(body.theirs.paragraphs.length).toBeGreaterThan(0);
  });

  it('POST /sync/links/{id}/sync', async () => {
    SyncRunResultSchema.parse(await send('POST', `/sync/links/${LINK_IMPORT}/sync`, { direction: 'import' }));
  });

  it('GET /admin/groups/search is a prefix match, as Graph startswith() is', async () => {
    const body = GroupSearchResponseSchema.parse(await get('/admin/groups/search?q=KB'));
    expect(body.items.map((g) => g.displayName)).toEqual(['KB-Editors', 'KB-New']);
    // "contains" here would let a screen pass against a mock the real directory cannot answer.
    expect(GroupSearchResponseSchema.parse(await get('/admin/groups/search?q=Editors')).items).toEqual([]);
  });

  it('GET /sync/parity carries both sides per row and the two unlinked lists', async () => {
    const body = ParityResponseSchema.parse(await get('/sync/parity'));
    const wp = body.connectors.find((c) => c.connectorId === C_WP)!;
    expect(wp.items.every((i) => i.localHash && i.remoteHash)).toBe(true);
    // One row has moved off its baseline and one has not — the report is useless if every row
    // agrees, because then nothing distinguishes "in step" from "not compared".
    expect(wp.items.filter((i) => i.remoteHash !== i.baseRemoteHash)).toHaveLength(1);
    expect(wp.unlinked.documents).toHaveLength(1);
    expect(wp.unlinked.remote).toHaveLength(1);
    // An unreadable remote is a state the report carries, not an error it throws.
    expect(body.connectors.some((c) => !c.remoteAvailable)).toBe(true);
  });

  it('POST /sync/links answers a link with no baseline, and drops it from both lists', async () => {
    const row = SyncLinkRowSchema.parse(
      await send('POST', '/sync/links', {
        connectorId: C_WP,
        documentId: D_UNLINKED,
        externalId: REMOTE_UNLINKED,
      }),
    );
    expect(row).toMatchObject({ state: 'pending_import', lastSyncedAt: null });
    const after = ParityResponseSchema.parse(await get(`/sync/parity?connectorId=${C_WP}`));
    expect(after.connectors[0].unlinked.documents).toHaveLength(0);
    expect(after.connectors[0].unlinked.remote).toHaveLength(0);
  });
});
