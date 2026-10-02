import { describe, it, expect, afterEach } from 'vitest';
import FormData from 'form-data';
import type pg from 'pg';
import type { Block, Document } from '@wecom/shared';
import { withDb, integration } from '../helpers/l5/db.js';
import { contentStub, seedUser, seedBlock, seedDocument, seedField } from '../helpers/l5/stubs.js';
import { buildDocx } from '../sources/fixtures/docx-builder.js';
import { buildApp } from '../../src/app.js';
import { setContentApi } from '../../src/modules/sources/content-api.js';
import { PROMPT_FAMILY } from '../../src/lib/aiSettings.js';

/**
 * Wave 6 (X1), spec §1.6/§1.9. Through the real pipeline and the real routes: every suggestion
 * the pipeline writes carries its provenance (`prompt_version`, `model`) and the blast radius
 * the *server* computed (`affects`), and `GET /suggestions` hands all three to the web app.
 *
 * `MODEL_DISABLED: true` on purpose — the rule-based path is what the compose e2e gate runs, so
 * if `affects` only appeared when Ollama was reachable, the chips would never render there.
 */
const run = integration ? describe : describe.skip;
const D = '11111111-1111-4111-8111-111111111111';
const BLK = '44444444-4444-4444-8444-444444444444';
const PARA_V1 = '4.14 ריענון SIM ברשת. אם הלקוח מדווח על היעדר קליטה – בצע ריענון SIM בקונסולה.';
const PARA_V2 =
  '4.14 ריענון SIM ברשת. אם הלקוח מדווח על היעדר קליטה – בצע ריענון SIM בקונסולה. המתן 90 שניות.';

afterEach(() => setContentApi(null));

const upload = async (
  app: Awaited<ReturnType<typeof buildApp>>,
  filename: string,
  text: string,
  sourceId?: string,
): Promise<{ sourceId: string; revisionId: string }> => {
  const buf = await buildDocx({ title: 'נהלי תמיכה טכנית', paragraphs: [{ runs: [{ t: text }] }] });
  const fd = new FormData();
  fd.append('file', buf, {
    filename,
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  // A second upload without this creates a *second* source, and the mapping would not apply.
  if (sourceId) fd.append('sourceId', sourceId);
  const up = await app.inject({
    method: 'POST',
    url: '/api/v1/sources/upload',
    payload: fd.getBuffer(),
    headers: fd.getHeaders(),
  });
  expect(up.statusCode).toBe(200);
  return up.json();
};

run('suggestions carry affects, prompt version and model', () => {
  it(
    'stamps server-computed affects and provenance on every suggestion, and serves them over the API',
    async () =>
      withDb(async (pool, uri) => {
        setContentApi(contentStub);
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const block: Block = {
          id: BLK,
          slug: 'sim-refresh',
          title: 'ריענון SIM',
          kind: 'step',
          actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← בצע ריענון SIM בקונסולה' }],
          outcomes: [],
          currentVersion: 1,
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
        await seedBlock(pool, block);
        await seedField(pool, { name: 'sim block lbl' });
        const doc: Document = {
          id: D,
          slug: 'no-signal',
          title: 'אין קליטה',
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
                  // Close enough to the paragraph for the trigram mapper to anchor it on import.
                  title: 'ריענון SIM ברשת',
                  blockId: BLK,
                  blockRefs: [],
                  deps: [],
                  actions: [],
                  outcomes: [],
                },
              ],
            },
          ],
          related: [],
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        } as Document;
        await seedDocument(pool, doc, uid);
        await pool.query(
          `insert into step_field_refs(step_id, field_name)
           select s.id, 'sim block lbl' from steps s where s.document_id=$1 and s.step_key='s1'`,
          [D],
        );

        const app = await buildApp({
          config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true },
          pool: pool as pg.Pool,
          boss: false,
          testUser: { id: uid, displayName: 'ענבר ל.', permissions: 'all' },
        });

        /**
         * The baseline revision, anchored to the step by hand. `proposeInitialMapping`'s
         * trigram pass is not the subject here and its threshold is a moving target; what this
         * test is about is what happens to the *second* revision once a step is mapped.
         */
        const first = await upload(app, 'נהלים.docx', PARA_V1);
        const ref = (
          await pool.query(`select paragraphs from source_revisions where id=$1`, [first.revisionId])
        ).rows[0].paragraphs[0].ref as string;
        await pool.query(`update steps set source_ref=$2 where document_id=$1 and step_key='s1'`, [
          D,
          '§' + ref,
        ]);
        await pool.query(
          `insert into document_links(from_document_id, from_step_key, to_source_id, type, origin)
           values ($1,'s1',$2,'derived_from_source','explicit') on conflict do nothing`,
          [D, first.sourceId],
        );
        await pool.query(`update documents set source_id=$2 where id=$1`, [D, first.sourceId]);
        await pool.query(`update source_revisions set accepted=true where id=$1`, [first.revisionId]);

        // Second import changes the mapped paragraph → the rules path proposes update-block.
        const second = await upload(app, 'נהלים.docx', PARA_V2, first.sourceId);
        expect(second.sourceId).toBe(first.sourceId);
        expect(second.revisionId).not.toBe(first.revisionId);
        const proc = await app.inject({ method: 'POST', url: `/api/v1/sources/${second.sourceId}/process` });
        expect(proc.statusCode).toBe(200);
        expect(proc.json().used).toBe('rules');

        const rows = (
          await pool.query(
            `select type, prompt_version, model, affects from suggestions where source_revision_id=$1`,
            [second.revisionId],
          )
        ).rows;
        expect(rows.length).toBeGreaterThan(0);
        // `currentPromptVersion` — the prompt family (`propose-v4` → `v4`) plus the brief/style
        // versions an admin has saved (0 here). Derived, so a v5 prompt moves this with it.
        for (const r of rows) {
          expect(r.prompt_version).toMatch(new RegExp(`^${PROMPT_FAMILY}\\.`));
          expect(r.model).toBe('rules');
        }
        const blockRow = rows.find((r) => r.type === 'update-block');
        expect(blockRow, 'the mapped step is embedded from a shared block').toBeTruthy();
        const affects = blockRow.affects as { kind: string; id: string; why: string }[];
        expect(affects.some((a) => a.kind === 'block' && a.id === BLK && /\d/.test(a.why))).toBe(true);

        // …and the same three fields reach the web app through the existing route.
        const list = await app.inject({
          method: 'GET',
          url: `/api/v1/suggestions?status=pending&sourceId=${second.sourceId}`,
        });
        expect(list.statusCode).toBe(200);
        const item = list.json().items.find((i: { type: string }) => i.type === 'update-block');
        expect(item.promptVersion).toMatch(new RegExp(`^${PROMPT_FAMILY}\\.`));
        expect(item.model).toBe('rules');
        expect(item.affects.some((a: { kind: string }) => a.kind === 'block')).toBe(true);

        // The diffs behind the batch are kept on the revision, so the next run has a few-shot bank.
        const meta = (await pool.query(`select meta from source_revisions where id=$1`, [second.revisionId]))
          .rows[0].meta as { diffs: { ref: string }[] };
        expect(meta.diffs.length).toBeGreaterThan(0);

        await app.close();
      }),
    240000,
  );
});
