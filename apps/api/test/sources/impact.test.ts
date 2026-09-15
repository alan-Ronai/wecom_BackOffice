import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser, seedDocument, seedBlock, seedField } from '../helpers/l5/stubs.js';
import { ImpactService } from '../../src/modules/sources/impact.js';
import type { Block, Document } from '@wecom/shared';

/**
 * Wave 6 (X1), spec §1.6. The point of the impact set is that an editor (and the model) sees
 * what a change reaches *before* anything is accepted: the shared block that appears in nine
 * other documents, the CRM field other flows read, the document whose goto lands on this step.
 */
const run = integration ? describe : describe.skip;
const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const BLK = '44444444-4444-4444-8444-444444444444';

const base = (id: string, title: string, phases: Document['phases']): Document =>
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
    phases,
    related: [],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  }) as Document;

run('ImpactService', () => {
  it('collects shared blocks, CRM fields, inbound links and topic siblings for a changed step', async () =>
    withDb(async (pool) => {
      const uid = await seedUser(pool, { displayName: 'ע' });
      const block: Block = {
        id: BLK,
        slug: 'sim-refresh',
        title: 'ריענון SIM',
        kind: 'step',
        actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }],
        outcomes: [],
        currentVersion: 1,
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
      await seedBlock(pool, block);
      await seedField(pool, { name: 'sim block lbl' });
      await seedField(pool, { name: 'apn field' });
      await seedDocument(
        pool,
        base(A, 'איטיות גלישה', [
          {
            id: 'p1',
            label: '',
            steps: [
              { key: 's1', num: '1', title: 'ריענון', blockId: BLK, blockRefs: [], deps: [], actions: [], outcomes: [] },
              {
                key: 's2',
                num: '2',
                title: 'בדיקת APN',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a', text: 'CRM ← apn field ← ערוך' }],
                outcomes: [],
              },
            ],
          },
        ]),
        uid,
      );
      await seedDocument(
        pool,
        base(B, 'ניתוקים', [
          {
            id: 'p1',
            label: '',
            steps: [
              {
                key: 's1',
                num: '1',
                title: 'קישור',
                blockRefs: [],
                deps: [],
                actions: [],
                outcomes: [{ kind: 'next', text: 'ראה איטיות', goto: 's2' }],
              },
            ],
          },
        ]),
        uid,
      );
      // `step_field_refs` is derived by `recomputeDerived`, which the L5 seed helper does not run.
      await pool.query(
        `insert into step_field_refs(step_id, field_name)
         select s.id, $2 from steps s where s.document_id=$1 and s.step_key='s2'`,
        [A, 'apn field'],
      );
      await pool.query(
        `insert into step_field_refs(step_id, field_name)
         select s.id, $2 from steps s where s.document_id=$1 and s.step_key='s1'`,
        [A, 'sim block lbl'],
      );
      await pool.query(
        `insert into document_links(from_document_id, from_step_key, to_document_id, type, origin) values ($1,'s1',$2,'link','explicit')`,
        [B, A],
      );
      await pool.query(
        `insert into topics(world_id, slug, name) select id, 'apn', 'APN' from worlds where slug='tech'`,
      );
      const topicId = (await pool.query(`select id from topics where slug='apn'`)).rows[0].id as string;
      await pool.query(`insert into document_topics(document_id, topic_id) values ($1,$3),($2,$3)`, [
        A,
        B,
        topicId,
      ]);

      const impact = await new ImpactService(pool).impactForSteps([
        { documentId: A, stepKey: 's1', blockId: BLK },
        { documentId: A, stepKey: 's2' },
      ]);
      expect(impact.blocks).toEqual([{ id: BLK, title: 'ריענון SIM', usedBy: 1 }]);
      expect(impact.fields.map((f) => f.name).sort()).toEqual(['apn field', 'sim block lbl']);
      expect(impact.documents.map((d) => d.id)).toContain(B);
      expect(impact.documents.find((d) => d.id === B)?.why).toMatch(/קישור|link/);
      expect(impact.topics).toEqual([{ id: topicId, name: 'APN' }]);
      // 0051 rebuilt the column, so nothing is embedded until `ai.reindex` runs.
      expect(impact.related).toEqual([]);

      // The document-wide radius is the union over its own steps — the shape X2's tool reads.
      const whole = await new ImpactService(pool).impactForDocument(A);
      expect(whole.blocks).toEqual(impact.blocks);
      expect(whole.documents.map((d) => d.id)).toContain(B);
    }));

  it('affectsFor narrows the set to what one suggestion touches and formatImpact respects the budget', async () =>
    withDb(async (pool) => {
      const svc = new ImpactService(pool);
      const impact = {
        documents: [{ id: B, title: 'ניתוקים', why: 'קישור משלב 1' }],
        blocks: [{ id: BLK, title: 'ריענון SIM', usedBy: 3 }],
        fields: [{ name: 'apn field', usedBy: 2 }],
        topics: [],
        related: [],
      };
      const aff = svc.affectsFor(impact, {
        anchor: '§1',
        type: 'update-block',
        title: 't',
        targetDocumentId: A,
        targetStepKey: 's1',
        targetBlockId: BLK,
        payload: { type: 'update-block', actions: [{ id: 'b1', text: 'x' }] },
        confidence: 0.8,
        rationale: '',
      });
      expect(aff.map((a) => a.kind)).toEqual(['block', 'document']);
      expect(aff[0].why).toContain('3');
      const text = svc.formatImpact(impact, 80);
      expect(text.length).toBeLessThanOrEqual(80);
      expect(text).toMatch(/בלוק/);
      // A field only lands in `affects` when the suggestion is the alert about that field.
      const alert = svc.affectsFor(impact, {
        anchor: '§1',
        type: 'field-alert',
        title: 't',
        targetDocumentId: null,
        targetStepKey: null,
        targetBlockId: null,
        payload: { type: 'field-alert', fieldName: 'apn field', issue: 'unknown' },
        confidence: 0.8,
        rationale: '',
      });
      expect(alert.map((a) => a.kind)).toEqual(['field', 'document']);
    }));
});
