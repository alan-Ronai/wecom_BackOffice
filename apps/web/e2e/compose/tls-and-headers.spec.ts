import { test, expect, type APIResponse } from '@playwright/test';

/**
 * S1-3 (a) — the edge nginx serves, seen from outside it.
 *
 * `deploy/smoke.sh` already checks the five security headers on `GET /`. This checks them on the
 * three responses a browser actually loads — the document, the hashed JS bundle, and an API call
 * — because that is where the O-1 finding lived: `location /` and `location /assets/` each
 * declare an `add_header` of their own, and nginx discards *every* inherited header in a location
 * that does, so the two responses the browser renders carried no CSP at all while `curl`ing the
 * API looked fine. A regression there is one missing `include` away, and nothing else in the repo
 * would see it.
 */

const REQUIRED = [
  'strict-transport-security',
  'x-content-type-options',
  'x-frame-options',
  'referrer-policy',
  'content-security-policy',
];

function assertSecurityHeaders(res: APIResponse, what: string) {
  const headers = res.headers();
  for (const h of REQUIRED) expect(headers[h], `${what} is missing the ${h} header`).toBeTruthy();
  expect(headers['strict-transport-security'], what).toContain('max-age=');
  expect(headers['x-content-type-options'], what).toBe('nosniff');
  // The app loads nothing third-party; a policy that had grown a wildcard would still be a
  // "present" header, so the assertion is on what it says.
  expect(headers['content-security-policy'], what).toContain("default-src 'self'");
  expect(headers['content-security-policy'], what).toContain("object-src 'none'");
}

test('the SPA document is served over TLS with the security headers', async ({ request, baseURL }) => {
  expect(baseURL, 'E2E_COMPOSE_BASE_URL is set by scripts/e2e-compose.mjs').toMatch(/^https:/);
  const res = await request.get('/');
  expect(res.status()).toBe(200);
  expect(res.url()).toMatch(/^https:/);
  assertSecurityHeaders(res, 'GET /');
  expect(await res.text()).toContain('<div id="root">');
});

test('the hashed asset bundle carries them too, and is still cached', async ({ request }) => {
  const html = await (await request.get('/')).text();
  // The built index.html references the entry chunk by its hashed name; take it from there rather
  // than guessing, so this keeps working across rebuilds.
  const asset = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(asset, 'index.html references a hashed /assets/*.js bundle').toBeTruthy();

  const res = await request.get(asset!);
  expect(res.status()).toBe(200);
  assertSecurityHeaders(res, `GET ${asset}`);
  // `location /assets/` declares `expires`/`Cache-Control` — the very declaration that discards
  // inherited headers. Asserting both together is the point: the caching must survive the fix.
  expect(res.headers()['cache-control']).toContain('immutable');
});

test('the API answers through the proxy with the security headers and a request id', async ({ request }) => {
  const res = await request.get('/api/v1/system/health');
  expect(res.status()).toBe(200);
  assertSecurityHeaders(res, 'GET /api/v1/system/health');
  expect(res.headers()['x-request-id'], 'the API stamps a request id nginx logs').toBeTruthy();

  const body = (await res.json()) as {
    db: boolean;
    modelStatus: { reachable: boolean; tagPresent: boolean; name: string };
  };
  expect(body.db).toBe(true);
  // The gate waits for this before starting Playwright; asserting it here is what makes the
  // "a pilot's stack, not a stripped-down one" claim checkable from inside the suite.
  expect(body.modelStatus.reachable).toBe(true);
  expect(body.modelStatus.tagPresent, `${body.modelStatus.name} is pulled`).toBe(true);
});

test('the SSE stream carries them too — it is its own nginx location', async ({ browser, baseURL }) => {
  // `= /api/v1/events` is an *exact* match, so it outranks the `/api/` prefix block and is what
  // actually governs the stream. That makes it a separate location with an `include` of its own,
  // and the same O-1 shape as `/` and `/assets/`: delete that one line and the app's only
  // long-lived connection ships with no CSP while all three assertions above still pass.
  //
  // Asked without a session deliberately. With one the handler calls `reply.hijack()` and streams
  // `text/event-stream` forever, and `apiRequestContext.get` buffers the whole body — so an
  // authenticated request here does not return until the test times out two minutes later. Without
  // a session the auth preHandler (`requires: ['docs.read']`) answers 401 from the same location,
  // which is all this needs: the headers are declared `always` precisely so that an error response
  // carries them too.
  //
  // `storageState` explicitly empty for the reason `lan-identity.spec.ts` spells out —
  // `browser.newContext()` merges the project's `use` over its own options, so without this the
  // context starts as the break-glass admin and the stream opens for real.
  const context = await browser.newContext({
    baseURL,
    ignoreHTTPSErrors: true,
    storageState: { cookies: [], origins: [] },
  });
  try {
    // And a short timeout as the backstop: if this ever does open a stream again, it should say so
    // in seconds rather than hold the suite for the full two-minute test timeout.
    const res = await context.request.get('/api/v1/events', { timeout: 15_000 });
    expect(res.status(), 'no session, so the stream is refused before it is hijacked').toBe(401);
    assertSecurityHeaders(res, 'GET /api/v1/events');
  } finally {
    await context.close();
  }
});

test('plain HTTP is redirected to HTTPS rather than served', async ({ request, baseURL }) => {
  const httpUrl = baseURL!.replace('https://', 'http://').replace(':8443', ':8080');
  const res = await request.get(`${httpUrl}/library`, { maxRedirects: 0 });
  expect(res.status()).toBe(301);
  expect(res.headers()['location']).toMatch(/^https:\/\/.*\/library$/);
});
