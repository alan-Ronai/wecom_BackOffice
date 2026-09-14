/**
 * Every stage-5 handler response, parsed with the schema its route is built to.
 *
 * The stage-4 and collab surfaces already had a suite like this; stage 5 did not, and the cost of
 * that was exact: for a whole wave `GET /connectors/{id}` answered the list's row shape in the
 * mock while `openapi.json` published a masked-detail shape, the edit form read `.config` off it,
 * got `undefined`, and PATCHed the blank back — and thirteen unit tests plus four e2e specs stayed
 * green the entire time, because they were all asking the same mock the same wrong question.
 *
 * What makes this file worth having is the pair of assertions on the connector routes: the list
 * really answers the row and the detail routes really answer the detail, checked against two
 * different schemas. A fixture cannot satisfy both by accident.
 */
import { describe, expect, it } from 'vitest';
import {
  AdminUserRowSchema,
  AuditEntryDetailSchema,
  ConflictViewSchema,
  ConnectorRowSchema,
  ConnectorTypeInfoSchema,
  IdentitySettingsSchema,
  RoleMatrixSchema,
  SyncQueueResponseSchema,
  SyncRunResultSchema,
  paginated,
} from '@wecom/shared';
import { ConnectorDetailSchema } from '../../src/api/stage5.js';
import { C_FOLDER, C_WP, LINK_CONFLICT, LINK_IMPORT, AUDIT_1 } from './stage5.js';

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

  it('GET /connectors answers the ROW shape — config, links, conflicts', async () => {
    const body = (await get('/connectors')) as { items: unknown[] };
    body.items.forEach((c) => ConnectorRowSchema.parse(c));
    // And it is genuinely the row, not the detail: the detail schema must reject it.
    expect(ConnectorDetailSchema.safeParse(body.items[0]).success).toBe(false);
  });

  it('GET /connectors/{id} answers the DETAIL shape — configMasked, capabilities', async () => {
    const body = ConnectorDetailSchema.parse(await get(`/connectors/${C_WP}`));
    expect(body.capabilities.webhooks).toBe(true);
    expect(body.configMasked.baseUrl).toBe('https://help.wecom.co.il');
    // Secrets are masked on the way out, which is the whole reason the field is named this way.
    expect(body.configMasked.appPassword).toBe('••••');
    // And it is genuinely the detail, not the row.
    expect(ConnectorRowSchema.safeParse(body).success).toBe(false);
  });

  it('POST /connectors and PATCH /connectors/{id} answer the detail shape too', async () => {
    const created = ConnectorDetailSchema.parse(
      await send('POST', '/connectors', { type: 'folder', name: 'תיקייה נוספת', config: { path: '\\\\x' } }),
    );
    expect(created.capabilities.write).toBe(false);
    const patched = ConnectorDetailSchema.parse(
      await send('PATCH', `/connectors/${C_FOLDER}`, { config: { recursive: false } }),
    );
    // A partial config PATCH merges rather than replaces — the key the client did not send
    // survives, which is what lets it omit the masked secrets it was never given.
    expect(patched.configMasked.path).toBe('\\\\fs01\\kb\\procedures');
    expect(patched.configMasked.recursive).toBe(false);
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
});
