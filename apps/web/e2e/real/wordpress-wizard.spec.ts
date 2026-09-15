import { test, expect } from '@playwright/test';

/**
 * W-1 — the connector wizard, driven the way the documents tell an operator to drive it.
 *
 * `deploy/INSTALL.md` §WordPress connector and `docs/operations.md` §Adding a connector both say:
 * open `/admin/connectors`, press **✚ מחבר**, choose WordPress, fill in `baseUrl`, `username`,
 * `applicationPassword`, `postTypes`, `categoryMap` and `webhookSecret`, test, save. Done in a
 * browser against a freshly installed stack, step 2 rendered exactly one input — *שם המחבר* —
 * **בדוק חיבור** answered `הגדרות המחבר אינן תקינות` and **צור מחבר** returned 400.
 *
 * Nothing caught it because every automated cover of connector creation posted
 * `POST /api/v1/connectors` from the spec, config object and all —
 * `wordpress-source.spec.ts` beside this file still does, deliberately: it is testing the sync
 * loop, not the form. This one never touches the API directly. Everything below is typed into
 * the wizard, and the run's outcome is read off the screen.
 *
 * The remote is `scripts/wp-stub.mjs`, the same server the sync spec uses; `E2E_WP_URL` is where
 * `scripts/e2e-real.mjs` put it.
 */
const WP = process.env.E2E_WP_URL!;
const stamp = Date.now().toString(36);
const NAME = `אתר וורדפרס ${stamp}`;
/** The stub's post 101 — what an import is supposed to bring back. */
const WP_TITLE = 'נוהל WordPress לבדיקה';

test('W-1 the connector wizard creates, tests and runs a WordPress connector', async ({ page }) => {
  // The run is synchronous but does a full import through the model pipeline.
  test.setTimeout(180_000);
  expect(WP, 'E2E_WP_URL is set by scripts/e2e-real.mjs').toBeTruthy();

  await page.goto('/admin/connectors');
  await page.getByRole('button', { name: '✚ מחבר' }).click();

  /* 1. the type ------------------------------------------------------------- */
  await page.getByLabel('WordPress').check();
  await page.getByRole('button', { name: 'המשך' }).click();

  /* 2. every field the type declares ---------------------------------------- */
  const name = page.getByLabel('שם המחבר');
  await name.fill(NAME);
  // The six fields of `WpConfigSchema`. That they exist at all is the finding.
  await page.getByLabel('כתובת האתר').fill(WP);
  await page.getByLabel('שם משתמש').fill('e2e');
  await page.getByLabel('סיסמת אפליקציה').fill('e2e-app-pw');
  await page.getByLabel('סוגי תוכן').fill('posts');
  await page.getByLabel('מיפוי קטגוריות').fill('sim-cards = sim');
  await page.getByLabel('סוד ה-webhook').fill(`wizard-secret-${stamp}`);

  // The connector's own rules, applied in the form: `webhookSecret` is `z.string().min(8)`.
  await page.getByLabel('סוד ה-webhook').fill('short');
  await expect(page.getByText('סוד ה-webhook: לפחות 8 תווים')).toBeVisible();
  await expect(page.getByRole('button', { name: 'המשך לבדיקה' })).toBeDisabled();
  await page.getByLabel('סוד ה-webhook').fill(`wizard-secret-${stamp}`);

  /* 3. the dry run, before anything is saved -------------------------------- */
  await page.getByRole('button', { name: 'המשך לבדיקה' }).click();
  await page.getByRole('button', { name: 'בדוק חיבור' }).click();
  // The real connector's own message, from a real round trip to the stub's REST API.
  await expect(page.getByText('✓ החיבור ל-WordPress תקין')).toBeVisible({ timeout: 30_000 });

  /* 4. schedule and create --------------------------------------------------- */
  await page.getByRole('button', { name: 'המשך לתזמון' }).click();
  await page.getByRole('button', { name: 'צור מחבר' }).click();
  await expect(page.getByText('המחבר נוצר')).toBeVisible({ timeout: 30_000 });
  // Saved: the wizard is now editing a connector with an id, so the webhook address exists.
  await expect(page).toHaveURL(/\/admin\/connectors\/[0-9a-f-]{36}$/);

  /* 5. the row is on the connectors page, and runs from it -------------------- */
  await page.goto('/admin/connectors');
  const row = page.getByRole('row').filter({ hasText: NAME });
  await expect(row).toBeVisible();
  // `WpConfigSchema` strips the trailing slash, so the row shows what the server actually stored.
  await expect(row.getByText(WP.replace(/\/+$/, ''), { exact: true })).toBeVisible();

  await row.getByRole('button', { name: 'בדוק חיבור' }).click();
  await expect(page.getByText('החיבור ל-WordPress תקין')).toBeVisible({ timeout: 30_000 });

  await row.getByRole('button', { name: 'הרץ עכשיו' }).click();
  // "0 נקלטו" would satisfy a looser pattern and prove nothing.
  await expect(page.getByText(/נקלטו [1-9]\d* · נדחפו \d+ · \d+ קונפליקטים/)).toBeVisible({
    timeout: 120_000,
  });

  /* 6. and the import is there ----------------------------------------------- */
  await page.goto('/sources');
  await expect(page.getByText(WP_TITLE).first()).toBeVisible({ timeout: 60_000 });
});
