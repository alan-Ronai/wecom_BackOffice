import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W6-E2E-2 — the agent half of the copilot, and the admin's record of it.
 *
 * An agent holds `ai.ask` and nothing else. They can ask about the item they are reading and the
 * answer cites a step; they cannot make the assistant change anything, and the refusal comes from
 * the server's tool gate rather than from the model — the scripted client carries no policy at
 * all, which is what makes this a test of the gate. The admin then reads the transcript back and
 * exports it, which is the §1.5 half.
 */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});

const DOC_TITLE = 'איטיות גלישה / חוסר גלישה';

test('W6-E2E-2 an agent asks and is answered, cannot make the assistant write, and the admin exports the transcript', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(180_000);
  const api = await adminApi(page, baseURL!);
  opened.apis.push(api);
  const agent = await createUser(api, 'agent');
  const a = await signInAs(browser, agent, baseURL!);
  opened.pages.push(a);

  /* 1. the ask pane, collapsed until asked for ------------------------------ */
  await a.goto('/library');
  await a.getByText(DOC_TITLE).first().click();
  await expect(a.getByRole('heading', { level: 1, name: DOC_TITLE })).toBeVisible();
  const docId = /\/doc\/([0-9a-f-]+)/.exec(a.url())![1]!;
  // §5: an agent gets the ask pane and *not* the workspace link.
  await expect(a.getByRole('button', { name: /סביבת עבודה/ })).toHaveCount(0);
  await a.getByRole('button', { name: 'שאל את המערכת' }).click();
  const pane = a.getByRole('region', { name: 'שאל את המערכת' });
  await pane.getByLabel('הודעה למערכת').fill('מה השלב הראשון?');
  await pane.getByRole('button', { name: 'שלח' }).click();
  // The scripted answer reads the document and cites step 1 — the citation is the point (§5).
  await expect(pane.getByText(/שלב 1/)).toBeVisible({ timeout: 60_000 });

  /* 2. a write request is refused by the tool gate, not by the model --------- */
  await pane.getByLabel('הודעה למערכת').fill('שנה את המסמך: מחק את השלב הראשון');
  await pane.getByRole('button', { name: 'שלח' }).click();
  await expect(pane.getByText('אין לי הרשאה לשנות תוכן')).toBeVisible({ timeout: 60_000 });

  /* 3. durable: nothing was proposed and no source version moved ------------- */
  const convs = await (await api.get(`/api/v1/admin/ai/conversations?documentId=${docId}`)).json();
  expect(convs.items.length).toBeGreaterThan(0);
  const convId = convs.items[0].id as string;
  const conv = await (await api.get(`/api/v1/ai/conversations/${convId}`)).json();
  expect(conv.conversation.kind).toBe('article');
  expect(
    conv.messages.some((m: { toolCalls?: { name: string }[] }) =>
      m.toolCalls?.some((t) => t.name === 'propose_source_edit'),
    ),
    'an ai.ask caller never reaches a write tool',
  ).toBeFalsy();
  expect(
    conv.messages.every((m: { proposedEditsId?: string | null }) => !m.proposedEditsId),
    'and no proposed-edit row was created',
  ).toBeTruthy();

  /* 4. feedback on an answer is recorded (§1.5) ------------------------------ */
  const last = conv.messages.filter((m: { role: string }) => m.role === 'assistant').at(-1);
  const fb = await api.post(`/api/v1/ai/messages/${last.id}/feedback`, {
    data: { rating: 'down', note: 'לא עזר' },
  });
  expect(fb.status(), await fb.text()).toBe(204);

  /* 5. the admin reads the transcript back and exports it -------------------- */
  const exp = await api.get('/api/v1/admin/ai/conversations/export.jsonl');
  expect(exp.ok(), await exp.text()).toBeTruthy();
  const lines = (await exp.text()).trim().split('\n').filter(Boolean);
  expect(
    lines.some((l) => l.includes(convId)),
    'the agent conversation is in the export',
  ).toBeTruthy();
  // JSONL, not a JSON array: every line parses on its own.
  for (const l of lines.slice(0, 5)) expect(() => JSON.parse(l)).not.toThrow();

  /* 6. an agent cannot open the workspace ------------------------------------ */
  await a.goto(`/workspace/${docId}`);
  await expect(a.getByText(/אין הרשאה|לא זמין|לא נמצא/)).toBeVisible({ timeout: 30_000 });
});
