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
    // 23 legacy documents + the 8 new Kira ones (Y5); 13 legacy ones are superseded in place.
    expect(first.documents).toBe(31);
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
    expect(
      (await db.pool.query(`select doc_type from documents where slug='pdf-011'`)).rows[0].doc_type,
    ).toBe('M');
    expect(
      (await db.pool.query(`select doc_type from documents where slug='topic-1'`)).rows[0].doc_type,
    ).toBe('I');
    expect(
      (await db.pool.query(`select count(*)::int n from documents where doc_type='T' and kind='text'`))
        .rows[0].n,
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

  /**
   * Y5 — the Kira base-knowledge overlay (`seed/convert-kira.mjs`). A Kira document that supersedes
   * a legacy one keeps its id and slug and carries the legacy content as its previous version; the
   * others are new. Every link the seed writes lands on a real document.
   */
  describe('Kira base knowledge', () => {
    const SUPERSEDED: [slug: string, id: string, code: string, legacyVersion: number][] = [
      ['pdf-011', '4f2238c4-3191-4387-8de1-31f9333681ee', 'M-00', 3],
      ['pdf-012', 'de037d38-7d17-4730-8c19-d3aa2704ddaf', 'R-01', 4],
      ['pdf-013', '68347add-1dd7-43e5-8519-aac95e92dcb1', 'R-02', 4],
      ['pdf-014', '234b98bc-fa1c-4c85-8c31-766b7ae81cd6', 'R-03', 4],
      ['pdf-015', 'b37ca8e1-6950-41c8-8f62-2c0515beabfb', 'R-04', 4],
      ['pdf-016', 'f956f3d2-323b-4645-83f2-b6b05ae762f9', 'R-05', 2],
      ['pdf-017', 'e2c50192-2a99-40bc-88d3-d29109342509', 'O-02', 3],
      ['pdf-018', '7377218d-b9b4-4452-8d18-8f0228dea8f9', 'O-03', 2],
      ['pdf-019', '500f1fa7-f70f-4c12-89e4-11d1cfba08a6', 'O-04', 2],
      ['pdf-020', '0dcc9d72-bf6b-4124-82e4-96303cb404ae', 'O-05', 2],
      ['pdf-021', '8805f83f-191e-47aa-8f94-bf20f3cffd2d', 'E-01', 2],
      ['pdf-002', 'ba744440-a357-43b3-83e0-03c2fabe7ebc', 'M-10', 4],
      ['pdf-005', '511a7481-eea1-469b-8c9e-cb5f745202ad', 'O-13', 2],
    ];
    const NEW: [slug: string, code: string, world: string][] = [
      ['kira-o-06', 'O-06', 'intl'],
      ['kira-r-11', 'R-11', 'tech'],
      ['kira-r-12', 'R-12', 'tech'],
      ['kira-r-13', 'R-13', 'tech'],
      ['kira-o-10', 'O-10', 'tech'],
      ['kira-o-12', 'O-12', 'tech'],
      ['kira-e-10', 'E-10', 'tech'],
      ['kira-t-10', 'T-10', 'tech'],
    ];

    it('a superseded document keeps its id and slug and gains the Kira version on top of the legacy one', async () => {
      for (const [slug, id, code, legacyVersion] of SUPERSEDED) {
        const d = (
          await db.pool.query(
            'select id, code, doc_type, current_version, source_ref from documents where slug=$1',
            [slug],
          )
        ).rows[0];
        expect(d, slug).toMatchObject({ id, code, doc_type: code[0], current_version: legacyVersion + 1 });
        expect(d.source_ref).toMatch(/^Kira · /);
        const vs = await db.pool.query(
          'select version, label from document_versions where document_id=$1 order by version',
          [id],
        );
        expect(
          vs.rows.map((v) => v.version),
          slug,
        ).toEqual([legacyVersion, legacyVersion + 1]);
        expect(vs.rows[1].label).toMatch(/Kira/);
      }
    });

    it('the new Kira documents are there, typed by their code, in their world', async () => {
      for (const [slug, code, world] of NEW) {
        const d = (
          await db.pool.query(
            `select d.code, d.doc_type, d.status, d.category,
                    (select count(*)::int from steps s where s.document_id = d.id) as steps
               from documents d where d.slug=$1`,
            [slug],
          )
        ).rows[0];
        expect(d, slug).toMatchObject({ code, doc_type: code[0], category: world });
        expect(d.steps, slug).toBeGreaterThan(2);
        expect(['published', 'partial']).toContain(d.status);
      }
      // O-01 was delivered as an empty file and is not a document.
      expect((await db.pool.query(`select 1 from documents where code='O-01'`)).rowCount).toBe(0);
    });

    it('the domestic-reception documents share the topic "בעיות קליטה בארץ"', async () => {
      const members = (
        await db.pool.query(
          `select d.code from document_topics x join topics t on t.id=x.topic_id join documents d on d.id=x.document_id
            where t.slug='topic-14' and t.name='בעיות קליטה בארץ' order by d.code`,
        )
      ).rows.map((r) => r.code);
      expect(members).toEqual(['E-10', 'M-10', 'O-10', 'O-12', 'O-13', 'R-11', 'R-12', 'R-13', 'T-10']);
      // O-13 keeps its own legacy topic too, and that one is not renamed
      const o13 = (
        await db.pool.query(
          `select t.slug, t.name from document_topics x join topics t on t.id=x.topic_id join documents d on d.id=x.document_id
            where d.code='O-13' order by t.slug`,
        )
      ).rows;
      expect(o13).toEqual([
        { slug: 'topic-14', name: 'בעיות קליטה בארץ' },
        { slug: 'topic-20', name: 'איפוס הגדרות רשת' },
      ]);
    });

    it('the knowledge map and the text link the documents, and every link resolves', async () => {
      const edges = async (from: string) =>
        (
          await db.pool.query(
            `select distinct t.code, l.type from document_links l
               join documents f on f.id=l.from_document_id join documents t on t.id=l.to_document_id
              where f.code=$1`,
            [from],
          )
        ).rows.map((r) => `${r.type}:${r.code}`);
      // M-00 routes to every problem route (text + map); M-10 to its reception routes.
      const m00 = await edges('M-00');
      for (const c of ['R-01', 'R-02', 'R-03', 'R-04', 'R-05', 'E-01', 'O-06'])
        expect(m00).toContain(`related:${c}`);
      expect(m00).toContain('link:R-01');
      const m10 = await edges('M-10');
      for (const c of ['R-11', 'R-12', 'R-13']) expect(m10).toContain(`related:${c}`);
      // a quoted title with no code becomes a [[doc:]] link (R-01 → O-06, the US compatibility list)
      expect(await edges('R-01')).toContain('link:O-06');
      // R-05's "O-06 בחירת רשת ידנית" is corrected to O-05 (ERRATA)
      expect(await edges('R-05')).toContain('link:O-05');
      expect(await edges('R-05')).not.toContain('link:O-06');
      // no dangling targets: every explicit/detected document edge points at an existing document
      expect(
        (
          await db.pool.query(
            `select count(*)::int n from documents d, jsonb_array_elements(d.related) r
              where not exists (select 1 from documents t where t.id = (r->>'documentId')::uuid)`,
          )
        ).rows[0].n,
      ).toBe(0);
      expect(
        (
          await db.pool.query(
            `select count(*)::int n from document_links l
              where l.to_document_id is not null and not exists (select 1 from documents t where t.id=l.to_document_id)`,
          )
        ).rows[0].n,
      ).toBe(0);
    });

    it('the converted structure keeps branches, scripts, objections and shared-block references', async () => {
      const step = async (code: string, where: string) =>
        (
          await db.pool.query(
            `select s.* from steps s join documents d on d.id=s.document_id where d.code=$1 and ${where}`,
            [code],
          )
        ).rows;
      // R-02 keeps the legacy "ריענון SIM" / "איפוס הגדרות רשת" block references on its steps 8–9
      const snap = (
        await db.pool.query(`select snapshot from document_versions v join documents d on d.id=v.document_id
          where d.code='R-02' and v.version=d.current_version`)
      ).rows[0].snapshot;
      const steps = snap.phases.flatMap(
        (p: { steps: { blockRefs: string[]; branch?: unknown }[] }) => p.steps,
      );
      expect(steps.filter((s: { blockRefs: string[] }) => s.blockRefs.length)).toHaveLength(2);
      expect(steps.filter((s: { branch?: unknown }) => s.branch).length).toBeGreaterThan(4);
      // T-10 carries scripts and customer objections
      const t10 = (
        await db.pool.query(`select snapshot from document_versions v join documents d on d.id=v.document_id
          where d.code='T-10'`)
      ).rows[0].snapshot;
      const t10Steps = t10.phases.flatMap(
        (p: { steps: { script?: string; extras?: { objection?: unknown } }[] }) => p.steps,
      );
      expect(t10Steps.filter((s: { script?: string }) => s.script).length).toBeGreaterThan(3);
      expect(
        t10Steps.filter((s: { extras?: { objection?: unknown } }) => s.extras?.objection).length,
      ).toBeGreaterThan(2);
      // O-04 is a skeleton in the source ("לבקש משחר להשלים") — partial, with the note as a hint
      expect((await db.pool.query(`select status from documents where code='O-04'`)).rows[0].status).toBe(
        'partial',
      );
      expect(await step('O-04', `s.hint like 'להשלמה:%'`)).toHaveLength(1);
    });
  });

  /**
   * A-M13 — the seed's `_usedIn` insert lost the `on conflict do nothing` the old `script_refs`
   * insert had, because after the scripts fold there was no constraint to conflict on. 0037
   * names the edge; these are the two halves of what that buys.
   */
  it('document_links: the edge is unique, and a repeated one is a no-op rather than a duplicate', async () => {
    const edge = (
      await db.pool.query<{
        from_document_id: string;
        to_document_id: string;
        type: string;
        origin: string;
      }>(
        `select l.from_document_id, l.to_document_id, l.type, l.origin
           from document_links l join documents t on t.id = l.to_document_id
          where t.doc_type='T' and l.type='link' and l.from_step_key is null limit 1`,
      )
    ).rows[0];
    expect(edge).toBeTruthy();
    const count = async () =>
      (
        await db.pool.query<{ n: number }>(
          `select count(*)::int n from document_links
            where from_document_id=$1 and to_document_id=$2 and type=$3 and origin=$4`,
          [edge.from_document_id, edge.to_document_id, edge.type, edge.origin],
        )
      ).rows[0].n;
    expect(await count()).toBe(1);

    // The shape the seed now uses: the same edge again changes nothing.
    await db.pool.query(
      `insert into document_links(from_document_id, to_document_id, type, origin)
       values ($1,$2,$3,$4) on conflict do nothing`,
      [edge.from_document_id, edge.to_document_id, edge.type, edge.origin],
    );
    expect(await count()).toBe(1);

    // And the index is what makes that guard mean something: unguarded, it raises.
    await expect(
      db.pool.query(
        `insert into document_links(from_document_id, to_document_id, type, origin) values ($1,$2,$3,$4)`,
        [edge.from_document_id, edge.to_document_id, edge.type, edge.origin],
      ),
    ).rejects.toThrow(/document_links_edge_uniq/);

    // Nulls are part of the key, not a licence to duplicate: the same target reached from two
    // different steps is still two distinct edges.
    const differentStep = await db.pool.query(
      `insert into document_links(from_document_id, from_step_key, to_document_id, type, origin)
       values ($1,'s1',$2,$3,$4) on conflict do nothing returning id`,
      [edge.from_document_id, edge.to_document_id, edge.type, edge.origin],
    );
    expect(differentStep.rowCount).toBe(1);
    await db.pool.query('delete from document_links where id=$1', [differentStep.rows[0].id]);

    // Nothing the seed wrote is a duplicate of anything else it wrote.
    expect(
      (
        await db.pool.query<{ n: number }>(
          `select count(*)::int n from (
             select 1 from document_links
              group by from_document_id, coalesce(from_step_key,''), coalesce(to_document_id::text,''),
                       coalesce(to_block_id::text,''), coalesce(to_field_name,''), coalesce(to_source_id::text,''),
                       type, origin
             having count(*) > 1) d`,
        )
      ).rows[0].n,
    ).toBe(0);
  });
});
