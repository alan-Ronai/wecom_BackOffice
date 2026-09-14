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

/**
 * m3: split view mounts the article twice, and the arrows have to reach the pane the operator is
 * actually driving. Before this they always reached the left one, because both panes register in
 * the same scope and mount order decided.
 */
test('the split pane you click takes the call-mode keys', async ({ page }) => {
  // Two open tabs is what `Ctrl \` needs: it pairs the document in the URL with the other tab.
  await page.goto('/library/intl');
  await page.getByText('אין גלישה בחו"ל').first().click();
  await expect(page.locator('.step.cur')).toBeVisible();

  await page.goto('/library/tech');
  await page.getByLabel('פעולות · איטיות גלישה / חוסר גלישה').click();
  await page.getByText('⧉ פתח בלשונית').click();
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's1');

  await page.keyboard.press('Control+\\');
  const panes = page.locator('.splitwrap > .pane');
  await expect(panes).toHaveCount(2);

  const left = panes.nth(0);
  const right = panes.nth(1);
  await expect(left).toHaveAttribute('aria-current', 'true');
  await page.keyboard.press('ArrowDown');
  await expect(left.locator('.step.cur')).toHaveAttribute('data-step', 's2');

  // One click on the other pane's header — nothing inside it is focused, which is the normal
  // state mid-call and the reason this could not be inferred from `document.activeElement`.
  await right.locator('.pane-head b').click();
  await expect(right).toHaveAttribute('aria-current', 'true');
  await expect(left).toHaveAttribute('aria-current', 'false');
  await page.keyboard.press('ArrowDown');

  // The right pane moved; the left one stayed exactly where it was.
  await expect(left.locator('.step.cur')).toHaveAttribute('data-step', 's2');
  await expect(right.locator('.step.cur')).toHaveAttribute('data-step', 's2');
  // …and it is still a split: the right pane's progress never reaches the URL.
  await expect(panes).toHaveCount(2);
});
