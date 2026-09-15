import { test, expect } from '@playwright/test';

test('the connector registry runs a connector and reports what the run did', async ({ page }) => {
  await page.goto('/admin/connectors');
  const wp = page.getByRole('row', { name: /WordPress/ });
  await expect(wp.getByText('תקין')).toBeVisible();
  await expect(wp.getByText('כל 30 דק׳')).toBeVisible();

  await wp.getByRole('button', { name: 'הרץ עכשיו' }).click();
  await expect(page.getByText('נקלטו 2 · נדחפו 1 · 0 קונפליקטים')).toBeVisible();

  // A disabled connector offers no run button to press.
  const folder = page.getByRole('row', { name: /תיקיית Word/ });
  await expect(folder.getByRole('button', { name: 'הרץ עכשיו' })).toBeDisabled();
});

test('the wizard builds its form from the type schema and dry-tests before saving', async ({ page }) => {
  await page.goto('/admin/connectors/new');
  await page.getByLabel('WordPress').check();
  await page.getByRole('button', { name: 'המשך' }).click();

  await expect(page.getByRole('button', { name: 'המשך לבדיקה' })).toBeDisabled();
  await page.getByLabel('כתובת האתר').fill('http://insecure.example');
  await page.getByLabel('שם משתמש').fill('kb-bot');
  await page.getByLabel('סיסמת אפליקציה').fill('app-pass');
  await page.getByLabel('סוד ה-webhook').fill('webhook-secret');
  // Schema defaults arrive filled in.
  await expect(page.getByLabel('סוגי תוכן')).toHaveValue('posts');
  await page.getByRole('button', { name: 'המשך לבדיקה' }).click();

  await page.getByRole('button', { name: 'בדוק חיבור' }).click();
  await expect(page.getByText(/כתובת האתר חייבת להיות https/)).toBeVisible();

  await page.getByRole('button', { name: '2. הגדרות' }).click();
  await page.getByLabel('כתובת האתר').fill('https://help.wecom.co.il');
  await page.getByRole('button', { name: 'המשך לבדיקה' }).click();
  await page.getByRole('button', { name: 'בדוק חיבור' }).click();
  await expect(page.getByText(/מחובר · WordPress 6.6/)).toBeVisible();
});

test('the sync queue moves one link and hands a conflict to the merge screen', async ({ page }) => {
  await page.goto('/sync');
  await expect(page.getByRole('tab', { name: 'קונפליקט 1' })).toBeVisible();

  const pending = page.getByRole('row', { name: /חו"ל ונדידה/ });
  await pending.getByRole('button', { name: 'ייבא עכשיו' }).click();
  await expect(page.getByText('נקלט מהמקור')).toBeVisible();

  await page
    .getByRole('row', { name: /איטיות גלישה/ })
    .getByRole('button', { name: 'פתור קונפליקט' })
    .click();
  await expect(page.getByText(/1 פסקאות בהתנגשות/)).toBeVisible();
  // The chip on the contested paragraph, not the sentence in the summary line above it.
  await expect(page.locator('.merge-row.contested')).toHaveCount(1);

  // Take the contested paragraph from WordPress, import the remote-only one, and save the merge.
  await page.getByLabel('קח מ-WordPress · §8').click();
  await page.getByLabel('קח מ-WordPress · §10').click();
  await page.getByRole('button', { name: 'שמור מיזוג' }).click();
  await expect(page.getByText('הקונפליקט נפתר')).toBeVisible();
  await expect(page.getByRole('tab', { name: 'קונפליקט 0' })).toBeVisible();
});

test('the parity report shows both sides and what has no link at all', async ({ page }) => {
  await page.goto('/sync');
  await page.getByRole('button', { name: 'דו״ח התאמה' }).click();
  await expect(page.getByRole('heading', { name: /WordPress/ })).toBeVisible();
  await expect(page.getByText(/מתוך 2 זהים/)).toBeVisible();
  // Design 4d: a fingerprint per side, not just a state pill.
  await expect(page.getByText('7d02be9')).toBeVisible();
  await expect(page.getByText('a91c4f2')).toBeVisible();

  // The two lists the queue structurally cannot show, and the pairing they exist for.
  await expect(page.getByText('מסמך ללא קישור')).toBeVisible();
  await expect(page.getByText('עמוד שאין לו מסמך')).toBeVisible();
  // Exact, because the sidebar's "גרף קשרים" also matches a loose "קשר".
  const linkBtn = page.getByRole('button', { name: 'קשר', exact: true });
  await expect(linkBtn).toBeDisabled();
  await page.getByLabel('בחר מסמך ללא קישור').check();
  await linkBtn.click();
  await expect(page.getByText(/הקישור נוצר/)).toBeVisible();
});
