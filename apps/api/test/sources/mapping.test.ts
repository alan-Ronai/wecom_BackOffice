import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument, seedBlock, seedField, contentStub } from '../helpers/l5/stubs.js';
import { MappingService } from '../../src/modules/sources/mapping.js';
import { ProposalService } from '../../src/modules/sources/proposal.js';
import { paragraphDiff } from '../../src/modules/sources/diff.js';
import type { Document, Block, SourceRevision } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111';
const B = '44444444-4444-4444-8444-444444444444';

const block: Block = {
  id: B,
  slug: 'sim-refresh',
  title: 'ריענון SIM',
  kind: 'step',
  actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }],
  outcomes: [],
  currentVersion: 2,
  updatedAt: '2025-06-12T00:00:00.000Z',
};

const doc = (sourceId: string): Document => ({
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
      label: 'מסלול 2',
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
        {
          key: 's11',
          num: '11',
          title: 'ריענון SIM',
          sourceRef: '§4.11',
          blockId: B,
          actions: [],
          outcomes: [],
          blockRefs: [],
          deps: [],
        },
      ],
    },
  ],
});

run('mapping + proposal context', () => {
  it(
    'lists linked steps, proposes and confirms mappings, builds context',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const src = await pool.query(
          `insert into sources(kind, title) values ('docx','נהלי תמיכה טכנית') returning id`,
        );
        const sourceId = src.rows[0].id as string;
        await seedBlock(pool, block);
        await seedField(pool, { name: 'sim block lbl' });
        await seedDocument(pool, doc(sourceId), uid);

        const m = new MappingService(pool);
        const linked = await m.linkedSteps(sourceId);
        expect(linked.map((s) => [s.anchor, s.stepKey, s.blockId ?? null])).toEqual([
          ['4.8', 's8', null],
          ['4.11', 's11', B],
        ]);
        expect(linked[1].actions).toEqual(['CRM ← sim block lbl ← שמור']);

        // a second document without links gets a proposal by similarity
        const other: Document = {
          ...doc(sourceId),
          id: '55555555-5555-4555-8555-555555555555',
          slug: 'other',
          sourceId: null,
          phases: [
            {
              id: 'p1',
              label: '',
              steps: [
                {
                  key: 's1',
                  num: '1',
                  title: 'x',
                  actions: [{ id: 'a', text: 'בקש מהלקוח להריץ Speedtest מעל 6 מגה תקין' }],
                  outcomes: [],
                  blockRefs: [],
                  deps: [],
                },
              ],
            },
          ],
        };
        await seedDocument(pool, other, uid);

        const props = await m.proposeInitialMapping(sourceId, [
          { ref: '9.1', runs: [{ t: 'בקש מהלקוח להריץ Speedtest מעל 6 מגה תקין' }] },
        ]);
        expect(props[0]).toMatchObject({ ref: '9.1', documentId: other.id, stepKey: 's1' });

        await m.confirmMapping(sourceId, props);
        expect(
          (await m.linkedSteps(sourceId)).some((s) => s.documentId === other.id && s.anchor === '9.1'),
        ).toBe(true);

        const ps = new ProposalService(pool, m, contentStub);
        const revision: SourceRevision = {
          id: '66666666-6666-4666-8666-666666666666',
          sourceId,
          hash: 'h',
          paragraphs: [{ ref: '4.8', runs: [{ t: 'מעל 6 מגה' }] }],
          importedAt: new Date().toISOString(),
          importedBy: uid,
          accepted: false,
        };
        const ctx = await ps.buildContext(revision, paragraphDiff(null, revision.paragraphs));
        expect(ctx.source.title).toBe('נהלי תמיכה טכנית');
        expect(ctx.linkedSteps).toHaveLength(3);
        expect(ctx.blocks[0].id).toBe(B);
        expect(ctx.fields[0].name).toBe('sim block lbl');
      }),
    180000,
  );

  /**
   * M2. `where not exists` is a check, not a guarantee: it answers out of the statement's own
   * snapshot, so a concurrent confirm that has inserted but not yet committed is invisible to it.
   * Since 0037 gave `document_links` its edge-identity unique index the loser of that race is a
   * 23505 — surfaced to the second editor as a 500 on a mapping that was in fact already made.
   */
  it(
    'confirms a mapping another session is inserting concurrently, instead of raising 23505',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const src = await pool.query(
          `insert into sources(kind, title) values ('docx','נהלי תמיכה') returning id`,
        );
        const sourceId = src.rows[0].id as string;
        await seedBlock(pool, block);
        await seedDocument(pool, doc(sourceId), uid);
        // The seed anchors the document's steps to the source; this test is about the *first*
        // confirm of a paragraph, so start from no edges at all.
        await pool.query('delete from document_links');
        const pair = [{ ref: '9.1', documentId: D, stepKey: 's8' }];

        /** True once some backend is waiting on a lock — i.e. the insert below has reached the index. */
        const blocked = async () =>
          (
            await pool.query<{ n: number }>(
              `select count(*)::int n from pg_stat_activity
                where wait_event_type='Lock' and state='active' and pid <> pg_backend_pid()`,
            )
          ).rows[0].n > 0;

        const other = await pool.connect();
        try {
          await other.query('begin');
          // The other editor's confirm, mid-flight: inserted, not yet committed, so it is
          // invisible to anybody else's `where not exists`.
          await other.query(
            `insert into document_links(from_document_id, from_step_key, to_source_id, type, origin)
             values ($1,$2,$3,'derived_from_source','explicit')`,
            [D, 's8', sourceId],
          );

          const mine = new MappingService(pool).confirmMapping(sourceId, pair);
          for (let i = 0; i < 200 && !(await blocked()); i++) await new Promise((r) => setTimeout(r, 25));
          await other.query('commit');

          // Before the fix this rejected with 23505 once the other transaction committed.
          await expect(mine).resolves.toBeUndefined();
        } finally {
          other.release();
        }

        // One edge, as the unique index says there must be.
        expect(
          (
            await pool.query<{ n: number }>(
              `select count(*)::int n from document_links where to_source_id=$1`,
              [sourceId],
            )
          ).rows[0].n,
        ).toBe(1);
      }),
    180000,
  );
});
