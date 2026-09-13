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

test('the palette lists local actions and cycles types with Tab', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await page.keyboard.press('Control+k');
  await expect(page.getByText('צור פריט ידע חדש')).toBeVisible();
  await page.getByPlaceholder(/חפש מסמך/).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.palette .types .on')).toHaveText('מסמכים');
});
