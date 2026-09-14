import { test, expect } from '@playwright/test';

test('the five tiles render and each one drills into its list', async ({ page }) => {
  await page.goto('/dashboards');

  for (const tile of ['כיסוי', 'רעננות', 'שימוש', 'צינור הצעות', 'התאמת סנכרון'])
    await expect(page.getByText(tile, { exact: true })).toBeVisible();

  // Every chart states its series in words, so it is readable without colour.
  await expect(page.getByLabel(/כיסוי כרטיסים: עם מסמך 23/)).toBeVisible();
  await expect(page.getByLabel(/מצב הקישורים: זהים 33/)).toBeVisible();

  await page
    .getByLabel(/המסמכים המובילים/)
    .getByText('איטיות גלישה / חוסר גלישה')
    .click();
  await expect(page.locator('.step.cur')).toBeVisible();
});

test('a coverage bar opens its category in the library', async ({ page }) => {
  await page.goto('/dashboards');
  await page
    .getByLabel(/כיסוי לפי קטגוריה/)
    .getByText('חו"ל ונדידה')
    .click();
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await expect(page).toHaveURL(/\/library\/intl/);
});

test('the tiles survive the dark theme', async ({ page }) => {
  await page.goto('/dashboards');
  await expect(page.getByText('כיסוי', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+d');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  // Charts are drawn from tokens, so they follow the theme rather than needing a second palette.
  await expect(page.getByLabel(/מצב ההצעות/)).toBeVisible();
});
