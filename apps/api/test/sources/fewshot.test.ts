import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument } from '../helpers/l5/stubs.js';
import { fewShotExamples } from '../../src/modules/sources/fewshot.js';
import type { Document } from '@wecom/shared';

/**
 * Wave 6 (X1), spec §1.7. The few-shot bank is the review queue read back as training data:
 * what an editor *kept* is the example, so `edited_payload` wins over `payload` and rejected
 * suggestions never appear.
 */
const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111';

const doc = (id: string, title: string): Document =>
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
        steps: [{ key: 's1', num: '1', title: 'שלב', blockRefs: [], deps: [], actions: [], outcomes: [] }],
      },
    ],
    related: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Document;

const newSource = async (pool: import('pg').Pool, title: string) =>
  (await pool.query(`insert into sources(kind, title) values ('docx',$1) returning id`, [title])).rows[0]
    .id as string;

const newRevision = async (pool: import('pg').Pool, sourceId: string, hash: string, diffs: unknown) =>
  (
    await pool.query(
      `insert into source_revisions(source_id, hash, paragraphs, meta) values ($1,$2,'[]',$3) returning id`,
      [sourceId, hash, JSON.stringify({ diffs })],
    )
  ).rows[0].id as string;

const insertSuggestion = async (
  pool: import('pg').Pool,
  revisionId: string,
  s: {
    anchor: string;
    type: string;
    title: string;
    payload: unknown;
    editedPayload?: unknown;
    status: string;
    decidedAt: string;
  },
) =>
  pool.query(
    `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key,
        payload, edited_payload, confidence, rationale, status, decided_at)
     values ($1,$2,$3,$4,$5,'s1',$6,$7,0.8,'r',$8,$9)`,
    [
      revisionId,
      s.anchor,
      s.type,
      s.title,
      D,
      JSON.stringify(s.payload),
      s.editedPayload ? JSON.stringify(s.editedPayload) : null,
      s.status,
      s.decidedAt,
    ],
  );

run('fewShotExamples', () => {
  it('returns accepted examples, same source first, with the edited payload and the real diff text', async () =>
    withDb(async (pool) => {
      const uid = await seedUser(pool, { displayName: 'ע' });
      await seedDocument(pool, doc(D, 'איטיות גלישה'), uid);
      const mine = await newSource(pool, 'נהלי SIM');
      const other = await newSource(pool, 'נהלי חיוב');
      const myRev = await newRevision(pool, mine, 'h1', [
        { ref: '4.8', kind: 'changed', before: 'מעל 5 מגה', after: 'מעל 6 מגה', similarity: 0.9 },
      ]);
      const otherRev = await newRevision(pool, other, 'h2', []);

      await insertSuggestion(pool, myRev, {
        anchor: '§4.8',
        type: 'update-step',
        title: 'סף 5 → 6',
        payload: { type: 'update-step', addActions: ['מה שהמודל אמר'], patch: {} },
        editedPayload: { type: 'update-step', addActions: ['מה שהעורך השאיר'], patch: {} },
        status: 'accepted',
        decidedAt: '2026-02-01T00:00:00.000Z',
      });
      await insertSuggestion(pool, otherRev, {
        anchor: '§2.1',
        type: 'deprecate-step',
        title: 'הוצאה משימוש',
        payload: { type: 'deprecate-step', reason: 'נמחק' },
        status: 'applied',
        decidedAt: '2026-03-01T00:00:00.000Z',
      });
      await insertSuggestion(pool, otherRev, {
        anchor: '§2.2',
        type: 'update-step',
        title: 'נדחה',
        payload: { type: 'update-step', addActions: ['לא'], patch: {} },
        status: 'rejected',
        decidedAt: '2026-04-01T00:00:00.000Z',
      });

      const out = await fewShotExamples(pool, {
        sourceId: mine,
        worldSlugs: ['tech'],
        types: ['update-step', 'deprecate-step'],
      });
      expect(out).toHaveLength(2);
      // Same source first, however much newer the other decision is.
      expect(out[0].suggestion.anchor).toBe('§4.8');
      expect((out[0].suggestion.payload as { addActions: string[] }).addActions).toEqual(['מה שהעורך השאיר']);
      expect(out[0].diff).toContain('מעל 6 מגה');
      expect(out.map((e) => e.suggestion.type)).toEqual(['update-step', 'deprecate-step']);
      // A revision with no stored diffs falls back to the anchor rather than dropping out.
      expect(out[1].diff).toBe('§2.1');
      // A rejected suggestion is never an example.
      expect(out.some((e) => e.suggestion.title === 'נדחה')).toBe(false);
    }));

  it('asks for nothing when no type is in play', async () =>
    withDb(async (pool) => {
      expect(await fewShotExamples(pool, { sourceId: D, worldSlugs: [], types: [] })).toEqual([]);
    }));
});
