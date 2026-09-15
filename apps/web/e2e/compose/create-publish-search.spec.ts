import { test, expect } from '@playwright/test';

/**
 * S1-3 (d) — one whole editorial round trip with nginx in the path: an editor creates a knowledge
 * item, publishes it, finds it again through search, and reads it as an article.
 *
 * `pnpm e2e:real` covers the same flow against the API on loopback. What is different here is
 * every hop: the proxy's buffering and 300 s read timeout, the `secure` session cookie riding a
 * real TLS connection, `X-Forwarded-For` reaching the audit and session rows, and the built SPA
 * served by nginx rather than by `vite preview`. A regression in the reverse proxy (a stripped
 * header, a swallowed `If-Match`, a truncated response) shows up here and nowhere else.
 */

const stamp = Date.now().toString(36);
const TITLE = `פריט קומפוז ${stamp}`;
const DESCRIPTION = `נוצר על ידי e2e:compose · ${stamp}`;

test('create → publish → search finds it → the article renders', async ({ page }) => {
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();

  /* 1. the editor starts a new item ------------------------------------------ */
  await page.getByRole('button', { name: '✚ פריט ידע חדש' }).click();
  await expect(page).toHaveURL(/\/edit\/new/);
  const title = page.getByPlaceholder('שם פריט הידע…');
  await expect(title).toBeVisible();
  await title.fill(TITLE);
  await page.getByLabel('תיאור קצר').fill(DESCRIPTION);

  /* 2. …and publishes it ------------------------------------------------------ */
  await page.getByRole('button', { name: /פרסם v/ }).click();
  const dialog = page.getByRole('dialog', { name: /פרסום v/ });
  await dialog.getByLabel(/מה השתנה/).fill('גרסה ראשונה');
  // Asserted on the responses, not only on the toast: a 4xx from either call would otherwise read
  // as "the toast never appeared", which says nothing about which call failed or why — and behind
  // a proxy "which hop failed" is the question.
  const [created] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/documents$/.test(r.url())),
    dialog.getByRole('button', { name: 'אישור' }).click(),
  ]);
  expect(created.status(), await created.text()).toBe(201);
  const docId = ((await created.json()) as { id: string }).id;
  const published = await page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/publish'),
  );
  expect(published.status(), await published.text()).toBe(200);

  // The editor is taken to the published article, and it renders — a URL alone is also what a
  // crashed React root leaves behind.
  await expect(page).toHaveURL(new RegExp(`/doc/${docId}`));
  await expect(page.locator('.doc-head h1')).toContainText(TITLE);

  /* 3. search finds it -------------------------------------------------------- */
  // The index is written by the publish, so this is a straight assertion rather than a poll; if
  // it ever becomes asynchronous, this is the spec that says so.
  const hits = await page.request.get(`/api/v1/search?q=${encodeURIComponent(stamp)}`);
  expect(hits.ok(), await hits.text()).toBeTruthy();
  const body = (await hits.json()) as {
    groups: { type: string; hits: { id: string; title?: string }[] }[];
    total: number;
  };
  expect(body.total, `"${stamp}" is findable through the API`).toBeGreaterThan(0);
  const docs = body.groups.find((g) => g.type === 'documents');
  expect(docs?.hits.some((h) => h.id === docId || h.title?.includes(stamp))).toBe(true);

  /* 4. …and so does the palette a reader actually uses ------------------------ */
  await page.goto('/library');
  await expect(page.getByTestId('library-grid')).toBeVisible();
  await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/חפש מסמך/).fill(stamp);
  const result = page.locator('.palette .ri', { hasText: TITLE }).first();
  await expect(result).toBeVisible();
  await result.click();

  /* 5. the article renders for the reader ------------------------------------- */
  await expect(page).toHaveURL(new RegExp(`/doc/${docId}`));
  await expect(page.locator('.doc-head h1')).toContainText(TITLE);
  await expect(page.getByText(DESCRIPTION)).toBeVisible();
});
