import { test, expect } from '@playwright/test';

test('map a CSV column to a card field and save the mapping', async ({ page }) => {
  await page.goto('/data');
  const files = page.getByTestId('data-files');
  await expect(files.getByText('topics.json')).toBeVisible();

  await files.getByText('agents-scripts.csv').click();
  await expect(page.getByTestId('mapping-table')).toBeVisible();
  await expect(page.getByRole('button', { name: 'שמור מיפוי' })).toBeDisabled();

  await page.getByLabel('שדה בכרטיס עבור line').selectOption('stepAction');
  await expect(page.getByText('✓ ממופה')).toBeVisible();
  await page.getByRole('button', { name: 'שמור מיפוי' }).click();
  await expect(page.getByText('המיפוי נשמר')).toBeVisible();
});

test('re-import a data file and follow the link to its suggestions', async ({ page }) => {
  await page.goto('/data');
  await expect(page.getByTestId('mapping-table')).toBeVisible();

  await page.getByRole('button', { name: /ייבא מחדש/ }).click();
  await expect(page.getByText('הייבוא נשלח לעיבוד')).toBeVisible();
  await page.getByRole('button', { name: 'עבור להצעות' }).click();
  await expect(page.getByText('הצעות לכרטיסים')).toBeVisible();
});

test('a duplicate column mapping blocks the save', async ({ page }) => {
  await page.goto('/data');
  await page.getByTestId('data-files').getByText('agents-scripts.csv').click();
  await page.getByLabel('שדה בכרטיס עבור agent').selectOption('title');
  await page.getByLabel('שדה בכרטיס עבור topic').selectOption('title');
  await expect(page.getByText('כפול')).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'שמור מיפוי' })).toBeDisabled();
});
