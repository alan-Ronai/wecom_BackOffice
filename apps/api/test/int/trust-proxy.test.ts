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

  /**
   * §5 / item 18: production may no longer *fall into* `trustProxy: true`. Trusting any
   * X-Forwarded-For — including one forged by a client that bypasses nginx — is the wrong thing
   * to acquire by omission, since req.ip gates the Palo Alto allowlist, the auth rate-limit
   * buckets and the audit trail. The fallback itself is unchanged for a hand-built config.
   */
  it('is required in production, and defaults to false elsewhere', () => {
    const prod = {
      NODE_ENV: 'production',
      SESSION_SECRET: 'c3f0a91d7be24568af0c1d2e3b4a5968c7d8e9f0a1b2c3d4e5f60718293a4b5c',
      CONNECTOR_KEY: '0123456789abcdef'.repeat(4),
      CONNECTOR_HOST_ALLOWLIST: 'wp.wecom.local',
    };
    expect(() => cfg(prod)).toThrow(/TRUST_PROXY/);
    expect(trustProxySetting(cfg({ ...prod, TRUST_PROXY: '172.16.0.0/12' }))).toEqual(['172.16.0.0/12']);
    expect(trustProxySetting({ ...cfg({}), NODE_ENV: 'production', TRUST_PROXY: undefined })).toBe(true);
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

  /**
   * The hop cap. A CIDR list answers "may this peer be believed?" and then keeps unwinding
   * X-Forwarded-For, so a proxy that appends rather than replaces lets the client choose `req.ip`.
   * `TRUST_PROXY_HOPS` bounds the unwind at the address the immediate proxy wrote.
   */
  describe('TRUST_PROXY_HOPS', () => {
    const hopFn = (over: Record<string, unknown>) => {
      const t = trustProxySetting(cfg(over));
      if (typeof t !== 'function') throw new Error(`expected a trust function, got ${typeof t}`);
      return t;
    };

    it('bounds a CIDR list to that many hops', () => {
      const trust = hopFn({ TRUST_PROXY: '172.16.0.0/12,192.168.0.0/16', TRUST_PROXY_HOPS: '1' });
      // hop 0 is the socket peer — nginx, on the docker bridge.
      expect(trust('172.18.0.5', 0)).toBe(true);
      expect(trust('192.168.1.1', 0)).toBe(true);
      // …and nothing beyond it is unwound, however trusted-looking the address.
      expect(trust('172.18.0.5', 1)).toBe(false);
      // An address outside the list is not a proxy even at hop 0.
      expect(trust('10.1.2.3', 0)).toBe(false);
      expect(trust('not-an-ip', 0)).toBe(false);
      // IPv4-mapped IPv6, which is how a dual-stack peer can arrive.
      expect(trust('::ffff:172.18.0.5', 0)).toBe(true);
    });

    it('allows two hops when two proxies are declared, and takes bare addresses too', () => {
      const trust = hopFn({ TRUST_PROXY: '172.18.0.5,10.0.0.1', TRUST_PROXY_HOPS: '2' });
      expect(trust('172.18.0.5', 0)).toBe(true);
      expect(trust('10.0.0.1', 1)).toBe(true);
      expect(trust('10.0.0.1', 2)).toBe(false);
    });

    it('caps the hops for `true` regardless of address, and changes nothing for `false`', () => {
      const trust = hopFn({ TRUST_PROXY: 'true', TRUST_PROXY_HOPS: '1' });
      expect(trust('203.0.113.1', 0)).toBe(true);
      expect(trust('203.0.113.1', 1)).toBe(false);
      expect(trustProxySetting(cfg({ TRUST_PROXY: 'false', TRUST_PROXY_HOPS: '1' }))).toBe(false);
    });

    it('is unset by default, and an empty value is unset rather than zero', () => {
      expect(cfg({}).TRUST_PROXY_HOPS).toBeUndefined();
      expect(cfg({ TRUST_PROXY_HOPS: '' }).TRUST_PROXY_HOPS).toBeUndefined();
      expect(trustProxySetting(cfg({ TRUST_PROXY: '172.16.0.0/12' }))).toEqual(['172.16.0.0/12']);
    });

    /**
     * M5. The exact-address arm compared the raw string, *before* the `::ffff:` unwrap the CIDR
     * arm does — so `TRUST_PROXY=172.20.0.3` on a dual-stack listener silently stopped trusting
     * nginx. Silently: `req.ip` becomes the proxy's address, so every per-IP rate-limit bucket
     * collapses into one and every audit row records the proxy instead of the caller.
     */
    it('matches an exact address however the peer is spelled', () => {
      const trust = hopFn({ TRUST_PROXY: '172.20.0.3', TRUST_PROXY_HOPS: '1' });
      expect(trust('172.20.0.3', 0)).toBe(true);
      // The same host, as a dual-stack listener hands it over.
      expect(trust('::ffff:172.20.0.3', 0)).toBe(true);
      // …and the other direction: a mapped address written in the config still matches the
      // plain v4 peer, because both sides are normalised rather than only one.
      const mapped = hopFn({ TRUST_PROXY: '::ffff:172.20.0.3', TRUST_PROXY_HOPS: '1' });
      expect(mapped('172.20.0.3', 0)).toBe(true);
      expect(mapped('::ffff:172.20.0.3', 0)).toBe(true);
      // Still nobody else.
      expect(trust('172.20.0.4', 0)).toBe(false);
    });

    /**
     * Deploy review L14. `loopback`/`linklocal`/`uniquelocal` are proxy-addr's own spellings and
     * work with `TRUST_PROXY` alone; the hop-bounded arm is our trust function rather than
     * proxy-addr's list handling, so without the table they became exact addresses matching
     * nothing — a working config that started trusting nobody the moment `TRUST_PROXY_HOPS` was
     * set beside it.
     */
    it('keeps proxy-addr keywords working once TRUST_PROXY_HOPS is set', () => {
      const loopback = hopFn({ TRUST_PROXY: 'loopback', TRUST_PROXY_HOPS: '1' });
      expect(loopback('127.0.0.1', 0)).toBe(true);
      expect(loopback('127.9.9.9', 0)).toBe(true);
      expect(loopback('::1', 0)).toBe(true);
      expect(loopback('10.0.0.1', 0)).toBe(false);

      const unique = hopFn({ TRUST_PROXY: 'uniquelocal', TRUST_PROXY_HOPS: '1' });
      for (const a of ['10.1.2.3', '172.18.0.5', '192.168.1.1', 'fd00::1'])
        expect(unique(a, 0), a).toBe(true);
      expect(unique('203.0.113.1', 0)).toBe(false);

      // Mixed with addresses and CIDRs, which is what a real `.env` line looks like.
      const mixed = hopFn({ TRUST_PROXY: 'loopback,172.16.0.0/12,10.0.0.1', TRUST_PROXY_HOPS: '1' });
      for (const a of ['127.0.0.1', '172.18.0.5', '10.0.0.1']) expect(mixed(a, 0), a).toBe(true);
      expect(mixed('192.168.1.1', 0)).toBe(false);

      const linklocal = hopFn({ TRUST_PROXY: 'linklocal', TRUST_PROXY_HOPS: '1' });
      expect(linklocal('169.254.1.1', 0)).toBe(true);
      expect(linklocal('fe80::1', 0)).toBe(true);
    });

    /**
     * Deploy review L14, the other half: `ipaddr.parseCIDR` threw a bare `invalid CIDR subnet`
     * out of `buildApp`, a stack trace naming ipaddr.js for what is a typo in one line of
     * `deploy/.env`.
     */
    it('turns a malformed TRUST_PROXY into a boot-time config error naming the variable', () => {
      for (const bad of ['172.16.0.0/64', '172.16.0.0/', 'not-an-ip', '10.0.0.0/8,wat'])
        expect(() => cfg({ TRUST_PROXY: bad }), bad).toThrow(/TRUST_PROXY/);
      // The message says what to write instead.
      expect(() => cfg({ TRUST_PROXY: '172.16.0.0/64' })).toThrow(/uniquelocal/);
      // A well-formed value of every accepted shape still parses.
      for (const ok of ['true', 'false', 'loopback', '172.16.0.0/12', '10.0.0.1, uniquelocal'])
        expect(() => cfg({ TRUST_PROXY: ok }), ok).not.toThrow();
    });
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
  let oneHop: Awaited<ReturnType<typeof buildApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  /** Its own pool: `buildApp` ends the pool it was handed on close. */
  let secondPool: pg.Pool;
  let thirdPool: pg.Pool;

  beforeAll(async () => {
    db = await startTestDb();
    secondPool = new pg.Pool({ connectionString: db.url });
    thirdPool = new pg.Pool({ connectionString: db.url });
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
    /**
     * The shipped topology: one proxy, believed because of where it connects from, and nothing
     * unwound past what it wrote. `127.0.0.0/8` is the CIDR `app.inject` arrives from.
     */
    oneHop = await buildApp({
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        TRUST_PROXY: '127.0.0.0/8,172.16.0.0/12',
        TRUST_PROXY_HOPS: 1,
      },
      pool: thirdPool,
      boss: false,
      plugins: [fakeAuth],
    });
    u = await makeUser(db.pool);
  }, 240000);

  afterAll(async () => {
    await trusting?.close();
    await untrusting?.close();
    await oneHop?.close();
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

  /**
   * The header a *forging* client produces once an appending proxy has added its own view:
   * `10.1.2.3` is what the client claimed, `172.18.0.5` is what the proxy saw it as. Under
   * `TRUST_PROXY_HOPS=1` only the proxy's own observation is believed, so the forgery cannot
   * reach the Palo Alto allowlist, the rate-limit bucket or the audit trail — even though
   * deploy/nginx.conf no longer appends and the header should never look like this.
   */
  it('takes only what the immediate proxy wrote when TRUST_PROXY_HOPS=1', async () => {
    const created = await createDoc(oneHop, 'קפיצה אחת');
    expect(created.statusCode).toBe(201);
    const row = await db.pool.query<{ ip: string }>(
      `select ip::text from audit_log where entity_id=$1 and action='docs.create'`,
      [created.json().id],
    );
    expect(row.rows[0].ip).toBe('172.18.0.5');
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
