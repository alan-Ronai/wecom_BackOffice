import { test, expect } from '@playwright/test';

test('Ctrl K finds a step and opens it', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/חפש מסמך/).fill('ריענון sim');
  await expect(page.locator('.palette .gh', { hasText: 'שלבים' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's11');
});

/**
 * `docs/perf.md` § "What stays broken": a two-character Hebrew prefix cannot use any index, so the
 * palette answers a short query from what the client already holds instead of asking the server.
 * The request count itself is pinned in `test/palette/minChars.test.tsx`; what belongs here is
 * that the operator is told why, and still gets rows.
 */
test('a query shorter than three characters is answered locally, with a reason', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/חפש מסמך/).fill('אי');

  await expect(page.locator('.palette .hint')).toHaveText('הקלידו לפחות 3 תווים לחיפוש בכל המקורות');
  await expect(page.locator('.palette .ri', { hasText: 'חוסר גלישה' }).first()).toBeVisible();

  await page.getByPlaceholder(/חפש מסמך/).fill('איטיות');
  await expect(page.locator('.palette .hint')).toHaveCount(0);
});

test('the palette lists local actions and cycles types with Tab', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByText('צור פריט ידע חדש')).toBeVisible();
  await page.getByPlaceholder(/חפש מסמך/).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.palette .types .on')).toHaveText('מסמכים');
});
