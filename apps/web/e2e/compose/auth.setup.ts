import { test as setup, expect } from '@playwright/test';

/**
 * Signs in as the break-glass admin through nginx and saves the session for the rest of the
 * Compose suite.
 *
 * The account is the one `scripts/e2e-compose.mjs` creates inside the api container with
 * `pnpm --filter @wecom/api create-admin`. No Entra issuer is configured on this stack, so
 * `GET /auth/providers` answers `{ providers: ['local'], fallback: 'paloalto' }` — the local form
 * renders unfolded, and the Palo Alto notice sits under it because the fallback *is* configured,
 * it simply has nothing to say about the address this browser arrives from (see
 * `lan-identity.spec.ts` for the other side of that).
 */
export const STORAGE_STATE = 'e2e/.auth/compose-admin.json';

setup('signs in with the break-glass local account through nginx', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL!;
  const password = process.env.E2E_ADMIN_PASSWORD!;

  await page.goto('/library');
  await expect(page).toHaveURL(/\/login/);

  // No SSO on this stack, so no Microsoft button and no disclosure to open.
  await expect(page.getByRole('link', { name: /Microsoft/ })).toHaveCount(0);
  await expect(page.getByText(/זוהה חיבור דרך/)).toBeVisible();

  await page.getByLabel('דוא״ל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();

  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByTestId('library-grid')).toBeVisible();

  // The first-login tour covers the library and swallows clicks aimed beneath it. Dismissing it
  // once here settles the preference for every spec that reuses this session.
  const tour = page.getByRole('dialog', { name: 'סיור היכרות' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'דלג על הסיור' }).click();
  await expect(tour).toHaveCount(0);

  await page.context().storageState({ path: STORAGE_STATE });
});
