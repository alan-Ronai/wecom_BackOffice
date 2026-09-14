import { test as setup, expect } from '@playwright/test';

/**
 * Signs in through the real `POST /auth/local` and saves the session cookie for every other
 * real-stack spec. This is the break-glass account `scripts/e2e-real.mjs` creates with
 * `pnpm --filter @wecom/api create-admin`; no SSO issuer is configured and `AUTH_FALLBACK=none`,
 * so this form is genuinely the only way in.
 */
export const STORAGE_STATE = 'e2e/.auth/admin.json';

setup('signs in with the break-glass local account', async ({ page }) => {
  const email = process.env.E2E_ADMIN_EMAIL!;
  const password = process.env.E2E_ADMIN_PASSWORD!;

  await page.goto('/library');
  // Unauthenticated, so RequireAuth bounces us to the login screen.
  await expect(page).toHaveURL(/\/login/);

  // `GET /auth/providers` really returns `{ providers: ['local'], fallback: 'none' }` here:
  // the local form must render, and the Entra button must not.
  await expect(page.getByLabel('דוא״ל')).toBeVisible();
  await expect(page.getByRole('link', { name: /Microsoft/ })).toHaveCount(0);

  await page.getByLabel('דוא״ל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: /^כניסה/ }).click();

  // Lands back on the deep link it was sent from, authenticated.
  await expect(page).toHaveURL(/\/library/);
  await expect(page.getByTestId('library-grid')).toBeVisible();

  /**
   * The first-login tour ("סיור היכרות") is a panel that sits over the library and swallows
   * clicks aimed at anything beneath it. Its completion is a *preference*, so dismissing it once
   * here settles it for every spec and every context this account signs in from — and asserting
   * on it means the tour itself stays covered rather than quietly disabled.
   */
  const tour = page.getByRole('dialog', { name: 'סיור היכרות' });
  await expect(tour).toBeVisible();
  await tour.getByRole('button', { name: 'דלג על הסיור' }).click();
  await expect(tour).toHaveCount(0);

  await page.context().storageState({ path: STORAGE_STATE });
});
