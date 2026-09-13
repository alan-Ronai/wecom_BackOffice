import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import {
  seedUser,
  seedDocument,
  seedBlock,
  seedField,
  contentStub,
  readDocument,
} from '../helpers/l5/stubs.js';
import { SuggestionService } from '../../src/modules/sources/suggestions.js';
import type { Block, Document, Event } from '@wecom/shared';

const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111';
const B = '44444444-4444-4444-8444-444444444444';

run('SuggestionService', () => {
  it(
    'creates, decides, edits and applies every payload type',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const src = (
          await pool.query(`insert into sources(kind, title) values ('docx','נהלי תמיכה טכנית') returning id`)
        ).rows[0].id as string;
        const rev = (
          await pool.query(
            `insert into source_revisions(source_id, hash, paragraphs) values ($1,'h','[]') returning id`,
            [src],
          )
        ).rows[0].id as string;

        const block: Block = {
          id: B,
          slug: 'sim-refresh',
          title: 'ריענון SIM',
          kind: 'step',
          actions: [
            { id: 'b1', text: 'CRM ← sim block lbl ← שמור' },
            { id: 'b2', text: 'בקש מהלקוח לאתחל מכשיר' },
          ],
          outcomes: [],
          currentVersion: 2,
          updatedAt: '2025-06-12T00:00:00.000Z',
        };
        await seedBlock(pool, block);
        await seedField(pool, { name: 'sim block lbl' });

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
          sourceId: src,
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
        };
        await seedDocument(pool, doc, uid);

        const events: Event[] = [];
        const svc = new SuggestionService(pool, contentStub, { publish: (_tx, e) => void events.push(e) });

        const created = await svc.createFromProposals(rev, [
          {
            anchor: '§4.8',
            type: 'update-step',
            title: 'סף',
            targetDocumentId: D,
            targetStepKey: 's8',
            targetBlockId: null,
            payload: { type: 'update-step', addActions: ['ודא ניתוק Wi-Fi'], patch: {} },
            confidence: 0.9,
            rationale: 'r',
          },
          {
            anchor: '§4.14',
            type: 'new-card',
            title: 'בעיות גלישה ברכב',
            targetDocumentId: null,
            targetStepKey: null,
            targetBlockId: null,
            payload: {
              type: 'new-card',
              title: 'בעיות גלישה ברכב',
              description: 'd',
              category: 'tech',
              wave: 2,
              priority: 'm',
              phases: [
                {
                  id: 'p1',
                  label: 'שלבי הטיפול',
                  steps: [
                    {
                      key: 's1',
                      num: '1',
                      title: 'x',
                      sourceRef: '§4.14',
                      actions: [{ id: 'a1', text: 'y' }],
                      outcomes: [{ kind: 'ok', text: '✓ סיום' }],
                      blockRefs: [],
                      deps: [],
                    },
                  ],
                },
              ],
            },
            confidence: 0.8,
            rationale: 'r',
          },
          {
            anchor: '§4.11',
            type: 'update-block',
            title: 'ריענון SIM: 90 שניות',
            targetDocumentId: D,
            targetStepKey: 's11',
            targetBlockId: B,
            payload: {
              type: 'update-block',
              actions: [
                { id: 'b1', text: 'CRM ← sim block lbl ← שמור' },
                { id: 'b2', text: 'בקש מהלקוח לאתחל מכשיר ולחכות 90 שניות' },
              ],
            },
            confidence: 0.9,
            rationale: 'r',
          },
          {
            anchor: '§4.9',
            type: 'new-step',
            title: 'שלב חדש',
            targetDocumentId: D,
            targetStepKey: 's8',
            targetBlockId: null,
            payload: {
              type: 'new-step',
              afterStepKey: 's8',
              title: 'בדיקת Wi-Fi Calling',
              actions: ['ודא Wi-Fi Calling פעיל'],
              outcomes: [],
            },
            confidence: 0.7,
            rationale: 'r',
          },
          {
            anchor: '§4.12',
            type: 'deprecate-step',
            title: 'הוצאה משימוש',
            targetDocumentId: D,
            targetStepKey: 's8',
            targetBlockId: null,
            payload: { type: 'deprecate-step', reason: 'נמחק במקור' },
            confidence: 0.7,
            rationale: 'r',
          },
          {
            anchor: '§4.15',
            type: 'field-alert',
            title: 'שדה לא מוכר',
            targetDocumentId: null,
            targetStepKey: null,
            targetBlockId: null,
            payload: { type: 'field-alert', fieldName: 'חסימת גלישה בחו"ל', issue: 'unknown' },
            confidence: 0.99,
            rationale: 'r',
          },
        ]);
        expect(created).toHaveLength(6);
        expect(events.filter((e) => e.name === 'suggestion.created')).toHaveLength(6);

        await svc.decide(created[1].id, 'rejected', uid);
        for (const s of created) if (s.id !== created[1].id) await svc.decide(s.id, 'accepted', uid);
        expect(events.filter((e) => e.name === 'suggestion.decided')).toHaveLength(6);

        await svc.edit(
          created[0].id,
          { type: 'update-step', addActions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה'], patch: {} },
          uid,
        );
        await expect(
          svc.edit(
            created[0].id,
            {
              type: 'new-card',
              title: 'x',
              description: '',
              category: 'tech',
              wave: 1,
              priority: 'm',
              phases: [],
            },
            uid,
          ),
        ).rejects.toThrow(/type/);

        const res = await svc.publishAccepted(src, uid);
        expect(res.applied).toBe(5);
        expect(res.versions).toHaveLength(3);

        const after = (await readDocument(pool, D))!;
        const s8 = after.phases[0].steps.find((s) => s.key === 's8')!;
        expect(s8.actions.map((a) => a.text)).toContain('ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה');
        expect(s8.tone).toBe('alert');
        expect(s8.outcomes[0].text).toContain('הוצא משימוש');
        expect(after.phases[0].steps.map((s) => s.key)).toEqual(['s8', 's12', 's11']);
        expect(after.currentVersion).toBeGreaterThan(7);
        expect(
          (await pool.query(`select count(*)::int as n from document_versions where document_id=$1`, [D]))
            .rows[0].n,
        ).toBeGreaterThanOrEqual(3);
        expect((await contentStub.getBlock(pool, B))!.currentVersion).toBe(3);
        expect(
          (await pool.query(`select status from crm_fields where name=$1`, ['חסימת גלישה בחו"ל'])).rows[0]
            .status,
        ).toBe('new');
        expect(
          (await pool.query(`select count(*)::int as n from documents where title=$1`, ['בעיות גלישה ברכב']))
            .rows[0].n,
        ).toBe(0); // rejected
        expect(
          (
            await pool.query(`select status, applied_version_id from suggestions where id=$1`, [
              created[0].id,
            ])
          ).rows[0],
        ).toMatchObject({ status: 'applied' });
        expect(
          (await pool.query(`select sync_state from sources where id=$1`, [src])).rows[0].sync_state,
        ).toBe('synced');
        expect(
          (await pool.query(`select accepted from source_revisions where id=$1`, [rev])).rows[0].accepted,
        ).toBe(true);
        expect(events.some((e) => e.name === 'document.published')).toBe(true);

        // an applied suggestion can no longer be decided or edited
        await expect(svc.decide(created[0].id, 'rejected', uid)).rejects.toThrow(/יושמה/);
      }),
    240000,
  );

  it(
    'filters and paginates the review queue',
    async () =>
      withDb(async (pool) => {
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const src = (
          await pool.query(`insert into sources(kind, title) values ('text','נהלים') returning id`)
        ).rows[0].id as string;
        const rev = (
          await pool.query(
            `insert into source_revisions(source_id, hash, paragraphs) values ($1,'h','[]') returning id`,
            [src],
          )
        ).rows[0].id as string;
        const svc = new SuggestionService(pool, contentStub, { publish: () => undefined });
        await svc.createFromProposals(
          rev,
          [1, 2, 3].map((n) => ({
            anchor: '§' + n,
            type: 'field-alert' as const,
            title: 'שדה ' + n,
            targetDocumentId: null,
            targetStepKey: null,
            targetBlockId: null,
            payload: { type: 'field-alert' as const, fieldName: 'f' + n, issue: 'unknown' as const },
            confidence: 0.5,
            rationale: 'r',
          })),
        );
        const all = await svc.list({ page: 1, pageSize: 2 });
        expect(all.total).toBe(3);
        expect(all.items).toHaveLength(2);
        expect(await svc.list({ status: 'accepted', page: 1, pageSize: 10 })).toMatchObject({ total: 0 });
        expect(await svc.list({ sourceId: src, page: 1, pageSize: 10 })).toMatchObject({ total: 3 });
        void uid;
      }),
    180000,
  );
});
