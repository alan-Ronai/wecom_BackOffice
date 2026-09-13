import { test, expect } from '@playwright/test';

test('library → call mode → outcomes → summary → split', async ({ page }) => {
  await page.goto('/library/tech');
  await page.getByText('איטיות גלישה / חוסר גלישה').first().click();
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's1');

  await page.keyboard.press('ArrowDown');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's2');
  await page.keyboard.press('2');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's3');
  await page.keyboard.press('1');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's4');
  await expect(page.getByTestId('summary')).toContainText('ש2 ✓ חבילה פעילה');

  // the jump strip marks the skipped and completed steps
  await expect(page.getByTestId('jumpstrip').getByText('1', { exact: true })).toHaveClass(/skip/);
  await expect(page.getByTestId('jumpstrip').getByText('2', { exact: true })).toHaveClass(/done/);
});
