import { test, expect } from '@playwright/test';

/**
 * The seeded library and call mode, against real data.
 *
 * `GET /documents` returns `{ items, total, page, pageSize }` and `GET /blocks` / `/fields` /
 * `/documents/:id/related` return `{ items }` — the twelve envelopes the port used to read as
 * bare arrays. Every one of those was a runtime TypeError that the msw suite could not see.
 */

test('the library renders the seeded cards, grouped by wave', async ({ page }) => {
  await page.goto('/library');

  const grid = page.getByTestId('library-grid');
  await expect(grid).toBeVisible();

  // 29 cards are seeded; assert on real ones rather than a fixture count.
  await expect(page.getByText('הפעלת SIM פיזי חדש').first()).toBeVisible();
  await expect(page.getByText('איטיות גלישה / חוסר גלישה').first()).toBeVisible();

  // The wave rules only render once the list envelope has been unwrapped correctly.
  const rules = await grid.getByTestId('rule').allTextContents();
  expect(rules.join(' ')).toMatch(/גל 1/);
  expect(await grid.locator('.tcard').count()).toBeGreaterThan(5);
});

test('opens a seeded document in call mode and picks an outcome', async ({ page }) => {
  await page.goto('/library');
  await page.getByText('איטיות גלישה / חוסר גלישה').first().click();

  // The article page reads /blocks, /fields and /related — all `{ items }` envelopes.
  await expect(page.locator('.doc-head h1')).toContainText('איטיות גלישה');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's1');

  // s1's first outcome is "✓ לא חסום – המשך לשלב 2" in the seed data.
  await page.keyboard.press('1');
  await expect(page.locator('.step.cur')).not.toHaveAttribute('data-step', 's1');
  await expect(page.getByTestId('summary')).toContainText('ש1');

  // The jump strip marks the step just completed.
  await expect(page.getByTestId('jumpstrip').getByText('1', { exact: true })).toHaveClass(/done/);
});

test('Ctrl-K search returns grouped results from the real index', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();

  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/חפש מסמך/).fill('sim');

  // Real `GET /search` groups hits by type; at least one group must come back.
  const groups = page.locator('.palette .gh');
  await expect(groups.first()).toBeVisible();
  expect(await groups.count()).toBeGreaterThan(0);
  await expect(page.locator('.palette .ri').first()).toBeVisible();

  // Tab cycles the type filter, and the filter value is a real search *group* name — the port
  // sent `doc`/`step`/`crm`, which the API ignores, so filtering returned nothing.
  await page.getByPlaceholder(/חפש מסמך/).click();
  await page.keyboard.press('Tab');
  await expect(page.locator('.palette .types .on')).toHaveText('מסמכים');
  await expect(page.locator('.palette .gh', { hasText: 'מסמכים' })).toBeVisible();
});

test('the sources page loads against the real pipeline', async ({ page }) => {
  await page.goto('/sources');
  // `GET /sources` is an `{ items }` envelope; the port spread it as an array and crashed.
  await expect(page.locator('.src-layout')).toBeVisible();
  // The page's own section title, not the sidebar nav entry of the same name.
  await expect(page.locator('.src-side .sec-title')).toHaveText('מסמכי מקור');
  // Either a seeded source or the honest empty state — never a crash, and never a LoadError.
  await expect(page.locator('.src-main')).toBeVisible();
  await expect(page.getByText('לא ניתן לטעון מסמכי מקור')).toHaveCount(0);
});

test('the admin users page lists the break-glass admin', async ({ page }) => {
  await page.goto('/admin/users');
  await expect(page.getByText('E2E Admin').first()).toBeVisible();
  await expect(page.getByText(process.env.E2E_ADMIN_EMAIL!).first()).toBeVisible();
});

test('the system page renders the real operator diagnostics', async ({ page }) => {
  await page.goto('/admin/system');
  await expect(page.getByText(/מסד נתונים/)).toBeVisible();
  await expect(page.getByText(/תור עבודות/)).toBeVisible();
  // Proves `GET /admin/system` answered rather than 404ing, as it did before the backend wave.
  await expect(page.getByText(/גרסה/)).toBeVisible();
});
