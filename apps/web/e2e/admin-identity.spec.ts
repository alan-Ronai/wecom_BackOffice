import { test, expect } from '@playwright/test';

/**
 * The msw-backed build signs in as a lead, not an admin, so these specs drive the screens through
 * the routes directly and assert what a lead is allowed to see. The permission-gated variants are
 * covered by the unit suite, which can swap `/auth/me`.
 */

test('the audit explorer narrows by filter and opens a computed diff', async ({ page }) => {
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: /יומן פעולות/ })).toBeVisible();

  const rows = page.locator('table tbody tr');
  await expect(rows.first()).toBeVisible();

  await page.getByLabel('סוג ישות').selectOption('role');
  await expect(page.getByRole('button', { name: /ישות: תפקיד/ })).toBeVisible();
  await expect(page.getByText('roles.update')).toBeVisible();
  await expect(page.getByText('docs.publish')).toHaveCount(0);

  // Every active filter is removable where it stands.
  await page.getByRole('button', { name: /ישות: תפקיד/ }).click();
  await expect(page.getByText('docs.publish')).toBeVisible();

  await page.getByRole('button', { name: 'לפני / אחרי' }).first().click();
  const drawer = page.getByRole('dialog', { name: 'פרטי רשומת ביקורת' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('currentVersion')).toBeVisible();
  await expect(drawer.getByText('published')).toBeVisible();
  await drawer.getByRole('button', { name: 'סגור' }).click();
  await expect(drawer).toHaveCount(0);
});

test('users can be filtered by source and their scope edited as a set', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByRole('row', { name: /ענבר ל\./ })).toBeVisible();

  await page.getByRole('tab', { name: 'GlobalProtect' }).click();
  await expect(page.getByRole('row', { name: /מאיה כ\./ })).toBeVisible();
  await expect(page.getByRole('row', { name: /ענבר ל\./ })).toHaveCount(0);

  await page.getByRole('tab', { name: 'לא פעילים' }).click();
  await expect(page.getByText('מעולם לא')).toBeVisible();
});

test('the role matrix groups by resource and locks the admin cells', async ({ page }) => {
  await page.goto('/admin/roles');
  await expect(page.getByRole('columnheader', { name: 'ניהול' })).toBeVisible();
  await expect(page.getByLabel('roles.manage · admin')).toBeDisabled();
  await expect(page.getByLabel('docs.publish · admin')).toBeEnabled();

  await page.getByLabel('audit.read · lead').click();
  await expect(page.getByRole('button', { name: 'שמור (1 שינויים)' })).toBeEnabled();
});

test('identity settings never render a stored secret', async ({ page }) => {
  await page.goto('/admin/identity');
  await expect(page.getByLabel('Issuer')).toHaveValue(/login\.microsoftonline\.com/);
  await expect(page.getByText('מוגדר').first()).toBeVisible();
  await expect(page.getByLabel('Client secret')).toHaveCount(0);

  await page.getByRole('button', { name: 'החלף' }).first().click();
  await expect(page.getByLabel('Client secret')).toHaveValue('');

  await page.getByRole('button', { name: 'בדוק חיבור' }).first().click();
  await expect(page.getByText(/גילוי OIDC הצליח/)).toBeVisible();

  await expect(page.getByRole('link', { name: 'כניסת בדיקה' })).toHaveAttribute(
    'href',
    /returnTo=%2Fadmin%2Fidentity/,
  );
});
