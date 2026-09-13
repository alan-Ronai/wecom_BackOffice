import type pg from 'pg';
import {
  DocumentCardSchema,
  DocumentSchema,
  detectFieldRefs,
  detectLinks,
  stepText,
  type Block,
  type CreateDocumentBody,
  type DocRef,
  type Document,
  type DocumentCard,
  type ListDocumentsQuery,
  type PatchDocumentBody,
  type Phase,
  type Step,
  type StructureBody,
} from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';

export type Q = pg.Pool | Tx;

const PRIORITY_ORDER = "array_position(array['hh','h','m','l'], d.priority)";

export const slugify = (title: string): string => {
  const ascii = String(title)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (ascii.length >= 2 ? ascii : 'doc') + '-' + Math.random().toString(36).slice(2, 7);
};

export const iso = (d: Date | string | null | undefined): string | null =>
  d ? new Date(d).toISOString() : null;

const groupBy = <T extends Record<string, unknown>>(rows: T[], key: string): Map<string, T[]> => {
  const m = new Map<string, T[]>();
  for (const r of rows) {
    const k = String(r[key]);
    const list = m.get(k);
    if (list) list.push(r);
    else m.set(k, [r]);
  }
  return m;
};

type Row = Record<string, never> & Record<string, unknown>;

/** Assemble the normalised rows of several documents into the shared `Document` shape. */
export async function assembleMany(q: Q, ids: string[]): Promise<Map<string, Document>> {
  if (!ids.length) return new Map();
  const [docs, phases, steps, actions, outcomes, branches, options] = await Promise.all([
    q.query('select * from documents where id = any($1) and deleted_at is null', [ids]),
    q.query('select * from phases where document_id = any($1) order by position', [ids]),
    q.query('select * from steps where document_id = any($1) order by position', [ids]),
    q.query(
      'select a.* from step_actions a join steps s on s.id=a.step_id where s.document_id = any($1) order by a.position',
      [ids],
    ),
    q.query(
      'select o.* from step_outcomes o join steps s on s.id=o.step_id where s.document_id = any($1) order by o.position',
      [ids],
    ),
    q.query(
      'select b.* from step_branches b join steps s on s.id=b.step_id where s.document_id = any($1)',
      [ids],
    ),
    q.query(
      'select o.* from step_branch_options o join step_branches b on b.id=o.branch_id join steps s on s.id=b.step_id where s.document_id = any($1) order by o.position',
      [ids],
    ),
  ]);
  const phasesBy = groupBy(phases.rows as Row[], 'document_id');
  const stepsBy = groupBy(steps.rows as Row[], 'phase_id');
  const actBy = groupBy(actions.rows as Row[], 'step_id');
  const outBy = groupBy(outcomes.rows as Row[], 'step_id');
  const brBy = groupBy(branches.rows as Row[], 'step_id');
  const optBy = groupBy(options.rows as Row[], 'branch_id');

  const out = new Map<string, Document>();
  for (const row of docs.rows) {
    const phasesOut: Phase[] = (phasesBy.get(row.id) ?? []).map((p) => ({
      id: String(p.phase_key),
      label: String(p.label ?? ''),
      note: (p.note as string | null) ?? undefined,
      route: (p.route as string | null) ?? undefined,
      steps: (stepsBy.get(String(p.id)) ?? []).map((s): Step => {
        const br = (brBy.get(String(s.id)) ?? [])[0];
        return {
          key: String(s.step_key),
          num: String(s.num),
          title: String(s.title ?? ''),
          description: (s.description as string | null) ?? undefined,
          hint: (s.hint as string | null) ?? undefined,
          tone: (s.tone as 'alert' | null) ?? undefined,
          blockId: (s.block_id as string | null) ?? undefined,
          blockRefs: (s.block_refs as string[] | null) ?? [],
          script: (s.script as string | null) ?? undefined,
          sourceRef: (s.source_ref as string | null) ?? undefined,
          deps: (s.deps as string[] | null) ?? [],
          actions: (actBy.get(String(s.id)) ?? []).map((a) => ({
            id: String(a.action_key),
            text: String(a.text),
          })),
          outcomes: (outBy.get(String(s.id)) ?? []).map((o) => ({
            kind: o.kind as 'ok' | 'next' | 'alert',
            text: String(o.text),
            goto: (o.goto_step_key as string | null) ?? undefined,
          })),
          branch: br
            ? {
                q: String(br.question),
                options: (optBy.get(String(br.id)) ?? []).map((o) => ({
                  kind: o.kind as 'if' | 'then',
                  label: String(o.label),
                  text: String(o.text),
                  goto: (o.goto_step_key as string | null) ?? undefined,
                })),
              }
            : undefined,
          extras: (s.extras as Step['extras']) ?? undefined,
        };
      }),
    }));
    out.set(
      row.id,
      DocumentSchema.parse({
        id: row.id,
        slug: row.slug,
        code: row.code ?? undefined,
        title: row.title,
        description: row.description ?? '',
        category: row.category,
        wave: row.wave,
        priority: row.priority,
        kind: row.kind,
        status: row.status,
        currentVersion: row.current_version,
        sourceId: row.source_id,
        sourceRef: row.source_ref ?? undefined,
        phases: phasesOut,
        related: row.related ?? [],
        createdAt: iso(row.created_at),
        updatedAt: iso(row.updated_at),
        createdBy: row.created_by ?? undefined,
        updatedBy: row.updated_by ?? undefined,
        etag: row.etag,
      }),
    );
  }
  return out;
}

