import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument, contentStub } from '../helpers/l5/stubs.js';
import { SourceRevisionService } from '../../src/modules/sources/revisions.js';
import { MappingService } from '../../src/modules/sources/mapping.js';
import { ProposalService } from '../../src/modules/sources/proposal.js';
import { SuggestionService } from '../../src/modules/sources/suggestions.js';
import { processRevision, scanWatchDir, type PipelineDeps } from '../../src/jobs/pipeline.js';
import { parseText } from '../../src/modules/sources/text.js';
import { buildDocx } from './fixtures/docx-builder.js';
import { RuleBasedModel } from '@wecom/model';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import type { Document } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111';

const makeDeps = (pool: pg.Pool): PipelineDeps => {
  const revisions = new SourceRevisionService(pool, { send: async () => null });
  const mapping = new MappingService(pool);
  return {
    revisions,
    mapping,
    proposal: new ProposalService(pool, mapping, contentStub),
    suggestions: new SuggestionService(pool, contentStub, { publish: () => undefined }),
  };
};

const fakeApp = { log: { info: () => undefined } } as unknown as FastifyInstance;

run('processRevision', () => {
  it(
    'diffs against the last accepted revision and stores model proposals',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const deps = makeDeps(pool);
        const { id: sourceId } = await deps.revisions.createSource(
          { kind: 'text', title: 'נהלי תמיכה טכנית' },
          uid,
        );
        const doc: Document = {
          id: D,
          slug: 'browsing',
          title: 'איטיות גלישה',
          description: '',
          category: 'tech',
          wave: 1,
          priority: 'hh',
          kind: 'steps',
          status: 'published',
          currentVersion: 7,
          sourceId,
          related: [],
          createdAt: '2025-06-12T00:00:00.000Z',
          updatedAt: '2025-06-12T00:00:00.000Z',
          phases: [
            {
              id: 'p1',
              label: '',
              steps: [
                {
                  key: 's8',
                  num: '8',
                  title: 'בדיקת מהירות גלישה',
                  sourceRef: '§4.8',
                  actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ Speedtest' }],
                  outcomes: [],
                  blockRefs: [],
                  deps: [],
                },
              ],
            },
          ],
        };
        await seedDocument(pool, doc, uid);

        const v1 = await deps.revisions.ingest(
          sourceId,
          parseText('a.md', '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest. מעל 5 מגה תקין.'),
          uid,
        );
        await pool.query(`update source_revisions set accepted=true where id=$1`, [v1.revisionId]);
        const v2 = await deps.revisions.ingest(
          sourceId,
          parseText(
            'a.md',
            '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest. מעל 6 מגה תקין. ודא ניתוק מ-Wi-Fi.',
          ),
          uid,
        );

        const res = await processRevision(deps, new RuleBasedModel(), v2.revisionId);
        expect(res.used).toBe('rules');
        expect(res.created).toBe(1);
        const list = await deps.suggestions.list({ status: 'pending', page: 1, pageSize: 10 });
        expect(list.items[0]).toMatchObject({ type: 'update-step', targetStepKey: 's8', anchor: '§4.8' });
        expect(
          (await pool.query(`select sync_state from sources where id=$1`, [sourceId])).rows[0].sync_state,
        ).toBe('pending');

        // re-processing the same revision replaces its pending suggestions instead of duplicating
        await processRevision(deps, new RuleBasedModel(), v2.revisionId);
        expect((await deps.suggestions.list({ page: 1, pageSize: 10 })).total).toBe(1);
      }),
    240000,
  );

  it(
    'marks a revision with no changes as accepted and the source synced',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const deps = makeDeps(pool);
        const { id: sourceId } = await deps.revisions.createSource({ kind: 'text', title: 'נהלים' }, uid);
        const v1 = await deps.revisions.ingest(
          sourceId,
          parseText('a.md', '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest.'),
          uid,
        );
        const res = await processRevision(deps, new RuleBasedModel(), v1.revisionId);
        expect(res.created).toBe(1); // first import: everything is "added"
        await pool.query(`update suggestions set status='rejected' where source_revision_id=$1`, [
          v1.revisionId,
        ]);
        await pool.query(`update source_revisions set accepted=true where id=$1`, [v1.revisionId]);

        // same content again -> duplicate, so force a second identical-content revision by hand
        const v2 = (
          await pool.query(
            `insert into source_revisions(source_id, hash, paragraphs)
             select source_id, 'other-hash', paragraphs from source_revisions where id=$1 returning id`,
            [v1.revisionId],
          )
        ).rows[0].id as string;
        const res2 = await processRevision(deps, new RuleBasedModel(), v2);
        expect(res2.created).toBe(0);
        expect(
          (await pool.query(`select accepted from source_revisions where id=$1`, [v2])).rows[0].accepted,
        ).toBe(true);
        expect(
          (await pool.query(`select sync_state from sources where id=$1`, [sourceId])).rows[0].sync_state,
        ).toBe('synced');
      }),
    240000,
  );

  it(
    'imports settled .docx files from the watch folder once per filename',
    async () =>
      withDb(async (pool) => {
        const deps = makeDeps(pool);
        const dir = await mkdtemp(join(tmpdir(), 'l5-watch-'));
        const buf = await buildDocx({
          title: 'נהלי תמיכה טכנית',
          paragraphs: [{ runs: [{ t: '4.14 בעיות גלישה ברכב. בדוק את ה-Wi-Fi של הרכב.' }] }],
        });
        await writeFile(join(dir, 'nohalim.docx'), buf);
        await pool.query(`select 1`); // keep the pool warm
        // mtime is "now", so the first scan skips the file as still being written
        expect(await scanWatchDir(fakeApp, deps, dir)).toBe(0);
        const old = new Date(Date.now() - 60_000);
        const { utimes } = await import('node:fs/promises');
        await utimes(join(dir, 'nohalim.docx'), old, old);
        expect(await scanWatchDir(fakeApp, deps, dir)).toBe(1);
        expect(await scanWatchDir(fakeApp, deps, dir)).toBe(0); // same hash -> duplicate
        const sources = await deps.revisions.listSources();
        expect(sources).toHaveLength(1);
        expect(sources[0]).toMatchObject({ kind: 'docx', externalId: 'nohalim.docx' });
      }),
    240000,
  );
});
