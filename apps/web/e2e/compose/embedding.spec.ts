import { test, expect } from '@playwright/test';

/**
 * The embedding path, proved end to end for the first time.
 *
 * Nothing had ever proved it, and nothing could have: `updateEmbedding` swallows every error so a
 * model outage can never fail a publish, and both `deploy/ci.env` and `deploy/e2e.env` configured
 * `all-minilm` — a 384-dimensional model against a `vector(768)` column — so every embedding write
 * on both gates failed into that swallow. No vector, no log line, a green smoke test, and search
 * silently ranking lexically. Those files now configure `nomic-embed-text` (768), which is what
 * makes this spec possible at all.
 *
 * Both halves are asserted, because they fail independently:
 *
 *   - `GET /system/health` → `embedStatus.lastOk` — the *model* handed back a vector the column
 *     accepts, with the model name and the width it returned;
 *   - `GET /documents/:id/embedding-status` → `hasEmbedding` — that vector reached *this row*.
 *
 * A model of the right width whose write never lands leaves the first green and the second false;
 * a row embedded before a model change leaves the second true and the first false. Only the pair
 * says the path works.
 *
 * This is the whole stack: nginx, the API, Postgres with pgvector, and a real Ollama running the
 * real embedding model on CPU.
 */

const stamp = Date.now().toString(36);
const TITLE = `הטמעה וקטורית ${stamp}`;

interface EmbedStatus {
  model: string;
  dimension: number | null;
  expected: number;
  lastOk: boolean | null;
  lastError: string | null;
}

test('a published document ends up with a real embedding, and health says so', async ({ page }) => {
  /* 1. the configuration this whole spec depends on ---------------------------- */
  // Read first, so a stack whose EMBED_DIMENSION and EMBED_MODEL were changed apart fails here
  // with the numbers in the message rather than as a mysteriously null embedding below.
  const before = await page.request.get('/api/v1/system/health');
  expect(before.ok(), await before.text()).toBeTruthy();
  const beforeEmbed = ((await before.json()) as { embedStatus: EmbedStatus }).embedStatus;
  expect(beforeEmbed.expected, 'EMBED_DIMENSION matches documents.embedding').toBe(768);
  // The tag carries `:latest` in deploy/e2e.env, because `ollama list` prints it that way and
  // scripts/e2e-compose.mjs matches the two literally. Matched on the family, not the whole tag.
  expect(beforeEmbed.model, 'deploy/e2e.env configures the 768-dimensional tag').toMatch(
    /^nomic-embed-text\b/,
  );

  /* 2. create and publish, through nginx, as the signed-in admin ---------------- */
  const created = await page.request.post('/api/v1/documents', {
    data: { title: TITLE, category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
  });
  expect(created.status(), await created.text()).toBe(201);
  const docId = ((await created.json()) as { id: string }).id;

  const published = await page.request.post(`/api/v1/documents/${docId}/publish`, {
    data: { label: 'גרסה ראשונה' },
  });
  // The swallow is correct and stays: whatever the model does, the publish succeeds.
  expect(published.status(), await published.text()).toBe(200);

  /* 3. the embedding lands on the row ------------------------------------------ */
  // The embedding is fired off after the publish response, and this is a real model on CPU —
  // seconds, not milliseconds. Polled rather than slept on, so a fast machine is not made to wait.
  let status!: { hasEmbedding: boolean; dimension: number | null; expected: number; model: string };
  await expect
    .poll(
      async () => {
        const r = await page.request.get(`/api/v1/documents/${docId}/embedding-status`);
        if (!r.ok()) return false;
        status = await r.json();
        return status.hasEmbedding;
      },
      {
        timeout: 90_000,
        intervals: [500, 1000, 2000],
        message: `documents.embedding is still null for ${docId} — the publish path never stored a vector`,
      },
    )
    .toBe(true);

  // Not just "not null": the stored vector is the width the column was declared with, which is
  // what a model swapped for one of a different size would break.
  expect(status.dimension).toBe(768);
  expect(status.expected).toBe(768);
  expect(status.model).toMatch(/^nomic-embed-text\b/);

  /* 4. …and health reports the same run of the same path ----------------------- */
  const after = await page.request.get('/api/v1/system/health');
  expect(after.ok(), await after.text()).toBeTruthy();
  const embed = ((await after.json()) as { embedStatus: EmbedStatus }).embedStatus;
  expect(embed.lastOk, `embedStatus.lastError: ${embed.lastError}`).toBe(true);
  expect(embed.lastError).toBeNull();
  expect(embed.dimension, 'the width the model actually returned').toBe(768);
  expect(embed.model).toMatch(/^nomic-embed-text\b/);
});
