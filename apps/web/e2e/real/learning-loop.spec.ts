import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W5-E2E-1 — the PRD future-phase learning loop, end to end against the real stack, as two real
 * people: a lead builds a quiz from a published knowledge item, assigns it to an audience, the
 * agent passes it, the completion shows on the dashboard, a significant publish invalidates that
 * completion and hands the agent a refresh, and a term nobody could find becomes a knowledge gap
 * with a shortcut into the editor.
 *
 * Six numbered stages, because they are the acceptance evidence for six PRD bullets. Nothing here
 * is mocked: V1 owns the item, V2 the assignment and the change detector, V3 the gap, V4a/V4b the
 * screens, and this is the only test that proves they are the same system.
 */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});

const DOC_TITLE = 'איטיות גלישה / חוסר גלישה';
const stamp = Date.now().toString(36);
const QUIZ = `שאלון גלישה ${stamp}`;
/** A term the corpus cannot possibly answer, so the zero-result heuristic has something to find. */
const ZERO_TERM = `zzzqq${stamp}`;

/** `GET /learning/items/:id` — the manager's view, the only one that says which option is correct. */
interface ItemQuestion {
  id: string;
  stem: string;
  kind: 'single' | 'multi' | 'order' | 'free';
  options: { id: string; text: string; correct: boolean }[];
}

