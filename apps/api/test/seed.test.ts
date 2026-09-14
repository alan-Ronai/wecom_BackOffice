import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';

const run = integration ? describe : describe.skip;
run('seed', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });

  it('loads the legacy library idempotently', async () => {
    const { runSeed } = await import('../src/seed.js');
    const first = await runSeed(db.pool);
    expect(first.documents).toBe(23);
    // 29 of the 52 legacy topics have no `docId`; they become card-only draft documents.
    expect(first.cards).toBe(29);
    expect(first.blocks).toBe(4);
    expect(first.fields).toBe(14);
    expect(first.scripts).toBe(7);
    expect(first.topics).toBe(52);
    const again = await runSeed(db.pool);
    expect(again.documents).toBe(0);
    expect(again.cards).toBe(0);
    expect(again.topics).toBe(0);

    const b = (await db.pool.query("select id, status, current_version from documents where slug='browsing'"))
      .rows[0];
    expect(b.status).toBe('published');
    expect(b.current_version).toBe(7);
    const vs = await db.pool.query(
      'select version, label from document_versions where document_id=$1 order by version',
      [b.id],
    );
    expect(vs.rows.map((v) => v.version)).toEqual([3, 4, 5, 6, 7]);
    const v5 = (
      await db.pool.query('select snapshot from document_versions where document_id=$1 and version=5', [b.id])
    ).rows[0].snapshot;
    expect(
      v5.phases
        .flatMap((p: { steps: { key: string }[] }) => p.steps)
        .some((s: { key: string }) => s.key === 's13'),
    ).toBe(false);
    expect(
      (
        await db.pool.query(
          "select count(*)::int n from steps s join documents d on d.id=s.document_id where d.slug='browsing' and s.block_id is not null",
        )
      ).rows[0].n,
    ).toBe(3);
    expect((await db.pool.query('select count(*)::int n from step_field_refs')).rows[0].n).toBeGreaterThan(
      20,
    );
    // card-only topics land as zero-step drafts
    expect(
      (
        await db.pool.query(
          `select count(*)::int n from documents d where d.status='draft'
             and exists (select 1 from document_topics t where t.document_id = d.id)`,
        )
      ).rows[0].n,
    ).toBe(29);
    expect((await db.pool.query('select count(*)::int n from worlds')).rows[0].n).toBe(6);
    expect(
      (
        await db.pool.query(
          `select count(*)::int n from documents d where not exists (select 1 from document_worlds w where w.document_id=d.id and w.world_slug=d.category)`,
        )
      ).rows[0].n,
    ).toBe(0);
    expect((await db.pool.query(`select doc_type from documents where slug='pdf-011'`)).rows[0].doc_type).toBe('M');
    expect((await db.pool.query(`select doc_type from documents where slug='topic-1'`)).rows[0].doc_type).toBe('I');
    expect(
      (await db.pool.query(`select count(*)::int n from documents where doc_type='T' and kind='text'`)).rows[0].n,
    ).toBe(7);
    expect(
      (
        await db.pool.query(
          `select count(*)::int n from document_links l join documents t on t.id=l.to_document_id where t.doc_type='T' and l.type='link'`,
        )
      ).rows[0].n,
    ).toBeGreaterThan(0);
    expect(
      (
        await db.pool.query(
          `select t.slug from document_topics x join documents d on d.id=x.document_id join topics t on t.id=x.topic_id where d.slug='browsing'`,
        )
      ).rows[0].slug,
    ).toBe('topic-11');
    expect((await db.pool.query('select count(*)::int n from notes')).rows[0].n).toBe(1);
    expect((await db.pool.query('select count(*)::int n from note_likes')).rows[0].n).toBe(4);
    expect((await db.pool.query('select count(*)::int n from document_links')).rows[0].n).toBeGreaterThan(0);
  });
});
