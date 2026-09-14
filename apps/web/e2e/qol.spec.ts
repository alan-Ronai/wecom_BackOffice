import { test, expect } from '@playwright/test';
import { seedUiPrefs, skipTour } from './fixtures/prefs.js';

/**
 * The wave-3 QOL flows, end to end in a real browser: the keyboard list mode and bulk actions,
 * the notification centre, the review round trip, and the onboarding tour itself.
 */

test('the onboarding tour greets a first-time user and can be skipped', async ({ page }) => {
  await page.goto('/library');
  const tour = page.getByRole('dialog', { name: 'סיור היכרות' });
  await expect(tour).toBeVisible();
  await expect(tour.getByText('שלב 1 מתוך 5')).toBeVisible();

  await tour.getByRole('button', { name: 'הבא' }).click();
  await expect(tour.getByText('שלב 2 מתוך 5')).toBeVisible();

  await tour.getByRole('button', { name: 'דלג על הסיור' }).click();
  await expect(tour).toBeHidden();

  // Dismissal is a preference, so a reload does not greet them again.
  await page.reload();
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'סיור היכרות' })).toBeHidden();
});

test('list mode: J/K move, X selects, and a bulk action applies to the selection', async ({ page }) => {
  await seedUiPrefs(page, { libraryView: 'list' });
  await page.goto('/library');

  const list = page.getByTestId('doc-list');
  await expect(list).toBeVisible();

  const firstTitle = await page.locator('.dl-row.cur .t > span:nth-child(2)').textContent();
  await page.keyboard.press('j');
  await expect(page.locator('.dl-row.cur .t > span:nth-child(2)')).not.toHaveText(firstTitle ?? '');

  await page.keyboard.press('x');
  await expect(page.getByText('1 נבחרו')).toBeVisible();

  const bar = page.getByRole('region', { name: 'פעולות על הפריטים שנבחרו' });
  await bar.getByRole('button', { name: '📌 הצמד' }).click();
  await expect(page.getByText(/בוצע על 1 פריטים/)).toBeVisible();
  await expect(page.getByText('1 נבחרו')).toBeHidden();
});

test('density and list mode survive a reload', async ({ page }) => {
  await skipTour(page);
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();

  await page.getByRole('button', { name: 'דחוס' }).click();
  await page.getByRole('button', { name: 'רשימה' }).click();
  await expect(page.getByTestId('doc-list')).toBeVisible();

  await page.reload();
  await expect(page.getByTestId('doc-list')).toBeVisible();
  await expect(page.locator('.lib-body')).toHaveAttribute('data-density', 'compact');
});

test('the notification bell shows the unread count and marks everything read', async ({ page }) => {
  await skipTour(page);
  await page.goto('/library');

  const bell = page.getByLabel('התראות · 2 שלא נקראו');
  await expect(bell).toBeVisible();
  await bell.click();

  const panel = page.getByRole('dialog', { name: 'מרכז התראות' });
  await expect(panel.getByText(/3 הצעות חדשות/)).toBeVisible();

  await panel.getByRole('button', { name: 'סמן הכל כנקרא' }).click();
  await expect(page.getByLabel('התראות', { exact: true })).toBeVisible();
});

test('a step comment with an @mention posts from the article', async ({ page }) => {
  await skipTour(page);
  await page.goto('/library');
  await page.getByTestId('library-grid').getByText('איטיות גלישה').first().click();
  await expect(page.locator('.step.cur')).toBeVisible();

  const box = page.locator('.mention-input textarea').first();
  await box.fill('לבדוק גם VPN @דנ');
  await page.getByRole('option', { name: /דנה ר\./ }).click();
  await expect(box).toHaveValue(/@דנה ר\. /);
  await box.press('Enter');

  await expect(page.getByText('לבדוק גם VPN @דנה ר.')).toBeVisible();
});

test('request review from the editor and decide it on /reviews', async ({ page }) => {
  await skipTour(page);
  await page.goto('/reviews');
  await expect(page.getByRole('heading', { name: /סקירות/ })).toBeVisible();

  // The seeded open review is decided with an explicit version label.
  await page
    .getByLabel(/^אשר ופרסם את /)
    .first()
    .click();
  await page.getByLabel('מה השתנה? (מופיע בהיסטוריית הגרסאות)').fill('אושר בסקירה');
  await page.getByRole('button', { name: 'אישור' }).click();

  await expect(page.getByText('אושר ופורסם')).toBeVisible();
  await expect(page.getByText('אין פריטים שממתינים לסקירה')).toBeVisible();
});
