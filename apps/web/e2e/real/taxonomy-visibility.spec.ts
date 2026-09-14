import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W4-E2E-2 — PRD §2/§3/§6/§7/§10 in one pass: worlds and topics are data an admin edits, items
 * carry a type and tags, the topic page groups them, and a read-only reader sees the published
 * one and nothing else.
 *
 * The two halves are deliberately in one spec: "an agent can find it" and "an agent cannot find
 * the draft next to it" are the same assertion seen from two sides, and splitting them would let
 * one pass while the other silently stopped being about the same item.
 */
/**
 * Teardown that survives a failure. Closing the contexts after the last assertion means a
 * mid-test failure leaks them until the worker exits — which costs debuggability rather than
 * correctness, but a leaked context is exactly what you do not want while debugging a failure.
 * (`test.describe.configure({ mode: 'serial' })` used to sit here and was a no-op: one test.)
 */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});

const stamp = Date.now().toString(36);
const WORLD = { slug: `w-${stamp}`, name: `עולם בדיקה ${stamp}` };
const TOPIC = { slug: `t-${stamp}`, name: `נושא בדיקה ${stamp}` };
const TAG = `tag${stamp}`;
const PUBLISHED_TITLE = `פריט מפורסם ${stamp}`;
const DRAFT_TITLE = `טיוטה נסתרת ${stamp}`;

