import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * S1-3 (b) and (c) — the Palo Alto User-ID fallback, end to end through nginx.
 *
 * This is the path a pilot's agents actually take: they never see a login screen. The browser
 * asks for `/library`, `RequireAuth` calls `GET /auth/me`, the API finds no session cookie, sees
 * that `req.ip` is inside `PALOALTO_SUBNETS`, asks the firewall who is at that address, upserts
 * the answer, and hands back a session — all inside the first request. The only other test of any
 * of that is `apps/api/test/int/auth-paloalto.test.ts`, which calls the Fastify instance directly
 * and so cannot see nginx, `X-Forwarded-For`, `TRUST_PROXY`, the `secure` cookie, or the SPA.
 *
 * ── on the addresses ─────────────────────────────────────────────────────────────────────────
 * Nothing here forges a header. deploy/nginx.conf sets `X-Forwarded-For $remote_addr`, replacing
 * whatever the client sent, so `req.ip` is the address the connection to nginx genuinely came
 * from — which is the whole point, since that address is what decides who the firewall is asked
 * about. An earlier version of this file set `X-Forwarded-For: 10.44.0.7` from the developer's
 * machine and was believed; that was the bug, not the fixture.
 *
 * So the stack hands the gate real addresses instead. `deploy/docker-compose.e2e.yml` runs three
 * `scripts/lan-forwarder.mjs` containers, each pinned to a fixed address on a compose network and
 * publishing nginx's 443 to a port on the host. Which port a context opens *is* which client it
 * is:
 *
 *   E2E_LAN_BASE_URL          10.44.0.7      on the LAN, mapped by the firewall
 *   E2E_LAN_UNKNOWN_BASE_URL  10.44.0.9      on the LAN, unknown to the firewall
 *   E2E_OFFSITE_BASE_URL      198.51.100.7   off the LAN
 *   (the default baseURL)     the docker bridge gateway — this machine, as it really is
 *
 * `scripts/e2e-compose.mjs` describes the arrangement; docs/operations.md, "Trusting
 * X-Forwarded-For", describes what it is protecting.
 */

const LAN_IP = process.env.E2E_LAN_IP!;
const LAN_SUBJECT = process.env.E2E_LAN_SUBJECT!;
const LAN_USER = process.env.E2E_LAN_USER!;
const LAN_ROLE = process.env.E2E_LAN_ROLE!;
const LAN_UNKNOWN_IP = process.env.E2E_LAN_UNKNOWN_IP!;
const OFFSITE_IP = process.env.E2E_OFFSITE_IP!;
const PANOS = process.env.E2E_PANOS_CONTROL!;

const LAN_URL = process.env.E2E_LAN_BASE_URL!;
const LAN_UNKNOWN_URL = process.env.E2E_LAN_UNKNOWN_BASE_URL!;
const OFFSITE_URL = process.env.E2E_OFFSITE_BASE_URL!;

type PanosState = { calls: { ip: string; user: string | null }[]; keyInQuery: boolean };
const panosState = async (request: { get(url: string): Promise<{ json(): Promise<unknown> }> }) =>
  (await (await request.get(`${PANOS}/_control/state`)).json()) as PanosState;

/**
 * A signed-out context that reaches nginx through `baseURL`'s forwarder — i.e. from that
 * forwarder's address. `headers` exists for one test only, which proves they are not believed.
 */
async function clientAt(browser: Browser, baseURL: string, headers?: Record<string, string>): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL,
    locale: 'he-IL',
    ignoreHTTPSErrors: true,
    /**
     * Explicitly empty, and this is half the point of the file: `browser.newContext()` merges the
     * project's `use` over its own options, so without this every context here started with the
     * break-glass admin's `storageState` and the login screen cheerfully offered to continue as
     * *him*. Every assertion below is about what a browser with **no** session is given.
     */
    storageState: { cookies: [], origins: [] },
    ...(headers ? { extraHTTPHeaders: headers } : {}),
  });
  return ctx.newPage();
}

const opened: Page[] = [];
test.afterEach(async () => {
  for (const p of opened.splice(0)) await p.context().close();
});

test('a browser from the trusted subnet is identified by the firewall and lands in the library', async ({
  browser,
  request,
}) => {
  const page = await clientAt(browser, LAN_URL);
  opened.push(page);

  // No cookie, no login form, no interaction: straight to the deep link that RequireAuth guards.
  await page.goto('/library');
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByTestId('library-grid')).toBeVisible();

  /* who the session belongs to ------------------------------------------------ */
  const me = (await (await page.request.get('/api/v1/auth/me')).json()) as {
    user: { subject: string; source: string; displayName: string; email: string | null };
    roles: string[];
    permissions: string[];
  };
  expect(me.user.subject).toBe(LAN_SUBJECT);
  expect(me.user.source).toBe('paloalto');
  // `DOMAIN\user` is the subject; the display name is the user half, which is what the firewall
  // actually knows about the person.
  expect(me.user.displayName).toBe(LAN_USER);
  expect(me.user.email, 'a firewall-identified user has no email — docs/identity.md §3').toBeNull();
  expect(me.roles).toEqual([LAN_ROLE]);

  /* …and the role is the one the deployment granted, not a blank session ------- */
  const who = page.locator('.user .who');
  await expect(who).toContainText(LAN_USER);
  await expect(who).toContainText(LAN_ROLE);
  expect(me.permissions).toContain('docs.read');
  expect(me.permissions).not.toContain('docs.create');
  // Which the library honours: an agent gets no authoring affordance.
  await expect(page.getByRole('button', { name: /פריט ידע חדש/ })).toHaveCount(0);

  /* the session is a real one, not a per-request identification --------------- */
  const cookies = await page.context().cookies();
  const session = cookies.find((c) => c.name === 'kb_session');
  expect(session, 'the fallback sets the session cookie on the first response').toBeTruthy();
  expect(session!.secure, 'set over TLS under NODE_ENV=production').toBe(true);
  expect(session!.httpOnly).toBe(true);

  /* …and the firewall really was asked — about the address the connection came
     from, which nginx wrote into X-Forwarded-For — over a call that leaked no API key */
  const state = await panosState(request);
  expect(state.calls.some((c) => c.ip === LAN_IP && c.user === LAN_SUBJECT)).toBe(true);
  expect(state.keyInQuery, 'the API key must travel in the POST body, never in a URL the firewall logs').toBe(
    false,
  );
});

