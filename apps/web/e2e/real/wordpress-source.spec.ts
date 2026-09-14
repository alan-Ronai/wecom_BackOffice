import { test, expect } from '@playwright/test';

/**
 * W4-E2E-3 — PRD §8, the two-way source loop against a real WordPress-shaped server:
 * a post is imported, accepted and published; an edit *there* lands as a new source version and
 * raises the review flag *here*; the editor decides it changes nothing and clears the flag; an
 * edit *here* is pushed back as the source HTML.
 *
 * The stub is the same module the connector unit tests use, started as a process by
 * `scripts/wp-stub.mjs`; `E2E_WP_URL` is where the gate put it.
 */
test.describe.configure({ mode: 'serial' });

const WP = process.env.E2E_WP_URL!;
const stamp = Date.now().toString(36);
const WP_TITLE = 'נוהל WordPress לבדיקה';

test('W4-E2E-3 WordPress → source version → review flag → publish → push renders the source HTML', async ({
  page,
  request,
}) => {
  expect(WP, 'E2E_WP_URL is set by scripts/e2e-real.mjs').toBeTruthy();

  /* 1. the connector ------------------------------------------------------- */
  const created = await request.post('/api/v1/connectors', {
    data: {
      type: 'wordpress',
      name: `wp-e2e-${stamp}`,
      config: {
        baseUrl: WP,
        username: 'e2e',
        applicationPassword: 'e2e-app-pw',
        postTypes: ['posts'],
        categoryMap: {},
        webhookSecret: 'e2e-webhook-secret',
      },
      enabled: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const connectorId = ((await created.json()) as { id: string }).id;

  /* 2. first run: the post becomes a suggestion, accepted and published ----- */
  const run1 = await request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run1.ok(), await run1.text()).toBeTruthy();

  await page.goto('/sources');
  await page.getByText(WP_TITLE).first().click();
  await page.getByRole('button', { name: 'אשר הכל' }).click();
  await page.getByRole('button', { name: 'פרסם לספרייה' }).click();
  await expect(page.getByText(/פורסמ/)).toBeVisible({ timeout: 20_000 });

  // The source pane shows the WordPress HTML as the item's source document.
  await page.goto('/library');
  await page.getByText(WP_TITLE).first().click();
  await expect(page.getByRole('heading', { level: 1, name: WP_TITLE })).toBeVisible();
  const docUrl = page.url();
  const docId = new URL(docUrl).pathname.split('/')[2]!;
  await page.getByRole('button', { name: 'מקור' }).click();
  await expect(page.getByText('סף מהירות: 5 מגה.')).toBeVisible();

  /* 3. an edit in WordPress becomes source version 2 and raises the flag ---- */
  const edited = await request.post(`${WP}/wp-json/wp/v2/posts/101`, {
    data: {
      content: '<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>',
    },
  });
  expect(edited.ok(), await edited.text()).toBeTruthy();
  const run2 = await request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run2.ok(), await run2.text()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const r = await request.get(`/api/v1/documents/${docId}/source`);
        return ((await r.json()) as { version: number }).version;
      },
      { timeout: 20_000 },
    )
    .toBeGreaterThan(1);

  await page.goto(docUrl);
  await expect(page.getByText('⚑ נדרשת בדיקה — המקור השתנה')).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: 'מקור' }).click();
  await expect(page.getByText('סף מהירות: 6 מגה.')).toBeVisible();

  /* 4. the editor decides the working view is unaffected -------------------- */
  await page.getByRole('button', { name: 'סמן כנבדק' }).click();
  await page.getByLabel('הערה').fill('אין השפעה על מסלול העבודה');
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText('⚑ נדרשת בדיקה — המקור השתנה')).toHaveCount(0);

  /* 5. an in-app source edit + publish pushes the *source HTML* back -------- */
  await page.goto(`/edit/${docId}/source`);
  const editor = page.getByRole('textbox', { name: 'מסמך המקור' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(` נערך במערכת ${stamp}.`);
  await page.getByRole('button', { name: 'שמור גרסה' }).click();
  await page.getByLabel('תיאור הגרסה').fill('עריכה במערכת');
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText(/נשמרה גרסת מקור/)).toBeVisible();

  await page.goto(`/edit/${docId}`);
  await page.getByRole('button', { name: /פרסם v/ }).click();
  const pub = page.getByRole('dialog', { name: /פרסום v/ });
  await pub.getByLabel(/מה השתנה/).fill('דחיפה ל-WordPress');
  await pub.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText(/פורסם v/)).toBeVisible({ timeout: 20_000 });

  await expect
    .poll(
      async () => {
        const r = await request.get(`${WP}/wp-json/wp/v2/posts/101`);
        return ((await r.json()) as { content: { rendered: string } }).content.rendered;
      },
      { timeout: 30_000 },
    )
    .toContain(`נערך במערכת ${stamp}`);
});
