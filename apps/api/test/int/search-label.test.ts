import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth } from '../helpers/fixtures.js';

const run = integration ? describe : describe.skip;

/**
 * A-2 (acceptance review §3, §7 item 8) — `GET /search` names the knowledge item behind a hit.
 *
 * `meta` is a display string that leads with the ingest filename (`topics.json`), and a *step*
 * hit named only the step — so the palette could not say which knowledge item the matched section
 * belonged to, nor what type it was. `labelHits` attaches `docType`, `world` and `docTitle` after
 * the search, leaving `repo.ts`'s own output untouched.
 */
run('search: hits are labelled with the knowledge item (A-2)', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let user: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    user = await makeUser(db.pool, { name: 'נציג' });

    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(user),
      payload: {
        title: 'ריענון חבילת גלישה',
        description: 'נוהל ריענון',
        category: 'tech',
        wave: 1,
        priority: 'hh',
        kind: 'steps',
      },
    });
    expect(created.statusCode, created.body).toBe(201);
    docId = created.json().id as string;

    // A real step, so the step group has something to return and the hit has a document behind it.
    const etag = (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}`, headers: auth(user) }))
      .headers.etag as string;
    const structure = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(user), 'if-match': etag },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'בירור',
            steps: [
              {
                key: 's1',
                num: '1',
                title: 'ריענון החבילה במערכת',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: 'כבה והדלק את מתג הגלישה' }],
                outcomes: [],
              },
            ],
          },
        ],
      },
    });
    expect(structure.statusCode, structure.body).toBe(200);
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  const search = async (q: string) =>
    (
      await app.inject({
        method: 'GET',
        url: `/api/v1/search?q=${encodeURIComponent(q)}`,
        headers: auth(user),
      })
    ).json() as {
      groups: { type: string; hits: Record<string, unknown>[] }[];
    };

  it('a step hit names its document, its type and its world', async () => {
    const res = await search('ריענון');
    const step = res.groups.find((g) => g.type === 'steps')?.hits[0];
    expect(step, JSON.stringify(res.groups)).toBeTruthy();
    // The thing the review says the agent needs and did not get: the knowledge item.
    expect(step!.docTitle).toBe('ריענון חבילת גלישה');
    expect(step!.world).toBe('tech');
    expect(step!.docType).toBeTruthy();
    // ...and the step title is still the matched section, so the row has both.
    expect(step!.title).toBe('ריענון החבילה במערכת');
  });

  it('a document hit carries the same three fields', async () => {
    const res = await search('ריענון חבילת');
    const hits = res.groups.flatMap((g) => g.hits);
    const doc = hits.find((h) => h.documentId === docId);
    expect(doc).toBeTruthy();
    expect(doc!.world).toBe('tech');
    expect(doc!.docTitle).toBe('ריענון חבילת גלישה');
  });

  it('leaves `meta` alone — the label is additive, not a rewrite of the display string', async () => {
    // `repo.ts` owns `meta` and the "N קבצים" counter is computed from the same source files.
    // The fix is that the client now has something better to render, not that the API changed
    // what it always sent.
    const res = await search('ריענון');
    const hits = res.groups.flatMap((g) => g.hits);
    expect(hits.every((h) => typeof h.meta === 'string')).toBe(true);
    expect(hits.some((h) => String(h.meta).includes('topics.json'))).toBe(true);
  });

  it('a hit with no document behind it is returned unlabelled rather than dropped', async () => {
    // CRM fields, blocks and tags are catalogue entries: they carry no `documentId`, so there is
    // nothing to look up — and the enrichment must never be able to filter a result away.
    const res = await search('גלישה');
    const unbacked = res.groups.flatMap((g) => g.hits).filter((h) => !h.documentId);
    for (const h of unbacked) {
      expect(h.docTitle).toBeUndefined();
      expect(h.docType).toBeUndefined();
      expect(h.title).toBeTruthy();
    }
  });
});
