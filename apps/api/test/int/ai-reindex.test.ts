import { describe, it, expect } from 'vitest';
import type { Document } from '@wecom/shared';
import type { ModelClient } from '@wecom/model';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument } from '../helpers/l5/stubs.js';
import { reindexEmbeddings } from '../../src/modules/ai/reindex.js';
import { readEmbeddingDimension } from '../../src/lib/embedStatus.js';

/**
 * Wave 6 (X1), spec §1.2. After an embedder change, 0051 has rebuilt `documents.embedding` and
 * every vector in it is gone; this job is what puts them back. The property that matters most is
 * the refusal: a run against a model of the wrong width must write *nothing*, because the
 * alternative — thousands of unstorable vectors disappearing into a caught exception — is the
 * silent failure the whole embedding-status apparatus exists to end.
 */
const run = integration ? describe : describe.skip;
const IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
];

const doc = (id: string, n: number): Document =>
  ({
    id,
    slug: id.slice(0, 8),
    title: 'מסמך ' + n,
    description: 'תיאור ' + n,
    category: 'tech',
    wave: 1,
    priority: 'h',
    kind: 'steps',
    status: 'published',
    currentVersion: 1,
    phases: [
      {
        id: 'p1',
        label: '',
        steps: [
          {
            key: 's1',
            num: '1',
            title: 'שלב ' + n,
            blockRefs: [],
            deps: [],
            actions: [{ id: 'a1', text: 'פעולה ' + n }],
            outcomes: [],
          },
          {
            key: 's2',
            num: '2',
            title: 'שלב נוסף ' + n,
            blockRefs: [],
            deps: [],
            actions: [{ id: 'a1', text: 'פעולה נוספת ' + n }],
            outcomes: [],
          },
        ],
      },
    ],
    related: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Document;

const log = { info: () => undefined, warn: () => undefined };
const fakeModel = (width: number): ModelClient => ({
  name: 'fake:' + width,
  available: async () => true,
  proposeChanges: async () => [],
  embed: async () => new Array(width).fill(0.05),
  embedBatch: async (texts: string[]) => texts.map(() => new Array(width).fill(0.05)),
});

run('ai.reindex', () => {
  it('re-embeds every document and step, skips unchanged steps on a second pass, and refuses a wrong width', async () =>
    withDb(async (pool) => {
      const dim = (await readEmbeddingDimension(pool)) ?? 768;
      const uid = await seedUser(pool, { displayName: 'ע' });
      for (const [i, id] of IDS.entries()) await seedDocument(pool, doc(id, i + 1), uid);
      // `search_text` is derived by `recomputeDerived`, which the seed helper does not run —
      // title + description alone is already an embeddable text, which is the point.
      const stepCount = (await pool.query('select count(*)::int n from steps')).rows[0].n as number;

      const first = await reindexEmbeddings(
        { db: pool, model: fakeModel(dim), expectedDim: dim, log },
        { batch: 2 },
      );
      expect(first).toMatchObject({ documents: 3, steps: stepCount, skipped: 0, dimension: dim });
      expect(
        (await pool.query('select count(*)::int n from documents where embedding is not null')).rows[0].n,
      ).toBe(3);
      expect((await pool.query('select count(*)::int n from step_embeddings')).rows[0].n).toBe(stepCount);

      // Second pass: documents are rewritten (a single idempotent update), steps are not.
      const second = await reindexEmbeddings({ db: pool, model: fakeModel(dim), expectedDim: dim, log });
      expect(second).toMatchObject({ documents: 3, steps: 0 });

      // A model of the wrong width refuses before writing anything.
      await pool.query('update documents set embedding=null');
      await pool.query('delete from step_embeddings');
      const refused = await reindexEmbeddings({
        db: pool,
        model: fakeModel(dim + 8),
        expectedDim: dim,
        log,
      });
      expect(refused).toMatchObject({ documents: 0, steps: 0, skipped: -1, dimension: dim + 8 });
      expect(
        (await pool.query('select count(*)::int n from documents where embedding is not null')).rows[0].n,
      ).toBe(0);
      expect((await pool.query('select count(*)::int n from step_embeddings')).rows[0].n).toBe(0);

      // A model with no `embed` is the MODEL_DISABLED case: refused, not crashed.
      const noEmbed = { ...fakeModel(dim), embed: undefined, embedBatch: undefined };
      expect(await reindexEmbeddings({ db: pool, model: noEmbed, expectedDim: dim, log })).toMatchObject({
        skipped: -1,
      });
    }));

  it('resumes from a watermark instead of re-walking the corpus', async () =>
    withDb(async (pool) => {
      const dim = (await readEmbeddingDimension(pool)) ?? 768;
      const uid = await seedUser(pool, { displayName: 'ע' });
      for (const [i, id] of IDS.entries()) await seedDocument(pool, doc(id, i + 1), uid);
      await pool.query(`update documents set updated_at = '2026-01-01' where id = $1`, [IDS[0]]);
      await pool.query(`update documents set updated_at = '2026-06-01' where id <> $1`, [IDS[0]]);

      const res = await reindexEmbeddings(
        { db: pool, model: fakeModel(dim), expectedDim: dim, log },
        { since: '2026-03-01T00:00:00.000Z' },
      );
      expect(res.documents).toBe(2);
      expect(
        (await pool.query('select embedding is null e from documents where id=$1', [IDS[0]])).rows[0].e,
      ).toBe(true);
    }));
});
