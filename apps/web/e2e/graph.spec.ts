import { test, expect } from '@playwright/test';

test('select a node and read "what breaks if I delete this"', async ({ page }) => {
  await page.goto('/graph');
  const svg = page.getByTestId('graph-svg');
  await expect(svg).toBeVisible();
  await expect(page.getByText('מסמכים 6')).toBeVisible();

  await svg.getByLabel(/^מסמך: איטיות גלישה/).click();
  await expect(page.getByText('מה נשבר אם אמחק')).toBeVisible();
  await expect(page.getByLabel('3 מסמכים מושפעים')).toBeVisible();
  await expect(page.getByLabel('2 קישורים יישברו')).toBeVisible();

  await page.getByRole('button', { name: 'פתח', exact: true }).click();
  await expect(page.locator('.step.cur')).toBeVisible();
});

test('filter by link type and focus a node into the URL', async ({ page }) => {
  await page.goto('/graph');
  const svg = page.getByTestId('graph-svg');
  await expect(svg.locator('[data-type="same_field"]').first()).toBeVisible();

  await page.getByRole('button', { name: 'אותו שדה CRM' }).click();
  await expect(svg.locator('[data-type="same_field"]')).toHaveCount(0);
  await expect(page).toHaveURL(/types=/);

  await svg.getByLabel('בלוק: ריענון SIM').click();
  await page.getByRole('button', { name: 'מקד כאן' }).click();
  await expect(page).toHaveURL(/focus=block/);
  await expect(svg.locator('.gnode.focus')).toHaveCount(1);
});

test('a document node hover shows the shared Peek preview', async ({ page }) => {
  await page.goto('/graph');
  const svg = page.getByTestId('graph-svg');
  await svg.getByLabel(/^מסמך: איטיות גלישה/).hover();
  await expect(page.locator('.peek')).toBeVisible({ timeout: 5000 });
  await expect(page.locator('.peek')).toContainText('שלבים');
});