test('W5-E2E-1 a quiz is built, assigned, passed, refreshed after a significant change, and a gap is surfaced', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(240_000);
  const api = await adminApi(page, baseURL!);
  opened.apis.push(api);
  const agent = await createUser(api, 'agent');

  // Listed and filtered here rather than searched: the title carries a `/`, which the full-text
  // query treats as punctuation, and this lookup is setup rather than the thing under test.
  const found = await api.get('/api/v1/documents?pageSize=200');
  expect(found.ok(), await found.text()).toBeTruthy();
  const listed = (await found.json()) as {
    items: { id: string; title: string; category: string }[];
    total: number;
  };
  const doc = listed.items.find((d) => d.title.includes(DOC_TITLE));
  expect(
    doc,
    `the seeded document "${DOC_TITLE}" is in the corpus (got ${listed.items.length}/${listed.total}: ${listed.items
      .map((d) => d.title)
      .join(' | ')})`,
  ).toBeTruthy();

  /* 1. the manager builds a quiz from the document -------------------------- */
  // The manager is the signed-in admin of the shared storage state: this stage is about
  // `learning.manage` + `docs.publish`, which the admin holds, and `POST /auth/local` allows only
  // five sign-ins a minute per IP — a budget the whole gate shares.
  const l = page;
  await l.goto('/learning/manage');
  await l.getByRole('button', { name: '✚ שאלון' }).click();
  const newQuiz = l.getByRole('dialog', { name: 'שאלון חדש' });
  await newQuiz.getByLabel('כותרת', { exact: true }).fill(QUIZ);
  await newQuiz.getByRole('button', { name: 'אישור' }).click();
  await expect(l).toHaveURL(/\/learning\/manage\/[0-9a-f-]{36}/);
  const itemId = new URL(l.url()).pathname.split('/').pop()!;
  await expect(l.getByRole('heading', { level: 1 })).toContainText(QUIZ);

  await l.getByLabel('הוסף פריט ידע').fill(DOC_TITLE);
  await l.getByRole('listbox', { name: 'תוצאות' }).getByRole('option').first().click();
  await l.getByRole('button', { name: 'צור שאלות' }).click();
  // Generation runs the rules fallback (no model service in this gate), but it is still a round
  // trip over a document of real size.
  await expect(l.getByTestId('questions-list').locator('li').first()).toBeVisible({ timeout: 60_000 });
  await l.getByRole('button', { name: 'שמור שאלות' }).click();

  await l.getByRole('button', { name: 'פרסם' }).click();
  const pubDialog = l.getByRole('dialog', { name: 'פרסום פריט למידה' });
  await pubDialog.getByLabel('תיאור הגרסה').fill('גרסה ראשונה');
  await pubDialog.getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText('פריט הלמידה פורסם')).toBeVisible();

  /* 2. assign to the agents of the document's world ------------------------- */
  await l.getByRole('button', { name: 'הקצה' }).click();
  const assign = l.getByRole('dialog', { name: 'הקצאת פריט למידה' });
  await assign.getByRole('checkbox', { name: 'agent' }).check();
  // The audience is roles × worlds; a user with an unrestricted scope matches any world.
  // `exact`: the enclosing fieldset's legend is "קהל יעד (תפקידים × עולמות תוכן)", so a substring
  // match on the group name lands on the roles group and ticks a role instead of a world.
  const worldBoxes = assign.getByRole('group', { name: 'עולמות תוכן', exact: true }).getByRole('checkbox');
  await expect.poll(() => worldBoxes.count()).toBeGreaterThan(0);
  await worldBoxes.first().check();
  await assign.getByRole('button', { name: 'הקצה לקהל' }).click();
  await expect(l.getByText(/הוקצה ל-[1-9]\d* משתמשים/)).toBeVisible();

  /* 3. the agent passes it in the player ------------------------------------ */
  /*
   * Which option is correct is the manager's to know: `GET /learning/my/:id` and the manager's own
   * *preview* both answer `PlayerQuestionSchema`, which omits `correct` — that omission is the
   * feature. So the answers come from the full item (`GET /learning/items/:id`), which only
   * `learning.manage` can read, and the agent then picks them in the player like a person.
   */
  const full = await api.get(`/api/v1/learning/items/${itemId}`);
  expect(full.ok(), await full.text()).toBeTruthy();
  const questions = ((await full.json()) as { questions: ItemQuestion[] }).questions;
  expect(questions.length).toBeGreaterThan(0);
  expect(
    questions.every((q) => q.options.some((o) => o.correct)),
    'every generated question has a correct option',
  ).toBe(true);

  const a = await signInAs(browser, agent, baseURL!);
  opened.pages.push(a);
  const agentApi = await adminApi(a, baseURL!);
  opened.apis.push(agentApi);

  await a.goto('/learning');
  await a.getByRole('link', { name: QUIZ }).click();
  await a.getByRole('button', { name: 'התחל שאלון' }).click();
  for (let i = 0; i < questions.length; i++) {
    await expect(a.locator('.quiz-progress')).toHaveText(`שאלה ${i + 1} מתוך ${questions.length}`);
    const asked = await a.locator('.quiz-q legend').innerText();
    const q = questions.find((x) => x.stem.trim() === asked.trim());
    expect(q, `the player asked a question the item did not list: ${asked}`).toBeTruthy();
    const advance = a.getByRole('button', { name: i + 1 < questions.length ? 'הבא' : 'שלח תשובות' });
    const inputs = a.locator('.quiz-q input');
    for (const [n, o] of q!.options.entries()) if (o.correct) await inputs.nth(n).check();
    await expect(advance).toBeEnabled();
    await advance.click();
  }
  await expect(a.getByRole('heading', { name: /^עברת! ציון/ })).toBeVisible({ timeout: 30_000 });

  await a.goto('/learning');
  await expect(a.getByRole('region', { name: 'הושלמו' })).toContainText(QUIZ);

  /* 4. the dashboard shows the completion ----------------------------------- */
  await l.goto(`/learning/manage/${itemId}`);
  await l.getByRole('tab', { name: 'השלמה' }).click();
  await expect(l.getByText(agent.displayName)).toBeVisible({ timeout: 20_000 });

  /* 5. a significant publish invalidates it and creates a refresh ----------- */
  await l.goto(`/edit/${doc!.id}`);
  await l.getByRole('button', { name: /פרסם v/ }).click();
  const pub = l.getByRole('dialog', { name: /פרסום v/ });
  await pub.getByLabel(/מה השתנה/).fill(`שינוי סף ${stamp}`);
  const significant = pub.getByRole('checkbox', { name: 'שינוי מהותי – דרוש רענון' });
  await significant.check();
  await pub.getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText(/רענונים נוצרו/)).toBeVisible({ timeout: 30_000 });

  await a.goto(`/doc/${doc!.id}`);
  await expect(a.getByRole('status', { name: 'רענון ידע נדרש' })).toBeVisible({ timeout: 30_000 });
  await a.goto('/learning');
  await expect(a.getByRole('region', { name: 'בוטלו' })).toBeVisible();

  /* 6. a search nobody can answer becomes a gap with a shortcut ------------- */
  for (let i = 0; i < 4; i++) {
    const s = await agentApi.get(`/api/v1/search?q=${encodeURIComponent(ZERO_TERM)}`);
    expect(s.ok(), await s.text()).toBeTruthy();
  }
  const detect = await api.post('/api/v1/gaps/detect');
  expect(detect.ok(), await detect.text()).toBeTruthy();

  await l.goto('/gaps');
  const row = l.locator('article.gap').filter({ hasText: ZERO_TERM }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('link', { name: 'צור פריט' }).click();
  // The shortcut pre-fills the draft with the term nobody found, so the editor does not retype it.
  await expect(l).toHaveURL(/\/edit\/new\?title=/);
  await expect(l.getByPlaceholder('שם פריט הידע…')).toHaveValue(new RegExp(stamp));
});