export const getDocument = async (q: Q, id: string): Promise<Document | null> =>
  (await assembleMany(q, [id])).get(id) ?? null;

export async function listCards(
  q: Q,
  query: ListDocumentsQuery,
  userId: string,
): Promise<{ items: DocumentCard[]; total: number }> {
  const params: unknown[] = [userId];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const where: string[] = ['d.deleted_at is null'];
  if (query.category) where.push(`d.category = ${p(query.category)}`);
  if (query.wave) where.push(`d.wave = ${p(query.wave)}`);
  if (query.priority) where.push(`d.priority = ${p(query.priority)}`);
  if (query.status) where.push(`d.status = ${p(query.status)}`);
  if (query.drafts) where.push(`d.status = 'draft'`);
  if (query.q) {
    const i = p(query.q);
    where.push(`(d.search_vector @@ plainto_tsquery('simple', ${i}) or d.title ilike '%' || ${i} || '%')`);
  }
  if (query.pinned) where.push('p.user_id is not null');
  if (query.recent) where.push('rv.user_id is not null');
  if (query.updatedSince) where.push(`d.updated_at >= ${p(query.updatedSince)}`);

  const SORTS: Record<ListDocumentsQuery['sort'], string> = {
    wave: `d.wave, ${PRIORITY_ORDER}, d.title`,
    updated: 'd.updated_at desc',
    title: 'd.title',
    views: 'coalesce(v.total,0) desc',
  };
  const order = query.recent === true ? 'rv.viewed_at desc' : SORTS[query.sort];

  const base = `from documents d
    left join pins p on p.document_id=d.id and p.user_id=$1
    left join recent_views rv on rv.document_id=d.id and rv.user_id=$1
    left join (select document_id, sum(count) total from recent_views group by document_id) v on v.document_id=d.id
    left join (select document_id, count(*) n, bool_or(block_id is not null) shared from steps group by document_id) st on st.document_id=d.id
    left join (select from_document_id id, count(distinct to_document_id) n from document_links where to_document_id is not null group by 1) lo on lo.id=d.id
    left join (select to_document_id id, count(distinct from_document_id) n from document_links where to_document_id is not null group by 1) li on li.id=d.id
    left join (select s.document_id, array_agg(distinct f.field_name) names from step_field_refs f join steps s on s.id=f.step_id group by 1) cf on cf.document_id=d.id
    left join users au on au.id=d.updated_by
    where ${where.join(' and ')}`;

  const total = (await q.query(`select count(*)::int n ${base}`, params)).rows[0].n as number;
  const limit = p(query.pageSize);
  const offset = p((query.page - 1) * query.pageSize);
  const rows = await q.query(
    `select d.*, coalesce(st.n,0)::int step_count, coalesce(st.shared,false) shared,
       coalesce(lo.n,0)::int links_out, coalesce(li.n,0)::int links_in, coalesce(v.total,0)::int views,
       coalesce(cf.names,'{}') crm, (p.user_id is not null) pinned, au.display_name author_name
     ${base} order by ${order} limit ${limit} offset ${offset}`,
    params,
  );
  return {
    total,
    items: rows.rows.map((r) =>
      DocumentCardSchema.parse({
        id: r.id,
        slug: r.slug,
        title: r.title,
        description: r.description ?? '',
        category: r.category,
        wave: r.wave,
        priority: r.priority,
        kind: r.kind,
        status: r.status,
        currentVersion: r.current_version,
        updatedAt: iso(r.updated_at),
        stepCount: r.step_count,
        linksOut: r.links_out,
        linksIn: r.links_in,
        views: r.views,
        crmFields: r.crm,
        hasSharedBlocks: r.shared,
        pinned: r.pinned,
        authorName: r.author_name ?? undefined,
      }),
    ),
  };
}

