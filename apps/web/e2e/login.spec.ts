import { test, expect } from '@playwright/test';

// Needs the local OIDC issuer plus an API configured against it; skipped for the mock-backed run.
test.skip(process.env.E2E_OIDC !== '1', 'no OIDC test issuer running');

test('signs in through the test issuer and lands in the library', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('link', { name: 'כניסה עם חשבון wecom' }).click();
  await page.getByLabel('Login').fill('e2e-user');
  await page.getByLabel('Password').fill('x');
  await page.getByRole('button', { name: 'Sign-in' }).click();
  const cont = page.getByRole('button', { name: 'Continue' });
  if (await cont.isVisible()) await cont.click();
  await expect(page.getByText('ספריית ידע').first()).toBeVisible();
  await expect(page.getByText('בודק E2E')).toBeVisible();
  await page.context().storageState({ path: 'e2e/.auth/lead.json' });
});
