import { test, expect } from '@playwright/test';

const FIELD = encodeURIComponent('שירות נדידה');

test('open a CRM field page from the list and jump to a referencing step', async ({ page }) => {
  await page.goto('/fields');
  await page.locator('.tcard', { hasText: 'שירות נדידה' }).first().click();

  await expect(page.getByTestId('field-usage')).toBeVisible();
  await expect(page.getByText(/שונה שם ל-שירותי נדידה/)).toBeVisible();

  await page
    .getByTestId('field-usage')
    .getByText(/5 · בדיקת שירות נדידה/)
    .click();
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's5');
});

test('rename a field and update all of its references', async ({ page }) => {
  await page.goto(`/fields/${FIELD}`);
  await expect(page.getByTestId('field-usage')).toBeVisible();

  await page.getByRole('button', { name: '✎ שנה שם ועדכן הפניות' }).click();
  const dialog = page.getByRole('dialog', { name: 'שינוי שם השדה' });
  await expect(dialog.getByLabel('עדכן את כל ההפניות')).toBeChecked();

  await dialog.getByLabel('שם חדש').fill('שירותי נדידה');
  await dialog.getByRole('button', { name: 'עדכן הכל' }).click();
  await expect(page.getByText(/3 מסמכים עודכנו/)).toBeVisible();
});

test('deleting a field warns with the number of documents that reference it', async ({ page }) => {
  await page.goto(`/fields/${FIELD}`);
  await page.getByRole('button', { name: '🗑 מחק שדה' }).click();
  const dialog = page.getByRole('dialog', { name: 'מחיקת שדה CRM' });
  await expect(dialog.getByText(/3 מסמכים מפנים/)).toBeVisible();
  await dialog.getByRole('button', { name: 'מחק שדה' }).click();
  await expect(page.getByText('השדה נמחק')).toBeVisible();
});
