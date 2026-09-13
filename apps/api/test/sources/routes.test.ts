import { describe, it, expect, afterEach } from 'vitest';
import FormData from 'form-data';
import { withDb, integration } from '../helpers/l5/db.js';
import { contentStub, seedUser } from '../helpers/l5/stubs.js';
import { buildDocx } from './fixtures/docx-builder.js';
import { buildApp } from '../../src/app.js';
import { setContentApi } from '../../src/modules/sources/content-api.js';
import type pg from 'pg';

const run = integration ? describe : describe.skip;

afterEach(() => setContentApi(null));

run('sources & suggestions routes', () => {
  it(
    'uploads a docx, processes it and exposes suggestions',
    async () =>
      withDb(async (pool, uri) => {
        setContentApi(contentStub);
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const app = await buildApp({
          config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true },
          pool: pool as pg.Pool,
          boss: false,
          testUser: { id: uid, displayName: 'ענבר ל.', permissions: 'all' },
        });

        const buf = await buildDocx({
          title: 'נהלי תמיכה טכנית',
          paragraphs: [
            {
              runs: [
                {
                  t: '4.14 בעיות גלישה ברכב. אם הלקוח מדווח על איטיות רק ברכב – בדוק Wi-Fi של הרכב. הנחה לכבות Wi-Fi ברכב.',
                },
              ],
            },
          ],
        });
        const fd = new FormData();
        fd.append('file', buf, {
          filename: 'נהלים.docx',
          contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const up = await app.inject({
          method: 'POST',
          url: '/api/v1/sources/upload',
          payload: fd.getBuffer(),
          headers: fd.getHeaders(),
        });
        expect(up.statusCode).toBe(200);
        const { sourceId, revisionId, duplicate, kind } = up.json();
        expect({ duplicate, kind }).toEqual({ duplicate: false, kind: 'docx' });

        const proc = await app.inject({ method: 'POST', url: `/api/v1/sources/${sourceId}/process` });
        expect(proc.json()).toMatchObject({ revisionId, used: 'rules' });
        expect(proc.json().created).toBeGreaterThan(0);

        const list = await app.inject({ method: 'GET', url: '/api/v1/suggestions?status=pending' });
        const sug = list.json().items[0];
        expect(sug.type).toBe('new-card');

        expect(
          (await app.inject({ method: 'POST', url: `/api/v1/suggestions/${sug.id}/accept` })).json().status,
        ).toBe('accepted');

        const pub = await app.inject({
          method: 'POST',
          url: '/api/v1/suggestions/publish',
          payload: { sourceId },
        });
        expect(pub.json().applied).toBe(1);

        expect(
          (await app.inject({ method: 'GET', url: `/api/v1/sources/${sourceId}/revisions/latest` })).json()
            .accepted,
        ).toBe(true);
        expect((await app.inject({ method: 'GET', url: '/api/v1/sources' })).json().items[0].syncState).toBe(
          'synced',
        );
        await app.close();
      }),
    240000,
  );

  it(
    'rejects unsupported uploads and unknown revisions',
    async () =>
      withDb(async (pool, uri) => {
        setContentApi(contentStub);
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const app = await buildApp({
          config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true },
          pool: pool as pg.Pool,
          boss: false,
          testUser: { id: uid, displayName: 'ענבר ל.', permissions: 'all' },
        });
        const fd = new FormData();
        fd.append('file', Buffer.from('x'), { filename: 'bad.exe', contentType: 'application/octet-stream' });
        const bad = await app.inject({
          method: 'POST',
          url: '/api/v1/sources/upload',
          payload: fd.getBuffer(),
          headers: fd.getHeaders(),
        });
        expect(bad.statusCode).toBe(400);
        expect(bad.json().code).toBe('UNSUPPORTED_FILE');

        const missing = await app.inject({
          method: 'POST',
          url: '/api/v1/sources/11111111-1111-4111-8111-111111111111/process',
        });
        expect(missing.statusCode).toBe(404);
        await app.close();
      }),
    180000,
  );

  it(
    'rejects without permission',
    async () =>
      withDb(async (pool, uri) => {
        const uid = await seedUser(pool, { displayName: 'נציג' });
        const app = await buildApp({
          config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true },
          pool: pool as pg.Pool,
          boss: false,
          testUser: { id: uid, displayName: 'נציג', permissions: ['docs.read'] },
        });
        expect((await app.inject({ method: 'GET', url: '/api/v1/suggestions' })).statusCode).toBe(403);
        expect((await app.inject({ method: 'GET', url: '/api/v1/sources' })).statusCode).toBe(200);
        await app.close();
      }),
    180000,
  );
});