export async function insertDocument(tx: Tx, body: CreateDocumentBody, userId: string): Promise<Document> {
  const r = await tx.query(
    `insert into documents(slug, title, description, category, wave, priority, kind, status, topic_id, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) returning id`,
    [
      body.slug ?? slugify(body.title),
      body.title,
      body.description ?? '',
      body.category,
      body.wave,
      body.priority,
      body.kind,
      'draft',
      body.topicId ?? null,
      userId,
    ],
  );
  return (await getDocument(tx, r.rows[0].id as string))!;
}

const PATCH_COLUMNS: Record<string, string> = {
  title: 'title',
  description: 'description',
  category: 'category',
  wave: 'wave',
  priority: 'priority',
  code: 'code',
  sourceRef: 'source_ref',
};

export async function patchDocument(
  tx: Tx,
  id: string,
  body: PatchDocumentBody,
  userId: string,
): Promise<Document> {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(PATCH_COLUMNS)) {
    const v = body[key as keyof PatchDocumentBody];
    if (v !== undefined) {
      params.push(v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(userId, id);
  await tx.query(
    `update documents set ${sets.length ? sets.join(', ') + ',' : ''} updated_by = $${params.length - 1},
       updated_at = now(), etag = gen_random_uuid()::text
     where id = $${params.length} and deleted_at is null`,
    params,
  );
  return (await getDocument(tx, id))!;
}

// ---------------------------------------------------------------------------
// Structure save + derived data (field refs, links, search text)
// ---------------------------------------------------------------------------

export async function loadBlocksMap(q: Q): Promise<Map<string, Block>> {
  const [b, a, o] = await Promise.all([
    q.query('select * from blocks where deleted_at is null'),
    q.query('select * from block_actions order by position'),
    q.query('select * from block_outcomes order by position'),
  ]);
  const m = new Map<string, Block>();
  for (const r of b.rows)
    m.set(r.id, {
      id: r.id,
      slug: r.slug,
      title: r.title,
      kind: r.kind,
      description: r.description ?? undefined,
      script: r.script ?? undefined,
      currentVersion: r.current_version,
      updatedAt: iso(r.updated_at)!,
      updatedBy: r.updated_by ?? undefined,
      actions: a.rows
        .filter((x) => x.block_id === r.id)
        .map((x) => ({ id: x.id as string, text: x.text as string })),
      outcomes: o.rows
        .filter((x) => x.block_id === r.id)
        .map((x) => ({ kind: x.kind, text: x.text, goto: x.goto_step_key ?? undefined })),
    });
  return m;
}

export const loadFieldNames = async (q: Q): Promise<string[]> =>
  (await q.query('select name from crm_fields where deleted_at is null')).rows.map((r) => r.name as string);

export const loadDocRefs = async (q: Q): Promise<DocRef[]> =>
  (await q.query('select id, title, code from documents where deleted_at is null')).rows.map((r) => ({
    id: r.id as string,
    title: r.title as string,
    code: (r.code as string | null) ?? undefined,
  }));

/** Recompute `step_field_refs`, `document_links` and `documents.search_text` for one document. */
export async function recomputeDerived(tx: Tx, doc: Document): Promise<void> {
  const [blocks, fields, refs] = await Promise.all([
    loadBlocksMap(tx),
    loadFieldNames(tx),
    loadDocRefs(tx),
  ]);
  const stepIds = new Map<string, string>(
    (await tx.query('select id, step_key from steps where document_id=$1', [doc.id])).rows.map((r) => [
      r.step_key as string,
      r.id as string,
    ]),
  );
  await tx.query('delete from step_field_refs where step_id in (select id from steps where document_id=$1)', [
    doc.id,
  ]);
  for (const f of detectFieldRefs(doc, fields, blocks)) {
    const stepId = stepIds.get(f.stepKey);
    if (!stepId) continue;
    await tx.query('insert into step_field_refs(step_id, field_name) values ($1,$2) on conflict do nothing', [
      stepId,
      f.fieldName,
    ]);
  }
  await tx.query(
    "delete from document_links where from_document_id=$1 and (origin='detected' or type='related')",
    [doc.id],
  );
  for (const l of detectLinks(doc, refs, blocks))
    await tx.query(
      `insert into document_links(from_document_id, from_step_key, to_document_id, to_block_id, to_field_name, to_source_id, type, origin)
       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [
        l.fromDocumentId,
        l.fromStepKey,
        l.toDocumentId,
        l.toBlockId,
        l.toFieldName,
        l.toSourceId,
        l.type,
        l.origin,
      ],
    );
  const text = doc.phases
    .flatMap((p) => p.steps.map((s) => stepText(s, s.blockId ? blocks.get(s.blockId) : null)))
    .join(' \n ');
  await tx.query('update documents set search_text=$2 where id=$1', [doc.id, text]);
}

/** Rewrite the whole phase/step tree in one transaction; rotates the etag. */
export async function saveStructure(
  tx: Tx,
  id: string,
  body: StructureBody,
  userId: string,
  ifMatch?: string,
): Promise<Document> {
  const cur = await tx.query('select etag, status from documents where id=$1 and deleted_at is null for update', [
    id,
  ]);
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  if (ifMatch && ifMatch !== cur.rows[0].etag)
    throw httpError(412, 'ETAG_MISMATCH', 'המסמך השתנה בינתיים — טען מחדש ונסה שוב');
  await tx.query('delete from phases where document_id=$1', [id]); // cascades steps/actions/outcomes/branches
  let pos = 0;
  for (const [pi, p] of body.phases.entries()) {
    const ph = await tx.query(
      'insert into phases(document_id, position, phase_key, label, note, route) values ($1,$2,$3,$4,$5,$6) returning id',
      [id, pi, p.id, p.label ?? '', p.note ?? null, p.route ?? null],
    );
    for (const s of p.steps) {
      const st = await tx.query(
        `insert into steps(phase_id, document_id, position, step_key, num, title, description, hint, tone, block_id, block_refs, script, source_ref, deps, extras)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning id`,
        [
          ph.rows[0].id,
          id,
          pos++,
          s.key,
          s.num,
          s.title,
          s.description ?? null,
          s.hint ?? null,
          s.tone ?? null,
          s.blockId ?? null,
          s.blockRefs ?? [],
          s.script ?? null,
          s.sourceRef ?? null,
          s.deps ?? [],
          s.extras ? JSON.stringify(s.extras) : null,
        ],
      );
      const sid = st.rows[0].id as string;
      for (const [i, a] of s.actions.entries())
        await tx.query('insert into step_actions(step_id, position, action_key, text) values ($1,$2,$3,$4)', [
          sid,
          i,
          a.id,
          a.text,
        ]);
      for (const [i, o] of s.outcomes.entries())
        await tx.query(
          'insert into step_outcomes(step_id, position, kind, text, goto_step_key) values ($1,$2,$3,$4,$5)',
          [sid, i, o.kind, o.text, o.goto ?? null],
        );
      if (s.branch) {
        const br = await tx.query('insert into step_branches(step_id, question) values ($1,$2) returning id', [
          sid,
          s.branch.q,
        ]);
        for (const [i, o] of s.branch.options.entries())
          await tx.query(
            'insert into step_branch_options(branch_id, position, kind, label, text, goto_step_key) values ($1,$2,$3,$4,$5,$6)',
            [br.rows[0].id, i, o.kind, o.label, o.text, o.goto ?? null],
          );
      }
    }
  }
  const prev = cur.rows[0].status as string;
  const status = prev === 'published' || prev === 'partial' ? 'review' : prev;
  await tx.query(
    'update documents set related=$2, status=$3, updated_by=$4, updated_at=now(), etag=gen_random_uuid()::text where id=$1',
    [id, JSON.stringify(body.related ?? []), status, userId],
  );
  const doc = (await getDocument(tx, id))!;
  await recomputeDerived(tx, doc);
  return doc;
}