test('the login screen offers to continue as the firewall-identified user', async ({ browser }) => {
  const page = await clientAt(browser, LAN_URL);
  opened.push(page);

  // `/login` is the one route that probes `/auth/me` on purpose, to show who it thinks you are
  // before you are sent anywhere.
  await page.goto('/login');
  await expect(page.getByText('זוהית אוטומטית דרך')).toBeVisible();
  await expect(page.getByRole('button', { name: `המשך כ־${LAN_USER}` })).toBeVisible();
  await page.getByRole('button', { name: `המשך כ־${LAN_USER}` }).click();
  await expect(page.getByTestId('library-grid')).toBeVisible();
});

test('an address inside the trusted subnet that the firewall cannot name stays signed out', async ({
  browser,
  request,
}) => {
  const page = await clientAt(browser, LAN_UNKNOWN_URL);
  opened.push(page);

  await page.goto('/library');
  // The subnet check passes and the firewall is asked; it answers with an empty result, and an
  // empty result is not an identity.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('דוא״ל')).toBeVisible();
  await expect(page.getByText('זוהית אוטומטית דרך')).toHaveCount(0);
  await expect(page.locator('.user .who')).toHaveCount(0);

  const state = await panosState(request);
  expect(
    state.calls.some((c) => c.ip === LAN_UNKNOWN_IP && c.user === null),
    'the firewall was asked about this address and had no answer',
  ).toBe(true);
});

test('a browser from outside the trusted subnet gets the login page, and the firewall is never asked', async ({
  browser,
  baseURL,
  request,
}) => {
  const before = await panosState(request);

  // Two clients that must both be refused: one connecting from an address off the corporate LAN,
  // and one that arrives as the docker bridge gateway — a real address, and the honest "this
  // machine is not on the LAN" case.
  for (const url of [OFFSITE_URL, baseURL!]) {
    const page = await clientAt(browser, url);
    opened.push(page);
    await page.goto('/library');
    await expect(page, `a client at ${url} is not identified`).toHaveURL(/\/login/);
    await expect(page.getByLabel('דוא״ל')).toBeVisible();
    await expect(page.getByText('זוהית אוטומטית דרך')).toHaveCount(0);
  }

  const after = await panosState(request);
  // The subnet allowlist is checked *before* the lookup — an address outside it never reaches the
  // firewall at all, which is what keeps a public-facing deployment from becoming a User-ID probe.
  expect(after.calls.length, 'no lookup was made for an address outside PALOALTO_SUBNETS').toBe(
    before.calls.length,
  );
  expect(after.calls.some((c) => c.ip === OFFSITE_IP)).toBe(false);
});

/**
 * The attack the old shape of this file was built on, now asserted against.
 *
 * `10.44.0.9` is on the LAN but nobody; `10.44.0.7` is the agent the firewall maps. While nginx
 * *appended* to `X-Forwarded-For`, a browser at .9 — or at any address that could reach nginx at
 * all — could send `X-Forwarded-For: 10.44.0.7` and be handed that agent's session. nginx now
 * replaces the header, and `TRUST_PROXY_HOPS=1` keeps that true even if it were misconfigured to
 * append again: the client's claim never becomes `req.ip`.
 */
test('a browser that forges X-Forwarded-For is still seen as the address it connected from', async ({
  browser,
  request,
}) => {
  const before = await panosState(request);
  const lookupsForLanIp = (s: PanosState) => s.calls.filter((c) => c.ip === LAN_IP).length;

  const page = await clientAt(browser, LAN_UNKNOWN_URL, {
    'X-Forwarded-For': LAN_IP,
    'X-Real-IP': LAN_IP,
  });
  opened.push(page);

  await page.goto('/library');
  await expect(page, 'the forged address did not become req.ip').toHaveURL(/\/login/);
  await expect(page.getByLabel('דוא״ל')).toBeVisible();
  await expect(page.getByText('זוהית אוטומטית דרך')).toHaveCount(0);
  const cookies = await page.context().cookies();
  expect(
    cookies.find((c) => c.name === 'kb_session'),
    'no session was issued',
  ).toBeUndefined();

  // Whatever the firewall was asked in the course of this, it was not asked about the address the
  // browser claimed to hold. (It may not have been asked anything: the fallback caches a negative
  // answer per address, and 10.44.0.9 was already found to be nobody by the test above.)
  const after = await panosState(request);
  expect(lookupsForLanIp(after), 'the firewall was not asked about the forged address').toBe(
    lookupsForLanIp(before),
  );
});
