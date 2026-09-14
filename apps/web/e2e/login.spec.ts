import { test, expect } from '@playwright/test';

test.describe('login screen', () => {
  test('offers SSO first and keeps break-glass folded behind a disclosure', async ({ page }) => {
    await page.goto('/login?returnTo=%2Fadmin%2Fidentity');
    const sso = page.getByRole('link', { name: 'כניסה עם חשבון Microsoft של wecom' });
    await expect(sso).toBeVisible();
    await expect(sso).toHaveAttribute('href', /returnTo=%2Fadmin%2Fidentity/);

    // The local form is the last resort: not on screen until asked for.
    await expect(page.getByLabel('דוא״ל')).toHaveCount(0);
    await page.getByRole('button', { name: 'כניסה מקומית (מנהל מערכת בלבד)' }).click();
    await expect(page.getByLabel('דוא״ל')).toBeVisible();
    await expect(page.getByLabel('סיסמה')).toBeVisible();
  });
});

// Needs the local OIDC issuer plus an API configured against it; skipped for the mock-backed run.
test.describe('real OIDC round trip', () => {
  test.skip(process.env.E2E_OIDC !== '1', 'no OIDC test issuer running');

  test('signs in through the test issuer and lands in the library', async ({ page }) => {
    await page.goto('/library');
    await page.getByRole('link', { name: 'כניסה עם חשבון Microsoft של wecom' }).click();
    await page.getByLabel('Login').fill('e2e-user');
    await page.getByLabel('Password').fill('x');
    await page.getByRole('button', { name: 'Sign-in' }).click();
    const cont = page.getByRole('button', { name: 'Continue' });
    if (await cont.isVisible()) await cont.click();
    await expect(page.getByText('ספריית ידע').first()).toBeVisible();
    await expect(page.getByText('בודק E2E')).toBeVisible();
    await page.context().storageState({ path: 'e2e/.auth/lead.json' });
  });
});
