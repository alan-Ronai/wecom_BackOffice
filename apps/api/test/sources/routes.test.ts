import { describe, it, expect, afterEach } from 'vitest';
import FormData from 'form-data';
import { withDb, integration } from '../helpers/l5/db.js';
import { contentStub, seedUser } from '../helpers/l5/stubs.js';
import { SuggestionService } from '../../src/modules/sources/suggestions.js';
import { resetSuggestionAnalyticsCache } from '../../src/modules/sources/analytics.js';
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

  /**
   * X3 §1.8/§1.9 over HTTP: the widened edit body, a partial accept and the remainder it queues,
   * and the acceptance analytics the review queue's dashboard reads.
   */
  it(
    'edits rows, accepts part of a suggestion and reports acceptance analytics',
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
        const sourceId = (
          await pool.query(`insert into sources(kind, title) values ('text','נהלים') returning id`)
        ).rows[0].id as string;
        const rev = (
          await pool.query(
            `insert into source_revisions(source_id, hash, paragraphs) values ($1,'hx','[]') returning id`,
            [sourceId],
          )
        ).rows[0].id as string;
        const svc = new SuggestionService(pool, contentStub, { publish: async () => undefined });
        const step = (anchor: string) =>
          ({
            anchor,
            type: 'update-step' as const,
            title: 'סף ' + anchor,
            targetDocumentId: null,
            targetStepKey: 's8',
            targetBlockId: null,
            payload: {
              type: 'update-step' as const,
              addActions: ['א', 'ב'],
              patch: { hint: 'טיפ' },
            },
            confidence: 0.9,
            rationale: 'r',
          }) as const;
        const [s1, s2, s3] = await svc.createFromProposals(rev, [
          step('§1'),
          step('§2'),
          {
            anchor: '§3',
            type: 'field-alert',
            title: 'שדה',
            targetDocumentId: null,
            targetStepKey: null,
            targetBlockId: null,
            payload: { type: 'field-alert', fieldName: 'f1', issue: 'unknown' },
            confidence: 0.5,
            rationale: 'r',
          },
        ]);

        // structured edit on the widened PUT body
        const edited = await app.inject({
          method: 'PUT',
          url: `/api/v1/suggestions/${s1.id}/edit`,
          payload: { structuredEdit: { type: 'update-step', rows: [{ rowId: 'add-0', op: 'edit', value: 'א!' }] } },
        });
        expect(edited.statusCode).toBe(200);
        expect(edited.json().editDiff.rows[0].rowId).toBe('add-0');
        expect(edited.json().editedPayload.addActions).toEqual(['א!', 'ב']);
        // exactly one of the two shapes
        const both = await app.inject({
          method: 'PUT',
          url: `/api/v1/suggestions/${s1.id}/edit`,
          payload: {
            editedPayload: { type: 'update-step', addActions: [], patch: {} },
            structuredEdit: { type: 'update-step', rows: [] },
          },
        });
        expect(both.statusCode).toBe(400);
        expect(both.json().code).toBe('VALIDATION');

        // partial accept: the unselected rows come back as a pending remainder
        const part = await app.inject({
          method: 'POST',
          url: `/api/v1/suggestions/${s1.id}/accept`,
          payload: { parts: ['add-0'] },
        });
        expect(part.statusCode).toBe(200);
        expect(part.json()).toMatchObject({ status: 'accepted', appliedParts: ['add-0'] });
        const queue = await app.inject({ method: 'GET', url: `/api/v1/suggestions?sourceId=${sourceId}` });
        const remainder = queue.json().items.find((x: { parentId: string | null }) => x.parentId === s1.id);
        expect(remainder).toMatchObject({ status: 'pending', title: 'סף §1 (המשך)' });
        const bad = await app.inject({
          method: 'POST',
          url: `/api/v1/suggestions/${s1.id}/accept`,
          payload: { parts: ['nope'] },
        });
        expect(bad.statusCode).toBe(400);
        expect(bad.json().code).toBe('NOT_SPLITTABLE');
        // an empty body is still a whole accept
        expect(
          (await app.inject({ method: 'POST', url: `/api/v1/suggestions/${s2.id}/reject` })).statusCode,
        ).toBe(200);

        resetSuggestionAnalyticsCache();
        const an = await app.inject({
          method: 'GET',
          url: `/api/v1/suggestions/analytics?sourceId=${sourceId}`,
        });
        expect(an.statusCode).toBe(200);
        const a = an.json();
        // s1 accepted-and-edited, s2 rejected, s3 pending, plus s1's remainder (pending)
        expect(a.total).toBe(4);
        expect(a.rates).toEqual({ accepted: 0.5, edited: 0.5, rejected: 0.5 });
        expect(a.byType).toEqual(
          expect.arrayContaining([
            { key: 'update-step', total: 3, accepted: 1, edited: 1, rejected: 1, pending: 1 },
            { key: 'field-alert', total: 1, accepted: 0, edited: 0, rejected: 0, pending: 1 },
          ]),
        );
        expect(a.bySource).toEqual([
          { key: sourceId, total: 4, accepted: 1, edited: 1, rejected: 1, pending: 2 },
        ]);
        // X1's 0051 columns are not here yet, so both bucket under the unknown key
        expect(a.byModel.map((b: { key: string }) => b.key)).toEqual(['—']);
        expect(a.byPromptVersion.map((b: { key: string }) => b.key)).toEqual(['—']);
        expect(a.meanMinutesToDecision).toBeGreaterThanOrEqual(0);
        void s3;
        await app.close();
      }),
    240000,
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
        expect(
          (await app.inject({ method: 'GET', url: '/api/v1/suggestions/analytics' })).statusCode,
        ).toBe(403);
        expect((await app.inject({ method: 'GET', url: '/api/v1/sources' })).statusCode).toBe(200);
        await app.close();
      }),
    180000,
  );
});
