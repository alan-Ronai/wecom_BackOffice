import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import FormData from 'form-data';
import type pg from 'pg';
import { startTestDb, integration } from './helpers/db.js';
import { makeUser, auth } from './helpers/fixtures.js';
import { buildApp } from '../src/app.js';
import fakeAuth from './helpers/fakeAuth.js';

const run = integration ? describe : describe.skip;

const CSV = [
  'Title,Description,Category',
  'איטיות גלישה,בדוק את מהירות הגלישה מול הלקוח. תעד את התוצאה,tech',
  'חיוב כפול,בדוק את החשבונית האחרונה מול המערכת. החזר את ההפרש,billing',
].join('\n');

/**
 * Stage 4 — the data explorer end to end, with no doubles: a real upload lands a real
 * source + revision, the mapping is persisted on `sources.mapping`, and re-import pushes the
 * rows back through the L5 pipeline so the cards show up as suggestions.
 */
run('stage 4: data explorer', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let sourceId: string;

  const get = (url: string) => app.inject({ method: 'GET', url, headers: auth(u) });

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildApp({
      // The deterministic rule-based model: no Ollama, but the real ModelClient contract.
      config: { DATABASE_URL: db.url, NODE_ENV: 'test', MODEL_DISABLED: true },
      pool: db.pool as pg.Pool,
      boss: false,
      plugins: [fakeAuth],
    });
    await app.ready();
    await app.events.start(db.url);
    u = await makeUser(db.pool);
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('uploads a csv, infers the columns and a default mapping', async () => {
    const form = new FormData();
    form.append('file', Buffer.from(CSV, 'utf8'), { filename: 'topics.csv', contentType: 'text/csv' });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/data/files',
      headers: { ...auth(u), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(r.statusCode).toBe(200);
    const f = r.json();
    sourceId = f.sourceId;
    expect(f.kind).toBe('csv');
    expect(f.title).toBe('topics');
    expect(f.rows).toBe(2);
    expect(f.columns).toEqual(['Title', 'Description', 'Category']);
    expect(
      Object.fromEntries(f.mapping.map((m: { column: string; field: string }) => [m.column, m.field])),
    ).toEqual({ Title: 'title', Description: 'description', Category: 'category' });
    expect(f.mapping[0].sample).toBe('איטיות גלישה');
    expect(f.pendingSuggestions).toBe(0);

    const list = await get('/api/v1/data/files');
    expect(list.json().items.map((x: { sourceId: string }) => x.sourceId)).toContain(sourceId);
  });

  it('rejects an unsupported or empty upload', async () => {
    const form = new FormData();
    form.append('file', Buffer.from('hello', 'utf8'), { filename: 'notes.docx' });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/data/files',
      headers: { ...auth(u), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(r.statusCode).toBe(400);
  });

  it('previews the stored rows', async () => {
    const r = await get(`/api/v1/data/files/${sourceId}/preview?limit=1`);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.total).toBe(2);
    expect(p.rows).toHaveLength(1);
    expect(p.columns).toEqual(['Title', 'Description', 'Category']);
    expect(p.rows[0].Title).toBe('איטיות גלישה');
    expect((await get('/api/v1/data/files/11111111-1111-4111-8111-111111111111/preview')).statusCode).toBe(
      404,
    );
  });

  it('persists a mapping change and refuses unknown columns', async () => {
    const bad = await app.inject({
      method: 'PUT',
      url: `/api/v1/data/files/${sourceId}/mapping`,
      headers: auth(u),
      payload: { mapping: [{ column: 'Nope', field: 'title' }] },
    });
    expect(bad.statusCode).toBe(400);

    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/data/files/${sourceId}/mapping`,
      headers: auth(u),
      payload: {
        mapping: [
          { column: 'Title', field: 'title' },
          { column: 'Description', field: 'stepAction' },
          { column: 'Category', field: 'ignore' },
        ],
      },
    });
    expect(r.statusCode).toBe(200);
    expect(
      Object.fromEntries(r.json().mapping.map((m: { column: string; field: string }) => [m.column, m.field])),
    ).toEqual({ Title: 'title', Description: 'stepAction', Category: 'ignore' });
    const audited = await db.pool.query(
      "select count(*)::int n from audit_log where action='sources.mapping' and entity_id=$1",
      [sourceId],
    );
    expect(audited.rows[0].n).toBe(1);
  });

  it('re-imports the rows through the pipeline so the cards become suggestions', async () => {
    const r = await app.inject({
      method: 'POST',
      url: `/api/v1/data/files/${sourceId}/reimport`,
      headers: auth(u),
    });
    expect(r.statusCode).toBe(200);
    const res = r.json();
    // The mapping changed since the upload, so this is a new revision, not a duplicate.
    expect(res.duplicate).toBe(false);
    expect(res.suggestionsQueued).toBe(true);

    const suggestions = await db.pool.query(
      `select g.title, g.type, g.status from suggestions g
         join source_revisions sr on sr.id = g.source_revision_id where sr.source_id = $1`,
      [sourceId],
    );
    expect(suggestions.rowCount).toBeGreaterThan(0);
    expect(suggestions.rows.every((x) => x.status === 'pending')).toBe(true);
    expect(suggestions.rows.map((x) => x.title)).toContain('איטיות גלישה');

    const file = (await get('/api/v1/data/files'))
      .json()
      .items.find((x: { sourceId: string }) => x.sourceId === sourceId);
    expect(file.pendingSuggestions).toBe(suggestions.rowCount);
    expect(file.rows).toBe(2);

    // Re-importing again with an unchanged mapping is idempotent on the content hash.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/data/files/${sourceId}/reimport`,
      headers: auth(u),
    });
    expect(again.json().duplicate).toBe(true);
    expect(again.json().revisionId).toBe(res.revisionId);
  });

  it('404s a re-import of a source with no stored rows', async () => {
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/data/files/11111111-1111-4111-8111-111111111111/reimport',
      headers: auth(u),
    });
    expect(r.statusCode).toBe(404);
  });
});
