import type { APIRequestContext, Browser, Page } from '@playwright/test';
import { expect } from '@playwright/test';

export interface Creds {
  id: string;
  email: string;
  password: string;
  displayName: string;
}

/**
 * Creates a local user with one seeded role through the real admin API.
 *
 * The wave-4 flows are about *different people seeing different things* — an agent reports, an
 * editor decides, a reader is refused — so the specs cannot all run as the break-glass admin the
 * storage state signs in as. `request` here is the admin-authenticated context Playwright hands
 * the test, which is what makes `POST /admin/users` allowed.
 */
export async function createUser(
  request: APIRequestContext,
  roleName: 'agent' | 'editor' | 'lead',
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
 * (the shared `storageState`) is not the one being exercised.
 */
export async function signInAs(browser: Browser, creds: Creds): Promise<Page> {
  const ctx = await browser.newContext({ locale: 'he-IL' });
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel('דוא״ל').fill(creds.email);
  await page.getByLabel('סיסמה').fill(creds.password);
  await page.getByRole('button', { name: /^כניסה/ }).click();
  await expect(page).toHaveURL(/\/library/);
  return page;
}