test('W4-E2E-2 admin adds a world and topic; an editor files items; a reader sees the published one only', async ({
  page,
  browser,
  baseURL,
}) => {
  const request = await adminApi(page, baseURL!);
  opened.apis.push(request);
  /* 1. the admin adds a world and a topic, with no deploy ------------------- */
  await page.goto('/admin/taxonomy');
  await page.getByRole('button', { name: '✚ עולם תוכן' }).click();
  const nameDlg = page.getByRole('dialog', { name: 'עולם תוכן חדש' });
  await nameDlg.getByLabel('שם', { exact: true }).fill(WORLD.name);
  await nameDlg.getByRole('button', { name: 'אישור' }).click();
  // Both prompts are titled "עולם תוכן חדש"; the slug one is identified by its field label.
  const slugDlg = page.getByRole('dialog', { name: 'עולם תוכן חדש' });
  await slugDlg.getByLabel(/מזהה/).fill(WORLD.slug);
  await slugDlg.getByRole('button', { name: 'אישור' }).click();
  const worldsList = page.getByTestId('worlds-list');
  await expect(worldsList.getByText(WORLD.name)).toBeVisible();

  // Exact: the ✎ rename button's accessible name contains the world name too.
  await worldsList.getByRole('button', { name: WORLD.name, exact: true }).click();
  await page.getByLabel('שם נושא חדש').fill(TOPIC.name);
  await page.getByLabel('מזהה נושא חדש').fill(TOPIC.slug);
  await page.getByRole('button', { name: '✚ נושא' }).click();
  await expect(page.getByTestId('topics-list').getByText(TOPIC.name)).toBeVisible();

  // The sidebar's world list is the API's, so the new world is simply there.
  await page.goto('/library');
  const side = page.getByRole('complementary', { name: 'ניווט ראשי' });
  await expect(side.getByText(WORLD.name)).toBeVisible();

  /* 2. an editor files one published item through the editor ---------------- */
  const editor = await createUser(request, 'lead');
  const e = await signInAs(browser, editor, baseURL!);
  opened.pages.push(e);
  await e.goto('/edit/new');
  await e.getByPlaceholder('שם פריט הידע…').fill(PUBLISHED_TITLE);
  await e.getByLabel('סוג פריט').selectOption('O');
  await e.getByLabel('עולם תוכן ראשי').selectOption(WORLD.slug);
  await e.getByTestId('topics').getByLabel(TOPIC.name).check();
  await e.getByLabel('הוסף תגית').fill(TAG);
  await e.getByLabel('הוסף תגית').press('Enter');
  await e.getByRole('button', { name: /פרסם v/ }).click();
  const pub = e.getByRole('dialog', { name: /פרסום v/ });
  await pub.getByLabel(/מה השתנה/).fill('פריט חדש');
  // Asserted on the responses, not only on the toast: a 400 from either call would otherwise
  // show up as "the toast never appeared", which says nothing about which call failed or why.
  const [createRes] = await Promise.all([
    e.waitForResponse((r) => r.request().method() === 'POST' && /\/api\/v1\/documents$/.test(r.url())),
    pub.getByRole('button', { name: 'אישור' }).click(),
  ]);
  expect(createRes.status(), await createRes.text()).toBe(201);
  const pubRes = await e.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/publish'),
  );
  expect(pubRes.status(), await pubRes.text()).toBe(200);
  // The editor navigates to the published item; that, not the toast, is the durable outcome.
  await expect(e).toHaveURL(/\/doc\/[0-9a-f-]+/, { timeout: 20_000 });
  /*
   * …and the article actually rendered. The URL alone is satisfied by a blank page — which is
   * precisely what this spec used to pass over: `CATS[slug].label` threw for an admin-created
   * world, the React root unmounted, and the URL stayed in the bar. The heading is the assertion
   * that can tell those two apart.
   */
  await expect(e.getByRole('heading', { level: 1, name: PUBLISHED_TITLE })).toBeVisible();

  /* 3. …and one that stays a draft. `POST /documents` creates drafts, and the editor only
        publishes, so the draft is made through the API rather than invented in the UI. ------ */
  const topics = await request.get(`/api/v1/worlds/${WORLD.slug}/topics`);
  const topicId = ((await topics.json()) as { items: { id: string; slug: string }[] }).items.find(
    (t) => t.slug === TOPIC.slug,
  )!.id;
  const draft = await request.post('/api/v1/documents', {
    data: {
      title: DRAFT_TITLE,
      description: '',
      category: WORLD.slug,
      wave: 2,
      priority: 'm',
      kind: 'text',
      docType: 'I',
      tags: [TAG],
      worlds: [],
      topics: [topicId],
    },
  });
  expect(draft.status(), await draft.text()).toBe(201);
  const draftId = ((await draft.json()) as { id: string }).id;

  /* 4. the topic page groups by type; the editor sees both, the draft flagged -------------- */
  await e.goto(`/topic/${topicId}`);
  await expect(e.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(e.getByText(DRAFT_TITLE)).toBeVisible();
  await expect(e.getByText('טיוטה').first()).toBeVisible();

  /* 5. the reader finds the published item by tag, and the draft nowhere ------------------- */
  const agent = await createUser(request, 'agent');
  const a = await signInAs(browser, agent, baseURL!);
  opened.pages.push(a);
  await a.goto(`/library?tag=${TAG}`);
  await expect(a.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(a.getByText(DRAFT_TITLE)).toHaveCount(0);

  await a.goto(`/topic/${topicId}`);
  await expect(a.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(a.getByText(DRAFT_TITLE)).toHaveCount(0);
  // No status chips for a reader: every item they can see is published, so a chip would be noise.
  await expect(a.getByText('טיוטה')).toHaveCount(0);

  // The reader *opens* it, rather than only seeing it in a list: the reader half of this spec
  // never reached the article, which is the screen the new world actually has to render.
  await a.getByText(PUBLISHED_TITLE).click();
  await expect(a).toHaveURL(/\/doc\/[0-9a-f-]+/);
  await expect(a.getByRole('heading', { level: 1, name: PUBLISHED_TITLE })).toBeVisible();

  // …and the direct link says "not available", not "not found" and not "forbidden".
  await a.goto(`/doc/${draftId}`);
  await expect(a.getByRole('heading', { name: 'פריט זה אינו זמין כרגע' })).toBeVisible();
});
