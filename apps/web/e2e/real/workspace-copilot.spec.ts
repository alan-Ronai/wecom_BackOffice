import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { adminApi, createUser, signInAs } from './helpers/users.js';

/**
 * W6-E2E-1 — the AI copilot loop against the real stack.
 *
 * The chat runs in `AI_TEST_SCRIPT` mode (`scripts/e2e-real.mjs` sets it, and `chatModel.ts`
 * refuses it outside the e2e stack): the *reply* is deterministic, everything else — the
 * orchestrator, the tool runtime and its permission gate, the anchored paragraph edit, the source
 * save, the pipeline, the structured editor, the partial apply and the analytics — is the real
 * code. Model *quality* is measured by the eval harness (`docs/wave6-acceptance.md`), not here.
 *
 * Every assertion is a durable post-condition — a source version, a suggestion status, a
 * persisted transcript — not a toast.
 */
const opened: { pages: Page[]; apis: APIRequestContext[] } = { pages: [], apis: [] };
test.afterEach(async () => {
  for (const p of opened.pages.splice(0)) await p.context().close();
  for (const a of opened.apis.splice(0)) await a.dispose();
});

const DOC_TITLE = 'איטיות גלישה / חוסר גלישה';
const stamp = Date.now().toString(36);

test('W6-E2E-1 the chat proposes a source edit, the editor accepts it, and a partial apply lands', async ({
  browser,
  page,
  baseURL,
}) => {
  test.setTimeout(420_000);
  const api = await adminApi(page, baseURL!);
  opened.apis.push(api);
  // `editor` holds docs.edit + ai.chat + suggestions.review (`DEFAULT_ROLES.editor`).
  const editor = await createUser(api, 'editor');
  const e = await signInAs(browser, editor, baseURL!);
  opened.pages.push(e);

  /* 1. the workspace is reached from the article, not from a nav entry ------- */
  await e.goto('/library');
  await e.getByText(DOC_TITLE).first().click();
  await expect(e.getByRole('heading', { level: 1, name: DOC_TITLE })).toBeVisible();
  await e.getByRole('button', { name: /סביבת עבודה/ }).click();
  await expect(e).toHaveURL(/\/workspace\/[0-9a-f-]+/);
  const docId = /\/workspace\/([0-9a-f-]+)/.exec(e.url())![1]!;

  const sourceOf = async () => (await api.get(`/api/v1/documents/${docId}/source`)).json();
  /*
   * The seed gives no document a source document; in a full run `feedback-loop.spec.ts` happens
   * to save one on this item first. Relying on that made this spec order-dependent — alone, the
   * GET answered 204 and the spec died parsing an empty body. So it gives the item a source
   * document itself when there is none, through the same audited save an editor uses.
   */
  if ((await api.get(`/api/v1/documents/${docId}/source`)).status() === 204) {
    const put = await api.put(`/api/v1/documents/${docId}/source`, {
      data: { html: '<p>סף חדש: 6 מגה.</p>', label: 'e2e: מסמך מקור ראשון' },
    });
    expect(put.ok(), `first source save: ${put.status()}`).toBeTruthy();
    await e.reload();
  }
  const before = await sourceOf();
  expect(before.version, 'the document has a source document').toBeGreaterThan(0);
  // The first sentence of the source, which the scripted reply is asked to rewrite.
  const quote = /<p>([^<]{6,60})/.exec(before.html as string)?.[1]?.trim();
  expect(quote, `a paragraph to edit in ${String(before.html).slice(0, 200)}`).toBeTruthy();

  /* 2. ask the chat for the change; accept the hunk ------------------------- */
  // The workspace's three panes are `section[aria-label]`s: "מסמך המקור", "הצעות", "סביבת העבודה".
  const chat = e.getByRole('region', { name: 'סביבת העבודה' });
  await chat.getByLabel('הודעה למערכת').fill(`שנה את "${quote}" ל-"${quote} ${stamp}"`);
  await chat.getByRole('button', { name: 'שלח' }).click();

  const overlay = e.getByRole('region', { name: 'עריכות מוצעות במסמך' });
  await expect(overlay).toBeVisible({ timeout: 60_000 });
  /*
   * Per hunk, not "קבל הכל": the tri-state row is the thing spec §1.3 is about, and "קבל הכל"
   * short-circuits straight to the decision. Marking one hunk and then confirming exercises the
   * path a real editor takes and the `{ accept: [...], reject: [...] }` body it produces.
   */
  await overlay.getByRole('button', { name: 'קבל', exact: true }).first().click();
  await overlay.getByRole('button', { name: /אשר החלטות/ }).click();

  // Durable: a new source version whose html carries the text the chat proposed.
  await expect
    .poll(async () => (await sourceOf()).version, { timeout: 60_000 })
    .toBeGreaterThan(before.version as number);
  expect((await sourceOf()).html).toContain(`${quote} ${stamp}`);

  /* 3. the transcript persisted the tool call ------------------------------- */
  const convs = await (await api.get(`/api/v1/admin/ai/conversations?documentId=${docId}`)).json();
  expect(convs.items.length).toBeGreaterThan(0);
  const conv = await (await api.get(`/api/v1/ai/conversations/${convs.items[0].id}`)).json();
  expect(
    conv.messages.some((m: { toolCalls?: { name: string }[] }) =>
      m.toolCalls?.some((t) => t.name === 'propose_source_edit'),
    ),
    'the proposal is in the persisted transcript, not only in the stream',
  ).toBeTruthy();
  // §1.3: the assistant never wrote — the source version moved through the *decision*, which is
  // an ordinary audited save, and the proposal row records who decided it.
  const decided = await (
    await api.get(
      `/api/v1/ai/proposed-edits/${conv.messages.find((m: { proposedEditsId?: string }) => m.proposedEditsId).proposedEditsId}`,
    )
  ).json();
  expect(decided.status).toBe('accepted');
  expect(decided.resultingSourceVersion).toBeGreaterThan(before.version as number);

  /* 4. the pipeline reacts, and the suggestions carry `affects` -------------- */
  const doc = await (await api.get(`/api/v1/documents/${docId}`)).json();
  type Listed = { id: string; title: string; status: string; sourceRevisionId: string; affects: unknown[] };
  const listOf = async (query = '') =>
    (await (await api.get(`/api/v1/suggestions?sourceId=${doc.sourceId}${query}`)).json()).items as Listed[];
  /*
   * The suggestion *this* edit produced — not merely "a pending one". Opening the workspace already
   * gave the source a first revision, and that revision's own `new-card` is pending long before the
   * chat answers, so "any pending suggestion" was satisfied without the pipeline reacting to the
   * edit at all. The revision is identified by content: the latest one carrying the stamp.
   */
  const editRevision = async () => {
    const rev = await (await api.get(`/api/v1/sources/${doc.sourceId}/revisions/latest`)).json();
    return JSON.stringify(rev.paragraphs ?? '').includes(stamp) ? (rev.id as string) : null;
  };
  const fromEdit = async () => {
    const revId = await editRevision();
    return revId ? (await listOf('&status=pending')).find((s) => s.sourceRevisionId === revId) : undefined;
  };
  await expect.poll(async () => (await fromEdit())?.id ?? null, { timeout: 150_000 }).not.toBeNull();
  const target = (await fromEdit())!;
  // `affects` is computed server-side from the graph (§1.6), so the field is always an array —
  // empty when the change really touches nothing else, which is itself the honest answer.
  expect(Array.isArray(target.affects)).toBeTruthy();

  /* 5. structured edit, then a partial apply -------------------------------- */
  await e.reload();
  const panel = e.getByRole('region', { name: 'הצעות' });
  /*
   * On the workspace the panel lists `GET /suggestions?documentId=` — every source linked to the
   * document, grouped per source when there is more than one, newest first — which can hold the
   * first revision's card beside this one. So the target's card is addressed by its id
   * (`data-suggestion-id` on the panel's `<li>`), never by position, and its presence is checked
   * against that same `?documentId=` list the panel renders.
   */
  const panelList = (await (await api.get(`/api/v1/suggestions?documentId=${docId}`)).json())
    .items as Listed[];
  expect(
    panelList.some((s) => s.id === target.id),
    'the target is in the list the panel renders',
  ).toBeTruthy();
  const card = panel.locator(`li[data-suggestion-id="${target.id}"]`);
  await expect(card.getByRole('button', { name: 'עריכה מפורטת' })).toBeVisible({ timeout: 30_000 });
  await card.getByRole('button', { name: 'עריכה מפורטת' }).click();
  const drawer = e.getByRole('dialog', { name: 'עריכת ההצעה' });
  // Each row is keep / edit / remove; the editable field only appears once "ערוך" is chosen,
  // which is the tri-state the structured editor is for (§1.8).
  const firstRowFields = drawer.locator('fieldset').first();
  await firstRowFields.getByRole('radio', { name: 'ערוך' }).check();
  const field = firstRowFields.getByRole('textbox');
  await field.fill(`${await field.inputValue()} (${stamp})`);
  await drawer.getByRole('button', { name: 'שמור עריכה' }).click();
  await expect(drawer).toBeHidden({ timeout: 30_000 });

  // Required rows are ticked and locked (the server refuses a `parts` set without them), so the
  // partial pick is an *optional* row — on a `new-card` the first row is the required card meta.
  await card.getByRole('checkbox', { disabled: false }).first().check();
  await card.getByRole('button', { name: 'החל חלקית' }).click();

  // Durable: the suggestion is decided and records *what* was applied and *what changed*.
  await expect
    .poll(async () => (await (await api.get(`/api/v1/suggestions/${target.id}`)).json()).status, {
      timeout: 30_000,
    })
    .toMatch(/accepted|applied/);
  const detail = await (await api.get(`/api/v1/suggestions/${target.id}`)).json();
  expect(detail.editDiff?.rows?.length ?? 0, 'the edit diff is stored (§1.8)').toBeGreaterThan(0);

  /* 6. analytics counts it as an edited accept ------------------------------ */
  const an = await (await api.get(`/api/v1/suggestions/analytics?sourceId=${doc.sourceId}`)).json();
  expect(an.total).toBeGreaterThan(0);
  expect(an.rates.edited, 'an accept that was edited first shows as an edited accept').toBeGreaterThan(0);
});
