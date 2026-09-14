import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W4-E2E-1 — PRD §12, the closed loop, as three real people against the real stack:
 * an agent reports from the step they were standing on, a lead picks it up in the queue, fixes
 * the source document, publishes the working view with the report ticked, and the report comes
 * back `טופל` carrying the version that closed it. The analytics tab then counts it.
 *
 * This is the one flow no lane could test: the report is W3, the source edit is W4, the publish
 * link is W2/W6, and the analytics is W3 again reading what the publish wrote.
 */
/** See `taxonomy-visibility.spec.ts`: teardown that survives a failure, in place of the no-op
    `test.describe.configure({ mode: 'serial' })` this file used to carry. */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});

const DOC_TITLE = 'איטיות גלישה / חוסר גלישה';
const REPORT = `הסף בשלב 1 לא נכון ${Date.now().toString(36)}`;

test('W4-E2E-1 feedback travels from an agent to a closed status linked to a published version', async ({
  browser,
  page,
  baseURL,
}) => {
  const api = await adminApi(page, baseURL!);
  opened.apis.push(api);
  const agent = await createUser(api, 'agent');
  const lead = await createUser(api, 'lead');

  /* 1. the agent reports, from the step they are on ------------------------ */
  const a = await signInAs(browser, agent, baseURL!);
  opened.pages.push(a);
  await a.goto('/library');
  await a.getByText(DOC_TITLE).first().click();
  await expect(a.getByRole('heading', { level: 1, name: DOC_TITLE })).toBeVisible();
  /*
   * §5.4 puts the report button in the header *and per step*. The agent lands here in call mode,
   * where only the step they are standing on is expanded, so the honest assertion at this point
   * is header + active step; the exact "one per step" count is asserted outside call mode in
   * `wave4-mounts.test.tsx`, where the preference is controllable.
   */
  const reportButtons = a.getByRole('button', { name: 'דיווח על בעיה / משוב' });
  await expect.poll(() => reportButtons.count()).toBeGreaterThanOrEqual(2);
  await reportButtons.first().click();
  const dlg = a.getByRole('dialog', { name: 'דיווח על בעיה / משוב' });
  await dlg.getByRole('radio', { name: 'מצאתי טעות' }).check();
  await dlg.getByLabel('הסבר קצר').fill(REPORT);
  // PRD §12: the context is captured, not retyped — the agent is shown what will be sent.
  await expect(dlg.getByText(/גרסה v\d+/)).toBeVisible();
  await dlg.getByRole('button', { name: 'שלח' }).click();
  await expect(a.getByText(/המשוב נשלח/)).toBeVisible();

  /* 2. the lead finds it in the queue and takes it -------------------------- */
  const l = await signInAs(browser, lead, baseURL!);
  opened.pages.push(l);
  await l.goto('/feedback');
  const row = l.getByRole('row').filter({ hasText: DOC_TITLE }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText('חדש')).toBeVisible();
  await row.getByRole('link').first().click();

  const drawer = l.getByRole('complementary', { name: 'פרטי משוב' });
  await expect(drawer.getByText(REPORT)).toBeVisible();
  await drawer.getByLabel('סטטוס').selectOption('in_review');
  await drawer.getByRole('button', { name: 'שמור' }).click();
  await expect(l.getByText('ההחלטה נשמרה')).toBeVisible();

  const docHref = await drawer.getByRole('link', { name: 'פתח מסמך' }).getAttribute('href');
  expect(docHref).toMatch(/\/doc\/[0-9a-f-]+/);
  const docId = docHref!.split('/')[2]!;

  /* 3. the lead edits the source document ----------------------------------- */
  await l.goto(`/edit/${docId}/source`);
  const editor = l.getByRole('textbox', { name: 'מסמך המקור' });
  await expect(editor).toBeVisible();
  await editor.click();
  await l.keyboard.press('End');
  await l.keyboard.type(' סף חדש: 6 מגה.');
  await l.getByRole('button', { name: 'שמור גרסה' }).click();
  await l.getByLabel('תיאור הגרסה').fill('עדכון סף');
  await l.getByRole('dialog').getByRole('button', { name: 'אישור' }).click();
  await expect(l.getByText(/נשמרה גרסת מקור/)).toBeVisible();

  /* 4. publishing the working view closes the report against the new version */
  await l.goto(`/edit/${docId}`);
  await l.getByRole('button', { name: /פרסם v/ }).click();
  const pub = l.getByRole('dialog', { name: /פרסום v/ });
  await pub.getByLabel(/מה השתנה/).fill('תיקון הסף בעקבות משוב');
  await pub.getByRole('checkbox').first().check();
  await pub.getByRole('button', { name: 'אישור' }).click();
  const published = l.getByText(/פורסם v\d+/);
  await expect(published).toBeVisible({ timeout: 20_000 });
  const version = Number(/v(\d+)/.exec(await published.innerText())![1]);

  /* 5. the queue shows it done, linked to that version ---------------------- */
  await l.goto('/feedback?status=done');
  const done = l.getByRole('row').filter({ hasText: DOC_TITLE }).first();
  await expect(done).toBeVisible();
  await expect(done.getByText(`v${version}`)).toBeVisible();

  await l.goto('/feedback/analytics');
  await expect(l.getByText(/שיעור משובים שהובילו לשינוי תוכן/)).toBeVisible();
});
