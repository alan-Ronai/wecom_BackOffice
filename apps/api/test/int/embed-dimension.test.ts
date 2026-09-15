import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { buildApp } from '../../src/app.js';
import { startTestDb, integration } from '../helpers/db.js';
import fakeAuth from '../helpers/fakeAuth.js';
import { makeUser, auth } from '../helpers/fixtures.js';

/**
 * The embedding path had never been proven end to end, and could not be: `updateEmbedding`
 * swallows every error so a model outage can never fail a publish, so an `EMBED_MODEL` whose
 * vectors are the wrong width for `documents.embedding` (`all-minilm` is 384; the column is
 * `vector(768)`, from migration 0003) stored nothing on every publish and said nothing about it.
 * `deploy/ci.env` and `deploy/e2e.env` had been in exactly that state since they were written.
 *
 * This is that failure, reproduced against a real Postgres and a real HTTP stub standing in for
 * Ollama's `/api/embeddings` — not a mocked module, so a genuine `app.model.embed()` goes over
 * the wire — and then its opposite. Three things are asserted, in both directions:
 *
 *   1. the publish still succeeds, because the swallow is correct and stays;
 *   2. `GET /system/health` says which model, which width, and why it failed;
 *   3. `GET /documents/:id/embedding-status` says whether the row actually carries a vector.
 *
 * The stub's width is chosen per app, so the same flow runs with a model that fits the column
 * and with one that does not.
 */
const dims = (n: number) => new Array(n).fill(0).map((_, i) => (i % 7) / 10);

/** Ollama's two endpoints, enough of them: a tag listing and an embedding of a fixed width. */
function stubOllama(width: number, tag: string) {
  return http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: tag }] }));
      if (req.url === '/api/embeddings') return res.end(JSON.stringify({ embedding: dims(width) }));
      res.statusCode = 404;
      res.end('{}');
    });
  });
}

const listen = async (server: http.Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
};

const newDocument = {
  category: 'tech',
  wave: 1,
  priority: 'hh',
  kind: 'steps',
} as const;

