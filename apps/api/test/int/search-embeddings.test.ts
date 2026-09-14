import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { buildApp } from '../../src/app.js';
import { OllamaModel } from '@wecom/model';
import { startTestDb, integration } from '../helpers/db.js';
import fakeAuth from '../helpers/fakeAuth.js';
import { makeUser, auth } from '../helpers/fixtures.js';

/**
 * Search quality item 3: the vector re-rank path (`search/repo.ts#rerank`) and the
 * `search.reindex` embedding pass (`reindexAll` -> `updateEmbedding`), verified against a
 * real HTTP stub standing in for Ollama's `/api/embeddings` — not a mocked module — so a
 * genuine `app.model.embed()` call goes over the wire exactly as it would in production.
 *
 * The stub returns a small deterministic "embedding": a 768-dim vector that is 1 at the
 * index of each keyword found in the prompt and 0 elsewhere (real cosine-similarity math,
 * fake semantics) — enough to prove the rerank pipeline actually runs and actually changes
 * ranking, without depending on a real model.
 */
const KEYWORDS = ['network', 'quantum'];
const stubEmbed = (prompt: string): number[] => {
  const v = new Array(768).fill(0);
  KEYWORDS.forEach((k, i) => {
    if (prompt.includes(k)) v[i] = 1;
  });
  return v;
};

const run = integration ? describe : describe.skip;
run('search: Hebrew stopwords, prefix matching, vector re-rank', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let stub: http.Server;
  let stubUrl: string;
  let embedCalls: string[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    stub = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [] }));
        if (req.url === '/api/embeddings') {
          const { prompt } = JSON.parse(raw) as { prompt: string };
          embedCalls.push(prompt);
          return res.end(JSON.stringify({ embedding: stubEmbed(prompt) }));
        }
        res.statusCode = 404;
        res.end('{}');
      });
    });
    await new Promise<void>((r) => stub.listen(0, '127.0.0.1', r));
    stubUrl = `http://127.0.0.1:${(stub.address() as { port: number }).port}`;
    app = await buildApp({
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        MODEL_DISABLED: false,
        MODEL_URL: stubUrl,
        EMBED_MODEL: 'stub-embed',
      },
    });
    await app.ready();
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
    await new Promise<void>((r) => stub.close(() => r()));
  });

  it('reindexAll computes and stores an embedding via the stub model (search.reindex job)', async () => {
    const u = await makeUser(db.pool);
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'quantum network guide', category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    expect(
      (await db.pool.query('select embedding from documents where id=$1', [c.id])).rows[0].embedding,
    ).toBeNull();

    embedCalls = [];
    const { reindexAll } = await import('../../src/modules/search/repo.js');
    // `app.model` is decorated on the v1-scoped fastify instance (Fastify encapsulation),
    // not the root one this test holds — build the same client directly against the stub.
    const model = new OllamaModel({ url: stubUrl, model: 'stub', embedModel: 'stub-embed' });
    const n = await reindexAll(db.pool, model);
    expect(n).toBeGreaterThan(0);
    expect(embedCalls.length).toBeGreaterThan(0);

    const row = (await db.pool.query('select embedding from documents where id=$1', [c.id])).rows[0];
    expect(row.embedding).not.toBeNull();
  });

  it('computes an embedding on publish', async () => {
    const u = await makeUser(db.pool);
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'network publish test', category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/publish`,
      headers: auth(u),
      payload: { label: 'v1' },
    });
    // Embedding update is fire-and-forget after the response; poll briefly for it to land.
    let embedding = null;
    for (let i = 0; i < 20 && !embedding; i++) {
      await new Promise((r) => setTimeout(r, 50));
      embedding = (await db.pool.query('select embedding from documents where id=$1', [c.id])).rows[0]
        .embedding;
    }
    expect(embedding).not.toBeNull();
  });

  it('re-ranks documents research by cosine similarity to the query embedding, not just text score', async () => {
    const u = await makeUser(db.pool);
    // Identical title + description => identical text score (ts_rank + trigram similarity),
    // so any difference in final ranking can only come from the embedding. Title must
    // contain both query words verbatim for the base ilike filter to keep either row.
    const title = 'network quantum בדיקת רשת';
    const description = 'תיאור זהה לשני המסמכים';
    const near = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title, description, category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    const far = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title, description, category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    // near: perfectly parallel to the query embedding. far: orthogonal (zero similarity).
    await db.pool.query('update documents set embedding=$2::vector where id=$1', [
      near.id,
      JSON.stringify(stubEmbed('network quantum')),
    ]);
    await db.pool.query('update documents set embedding=$2::vector where id=$1', [
      far.id,
      JSON.stringify(new Array(768).fill(0).map((_, i) => (i === 500 ? 1 : 0))),
    ]);

    embedCalls = [];
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent('network quantum') + '&types=documents',
      headers: auth(u),
    });
    const body = r.json();
    expect(embedCalls).toContain('network quantum');
    const hits = body.groups[0].hits as { id: string; score: number }[];
    const nearHit = hits.find((h) => h.id === near.id)!;
    const farHit = hits.find((h) => h.id === far.id)!;
    // Same title/description => tied text score; only the embedding differs, so `near`
    // (parallel to the query embedding) must outrank `far` (orthogonal) directly.
    expect(nearHit.score).toBeGreaterThan(farHit.score);
    expect(hits.indexOf(nearHit)).toBeLessThan(hits.indexOf(farHit));
  });

  it('prefix-matches the last word (palette incremental search)', async () => {
    const u = await makeUser(db.pool);
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'התחברות לרשת אלחוטית', category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
      })
    ).json();
    // "אלחוט" is a strict prefix of "אלחוטית" — plainto_tsquery would not match it.
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=' + encodeURIComponent('התחברות אלחוט') + '&types=documents',
      headers: auth(u),
    });
    const ids = (r.json().groups[0]?.hits ?? []).map((h: { id: string }) => h.id);
    expect(ids).toContain(c.id);
  });

  it('strips Hebrew stopwords from the search vector so they stop matching everything', async () => {
    const u = await makeUser(db.pool);
    await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: { title: 'מסמך על גלישה באינטרנט', category: 'tech', wave: 1, priority: 'hh', kind: 'steps' },
    });
    const vec = (
      await db.pool.query(
        `select search_vector::text v from documents where title='מסמך על גלישה באינטרנט' order by created_at desc limit 1`,
      )
    ).rows[0].v as string;
    // "על" is a stopword and must not appear as a lexeme in the vector.
    expect(vec).not.toMatch(/'על':/);
    expect(vec).toMatch(/'גלישה':/);
  });
});
