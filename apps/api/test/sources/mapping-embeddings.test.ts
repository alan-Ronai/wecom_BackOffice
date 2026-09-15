import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import type { Document, Paragraph } from '@wecom/shared';
import type { ModelClient } from '@wecom/model';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument } from '../helpers/l5/stubs.js';
import { MappingService, EMBED_MAP_THRESHOLD } from '../../src/modules/sources/mapping.js';
import { refreshStepEmbeddings, stepText, textHash } from '../../src/modules/sources/embeddings.js';
import { readEmbeddingDimension } from '../../src/lib/embedStatus.js';

/**
 * Wave 6 (X1), spec §1.10. Trigram mapping compares characters, so a paragraph that says the
 * same thing in other words mapped to nothing and the revision came back as `new-card`s.
 * Cosine over `step_embeddings` maps it; with no model, or nothing over the threshold, the
 * trigram pass still runs — the pre-wave-6 behaviour has to survive an unreachable embedder.
 */
const run = integration ? describe : describe.skip;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const doc = (id: string, title: string, stepTitle: string, action: string): Document =>
  ({
    id,
    slug: id.slice(0, 8),
    title,
    description: '',
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
            title: stepTitle,
            blockRefs: [],
            deps: [],
            actions: [{ id: 'a1', text: action }],
            outcomes: [],
          },
        ],
      },
    ],
    related: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Document;

/** A basis vector of the column's own width — `withDb` migrates, so 0051 has already run. */
const unit = (dim: number, axis: number): number[] =>
  Array.from({ length: dim }, (_, i) => (i === axis ? 1 : 0));

const para = (ref: string, text: string): Paragraph => ({ ref, runs: [{ t: text }] });

run('embedding-based paragraph → step mapping', () => {
  it('maps each paragraph to its nearest step vector and falls back to trigram without a model', async () =>
    withDb(async (pool) => {
      const dim = (await readEmbeddingDimension(pool)) ?? 768;
      const uid = await seedUser(pool, { displayName: 'ע' });
      await seedDocument(pool, doc(A, 'הגדרות רשת', 'הגדרת APN', 'עדכן APN במכשיר'), uid);
      await seedDocument(pool, doc(B, 'כרטיס SIM', 'ריענון SIM', 'בצע ריענון SIM בקונסולה'), uid);
      const src = (
        await pool.query(`insert into sources(kind, title) values ('docx','נהלים') returning id`)
      ).rows[0].id as string;

      const apnStep = (await pool.query(`select id from steps where document_id=$1`, [A])).rows[0]
        .id as string;
      const simStep = (await pool.query(`select id from steps where document_id=$1`, [B])).rows[0]
        .id as string;
      for (const [stepId, docId, axis] of [
        [apnStep, A, 0],
        [simStep, B, 1],
      ] as const)
        await pool.query(
          `insert into step_embeddings(step_id, document_id, embedding, text_hash) values ($1,$2,$3::vector,'seed')`,
          [stepId, docId, JSON.stringify(unit(dim, axis))],
        );

      /** "APN" → the first basis vector, anything else → the second. */
      const model: ModelClient = {
        name: 'fake',
        available: async () => true,
        proposeChanges: async () => [],
        embed: async (t: string) => unit(dim, /APN/.test(t) ? 0 : 1),
      };

      const paragraphs = [para('1.1', 'הגדרת APN מחדש במכשיר'), para('1.2', 'ריענון כרטיס SIM ברשת')];
      const mapped = await new MappingService(pool as pg.Pool, model).proposeInitialMapping(
        src,
        paragraphs,
      );
      expect(mapped).toHaveLength(2);
      expect(mapped[0]).toMatchObject({ ref: '1.1', documentId: A, stepKey: 's1' });
      expect(mapped[1]).toMatchObject({ ref: '1.2', documentId: B, stepKey: 's1' });
      for (const m of mapped) expect(m.score).toBeGreaterThanOrEqual(EMBED_MAP_THRESHOLD);

      // Without a model the trigram pass still maps what overlaps textually…
      const trigram = await new MappingService(pool as pg.Pool, null).proposeInitialMapping(src, [
        para('2.1', 'ריענון SIM בצע ריענון SIM בקונסולה'),
      ]);
      expect(trigram.map((t) => t.documentId)).toEqual([B]);

      // …and a model whose vector matches nothing well enough falls through to it too.
      const far: ModelClient = { ...model, embed: async () => unit(dim, dim - 1) };
      const fell = await new MappingService(pool as pg.Pool, far).proposeInitialMapping(src, [
        para('2.1', 'ריענון SIM בצע ריענון SIM בקונסולה'),
      ]);
      expect(fell.map((t) => t.documentId)).toEqual([B]);
    }));

  it('refreshStepEmbeddings re-embeds only the steps whose text moved', async () =>
    withDb(async (pool) => {
      const dim = (await readEmbeddingDimension(pool)) ?? 768;
      const uid = await seedUser(pool, { displayName: 'ע' });
      await seedDocument(pool, doc(A, 'הגדרות רשת', 'הגדרת APN', 'עדכן APN במכשיר'), uid);
      let calls = 0;
      const model: ModelClient = {
        name: 'fake',
        available: async () => true,
        proposeChanges: async () => [],
        embed: async () => unit(dim, 0),
        embedBatch: async (texts: string[]) => {
          calls += texts.length;
          return texts.map(() => unit(dim, 0));
        },
      };
      expect(await refreshStepEmbeddings(pool, A, model)).toBe(1);
      expect(calls).toBe(1);
      // Second pass: the hash is unchanged, so nothing is embedded again.
      expect(await refreshStepEmbeddings(pool, A, model)).toBe(0);
      expect(calls).toBe(1);
      const stored = (await pool.query(`select text_hash from step_embeddings where document_id=$1`, [A]))
        .rows[0].text_hash as string;
      expect(stored).toBe(textHash(stepText({ title: 'הגדרת APN', actions: ['עדכן APN במכשיר'] })));

      // A changed action is re-embedded; a model outage is swallowed, as on the publish path.
      await pool.query(
        `update step_actions set text='עדכן APN ואתחל' where step_id=(select id from steps where document_id=$1)`,
        [A],
      );
      expect(await refreshStepEmbeddings(pool, A, model)).toBe(1);
      const broken: ModelClient = {
        ...model,
        embedBatch: async () => Promise.reject(new Error('embed http 500')),
      };
      await pool.query(
        `update step_actions set text='שוב משהו אחר' where step_id=(select id from steps where document_id=$1)`,
        [A],
      );
      expect(await refreshStepEmbeddings(pool, A, broken)).toBe(0);
      // And a model with no embed at all is a clean no-op.
      expect(await refreshStepEmbeddings(pool, A, { ...model, embed: undefined })).toBe(0);
    }));
});
