import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { startTestDb, integration } from '../helpers/db.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import { buildApp } from '../../src/app.js';
import fakeAuth from '../helpers/fakeAuth.js';
import { loadConfig, trustProxySetting } from '../../src/config.js';
import { ipInSubnets, parseSubnets } from '../../src/modules/auth/paloalto.js';

describe('trustProxySetting', () => {
  const cfg = (over: Record<string, unknown>) =>
    loadConfig({ DATABASE_URL: 'postgres://x/y', NODE_ENV: 'test', ...over });

  it('defaults to true only in production', () => {
    expect(
      trustProxySetting(
        cfg({ NODE_ENV: 'production', SESSION_SECRET: 'x'.repeat(32), CONNECTOR_KEY: 'ab'.repeat(32) }),
      ),
    ).toBe(true);
    expect(trustProxySetting(cfg({}))).toBe(false);
    expect(trustProxySetting(cfg({ NODE_ENV: 'development' }))).toBe(false);
  });
  it('accepts explicit booleans and a CIDR list', () => {
    expect(trustProxySetting(cfg({ TRUST_PROXY: 'true' }))).toBe(true);
    expect(trustProxySetting(cfg({ TRUST_PROXY: 'false' }))).toBe(false);
    expect(trustProxySetting(cfg({ TRUST_PROXY: '172.16.0.0/12, 10.0.0.0/8' }))).toEqual([
      '172.16.0.0/12',
      '10.0.0.0/8',
    ]);
  });
});

const run = integration ? describe : describe.skip;

/**
 * Behind nginx, `req.ip` is what the Palo Alto subnet allowlist (the only control on
 * passwordless auto-login), the per-IP auth rate limits and `audit_log.ip` /
 * `sessions.ip` all see. Without `trustProxy` every one of them saw the proxy.
 */
run('req.ip behind a proxy', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let trusting: Awaited<ReturnType<typeof buildApp>>;
  let untrusting: Awaited<ReturnType<typeof buildApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  /** Its own pool: `buildApp` ends the pool it was handed on close. */
  let secondPool: pg.Pool;

  beforeAll(async () => {
    db = await startTestDb();
    secondPool = new pg.Pool({ connectionString: db.url });
    trusting = await buildApp({
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', TRUST_PROXY: 'true' },
      pool: db.pool as pg.Pool,
      boss: false,
      plugins: [fakeAuth],
    });
    untrusting = await buildApp({
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', TRUST_PROXY: 'false' },
      pool: secondPool,
      boss: false,
      plugins: [fakeAuth],
    });
    u = await makeUser(db.pool);
  }, 240000);

  afterAll(async () => {
    await trusting?.close();
    await untrusting?.close();
    await db?.stop();
  });

  const createDoc = (app: typeof trusting, title: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: { ...auth(u), 'x-forwarded-for': '10.1.2.3, 172.18.0.5' },
      payload: { title, description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
    });

  it('records the client address, not the proxy, in the audit trail', async () => {
    const created = await createDoc(trusting, 'עם פרוקסי');
    expect(created.statusCode).toBe(201);
    const row = await db.pool.query<{ ip: string }>(
      `select ip::text from audit_log where entity_id=$1 and action='docs.create'`,
      [created.json().id],
    );
    // The left-most entry of X-Forwarded-For is the original client.
    expect(row.rows[0].ip).toBe('10.1.2.3');
  });

  it('ignores the header when the proxy is not trusted', async () => {
    const created = await createDoc(untrusting, 'בלי פרוקסי');
    expect(created.statusCode).toBe(201);
    const row = await db.pool.query<{ ip: string }>(
      `select ip::text from audit_log where entity_id=$1 and action='docs.create'`,
      [created.json().id],
    );
    expect(row.rows[0].ip).not.toBe('10.1.2.3');
  });

  it('still rejects a forwarded address outside PALOALTO_SUBNETS', () => {
    // The gate the fallback applies to req.ip: trusting the proxy does not widen it.
    const subnets = parseSubnets('10.1.0.0/16');
    expect(ipInSubnets('10.1.2.3', subnets)).toBe(true);
    expect(ipInSubnets('203.0.113.9', subnets)).toBe(false);
    // The docker bridge address a non-trustProxy deployment would have seen.
    expect(ipInSubnets('172.18.0.5', subnets)).toBe(false);
  });
});
