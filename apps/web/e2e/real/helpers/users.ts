import { request as playwrightRequest, expect } from '@playwright/test';
import type { APIRequestContext, Browser, Page } from '@playwright/test';

export interface Creds {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

/**
 * An API context that carries the admin's session, taken from a browser context that already has
 * it.
 *
 * Neither the `request` fixture nor a freshly signed-in `request.newContext()` works here: the
 * API sets its session cookie `secure` under `NODE_ENV=production` (which is what this gate runs),
 * and while Chromium treats `http://127.0.0.1` as a secure origin and keeps it, Playwright's Node
 * request context does not and silently drops it — every call then answers 401. Copying the
 * cookie onto the context as a header sidesteps the jar entirely.
 *
 * Dispose it with `ctx.dispose()`.
 */
export async function adminApi(page: Page, baseURL: string): Promise<APIRequestContext> {
  const cookies = await page.context().cookies();
  expect(cookies.length, 'the storage state carries the admin session').toBeGreaterThan(0);
  return playwrightRequest.newContext({
    baseURL,
    extraHTTPHeaders: { cookie: cookies.map((c) => `${c.name}=${c.value}`).join('; ') },
  });
}

/**
 * Creates a local user with one seeded role through the real admin API.
 *
 * The wave-4 flows are about *different people seeing different things* — an agent reports, an
 * editor decides, a reader is refused — so the specs cannot all run as the one admin the shared
 * storage state signs in as.
 */
export async function createUser(
  request: APIRequestContext,
  roleName: 'agent' | 'editor' | 'lead' | 'approver',
): Promise<Creds> {
  const roles = await request.get('/api/v1/admin/roles');
  expect(roles.ok(), await roles.text()).toBeTruthy();
  const role = ((await roles.json()) as { items: { id: string; name: string }[] }).items.find(
    (r) => r.name === roleName,
  );
  if (!role) throw new Error(`role ${roleName} not seeded`);
  const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  const creds = {
    email: `e2e-${roleName}-${stamp}@wecom.co.il`,
    password: `e2e-${roleName}-password-${stamp}`,
    displayName: `E2E ${roleName} ${stamp}`,
  };
  const res = await request.post('/api/v1/admin/users', {
    // `null` scope = every world; these users are about permissions, not about scope.
    data: { ...creds, roles: [{ roleId: role.id, categoryScope: null }] },
  });
  expect(res.status(), await res.text()).toBe(201);
  const json = (await res.json()) as { id?: string; user?: { id: string } };
  const id = json.user?.id ?? json.id;
  if (!id) throw new Error(`POST /admin/users answered without an id: ${JSON.stringify(json)}`);
  return { id, ...creds };
}

/**
 * Signs in through the real local form in a brand-new context, so the spec's own admin session
 * is not the one being exercised.
 */
export async function signInAs(browser: Browser, creds: Creds, baseURL: string): Promise<Page> {
  // `browser.newContext` inherits nothing from the project's `use`, so the base URL is explicit.
  const ctx = await browser.newContext({ locale: 'he-IL', baseURL });
  const page = await ctx.newPage();
  await page.goto('/login');
  // With an SSO issuer configured (`E2E_OIDC=1`) the screen leads with Entra and folds the
  // local form behind a disclosure — the same shape `auth.setup.ts` follows.
  if (process.env.E2E_OIDC === '1')
    await page.getByRole('button', { name: 'כניסה מקומית (מנהל מערכת בלבד)' }).click();
  await page.getByLabel('דוא״ל').fill(creds.email);
  await page.getByLabel('סיסמה').fill(creds.password);
  // Exact: the disclosure button also starts with "כניסה".
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
  await expect(page).toHaveURL(/\/library/);
  // A new account usually meets the first-login tour, and it covers the library while it is
  // open. Best-effort rather than asserted: whether it shows depends on the preferences row,
  // and this helper is about signing in, not about the tour (`auth.setup.ts` asserts that).
  await page
    .getByRole('button', { name: 'דלג על הסיור' })
    .click({ timeout: 5_000 })
    .catch(() => undefined);
  return page;
}
