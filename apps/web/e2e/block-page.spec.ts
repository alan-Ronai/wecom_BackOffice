import { test, expect } from '@playwright/test';

test('open a shared block from the list and republish every document that embeds it', async ({ page }) => {
  await page.goto('/blocks');
  await page.locator('.tcard', { hasText: 'ריענון SIM' }).click();

  await expect(page.getByTestId('block-usage')).toBeVisible();
  await expect(page.getByTestId('block-usage').getByText('מוטמע')).toHaveCount(2);
  await expect(page.getByTestId('block-usage').getByText('מפנה')).toHaveCount(1);

  // Only the embeds need a republish; the reference always reads the latest text.
  await page.getByRole('button', { name: 'עדכן את כל ההפניות (2)' }).click();
  const dialog = page.getByRole('dialog', { name: 'עדכון כל ההפניות' });
  await expect(dialog.getByText(/2 מסמכים מטמיעים את הבלוק/)).toBeVisible();
  await dialog.getByRole('button', { name: 'עדכן הכל' }).click();
  await expect(page.getByText('2 מסמכים עודכנו')).toBeVisible();
});

test('edit a shared block and open a using document at its step', async ({ page }) => {
  await page.goto('/blocks');
  await page.locator('.tcard', { hasText: 'ריענון SIM' }).click();

  await page.getByRole('button', { name: '✎ ערוך בלוק' }).click();
  const dialog = page.getByRole('dialog', { name: '✎ עריכת בלוק משותף' });
  await dialog.getByLabel('שם הבלוק').fill('ריענון SIM – מעודכן');
  await dialog.getByRole('button', { name: 'שמור' }).click();
  await expect(page.getByText(/הבלוק נשמר/)).toBeVisible();

  await page
    .getByTestId('block-usage')
    .getByText(/אין גלישה בחו"ל/)
    .click();
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's7');
});

test('deleting a shared block warns about the documents that use it', async ({ page }) => {
  await page.goto('/blocks');
  await page.locator('.tcard', { hasText: 'ריענון SIM' }).click();
  await page.getByRole('button', { name: '🗑 מחק בלוק' }).click();
  const dialog = page.getByRole('dialog', { name: 'מחיקת בלוק משותף' });
  await expect(dialog.getByText(/2 מסמכים משתמשים בבלוק/)).toBeVisible();
  await dialog.getByRole('button', { name: 'מחק בלוק' }).click();
  await expect(page.getByText('הבלוק הועבר לסל המיחזור')).toBeVisible();
});
