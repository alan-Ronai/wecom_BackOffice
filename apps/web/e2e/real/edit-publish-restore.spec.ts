import { test, expect } from '@playwright/test';

/**
 * The editor → publish → history → restore round trip, against the real API.
 *
 * This is the path with the most contract surface in the review: the draft 204/404 split, the
 * `If-Match` precondition (428 without it, 412 when stale, and `PATCH` rotates the etag), the
 * `{ document, version, auditId }` publish envelope, the `{ items }` version list, the server
 * diff, and the restore envelope. All of it was wrong, and all of it was green under msw.
 */

test.describe.configure({ mode: 'serial' });

test('edit → publish a new version → history shows the diff → restore', async ({ page }) => {
  await page.goto('/library');
  await page.getByText('איטיות גלישה / חוסר גלישה').first().click();
  await expect(page.locator('.step.cur')).toBeVisible();

  const before = await page.locator('.doc-head h1').innerText();

  await page.getByRole('button', { name: '✏️ ערוך' }).click();
  const title = page.getByPlaceholder('שם פריט הידע…');
  await expect(title).toBeVisible();

  // The draft query must resolve (204 when no draft exists) before the editor seeds, or the
  // published document silently wins the race and the edit is applied to the wrong base.
  const edited = `${before} · E2E`;
  await title.fill(edited);
  // Autosave writes a real draft through PUT /documents/:id/draft.
  await expect(page.getByText(/נשמר/)).toBeVisible({ timeout: 20_000 });

  // Publish: PATCH (rotates the etag) → PUT structure with the *rotated* etag → POST publish.
  await page.getByRole('button', { name: /פרסם v/ }).click();
  await page.getByLabel(/מה השתנה/).fill('בדיקת E2E מול שרת אמיתי');
  await page.getByRole('button', { name: 'אישור' }).click();

  // A 412/428 would surface as an error toast instead of the success one.
  await expect(page.getByText(/פורסם v/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.doc-head h1')).toContainText('E2E');

  // History: the version list is `{ items }`, and the compare pane uses GET /documents/:id/diff.
  await page.getByRole('button', { name: /🕓 v/ }).click();
  await expect(page.locator('.hist-layout')).toBeVisible();
  await expect(page.locator('.vlist .vi').first()).toBeVisible();
  expect(await page.locator('.vlist .vi').count()).toBeGreaterThan(1);
  await expect(page.locator('.vi.cur')).toContainText('נוכחי');

  // The diff pane renders the side-by-side comparison against the previous version.
  await expect(page.locator('.diff-cols')).toBeVisible();

  // Restore the previous version — POST /documents/:id/restore/:v, `{ document, version, … }`.
  await page
    .getByRole('button', { name: /שחזר ל-v/ })
    .first()
    .click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /שחזר ל-v/ })
    .click();
  // The toast reads the `version` field off the envelope, not `currentVersion` off a Document.
  await expect(page.getByText(/שוחזר מגרסה v\d+ כגרסה v\d+/)).toBeVisible({ timeout: 20_000 });
});

test('delete → trash → restore', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();

  // Pick a card that is not the one the publish test edited.
  const card = page.locator('.tcard', { hasText: 'הפעלת eSIM' }).first();
  await expect(card).toBeVisible();
  const title = (await card.locator('.title').innerText()).trim();

  await card.locator('.kebab').click();
  await page.getByRole('menuitem', { name: '🗑 מחק' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'העבר לסל' }).click();

  // DELETE /documents/:id returns `{ auditId, restoreUntil }`, not `{ ok }`.
  await expect(page.getByText('הועבר לסל המיחזור')).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.tcard .title', { hasText: title })).toHaveCount(0, { timeout: 20_000 });

  await page.goto('/trash');
  // `GET /trash` is an `{ items }` envelope.
  const row = page.locator('.trow', { hasText: title }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });

  // POST /trash/:type/:id/restore returns `{ auditId }`.
  await row.getByText('שחזר', { exact: true }).click();
  await expect(page.getByText(/שוחזר למקור/)).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.trow', { hasText: title })).toHaveCount(0, { timeout: 20_000 });

  await page.goto('/library');
  await expect(page.locator('.tcard .title', { hasText: title }).first()).toBeVisible({ timeout: 20_000 });
});
