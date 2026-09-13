import pg from 'pg';
import { randomUUID } from 'node:crypto';
import type { Block, CrmField, Document, Phase, Step } from '@wecom/shared';
import type { ContentApi, ContentClient } from '../../../src/modules/sources/content-api.js';

/* ------------------------------------------------------------------ seeders */

export async function seedUser(
  pool: pg.Pool,
  u: { displayName: string; source?: 'entra' | 'paloalto' | 'local' },
): Promise<string> {
  const r = await pool.query(
    `insert into users(subject, source, display_name, initials) values ($1,$2,$3,$4) returning id`,
    [randomUUID(), u.source ?? 'local', u.displayName, u.displayName[0]],
  );
  return r.rows[0].id as string;
}

export async function seedField(pool: pg.Pool, f: Partial<CrmField> & { name: string }): Promise<void> {
  await pool.query(
    `insert into crm_fields(name, status, renamed_to, path) values ($1,$2,$3,$4)
     on conflict (name) do update set status=$2, renamed_to=$3`,
    [f.name, f.status ?? 'ok', f.renamedTo ?? null, f.path ?? ''],
  );
}

export async function seedBlock(pool: pg.Pool, b: Block): Promise<void> {
  await pool.query(
    `insert into blocks(id, slug, title, kind, description, script, current_version) values ($1,$2,$3,$4,$5,$6,$7)`,
    [b.id, b.slug, b.title, b.kind, b.description ?? null, b.script ?? null, b.currentVersion],
  );
  for (const [i, a] of b.actions.entries())
    await pool.query(`insert into block_actions(block_id, position, text) values ($1,$2,$3)`, [
      b.id,
      i,
      a.text,
    ]);
  for (const [i, o] of b.outcomes.entries())
    await pool.query(
      `insert into block_outcomes(block_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)`,
      [b.id, i, o.kind, o.text, o.goto ?? null],
    );
}

