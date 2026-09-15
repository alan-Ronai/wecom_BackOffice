import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { guardedFetch, MAX_REDIRECTS, WordPressConnector, WpConfigSchema } from '../src/index.js';

/**
 * M3. `assertAllowedHost` ran once, on the URL the caller passed, and the fetch that followed
 * carried the platform default `redirect: 'follow'`. An allowlisted host could therefore answer
 * `302 Location: http://169.254.169.254/…` and the platform would chase it for us, hand back the
 * body, and the connector would store it as source content. A redirect is a request to fetch a
 * second URL; it has to pass the same gate as the first.
 */
let server: http.Server;
let base: string;
/** Every path the stub was asked for, so a hop that should never have happened is visible. */
const hits: string[] = [];

beforeAll(async () => {
  server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    const u = new URL(req.url ?? '/', base);
    const to = u.searchParams.get('to');
    if (u.pathname === '/redirect' && to) {
      res.writeHead(Number(u.searchParams.get('code') ?? 302), { location: to });
      return res.end();
    }
    // A chain of `n` hops that stays on this host, to exercise the bound rather than the guard.
    if (u.pathname === '/chain') {
      const n = Number(u.searchParams.get('n') ?? 0);
      if (n > 0) {
        res.writeHead(302, { location: `/chain?n=${n - 1}` });
        return res.end();
      }
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('arrived');
    }
    if (u.pathname === '/echo') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null }));
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

describe('guardedFetch', () => {
  const allow = ['127.0.0.1'];

  it('passes a plain request straight through', async () => {
    const res = await guardedFetch(fetch, allow)(`${base}/plain`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('re-checks every hop against the allowlist, so an allowed host cannot redirect off it', async () => {
    const metadata = 'http://169.254.169.254/latest/meta-data/iam/security-credentials/';
    await expect(
      guardedFetch(fetch, allow)(`${base}/redirect?to=${encodeURIComponent(metadata)}`),
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });

    // The same refusal for a host that is merely not on the list, metadata or not.
    await expect(
      guardedFetch(fetch, allow)(`${base}/redirect?to=${encodeURIComponent('http://evil.test/x')}`),
    ).rejects.toMatchObject({ code: 'HOST_NOT_ALLOWED' });
  });

  it('follows a redirect that stays inside the allowlist', async () => {
    const res = await guardedFetch(
      fetch,
      allow,
    )(`${base}/redirect?to=${encodeURIComponent(base + '/plain')}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('ok');
  });

  it('bounds the chain at MAX_REDIRECTS instead of following it forever', async () => {
    expect(MAX_REDIRECTS).toBe(5);
    const ok = await guardedFetch(fetch, allow)(`${base}/chain?n=${MAX_REDIRECTS}`);
    expect(await ok.text()).toBe('arrived');
    await expect(guardedFetch(fetch, allow)(`${base}/chain?n=${MAX_REDIRECTS + 1}`)).rejects.toMatchObject({
      code: 'TOO_MANY_REDIRECTS',
    });
  });

  it('keeps credentials on the origin they were minted for and drops them off it', async () => {
    const headers = { authorization: 'Basic c2VjcmV0' };
    // Same origin: the header is still there at the end of the hop.
    const same = await guardedFetch(fetch, allow)(
      `${base}/redirect?to=${encodeURIComponent(base + '/echo')}`,
      { headers },
    );
    expect(await same.json()).toEqual({ method: 'GET', auth: 'Basic c2VjcmV0' });

    // A different origin — same host, different port — is a different party.
    const other = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ method: req.method, auth: req.headers.authorization ?? null }));
    });
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    const otherUrl = `http://127.0.0.1:${(other.address() as AddressInfo).port}/echo`;
    try {
      const res = await guardedFetch(fetch, allow)(`${base}/redirect?to=${encodeURIComponent(otherUrl)}`, {
        headers,
      });
      expect(await res.json()).toEqual({ method: 'GET', auth: null });
    } finally {
      await new Promise<void>((r) => other.close(() => r()));
    }
  });

  it('turns a 303 (and a 302 after POST) into a GET, as every HTTP client does', async () => {
    const g = guardedFetch(fetch, allow);
    const viaPost = await g(`${base}/redirect?code=302&to=${encodeURIComponent(base + '/echo')}`, {
      method: 'POST',
      body: 'x',
      headers: { 'content-type': 'text/plain' },
    });
    expect((await viaPost.json()).method).toBe('GET');
    const via303 = await g(`${base}/redirect?code=303&to=${encodeURIComponent(base + '/echo')}`, {
      method: 'POST',
      body: 'x',
      headers: { 'content-type': 'text/plain' },
    });
    expect((await via303.json()).method).toBe('GET');
  });

  it('is the path the WordPress connector actually takes', async () => {
    // Nothing in the connector may reach the network except through the guarded wrapper, so a
    // config whose baseUrl redirects off the allowlist fails rather than following.
    const c = new WordPressConnector(fetch, { hostAllowlist: ['127.0.0.1'] });
    const cfg = WpConfigSchema.parse({
      baseUrl: `${base}/redirect?to=${encodeURIComponent('http://169.254.169.254/latest')}&x=`,
      username: 'kb',
      applicationPassword: 'p',
      postTypes: ['posts'],
      categoryMap: {},
      webhookSecret: 's3cret12',
    });
    const before = hits.length;
    const r = await c.testConnection(cfg);
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/host not allowed/);
    // It did ask the allowlisted host, and stopped at its answer.
    expect(hits.length).toBeGreaterThan(before);
  });
});
