import { test, expect } from '@playwright/test';

/**
 * S1-3 (e) — the two-way WordPress loop, on the Compose stack.
 *
 * The shape is `e2e/real/wordpress-source.spec.ts`'s, deliberately: the same stub module, the same
 * sequence, the same assertions. What it adds is the deployment — the connector's outbound call
 * leaves the api *container* and is checked against `CONNECTOR_HOST_ALLOWLIST` (which names `wp`,
 * not `*`, so the allowlist is exercised rather than waved through), the pipeline runs against the
 * real Ollama the stack pulled rather than the rule-based fallback, and every browser step goes
 * through nginx. An import that works on loopback and fails in a container — a DNS name, an
 * allowlist entry, a proxy timeout on a slow model call — is exactly what this catches.
 *
 * `E2E_WP_URL` is WordPress as the api container reaches it; `E2E_WP_HOST_URL` is the same stub
 * published to the host, which is how this spec makes an edit "in WordPress".
 */

const WP = process.env.E2E_WP_URL!;
const WP_HOST = process.env.E2E_WP_HOST_URL!;
const WP_TITLE = 'נוהל WordPress לבדיקה';
const stamp = Date.now().toString(36);

test('WordPress → source version → review flag → publish → push renders the source HTML', async ({
  page,
  request: anonymous,
}) => {
  /**
   * Generous, and it has to be: the import is a queued job, and on this stack the pipeline makes a
   * real CPU-only model call (two, if the first answer is not valid JSON) before falling back to
   * the rule-based proposer. The budget is on the outcome, never on a fixed number of polls.
   */
  test.setTimeout(900_000);
  expect(WP, 'E2E_WP_URL is set by scripts/e2e-compose.mjs').toBeTruthy();

  /* 1. the connector ---------------------------------------------------------- */
  const created = await page.request.post('/api/v1/connectors', {
    data: {
      type: 'wordpress',
      name: `wp-compose-${stamp}`,
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

  /* 2. first run: the post becomes a suggestion, accepted and published -------- */
  const run1 = await page.request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run1.ok(), await run1.text()).toBeTruthy();

  await page.goto('/sources');
  await expect(page.locator('.src-layout')).toBeVisible();
  /**
   * The card arrives when it arrives. Measured on a CPU-only host: `proposeChanges` asks Ollama
   * twice, each call exceeds the model client's own 120 s budget, and the pipeline then falls back
   * to the rule-based proposer — about four minutes before the first suggestion exists. That is
   * the honest first-import cost of a pilot VM with no GPU, and the reason this one spec dominates
   * the suite's runtime; the budget is on the outcome, with room for a slower machine than this.
   */
  await expect(page.getByText(WP_TITLE).first()).toBeVisible({ timeout: 420_000 });
  await page.getByText(WP_TITLE).first().click();
  await page.getByRole('button', { name: 'אשר הכל' }).click();
  await page.getByRole('button', { name: 'פרסם לספרייה' }).click();
  await page.getByRole('dialog', { name: 'פרסום לספרייה' }).getByRole('button', { name: 'פרסם' }).click();
  // At least one: "0 changes applied" would satisfy a looser pattern and prove nothing.
  await expect(page.getByText(/פורסמו [1-9]\d* שינויים/)).toBeVisible({ timeout: 60_000 });

  /*
   * The created item is found by its **source**, not by its title: the title is the pipeline's to
   * choose, and on this stack a real model chooses it. Its identity here is "the document this
   * source produced".
   */
  const srcs = await page.request.get('/api/v1/sources');
  expect(srcs.ok(), await srcs.text()).toBeTruthy();
  const sourceId = ((await srcs.json()) as { items: { id: string; title: string }[] }).items.find(
    (x) => x.title === WP_TITLE,
  )?.id;
  expect(sourceId, `the connector created the source "${WP_TITLE}"`).toBeTruthy();

  const feedsFromSource = async (id: string): Promise<boolean> => {
    const doc = await page.request.get(`/api/v1/documents/${id}`);
    return doc.ok() && ((await doc.json()) as { sourceId?: string | null }).sourceId === sourceId;
  };
  let docId: string | undefined;
  await expect
    .poll(
      async () => {
        const links = await page.request.get(`/api/v1/sync/links?connectorId=${connectorId}&pageSize=50`);
        expect(links.ok(), await links.text()).toBeTruthy();
        const items = ((await links.json()) as { items: { documentId: string }[] }).items;
        for (const l of items) if (await feedsFromSource(l.documentId)) docId = l.documentId;
        return docId;
      },
      {
        message: 'applying the suggestions created a sync link for a document fed by the source',
        timeout: 60_000,
        intervals: [1_000],
      },
    )
    .toBeTruthy();
  const docUrl = `/doc/${docId!}`;

  /* 3. an edit in WordPress becomes a source version and raises the flag ------- */
  // Through the published port, i.e. from outside the stack, the way an author edits a post.
  const edited = await anonymous.post(`${WP_HOST}/wp-json/wp/v2/posts/101`, {
    data: {
      content: '<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>',
    },
  });
  expect(edited.ok(), await edited.text()).toBeTruthy();

  /*
   * A new run at most every 8 s — the remote listing is filtered by `modified_after` at one-second
   * resolution, so an edit made in the same second as the previous run is invisible to the next
   * one — and the source polled every second until the edit lands.
   */
  let sourceHtml = '';
  let lastRunAt = 0;
  await expect
    .poll(
      async () => {
        if (Date.now() - lastRunAt > 8_000) {
          const run = await page.request.post(`/api/v1/connectors/${connectorId}/run`);
          expect(run.ok(), await run.text()).toBeTruthy();
          lastRunAt = Date.now();
        }
        const r = await page.request.get(`/api/v1/documents/${docId}/source`);
        sourceHtml = r.status() === 204 ? '' : ((await r.json()) as { html: string }).html;
        return sourceHtml.includes('6 מגה');
      },
      { message: 'the WordPress edit became a source version', timeout: 180_000, intervals: [1_000] },
    )
    .toBe(true);

  await page.goto(docUrl);
  await expect(page.getByText('⚑ נדרשת בדיקה — המקור השתנה')).toBeVisible({ timeout: 30_000 });
  await page
    .getByRole('group', { name: 'מצב תצוגה' })
    .getByRole('button', { name: 'מקור', exact: true })
    .click();
  await expect(page.getByText('סף מהירות: 6 מגה.')).toBeVisible();

  /* 4. the editor decides the working view is unaffected ----------------------- */
  await page.getByRole('button', { name: 'סמן כנבדק' }).click();
  await page.getByLabel('הערה').fill('אין השפעה על מסלול העבודה');
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText('⚑ נדרשת בדיקה — המקור השתנה')).toHaveCount(0);

  /* 5. an in-app source edit + publish pushes the *source HTML* back ----------- */
  await page.goto(`/edit/${docId}/source`);
  const editor = page.getByRole('textbox', { name: 'מסמך המקור' });
  await expect(editor).toBeVisible();
  await editor.click();
  await page.keyboard.press('End');
  /**
   * Typed with a delay, unlike the loopback suite: on a machine busy enough to be running this
   * stack, TipTap dropped the first few keystrokes of an undelayed `type()` and the sentence
   * arrived truncated. The assertion at the end is on `stamp` alone for the same reason — the
   * prose around it is the editor's to reflow (it already wraps each list item in a `<p>`), while
   * the stamp is the thing that can only be here because *this run* typed it.
   */
  await page.keyboard.type(` נערך במערכת ${stamp}.`, { delay: 30 });
  await page.getByRole('button', { name: 'שמור גרסה' }).click();
  await page.getByLabel('תיאור הגרסה').fill('עריכה במערכת');
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText(/נשמרה גרסת מקור/)).toBeVisible();

  await page.goto(`/edit/${docId}`);
  await page.getByRole('button', { name: /פרסם v/ }).click();
  const pub = page.getByRole('dialog', { name: /פרסום v/ });
  await pub.getByLabel(/מה השתנה/).fill('דחיפה ל-WordPress');
  await pub.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByText(/פורסם v/)).toBeVisible({ timeout: 60_000 });

  /*
   * Publishing does not push by itself, and neither does the next run: the remote moved in step 3
   * and the local moved here, so the link is a genuine two-sided conflict. Resolving it as "ours"
   * is the operator's answer, and that is what sends the source HTML to WordPress.
   */
  const run3 = await page.request.post(`/api/v1/connectors/${connectorId}/run`);
  expect(run3.ok(), await run3.text()).toBeTruthy();

  const links = await page.request.get('/api/v1/sync/links?pageSize=50');
  expect(links.ok(), await links.text()).toBeTruthy();
  const link = ((await links.json()) as { items: { id: string; documentId: string }[] }).items.find(
    (l) => l.documentId === docId,
  );
  expect(link, 'applying the suggestions created a sync link for the document').toBeTruthy();
  const resolved = await page.request.post(`/api/v1/sync/links/${link!.id}/resolve`, {
    data: { resolution: 'ours' },
  });
  expect(resolved.ok(), await resolved.text()).toBeTruthy();

  // Read back from WordPress itself: the loop is only closed when the post has our HTML in it.
  await expect
    .poll(
      async () => {
        const r = await anonymous.get(`${WP_HOST}/wp-json/wp/v2/posts/101`);
        return ((await r.json()) as { content: { rendered: string } }).content.rendered;
      },
      { timeout: 60_000, intervals: [1_000] },
    )
    .toContain(stamp);
});