/** Rewrites phases/steps/actions/outcomes/branches (and derived_from_source links) for a document. */
export async function writeStructure(client: ContentClient, doc: Document): Promise<void> {
  await client.query(`delete from phases where document_id=$1`, [doc.id]);
  for (const [pi, ph] of doc.phases.entries()) {
    const p = await client.query(
      `insert into phases(document_id, position, phase_key, label, note, route) values ($1,$2,$3,$4,$5,$6) returning id`,
      [doc.id, pi, ph.id, ph.label, ph.note ?? null, ph.route ?? null],
    );
    for (const [si, s] of ph.steps.entries()) {
      const st = await client.query(
        `insert into steps(phase_id, document_id, position, step_key, num, title, description, hint, tone, block_id, block_refs, script, source_ref, deps, extras)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [
          p.rows[0].id,
          doc.id,
          si,
          s.key,
          s.num,
          s.title,
          s.description ?? null,
          s.hint ?? null,
          s.tone ?? null,
          s.blockId ?? null,
          s.blockRefs,
          s.script ?? null,
          s.sourceRef ?? null,
          s.deps,
          s.extras ? JSON.stringify(s.extras) : null,
        ],
      );
      for (const [ai, a] of s.actions.entries())
        await client.query(
          `insert into step_actions(step_id, position, action_key, text) values ($1,$2,$3,$4)`,
          [st.rows[0].id, ai, a.id, a.text],
        );
      for (const [oi, o] of s.outcomes.entries())
        await client.query(
          `insert into step_outcomes(step_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)`,
          [st.rows[0].id, oi, o.kind, o.text, o.goto ?? null],
        );
      if (s.branch) {
        const b = await client.query(
          `insert into step_branches(step_id, question) values ($1,$2) returning id`,
          [st.rows[0].id, s.branch.q],
        );
        for (const [bi, o] of s.branch.options.entries())
          await client.query(
            `insert into step_branch_options(branch_id, position, kind, label, text, goto_step_key) values ($1,$2,$3,$4,$5,$6)`,
            [b.rows[0].id, bi, o.kind, o.label, o.text, o.goto ?? null],
          );
      }
      if (doc.sourceId && s.sourceRef)
        await client.query(
          `insert into document_links(from_document_id, from_step_key, to_source_id, type, origin)
           select $1,$2,$3,'derived_from_source','explicit'
           where not exists (select 1 from document_links where from_document_id=$1 and from_step_key=$2 and to_source_id=$3 and type='derived_from_source')`,
          [doc.id, s.key, doc.sourceId],
        );
    }
  }
}

export async function seedDocument(pool: pg.Pool, doc: Document, actorId: string | null): Promise<Document> {
  await pool.query(
    `insert into documents(id, slug, code, title, description, category, wave, priority, kind, status, current_version, source_id, source_ref, related, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$15)`,
    [
      doc.id,
      doc.slug,
      doc.code ?? null,
      doc.title,
      doc.description,
      doc.category,
      doc.wave,
      doc.priority,
      doc.kind,
      doc.status,
      doc.currentVersion,
      doc.sourceId ?? null,
      doc.sourceRef ?? null,
      JSON.stringify(doc.related),
      actorId,
    ],
  );
  await writeStructure(pool, doc);
  return doc;
}

/* -------------------------------------------------------------- readers */

/** Reads a document back out of the normalized tables (used by the stub and by assertions). */
export async function readDocument(client: ContentClient, id: string): Promise<Document | null> {
  const d = await client.query(`select * from documents where id=$1 and deleted_at is null`, [id]);
  if (!d.rowCount) return null;
  const row = d.rows[0];
  const phases = await client.query(`select * from phases where document_id=$1 order by position`, [id]);
  const out: Document = {
    id,
    slug: row.slug,
    code: row.code ?? undefined,
    title: row.title,
    description: row.description,
    category: row.category,
    wave: row.wave,
    priority: row.priority,
    kind: row.kind,
    status: row.status,
    currentVersion: row.current_version,
    sourceId: row.source_id,
    sourceRef: row.source_ref ?? undefined,
    related: row.related,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    etag: row.etag,
    phases: [],
  };
  for (const ph of phases.rows) {
    const steps = await client.query(`select * from steps where phase_id=$1 order by position`, [ph.id]);
    const phase: Phase = {
      id: ph.phase_key as string,
      label: ph.label as string,
      note: ph.note ?? undefined,
      route: ph.route ?? undefined,
      steps: [],
    };
    for (const s of steps.rows) {
      const acts = await client.query(
        `select action_key, text from step_actions where step_id=$1 order by position`,
        [s.id],
      );
      const outs = await client.query(
        `select kind, text, goto_step_key from step_outcomes where step_id=$1 order by position`,
        [s.id],
      );
      const br = await client.query(`select id, question from step_branches where step_id=$1`, [s.id]);
      let branch: Step['branch'];
      if (br.rowCount) {
        const opts = await client.query(
          `select kind, label, text, goto_step_key from step_branch_options where branch_id=$1 order by position`,
          [br.rows[0].id],
        );
        branch = {
          q: br.rows[0].question,
          options: opts.rows.map((o) => ({
            kind: o.kind,
            label: o.label,
            text: o.text,
            goto: o.goto_step_key ?? undefined,
          })),
        };
      }
      phase.steps.push({
        key: s.step_key,
        num: s.num,
        title: s.title,
        description: s.description ?? undefined,
        hint: s.hint ?? undefined,
        tone: s.tone ?? undefined,
        blockId: s.block_id ?? undefined,
        blockRefs: s.block_refs,
        script: s.script ?? undefined,
        sourceRef: s.source_ref ?? undefined,
        deps: s.deps,
        actions: acts.rows.map((a) => ({ id: a.action_key, text: a.text })),
        outcomes: outs.rows.map((o) => ({
          kind: o.kind,
          text: o.text,
          goto: o.goto_step_key ?? undefined,
        })),
        branch,
        extras: s.extras ?? undefined,
      });
    }
    out.phases.push(phase);
  }
  return out;
}

/* -------------------------------------------------------- content stub */

/**
 * Test-only, DB-backed implementation of L2's content module with exactly the
 * signatures L5 consumes. Never shipped: it exists so the pipeline can be tested
 * end to end before L2 lands.
 */
export const contentStub: ContentApi = {
  async getDocument(client, id) {
    return readDocument(client, id);
  },

  async publishDocument(client, doc, opts) {
    const v = doc.currentVersion + 1;
    const next: Document = {
      ...doc,
      currentVersion: v,
      status: doc.status === 'draft' ? 'published' : doc.status,
    };
    await client.query(
      `update documents set title=$2, description=$3, category=$4, wave=$5, priority=$6, status=$7,
         current_version=$8, related=$9, updated_by=$10, updated_at=now(), etag=gen_random_uuid()::text
       where id=$1`,
      [
        doc.id,
        next.title,
        next.description,
        next.category,
        next.wave,
        next.priority,
        next.status,
        v,
        JSON.stringify(next.related),
        opts.actorId,
      ],
    );
    await writeStructure(client, next);
    const r = await client.query(
      `insert into document_versions(document_id, version, snapshot, author_id, label, kind, suggestion_id)
       values ($1,$2,$3,$4,$5,$6,$7) returning id`,
      [
        doc.id,
        v,
        JSON.stringify(next),
        opts.actorId,
        opts.label,
        opts.kind ?? 'published',
        opts.suggestionId ?? null,
      ],
    );
    return { document: next, versionId: r.rows[0].id as string, version: v };
  },

  async createDocument(client, input, actorId) {
    const id = randomUUID();
    const slug = input.slug ?? 'doc-' + id.slice(0, 8);
    const now = new Date().toISOString();
    const doc: Document = {
      id,
      slug,
      title: input.title,
      description: input.description,
      category: input.category,
      wave: input.wave,
      priority: input.priority,
      kind: input.kind,
      status: 'draft',
      currentVersion: 0,
      sourceId: input.sourceId ?? null,
      sourceRef: input.sourceRef,
      related: [],
      phases: input.phases ?? [],
      createdAt: now,
      updatedAt: now,
    };
    await client.query(
      `insert into documents(id, slug, title, description, category, wave, priority, kind, status, current_version, source_id, source_ref, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'draft',0,$9,$10,$11,$11)`,
      [
        id,
        slug,
        doc.title,
        doc.description,
        doc.category,
        doc.wave,
        doc.priority,
        doc.kind,
        doc.sourceId,
        doc.sourceRef ?? null,
        actorId,
      ],
    );
    await writeStructure(client, doc);
    return doc;
  },

  async listDocumentRefs(client) {
    const r = await client.query(`select id, title, code from documents where deleted_at is null`);
    return r.rows.map((x) => ({ id: x.id, title: x.title, code: x.code ?? undefined }));
  },

  async getBlock(client, id) {
    const b = await client.query(`select * from blocks where id=$1 and deleted_at is null`, [id]);
    if (!b.rowCount) return null;
    const a = await client.query(`select text from block_actions where block_id=$1 order by position`, [id]);
    const o = await client.query(
      `select kind, text, goto_step_key from block_outcomes where block_id=$1 order by position`,
      [id],
    );
    return {
      id,
      slug: b.rows[0].slug,
      title: b.rows[0].title,
      kind: b.rows[0].kind,
      description: b.rows[0].description ?? undefined,
      script: b.rows[0].script ?? undefined,
      actions: a.rows.map((x, i) => ({ id: 'b' + (i + 1), text: x.text })),
      outcomes: o.rows.map((x) => ({ kind: x.kind, text: x.text, goto: x.goto_step_key ?? undefined })),
      currentVersion: b.rows[0].current_version,
      updatedAt: b.rows[0].updated_at.toISOString(),
    };
  },

  async publishBlock(client, block, opts) {
    const v = block.currentVersion + 1;
    await client.query(
      `update blocks set title=$2, script=$3, current_version=$4, updated_by=$5, updated_at=now() where id=$1`,
      [block.id, block.title, block.script ?? null, v, opts.actorId],
    );
    await client.query(`delete from block_actions where block_id=$1`, [block.id]);
    for (const [i, a] of block.actions.entries())
      await client.query(`insert into block_actions(block_id, position, text) values ($1,$2,$3)`, [
        block.id,
        i,
        a.text,
      ]);
    await client.query(
      `insert into block_versions(block_id, version, snapshot, author_id, label) values ($1,$2,$3,$4,$5)`,
      [block.id, v, JSON.stringify({ ...block, currentVersion: v }), opts.actorId, opts.label],
    );
    return { block: { ...block, currentVersion: v }, version: v };
  },

  async listBlocks(client) {
    const r = await client.query(`select id from blocks where deleted_at is null`);
    const out: Block[] = [];
    for (const x of r.rows) {
      const b = await contentStub.getBlock(client, x.id);
      if (b) out.push(b);
    }
    return out;
  },

  async listFields(client) {
    const r = await client.query(`select * from crm_fields where deleted_at is null`);
    return r.rows.map((f) => ({
      name: f.name,
      status: f.status,
      renamedTo: f.renamed_to ?? undefined,
      path: f.path,
      updatedAt: f.updated_at.toISOString(),
    }));
  },

  async upsertField(client, input, actorId) {
    const r = await client.query(
      `insert into crm_fields(name, status, renamed_to, path, note, created_by, updated_by)
       values ($1,$2,$3,$4,$5,$6,$6)
       on conflict (name) do update set status=$2, renamed_to=$3, path=$4, note=$5, updated_by=$6, updated_at=now()
       returning *`,
      [input.name, input.status, input.renamedTo ?? null, input.path, input.note ?? null, actorId],
    );
    const f = r.rows[0];
    return {
      name: f.name,
      status: f.status,
      renamedTo: f.renamed_to ?? undefined,
      path: f.path,
      note: f.note ?? undefined,
      updatedAt: f.updated_at.toISOString(),
    };
  },
};
