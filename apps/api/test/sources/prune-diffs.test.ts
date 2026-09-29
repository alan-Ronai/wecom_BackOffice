import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import { KEEP_FULL_DIFFS, pruneRevisionDiffs } from '../../src/modules/sources/pruneDiffs.js';
import { fewShotExamples } from '../../src/modules/sources/fewshot.js';
import { resetSuggestionAnalyticsCache, suggestionAnalytics } from '../../src/modules/sources/analytics.js';

/**
 * Wave Y · A-M7, owner decision 3: full `meta->'diffs'` survive on the newest 20 revisions per
 * source and on any revision a suggestion references; every other revision keeps counts only.
 */
const run = integration ? describe : describe.skip;

const diffs = (i: number) => [
  { ref: '1.1', kind: 'changed', before: `לפני ${i}`, after: `אחרי ${i}` },
  { ref: '1.2', kind: 'added', before: null, after: `חדש ${i}` },
  { ref: '1.3', kind: 'changed', before: 'א', after: 'ב' },
];

run('source revision diff pruning (A-M7)', () => {
  it('keeps the newest 20 and every suggestion-referenced revision whole, counts-only for the rest', async () =>
    withDb(async (pool) => {
      const mkSource = async (title: string) =>
        (await pool.query(`insert into sources(kind, title) values ('docx',$1) returning id`, [title]))
          .rows[0].id as string;
      const src = await mkSource('גדול');
      const other = await mkSource('קטן');
      const total = KEEP_FULL_DIFFS + 3;
      const revs: string[] = []; // oldest first
      for (let i = 0; i < total; i++)
        revs.push(
          (
            await pool.query(
              `insert into source_revisions(source_id, hash, paragraphs, meta, imported_at)
               values ($1, $2, '[]', $3, now() - make_interval(days => $4)) returning id`,
              [src, 'h' + i, JSON.stringify({ title: 't', diffs: diffs(i) }), total - i],
            )
          ).rows[0].id,
        );
      // A second, small source: nothing of it is old enough to prune.
      const small = (
        await pool.query(
          `insert into source_revisions(source_id, hash, paragraphs, meta, imported_at)
           values ($1, 'x', '[]', $2, now() - interval '400 days') returning id`,
          [other, JSON.stringify({ diffs: diffs(99) })],
        )
      ).rows[0].id as string;
      // The oldest revision is referenced by an accepted suggestion: the few-shot bank reads it.
      await pool.query(
        `insert into suggestions(source_revision_id, anchor, type, title, payload, confidence, status, decided_at)
         values ($1, '§1.1', 'update-step', 'עדכון', '{}', 0.9, 'accepted', now())`,
        [revs[0]],
      );

      expect(await pruneRevisionDiffs(pool)).toBe(2);
      const meta = async (id: string) =>
        (await pool.query(`select meta from source_revisions where id=$1`, [id])).rows[0].meta;

      // revs[1] and revs[2]: past the newest 20 and referenced by nothing.
      for (const id of [revs[1], revs[2]]) {
        const m = await meta(id);
        expect(m.diffs).toBeUndefined();
        expect(m.diffCounts).toEqual({ changed: 2, added: 1 });
        expect(typeof m.prunedAt).toBe('string');
        expect(m.title).toBe('t'); // the rest of meta is untouched
      }
      expect((await meta(revs[0])).diffs).toHaveLength(3);
      for (const id of revs.slice(3)) expect((await meta(id)).diffs).toHaveLength(3);
      expect((await meta(small)).diffs).toHaveLength(3);

      // Idempotent: a pruned row has no diffs left to prune.
      expect(await pruneRevisionDiffs(pool)).toBe(0);

      // The few-shot bank still shows the change behind the accepted suggestion…
      const ex = await fewShotExamples(pool, { sourceId: src, worldSlugs: [], types: ['update-step'] });
      expect(ex).toHaveLength(1);
      expect(ex[0].diff).toContain('לפני 0');

      // …and a suggestion that lands on a pruned revision later still yields an example (anchor
      // only, the pre-wave-6 fallback), and the acceptance analytics count it.
      await pool.query(
        `insert into suggestions(source_revision_id, anchor, type, title, payload, confidence, status, decided_at)
         values ($1, '§1.2', 'update-step', 'עדכון', '{}', 0.9, 'accepted', now() - interval '1 day')`,
        [revs[1]],
      );
      const ex2 = await fewShotExamples(pool, { sourceId: src, worldSlugs: [], types: ['update-step'] });
      expect(ex2.map((e) => e.diff)).toEqual([expect.stringContaining('לפני 0'), '§1.2']);
      resetSuggestionAnalyticsCache();
      const a = await suggestionAnalytics(pool, { sourceId: src });
      expect(a.total).toBe(2);
      expect(a.rates.accepted).toBe(1);
    }));
});
