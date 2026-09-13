import { test, expect } from '@playwright/test';

test('edit → publish → history → restore', async ({ page }) => {
  await page.goto('/library');
  await page.getByText('איטיות גלישה / חוסר גלישה').first().click();
  await expect(page.locator('.step.cur')).toBeVisible();
  await page.getByRole('button', { name: '✏️ ערוך' }).click();

  const title = page.getByPlaceholder('שם פריט הידע…');
  await expect(title).toBeVisible();
  await title.fill('איטיות גלישה / חוסר גלישה – E2E');
  await expect(page.getByText(/נשמר/)).toBeVisible();

  await page.getByRole('button', { name: /פרסם v/ }).click();
  await page.getByLabel(/מה השתנה/).fill('בדיקת E2E');
  await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.locator('.doc-head h1')).toBeVisible();

  await page.getByRole('button', { name: /🕓 v/ }).click();
  await expect(page.getByText('v7 · נוכחי')).toBeVisible();
  await page.getByRole('button', { name: /שחזר ל-v/ }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /שחזר ל-v/ })
    .click();
  await expect(page.getByText(/שוחזר מגרסה/)).toBeVisible();
});
