import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import FormData from 'form-data';
import { startTestDb } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth } from '../helpers/fixtures.js';

/**
 * The routes `test/route-coverage.test.ts` found nothing calling at all (§6.2 / item 19).
 *
 * These are smoke tests by intent: each proves the route is wired, authorises, and answers the
 * shape its OpenAPI entry promises. Where a route already has a behavioural home elsewhere in the
 * suite that is where the deeper assertions belong; this file exists so no route is *unreached*.
 */
const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

run('routes with no other integration coverage', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;
  let etag: string;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.ready();
    await app.events.start(db.url);
    u = await makeUser(db.pool, { name: 'עורכת' });
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: {
        title: 'נוהל כיסוי',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'm',
        kind: 'steps',
      },
    });
    docId = created.json().id;
    etag = created.json().etag;
  }, 120000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('GET /admin/roles lists the seeded roles', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/admin/roles', headers: auth(u) });
    expect(r.statusCode).toBe(200);
    const names = (r.json().items ?? r.json()).map((x: { name: string }) => x.name);
    expect(names).toContain('admin');
  });

  it('GET /documents/:id/comments answers with the thread, empty to begin with', async () => {
    const empty = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/comments`,
      headers: auth(u),
    });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().items).toEqual([]);
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/comments`,
      headers: auth(u),
      payload: { text: 'הערה' },
    });
    const one = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/comments`,
      headers: auth(u),
    });
    expect(one.json().items).toHaveLength(1);
    expect(one.json().items[0].text).toBe('הערה');
  });

  it('POST /trash/restore-all brings every soft-deleted document back', async () => {
    const doomed = await app.inject({
      method: 'POST',
      url: '/api/v1/documents',
      headers: auth(u),
      payload: {
        title: 'למחיקה',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'm',
        kind: 'steps',
      },
    });
    const id = doomed.json().id;
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/documents/${id}`, headers: auth(u) }))
        .statusCode,
    ).toBeLessThan(300);
    const before = await app.inject({ method: 'GET', url: '/api/v1/trash', headers: auth(u) });
    expect(before.json().items.length).toBeGreaterThan(0);

    const restored = await app.inject({
      method: 'POST',
      url: '/api/v1/trash/restore-all',
      headers: auth(u),
    });
    expect(restored.statusCode).toBe(200);
    expect(restored.json().restored).toBeGreaterThan(0);
    const after = await app.inject({ method: 'GET', url: '/api/v1/trash', headers: auth(u) });
    expect(after.json().items).toEqual([]);
  });

  it('DELETE /fields/:name removes a catalogue field', async () => {
    const name = 'שדה זמני';
    const slug = encodeURIComponent(name);
    // The URL is written out at each call site on purpose: route-coverage.test.ts reads literals
    // at the call, so a `const url = …` passed by shorthand would read as an uncovered route.
    await app.inject({
      method: 'PUT',
      url: `/api/v1/fields/${slug}`,
      headers: auth(u),
      payload: { name, status: 'ok', path: 'CRM ↗ זמני' },
    });
    const del = await app.inject({
      method: 'DELETE',
      url: `/api/v1/fields/${slug}`,
      headers: auth(u),
    });
    expect(del.statusCode).toBe(200);
    expect(typeof del.json().auditId).toBe('string');
    const list = await app.inject({ method: 'GET', url: '/api/v1/fields', headers: auth(u) });
    expect(list.json().items.map((f: { name: string }) => f.name)).not.toContain(name);
    // Gone means gone: a second delete is a 404, not a silent success.
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/fields/${slug}`,
          headers: auth(u),
        })
      ).statusCode,
    ).toBe(404);
  });

  it('GET /assets/:id serves the bytes that were uploaded', async () => {
    // A 1×1 transparent PNG — the mime allowlist on POST /assets rejects anything else.
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      'base64',
    );
    const form = new FormData();
    form.append('file', png, { filename: 'dot.png', contentType: 'image/png' });
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/assets',
      headers: { ...auth(u), ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(up.statusCode).toBe(200);
    const assetId = up.json().id;

    const got = await app.inject({
      method: 'GET',
      url: `/api/v1/assets/${assetId}`,
      headers: auth(u),
    });
    expect(got.statusCode).toBe(200);
    expect(got.headers['content-type']).toBe('image/png');
    expect(got.rawPayload.equals(png)).toBe(true);
  });

  it('GET /documents/:id/source/versions/:v serves a historical source version', async () => {
    const first = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(u), 'if-match': etag },
      payload: { html: '<p>גרסה ראשונה</p>', label: 'ראשונה' },
    });
    expect(first.statusCode).toBe(200);
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/source`,
      headers: { ...auth(u), 'if-match': first.headers.etag as string },
      payload: { html: '<p>גרסה שנייה</p>', label: 'שנייה' },
    });

    const versions = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source/versions`,
      headers: auth(u),
    });
    expect(versions.json().items.length).toBeGreaterThanOrEqual(2);

    const v1 = await app.inject({
      method: 'GET',
      url: `/api/v1/documents/${docId}/source/versions/1`,
      headers: auth(u),
    });
    expect(v1.statusCode).toBe(200);
    expect(v1.json().html).toContain('גרסה ראשונה');
  });
});
