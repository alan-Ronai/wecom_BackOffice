import { test, expect, type APIRequestContext } from '@playwright/test';
import { adminApi } from './helpers/users.js';

/**
 * W4-E2E-3 — PRD §8, the two-way source loop against a real WordPress-shaped server:
 * a post is imported, accepted and published; an edit *there* lands as a new source version and
 * raises the review flag *here*; the editor decides it changes nothing and clears the flag; an
 * edit *here* is pushed back as the source HTML.
 *
 * The stub is the same module the connector unit tests use, started as a process by
 * `scripts/wp-stub.mjs`; `E2E_WP_URL` is where the gate put it.
 */
/** See `taxonomy-visibility.spec.ts`: teardown that survives a failure, in place of the no-op
    `test.describe.configure({ mode: 'serial' })` this file used to carry. */
const opened: APIRequestContext[] = [];
test.afterEach(async () => {
  for (const a of opened.splice(0)) await a.dispose();
});

const WP = process.env.E2E_WP_URL!;
const stamp = Date.now().toString(36);
const WP_TITLE = 'נוהל WordPress לבדיקה';

test('W4-E2E-3 WordPress → source version → review flag → publish → push renders the source HTML', async ({
  page,
  baseURL,
  request: anonymous,
}) => {
  expect(WP, 'E2E_WP_URL is set by scripts/e2e-real.mjs').toBeTruthy();
  const request = await adminApi(page, baseURL!);
  opened.push(request);

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
  // The publish is confirmed in a dialog before it runs.
  await page.getByRole('dialog', { name: 'פרסום לספרייה' }).getByRole('button', { name: 'פרסם' }).click();
  // At least one: "0 changes applied" would satisfy a looser pattern and prove nothing.
  await expect(page.getByText(/פורסמו [1-9]\d* שינויים/)).toBeVisible({ timeout: 20_000 });

  /*
   * The created item is found by its **source**, not by its title: a new-card suggestion names
   * itself after the first sentence of the paragraph it came from (`packages/model/rules.ts`),
   * not after the WordPress post. Its identity here is "the document this source produced".
   */
  const srcs = await request.get('/api/v1/sources');
  expect(srcs.ok(), await srcs.text()).toBeTruthy();
  const sourceId = ((await srcs.json()) as { items: { id: string; title: string }[] }).items.find(
    (x) => x.title === WP_TITLE,
  )?.id;
  expect(sourceId, `the connector created the source "${WP_TITLE}"`).toBeTruthy();

  /*
   * The polling is legitimate — applying the suggestions is asynchronous — but the fan-out was
   * not: each round listed ten cards and then issued a `GET /documents/:id` per card to read a
   * `sourceId` the card shape does not carry, up to ~200 requests to find one id, and getting
   * slower as the database fills. `GET /suggestions?sourceId=` answers the same question in one
   * request, because an applied suggestion records the document it created. The per-card scan
   * stays as the fallback for the round where `targetDocumentId` has not been written yet.
   */
  let docId: string | undefined;
  for (let round = 0; round < 20 && !docId; round++) {
    const sug = await request.get(`/api/v1/suggestions?sourceId=${sourceId}&pageSize=50`);
    expect(sug.ok(), await sug.text()).toBeTruthy();
    docId = ((await sug.json()) as { items: { targetDocumentId?: string | null }[] }).items.find(
      (x) => x.targetDocumentId,
    )?.targetDocumentId as string | undefined;
    if (!docId) {
      const list = await request.get('/api/v1/documents?sort=updated&pageSize=10');
      expect(list.ok(), await list.text()).toBeTruthy();
      for (const card of ((await list.json()) as { items: { id: string }[] }).items) {
        const doc = await request.get(`/api/v1/documents/${card.id}`);
        if (((await doc.json()) as { sourceId?: string | null }).sourceId === sourceId) {
          docId = card.id;
          break;
        }
      }
    }
    if (!docId) await page.waitForTimeout(1_000);
  }
  expect(docId, 'the accepted suggestion created a document fed by that source').toBeTruthy();
  const docUrl = `/doc/${docId!}`;

  /*
   * There is no source *document* yet, and that is the designed order: the sync link is created
   * when the suggestions are applied (`afterSuggestionsApplied`), and the remote HTML is written
   * as a source version by the first import that runs *through* that link. So the pane offers
   * nothing to open here — asserting otherwise would be asserting a step the product skips.
   */
  await page.goto(docUrl);
  const paneToggle = page.getByRole('group', { name: 'מצב תצוגה' });
  await expect(paneToggle.getByRole('button', { name: 'מקור', exact: true })).toBeDisabled();

  /* 3. an edit in WordPress becomes a source version and raises the flag ---- */
  const edited = await anonymous.post(`${WP}/wp-json/wp/v2/posts/101`, {
    data: {
      content: '<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>',
    },
  });
  expect(edited.ok(), await edited.text()).toBeTruthy();
  /*
   * Run until the import lands, rather than once: the remote listing is filtered by
   * `modified_after` at one-second resolution, so an edit made in the same second as the previous
   * run can be invisible to the next one. A scheduled connector simply catches it on the
   * following tick; here that tick is explicit.
   */
  let sourceHtml = '';
  for (let round = 0; round < 10 && !sourceHtml.includes('6 מגה'); round++) {
    const run = await request.post(`/api/v1/connectors/${connectorId}/run`);
    expect(run.ok(), await run.text()).toBeTruthy();
    const r = await request.get(`/api/v1/documents/${docId}/source`);
    sourceHtml = r.status() === 204 ? '' : ((await r.json()) as { html: string }).html;
    if (!sourceHtml.includes('6 מגה')) await page.waitForTimeout(1_500);
  }
  expect(sourceHtml, 'the WordPress edit became a source version').toContain('6 מגה');

  await page.goto(docUrl);
  await expect(page.getByText('⚑ נדרשת בדיקה — המקור השתנה')).toBeVisible({ timeout: 20_000 });
  await page
    .getByRole('group', { name: 'מצב תצוגה' })
    .getByRole('button', { name: 'מקור', exact: true })
    .click();
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

  /*
   * Publishing does not push by itself, and the next run does not either: the remote moved in
   * step 3 and the local moved here, so the link is a genuine two-sided conflict. Resolving it
   * as "ours" is the operator's answer — the working view is the one that is right — and that is
   * what sends the source HTML to WordPress.
   */
  const run3 = await request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run3.ok(), await run3.text()).toBeTruthy();

  const links = await request.get('/api/v1/sync/links?pageSize=50');
  expect(links.ok(), await links.text()).toBeTruthy();
  const link = ((await links.json()) as { items: { id: string; documentId: string }[] }).items.find(
    (l) => l.documentId === docId,
  );
  expect(link, 'applying the suggestions created a sync link for the document').toBeTruthy();
  const resolved = await request.post(`/api/v1/sync/links/${link!.id}/resolve`, {
    data: { resolution: 'ours' },
  });
  expect(resolved.ok(), await resolved.text()).toBeTruthy();

  await expect
    .poll(
      async () => {
        const r = await anonymous.get(`${WP}/wp-json/wp/v2/posts/101`);
        return ((await r.json()) as { content: { rendered: string } }).content.rendered;
      },
      { timeout: 30_000 },
    )
    .toContain(`נערך במערכת ${stamp}`);
});