const run = integration ? describe : describe.skip;
run('embedding dimension: the mismatch is visible, the matching case is proven', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let wrong: http.Server;
  let right: http.Server;
  let mismatched: Awaited<ReturnType<typeof buildApp>>;
  let matching: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    db = await startTestDb();
    wrong = stubOllama(384, 'all-minilm:latest');
    right = stubOllama(768, 'nomic-embed-text');
    const [wrongUrl, rightUrl] = [await listen(wrong), await listen(right)];
    const common = { DATABASE_URL: db.url, NODE_ENV: 'test' as const, MODEL_DISABLED: false };
    mismatched = await buildApp({
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
      config: { ...common, MODEL_URL: wrongUrl, EMBED_MODEL: 'all-minilm:latest' },
    });
    matching = await buildApp({
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
      config: { ...common, MODEL_URL: rightUrl, EMBED_MODEL: 'nomic-embed-text' },
    });
    await Promise.all([mismatched.ready(), matching.ready()]);
  }, 120000);

  afterAll(async () => {
    // Both apps hold the same pool; closing the first ends it, and `startTestDb` tolerates that.
    await mismatched.close();
    await matching.close().catch(() => undefined);
    await db.stop();
    await Promise.all([
      new Promise<void>((r) => wrong.close(() => r())),
      new Promise<void>((r) => right.close(() => r())),
    ]);
  });

  /** Create and publish, and wait out the fire-and-forget embedding that follows the response. */
  const publish = async (app: Awaited<ReturnType<typeof buildApp>>, title: string) => {
    const u = await makeUser(db.pool);
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: { title, ...newDocument },
    });
    expect(created.statusCode).toBe(201);
    const { id } = created.json() as { id: string };
    const published = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${id}/publish`,
      headers: auth(u),
      payload: { label: 'v1' },
    });
    // The point of the swallow: whatever the model does, the editor's publish succeeds.
    expect(published.statusCode, published.body).toBe(200);
    return { id, user: u };
  };

  const embeddingStatus = async (
    app: Awaited<ReturnType<typeof buildApp>>,
    id: string,
    user: Awaited<ReturnType<typeof makeUser>>,
  ) => {
    const r = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${id}/embedding-status`,
      headers: auth(user),
    });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as {
      id: string;
      hasEmbedding: boolean;
      dimension: number | null;
      expected: number;
      model: string;
    };
  };

  const health = async (app: Awaited<ReturnType<typeof buildApp>>) => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/system/health' });
    expect(r.statusCode, r.body).toBe(200);
    return (
      r.json() as {
        embedStatus: {
          model: string;
          dimension: number | null;
          expected: number;
          lastOk: boolean | null;
          lastError: string | null;
        };
      }
    ).embedStatus;
  };

  it('starts out saying the embedding path has never been asked anything', async () => {
    // A freshly built app, before any publish: "never attempted", not a guessed-at green.
    // Deliberately not closed — every app in this file shares `db.pool`, and `buildApp`'s
    // onClose ends it, so a second close would pull the pool out from under the other tests.
    const fresh = await buildApp({
      pool: db.pool,
      boss: false,
      plugins: [fakeAuth],
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', MODEL_DISABLED: true },
    });
    await fresh.ready();
    expect(await health(fresh)).toMatchObject({ dimension: null, lastOk: null, lastError: null });
  });

  it('a 384-dimension model against a vector(768) column: the publish succeeds and health says why nothing was stored', async () => {
    const { id, user } = await publish(mismatched, 'mismatched embedding model');

    // No embedding landed — the failure the walkthrough found, now observable rather than mute.
    const status = await embeddingStatus(mismatched, id, user);
    expect(status).toMatchObject({ id, hasEmbedding: false, dimension: null, expected: 768 });
    expect(status.model).toBe('all-minilm:latest');
    expect(
      (await db.pool.query('select embedding from documents where id=$1', [id])).rows[0].embedding,
    ).toBeNull();

    const embed = await health(mismatched);
    expect(embed.model).toBe('all-minilm:latest');
    expect(embed.expected).toBe(768);
    expect(embed.dimension).toBe(384);
    expect(embed.lastOk).toBe(false);
    // Both numbers in the message: the operator must not have to read a migration to find one.
    expect(embed.lastError).toContain('384');
    expect(embed.lastError).toContain('768');
  });

  it('a 768-dimension model: the document is embedded and health says lastOk', async () => {
    const { id, user } = await publish(matching, 'matching embedding model');

    // The embedding is fire-and-forget after the response; poll briefly for it to land.
    let status = await embeddingStatus(matching, id, user);
    for (let i = 0; i < 40 && !status.hasEmbedding; i++) {
      await new Promise((r) => setTimeout(r, 50));
      status = await embeddingStatus(matching, id, user);
    }
    expect(status).toMatchObject({ id, hasEmbedding: true, dimension: 768, expected: 768 });
    expect(status.model).toBe('nomic-embed-text');

    expect(await health(matching)).toMatchObject({
      model: 'nomic-embed-text',
      dimension: 768,
      expected: 768,
      lastOk: true,
      lastError: null,
    });
  });

  it('404s the embedding status of a document that is not there', async () => {
    const u = await makeUser(db.pool);
    const r = await matching.inject({
      method: 'GET',
      url: '/api/v1/documents/00000000-0000-4000-8000-000000000000/embedding-status',
      headers: auth(u),
    });
    expect(r.statusCode).toBe(404);
  });

  /**
   * The boot-time half. `documents.embedding` is `vector(768)`, so an `EMBED_DIMENSION` of 384 is
   * a configuration that cannot work — and the whole point is that it must be refused *here*,
   * loudly, instead of being discovered months later as "search feels wrong".
   */
  it('refuses to boot when EMBED_DIMENSION disagrees with the column, naming both and the migration', async () => {
    const boot = async () => {
      const app = await buildApp({
        pool: db.pool,
        boss: false,
        plugins: [fakeAuth],
        config: { DATABASE_URL: db.url, NODE_ENV: 'test', EMBED_DIMENSION: 384 },
      });
      // `plugins/model.ts` throws while the /api/v1 scope boots, which Fastify surfaces here.
      // Not closed for the same reason as above: the pool is shared.
      await app.ready();
    };
    await expect(boot()).rejects.toThrow(
      /EMBED_DIMENSION is 384 but documents\.embedding is vector\(768\).*0003_content\.js/s,
    );
  });
});
