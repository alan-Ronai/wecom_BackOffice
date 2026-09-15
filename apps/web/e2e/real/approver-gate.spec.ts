import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W5-E2E-2 — spec §11, the approver role, against the real stack.
 *
 * With `workflow.requireApprover` off, a lead decides a review as they always did. With it on, the
 * same lead is refused — in the queue before the click (`canApprove` on the row) and by the API
 * behind it (403 `APPROVER_REQUIRED`) — while a holder of the `approver` role goes through.
 *
 * The requester is a third person on purpose: main's E-2 refuses a self-approval with 403
 * `SELF_APPROVAL`, which would mask the rule this spec is about.
 */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
const stamp = Date.now().toString(36);
const TITLE = `סקירת אישור ${stamp}`;

test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});

test('W5-E2E-2 requireApprover blocks a lead and admits an approver', async ({ browser, page, baseURL }) => {
  test.setTimeout(180_000);
  const api = await adminApi(page, baseURL!);
  opened.apis.push(api);
  const lead = await createUser(api, 'lead');
  const approver = await createUser(api, 'approver');

  /* somebody other than the approver writes a draft and sends it to review ---- */
  // The signed-in admin plays the requester: what matters is only that they are not the person
  // who approves (main's E-2 refuses a self-approval with 403 SELF_APPROVAL), and every UI
  // sign-in this gate performs comes out of one shared five-a-minute budget.
  const eApi = api;
  const created = await eApi.post('/api/v1/documents', {
    data: { title: TITLE, description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const docId = ((await created.json()) as { id: string }).id;
  const asked = await eApi.post(`/api/v1/documents/${docId}/request-review`, { data: { note: 'לבדיקה' } });
  expect(asked.ok(), await asked.text()).toBeTruthy();

  /* switch the requirement on ------------------------------------------------- */
  const on = await api.put('/api/v1/admin/workflow', { data: { requireApprover: true } });
  expect(on.ok(), await on.text()).toBeTruthy();

  try {
    /* the lead is refused, and the queue says so before the click ------------- */
    const l = await signInAs(browser, lead, baseURL!);
    opened.pages.push(l);
    await l.goto('/reviews');
    const card = l.locator('article.review-card, .review-card').filter({ hasText: TITLE }).first();
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByRole('button', { name: `אשר ופרסם את ${TITLE}` })).toBeDisabled();
    await expect(card.getByText('אישור דורש תפקיד מאשר')).toBeVisible();

    const lApi = await adminApi(l, baseURL!);
    opened.apis.push(lApi);
    const refused = await lApi.post(`/api/v1/documents/${docId}/review-decision`, {
      data: { decision: 'approve', label: 'ניסיון של ראש צוות' },
    });
    expect(refused.status(), await refused.text()).toBe(403);
    expect(((await refused.json()) as { code: string }).code).toBe('APPROVER_REQUIRED');

    /* the approver goes through ----------------------------------------------- */
    const p = await signInAs(browser, approver, baseURL!);
    opened.pages.push(p);
    await p.goto('/reviews');
    const row = p.locator('article.review-card, .review-card').filter({ hasText: TITLE }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.getByRole('button', { name: `אשר ופרסם את ${TITLE}` }).click();
    const dialog = p.getByRole('dialog', { name: new RegExp('אישור ופרסום') });
    await dialog.getByLabel(/מה השתנה/).fill('אושר על ידי מאשר');
    await dialog.getByRole('button', { name: 'אישור' }).click();
    await expect(p.getByText('אושר ופורסם')).toBeVisible({ timeout: 20_000 });
  } finally {
    // Leave the instance as the other specs expect to find it, pass or fail — and say so if the
    // reset itself failed: silently leaving `requireApprover` on poisons every later spec in the
    // serial run, and the failure would surface as an unrelated 403 somewhere else. `expect.soft`
    // reports it without replacing the real failure this `finally` may be unwinding.
    const off = await api.put('/api/v1/admin/workflow', { data: { requireApprover: false } });
    expect.soft(off.ok(), `requireApprover was not reset: ${await off.text()}`).toBeTruthy();
  }
});
