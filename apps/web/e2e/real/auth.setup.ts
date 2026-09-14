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

  if (process.env.E2E_OIDC === '1') {
    // With an issuer configured, `GET /auth/providers` answers `['entra','local']` and the screen
    // leads with SSO, folding break-glass behind a disclosure. Both shapes are real deployments,
    // so the setup follows whichever one the gate is running rather than assuming the simpler one.
    await expect(page.getByRole('link', { name: /Microsoft/ })).toBeVisible();
    await page.getByRole('button', { name: 'כניסה מקומית (מנהל מערכת בלבד)' }).click();
  } else {
    // `GET /auth/providers` really returns `{ providers: ['local'], fallback: 'none' }` here:
    // the local form must render, and the Entra button must not.
    await expect(page.getByRole('link', { name: /Microsoft/ })).toHaveCount(0);
  }
  await expect(page.getByLabel('דוא״ל')).toBeVisible();

  await page.getByLabel('דוא״ל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  // Exact: with an issuer configured the disclosure button ("כניסה מקומית…") also starts with
  // "כניסה", and a prefix match would resolve to two buttons.
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();

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
