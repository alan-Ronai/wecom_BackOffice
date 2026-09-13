import { test, expect } from '@playwright/test';

test('restore an item from the trash', async ({ page }) => {
  await page.goto('/trash');
  await expect(page.getByText('Hotspot לא עובד')).toBeVisible();
  await expect(page.getByText('2 קישורים שבורים')).toBeVisible();
  await page.getByRole('button', { name: 'שחזר' }).first().click();
  await expect(page.getByText('סל המיחזור ריק')).toBeVisible();
});

test('delete a card from the library and see it in the trash', async ({ page }) => {
  await page.goto('/library/plans');
  const card = page.locator('.tcard', { hasText: 'הקפאת קו זמנית' });
  await card.hover();
  await card.locator('.kebab').click();
  await page.getByText('🗑 מחק').click();
  await page.getByRole('button', { name: 'העבר לסל' }).click();
  await expect(page.getByText('הועבר לסל המיחזור')).toBeVisible();
});
