import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser } from '../helpers/l5/stubs.js';
import { buildApp } from '../../src/app.js';

const run = integration ? describe : describe.skip;

/**
 * Wave Y (Y3): `GET /suggestions?documentId=` — the suggestions of every source linked to a
 * document (its primary `documents.source_id` plus each `document_links.to_source_id`), each row
 * carrying the source it came from so the workspace can group them.
 */
run('GET /suggestions?documentId', () => {
  it(
    'lists the suggestions of every source linked to the document, and nothing else',
    async () =>
      withDb(async (pool, uri) => {
        const uid = await seedUser(pool, { displayName: 'נועה' });
        const app = await buildApp({
          config: { DATABASE_URL: uri, NODE_ENV: 'test', MODEL_DISABLED: true },
          pool: pool as pg.Pool,
          boss: false,
          testUser: { id: uid, displayName: 'נועה', permissions: 'all' },
        });
        try {
          const source = async (title: string) =>
            (await pool.query(`insert into sources(kind, title) values ('text', $1) returning id`, [title]))
              .rows[0].id as string;
          const primary = await source('נהלי גלישה');
          const linked = await source('מחירון');
          const unrelated = await source('מקור אחר');

          const doc = async (slug: string, sourceId: string | null) =>
            (
              await pool.query(
                `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, current_version, source_id)
               values ($1, $1, '', 'tech', 1, 'h', 'steps', 'published', 'I', 1, $2) returning id`,
                [slug, sourceId],
              )
            ).rows[0].id as string;
          const multi = await doc('multi-source', primary);
          const orphan = await doc('no-source', null);
          await pool.query(
            `insert into document_links(from_document_id, to_source_id, type, origin)
           values ($1, $2, 'derived_from_source', 'manual')`,
            [multi, linked],
          );

          const suggest = async (sourceId: string, title: string) => {
            const rev = await pool.query(
              `insert into source_revisions(source_id, hash, paragraphs) values ($1, $2, '[]') returning id`,
              [sourceId, title],
            );
            return (
              await pool.query(
                `insert into suggestions(source_revision_id, anchor, type, title, payload, confidence)
               values ($1, '1', 'deprecate-step', $2, '{"type":"deprecate-step","reason":"x"}', 0.9) returning id`,
                [rev.rows[0].id, title],
              )
            ).rows[0].id as string;
          };
          const a = await suggest(primary, 'מהמקור הראשי');
          const b = await suggest(linked, 'מהמקור המקושר');
          await suggest(unrelated, 'ממקור שאינו מקושר');

          const get = async (qs: string) => {
            const r = await app.inject({ method: 'GET', url: `/api/v1/suggestions?${qs}` });
            expect(r.statusCode, r.body).toBe(200);
            return r.json() as {
              items: { id: string; sourceId?: string; sourceTitle?: string }[];
              total: number;
            };
          };

          const all = await get(`documentId=${multi}`);
          expect(all.total).toBe(2);
          expect(all.items.map((s) => s.id).sort()).toEqual([a, b].sort());
          expect(all.items.find((s) => s.id === a)).toMatchObject({
            sourceId: primary,
            sourceTitle: 'נהלי גלישה',
          });
          expect(all.items.find((s) => s.id === b)).toMatchObject({
            sourceId: linked,
            sourceTitle: 'מחירון',
          });

          // An intersection with `sourceId`, never a union.
          expect((await get(`documentId=${multi}&sourceId=${linked}`)).items.map((s) => s.id)).toEqual([b]);
          expect((await get(`documentId=${multi}&sourceId=${unrelated}`)).total).toBe(0);
          // A document with no source and no links has no suggestions — not everyone's.
          expect((await get(`documentId=${orphan}`)).total).toBe(0);
          // The old filter is unchanged.
          expect((await get(`sourceId=${primary}`)).items.map((s) => s.id)).toEqual([a]);
        } finally {
          await app.close();
        }
      }),
    120_000,
  );
});
