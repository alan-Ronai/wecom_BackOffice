import { test, expect, type Browser, type Page } from '@playwright/test';

/**
 * S1-3 (b) and (c) — the Palo Alto User-ID fallback, end to end through nginx.
 *
 * This is the path a pilot's agents actually take: they never see a login screen. The browser
 * asks for `/library`, `RequireAuth` calls `GET /auth/me`, the API finds no session cookie, sees
 * that `req.ip` is inside `PALOALTO_SUBNETS`, asks the firewall who is at that address, upserts
 * the answer, and hands back a session — all inside the first request. Until now the only test of
 * any of that was `apps/api/test/int/auth-paloalto.test.ts`, which calls the Fastify instance
 * directly and so cannot see nginx, `X-Forwarded-For`, `TRUST_PROXY`, the `secure` cookie, or the
 * SPA.
 *
 * ── on the addresses ─────────────────────────────────────────────────────────────────────────
 * A browser on this machine reaches nginx from the docker bridge gateway, which is deliberately
 * *outside* the trusted subnet — so "an untrusted client" needs no arrangement at all, and the
 * assertion below is on a genuine remote address. To play a client *inside* the LAN, a context
 * sets `X-Forwarded-For`, which nginx appends its own view to and `TRUST_PROXY` then unwinds; the
 * API sees the address the way it sees a real agent one hop further out.
 *
 * That also means a client who can reach nginx chooses the address the firewall is asked about —
 * `X-Forwarded-For $proxy_add_x_forwarded_for` preserves whatever the client sent. On the pilot
 * LAN that is a small exposure (the attacker must already be able to reach the VM, and can only
 * become a user the firewall maps), but it is real, and it is why `TRUST_PROXY` must name the
 * bridge rather than be `true`. Written up in docs/operations.md, "Trusting X-Forwarded-For".
 */

const LAN_IP = process.env.E2E_LAN_IP!;
const LAN_SUBJECT = process.env.E2E_LAN_SUBJECT!;
const LAN_USER = process.env.E2E_LAN_USER!;
const LAN_ROLE = process.env.E2E_LAN_ROLE!;
const LAN_UNKNOWN_IP = process.env.E2E_LAN_UNKNOWN_IP!;
const OFFSITE_IP = process.env.E2E_OFFSITE_IP!;
const PANOS = process.env.E2E_PANOS_CONTROL!;

/** A signed-out context that arrives from `ip`, or — with no `ip` — as whatever it really is. */
async function clientAt(browser: Browser, baseURL: string, ip?: string): Promise<Page> {
  const ctx = await browser.newContext({
    baseURL,
    locale: 'he-IL',
    ignoreHTTPSErrors: true,
    ...(ip ? { extraHTTPHeaders: { 'X-Forwarded-For': ip } } : {}),
  });
  return ctx.newPage();
}

const opened: Page[] = [];
test.afterEach(async () => {
  for (const p of opened.splice(0)) await p.context().close();
});

test('a browser from the trusted subnet is identified by the firewall and lands in the library', async ({
  browser,
  baseURL,
  request,
}) => {
  const page = await clientAt(browser, baseURL!, LAN_IP);
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

  /* …and the firewall really was asked, over a call that leaked no API key ----- */
  const state = (await (await request.get(`${PANOS}/_control/state`)).json()) as {
    calls: { ip: string; user: string | null }[];
    keyInQuery: boolean;
  };
  expect(state.calls.some((c) => c.ip === LAN_IP && c.user === LAN_SUBJECT)).toBe(true);
  expect(state.keyInQuery, 'the API key must travel in the POST body, never in a URL the firewall logs').toBe(
    false,
  );
});

test('the login screen offers to continue as the firewall-identified user', async ({ browser, baseURL }) => {
  const page = await clientAt(browser, baseURL!, LAN_IP);
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
  baseURL,
  request,
}) => {
  const page = await clientAt(browser, baseURL!, LAN_UNKNOWN_IP);
  opened.push(page);

  await page.goto('/library');
  // The subnet check passes and the firewall is asked; it answers with an empty result, and an
  // empty result is not an identity.
  await expect(page).toHaveURL(/\/login/);
  await expect(page.getByLabel('דוא״ל')).toBeVisible();
  await expect(page.getByText('זוהית אוטומטית דרך')).toHaveCount(0);
  await expect(page.locator('.user .who')).toHaveCount(0);

  const state = (await (await request.get(`${PANOS}/_control/state`)).json()) as {
    calls: { ip: string; user: string | null }[];
  };
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
  const before = (await (await request.get(`${PANOS}/_control/state`)).json()) as {
    calls: { ip: string }[];
  };

  // Two clients that must both be refused: one that says it is somewhere else entirely, and one
  // that says nothing at all and so arrives as the docker bridge gateway — a real address, and
  // the honest "this machine is not on the LAN" case.
  for (const ip of [OFFSITE_IP, undefined]) {
    const page = await clientAt(browser, baseURL!, ip);
    opened.push(page);
    await page.goto('/library');
    await expect(page, `a client at ${ip ?? 'the bridge gateway'} is not identified`).toHaveURL(/\/login/);
    await expect(page.getByLabel('דוא״ל')).toBeVisible();
    await expect(page.getByText('זוהית אוטומטית דרך')).toHaveCount(0);
  }

  const after = (await (await request.get(`${PANOS}/_control/state`)).json()) as {
    calls: { ip: string }[];
  };
  // The subnet allowlist is checked *before* the lookup — an address outside it never reaches the
  // firewall at all, which is what keeps a public-facing deployment from becoming a User-ID probe.
  expect(after.calls.length, 'no lookup was made for an address outside PALOALTO_SUBNETS').toBe(
    before.calls.length,
  );
  expect(after.calls.some((c) => c.ip === OFFSITE_IP)).toBe(false);
});
