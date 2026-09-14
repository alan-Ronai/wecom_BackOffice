import { test, expect } from '@playwright/test';
import { createUser, signInAs } from './helpers/users.js';

/**
 * W4-E2E-2 — PRD §2/§3/§6/§7/§10 in one pass: worlds and topics are data an admin edits, items
 * carry a type and tags, the topic page groups them, and a read-only reader sees the published
 * one and nothing else.
 *
 * The two halves are deliberately in one spec: "an agent can find it" and "an agent cannot find
 * the draft next to it" are the same assertion seen from two sides, and splitting them would let
 * one pass while the other silently stopped being about the same item.
 */
test.describe.configure({ mode: 'serial' });

const stamp = Date.now().toString(36);
const WORLD = { slug: `w-${stamp}`, name: `עולם בדיקה ${stamp}` };
const TOPIC = { slug: `t-${stamp}`, name: `נושא בדיקה ${stamp}` };
const TAG = `tag${stamp}`;
const PUBLISHED_TITLE = `פריט מפורסם ${stamp}`;
const DRAFT_TITLE = `טיוטה נסתרת ${stamp}`;

test('W4-E2E-2 admin adds a world and topic; an editor files items; a reader sees the published one only', async ({
  page,
  browser,
  request,
}) => {
  /* 1. the admin adds a world and a topic, with no deploy ------------------- */
  await page.goto('/admin/taxonomy');
  page.once('dialog', () => undefined); // no native dialogs; the app uses its own modal
  await page.getByRole('button', { name: '✚ עולם תוכן' }).click();
  await page.getByLabel('שם').fill(WORLD.name);
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await page.getByLabel('slug').fill(WORLD.slug);
  await page.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  const worldsList = page.getByTestId('worlds-list');
  await expect(worldsList.getByText(WORLD.name)).toBeVisible();

  await worldsList.getByRole('button', { name: WORLD.name }).click();
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
  const e = await signInAs(browser, editor);
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
  await pub.getByRole('button', { name: 'אישור' }).click();
  await expect(e.getByText(/פורסם v1/)).toBeVisible({ timeout: 20_000 });

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
  await e.context().close();

  /* 5. the reader finds the published item by tag, and the draft nowhere ------------------- */
  const agent = await createUser(request, 'agent');
  const a = await signInAs(browser, agent);
  await a.goto(`/library?tag=${TAG}`);
  await expect(a.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(a.getByText(DRAFT_TITLE)).toHaveCount(0);

  await a.goto(`/topic/${topicId}`);
  await expect(a.getByText(PUBLISHED_TITLE)).toBeVisible();
  await expect(a.getByText(DRAFT_TITLE)).toHaveCount(0);
  // No status chips for a reader: every item they can see is published, so a chip would be noise.
  await expect(a.getByText('טיוטה')).toHaveCount(0);

  // …and the direct link says "not available", not "not found" and not "forbidden".
  await a.goto(`/doc/${draftId}`);
  await expect(a.getByRole('heading', { name: 'פריט זה אינו זמין כרגע' })).toBeVisible();
  await a.context().close();
});
