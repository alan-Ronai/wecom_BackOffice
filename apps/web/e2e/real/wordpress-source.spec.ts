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
  // The import round-trip below is a queued job polled for up to 60 s (F-4); the whole flow
  // therefore needs more than the config's 60 s per test.
  test.setTimeout(180_000);
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
   * The created item is found by its **source**, not by its title: the title is the pipeline's
   * to choose (`packages/model/src/sections.ts`), and its identity here is "the document this
   * source produced".
   */
  const srcs = await request.get('/api/v1/sources');
  expect(srcs.ok(), await srcs.text()).toBeTruthy();
  const sourceId = ((await srcs.json()) as { items: { id: string; title: string }[] }).items.find(
    (x) => x.title === WP_TITLE,
  )?.id;
  expect(sourceId, `the connector created the source "${WP_TITLE}"`).toBeTruthy();

  /*
   * A WordPress post is one source, one document and one sync link — unique per
   * (connector, external id). The document this flow follows is "the one the link points at",
   * read from the queue once the asynchronous apply has written it; `sourceId` is still
   * verified so a link that points elsewhere is rejected rather than believed. (The fan-out
   * this loop was written to survive — a card per paragraph, the link landing on one of them —
   * is fixed in `packages/model/src/sections.ts`; the loop stays because the apply is async.)
   */
  const feedsFromSource = async (id: string): Promise<boolean> => {
    const doc = await request.get(`/api/v1/documents/${id}`);
    return doc.ok() && ((await doc.json()) as { sourceId?: string | null }).sourceId === sourceId;
  };
  let docId: string | undefined;
  await expect
    .poll(
      async () => {
        const links = await request.get(`/api/v1/sync/links?connectorId=${connectorId}&pageSize=50`);
        expect(links.ok(), await links.text()).toBeTruthy();
        const items = ((await links.json()) as { items: { documentId: string }[] }).items;
        for (const l of items) if (await feedsFromSource(l.documentId)) docId = l.documentId;
        return docId;
      },
      {
        message: 'applying the suggestions created a sync link for a document fed by the source',
        timeout: 30_000,
        intervals: [1_000],
      },
    )
    .toBeTruthy();
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
  /*
   * F-4: the run is a queued job, so the budget is on the *outcome*, not on a fixed number of
   * runs. A new run is kicked at most every 8 s (the modified_after race above), and the source is
   * polled every second for up to 60 s.
   */
  let sourceHtml = '';
  let lastRunAt = 0;
  await expect
    .poll(
      async () => {
        if (Date.now() - lastRunAt > 8_000) {
          const run = await request.post(`/api/v1/connectors/${connectorId}/run`);
          expect(run.ok(), await run.text()).toBeTruthy();
          lastRunAt = Date.now();
        }
        const r = await request.get(`/api/v1/documents/${docId}/source`);
        sourceHtml = r.status() === 204 ? '' : ((await r.json()) as { html: string }).html;
        return sourceHtml.includes('6 מגה');
      },
      { message: 'the WordPress edit became a source version', timeout: 60_000, intervals: [1_000] },
    )
    .toBe(true);

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
  // The editor is visible before TipTap has loaded the document, and a click that lands in an
  // empty editor puts the caret where the content will *later* be inserted around it (the typed
  // text once surfaced inside a list item). Wait for the imported text, then place the caret at
  // the end of the document explicitly and prove the typed sentence landed before saving.
  await expect(editor).toContainText('6 מגה');
  const edit = ` נערך במערכת ${stamp}.`;
  await expect(async () => {
    await editor.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type(edit);
    await expect(editor).toContainText(edit);
  }).toPass({ timeout: 15_000 });
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
