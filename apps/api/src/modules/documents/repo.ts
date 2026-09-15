import type pg from 'pg';
import {
  DocumentCardSchema,
  DocumentSchema,
  detectFieldRefs,
  detectLinks,
  htmlToText,
  sanitizeHtml,
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
  UNPUBLISHED_STATUSES,
} from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';
import { canReadUnpublished, visibleStatusSql, visibleWhere } from '../../lib/visibility.js';
import type { ReqUser } from '../../lib/user.js';
import { getDocumentSyncState } from '../connectors/document-sync-state.js';

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

/** Primary world first, the rest sorted — the order every consumer relies on. */
export const orderWorlds = (primary: string, worlds: readonly string[]): string[] => [
  primary,
  ...[...new Set(worlds)].filter((w) => w !== primary).sort(),
];

/** Postgres FK failures on the taxonomy tables are client errors, not 500s. */
export const mapTaxonomyFkError = (e: unknown): never => {
  const err = e as { code?: string; constraint?: string };
  if (
    err.code === '23503' &&
    (err.constraint === 'documents_category_fkey' || err.constraint === 'document_worlds_world_slug_fkey')
  )
    throw httpError(400, 'UNKNOWN_WORLD', 'עולם התוכן אינו קיים');
  if (err.code === '23503' && err.constraint === 'document_topics_topic_id_fkey')
    throw httpError(400, 'UNKNOWN_TOPIC', 'הנושא אינו קיים');
  throw e;
};

/**
 * Make `document_worlds` = {primary} ∪ extraWorlds and (when given) `document_topics` = topics.
 * The primary world is always a member, so "which worlds" is one join everywhere.
 */
export async function syncMemberships(
  tx: Tx,
  id: string,
  primary: string,
  extraWorlds: readonly string[],
  topics?: readonly string[],
): Promise<void> {
  const worlds = [...new Set([primary, ...extraWorlds])];
  await tx.query('delete from document_worlds where document_id=$1 and not (world_slug = any($2::text[]))', [
    id,
    worlds,
  ]);
  for (const w of worlds)
    await tx.query(
      'insert into document_worlds(document_id, world_slug) values ($1,$2) on conflict do nothing',
      [id, w],
    );
  if (topics !== undefined) {
    await tx.query('delete from document_topics where document_id=$1 and not (topic_id = any($2::uuid[]))', [
      id,
      [...topics],
    ]);
    for (const t of topics)
      await tx.query(
        'insert into document_topics(document_id, topic_id) values ($1,$2) on conflict do nothing',
        [id, t],
      );
  }
}

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
  const [docs, phases, steps, actions, outcomes, branches, options, worldRows, topicRows] = await Promise.all(
    [
      q.query(
        `select d.*, ou.display_name owner_name, eu.display_name editor_name, au.display_name approver_name
           from documents d
           left join users ou on ou.id=d.owner_id
           left join users eu on eu.id=d.editor_id
           left join users au on au.id=d.approver_id
          where d.id = any($1) and d.deleted_at is null`,
        [ids],
      ),
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
      q.query('select document_id, world_slug from document_worlds where document_id = any($1)', [ids]),
      q.query(
        'select document_id, topic_id from document_topics where document_id = any($1) order by topic_id',
        [ids],
      ),
    ],
  );
  const phasesBy = groupBy(phases.rows as Row[], 'document_id');
  const stepsBy = groupBy(steps.rows as Row[], 'phase_id');
  const actBy = groupBy(actions.rows as Row[], 'step_id');
  const outBy = groupBy(outcomes.rows as Row[], 'step_id');
  const brBy = groupBy(branches.rows as Row[], 'step_id');
  const optBy = groupBy(options.rows as Row[], 'branch_id');
  const worldsBy = groupBy(worldRows.rows as Row[], 'document_id');
  const topicsBy = groupBy(topicRows.rows as Row[], 'document_id');

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
        docType: row.doc_type,
        tags: (row.tags as string[] | null) ?? [],
        worlds: orderWorlds(
          row.category as string,
          (worldsBy.get(row.id) ?? []).map((w) => String(w.world_slug)),
        ),
        topics: (topicsBy.get(row.id) ?? []).map((t) => String(t.topic_id)),
        bodyHtml: (row.body_html as string | null) ?? undefined,
        ownerId: row.owner_id ?? null,
        ownerName: row.owner_name ?? null,
        editorId: row.editor_id ?? null,
        editorName: row.editor_name ?? null,
        approverId: row.approver_id ?? null,
        approverName: row.approver_name ?? null,
        publishedAt: iso(row.published_at),
        sourceReviewNeeded: row.source_review_needed ?? false,
        sourceReviewReason: row.source_review_reason ?? null,
      }),
    );
  }
  return out;
}

export const getDocument = async (q: Q, id: string): Promise<Document | null> =>
  (await assembleMany(q, [id])).get(id) ?? null;

/** `getDocument` plus the reader rule: an unpublished document is a 404 for users without `docs.read_unpublished`. */
export async function getVisibleDocument(
  q: Q,
  id: string,
  user: Pick<ReqUser, 'permissions'>,
): Promise<Document | null> {
  const doc = await getDocument(q, id);
  if (!doc) return null;
  if (!canReadUnpublished(user) && (UNPUBLISHED_STATUSES as readonly string[]).includes(doc.status))
    throw httpError(404, 'NOT_PUBLISHED', 'פריט זה אינו זמין כרגע');
  return doc;
}

/**
 * `worldScopes` is the caller's `user_roles.world_scope` union (null = every world).
 * Route-level `config.scope` only guards `/documents/:id`; without the same term here a
 * scoped user could list every document in every world. Scope is an INTERSECTION with
 * `document_worlds`: an item shared into a scoped world stays reachable.
 */
export async function listCards(
  q: Q,
  query: ListDocumentsQuery,
  userId: string,
  worldScopes: readonly string[] | null = null,
  readUnpublished = true,
): Promise<{ items: DocumentCard[]; total: number }> {
  const params: unknown[] = [userId];
  const p = (v: unknown) => {
    params.push(v);
    return '$' + params.length;
  };
  const where: string[] = ['d.deleted_at is null'];
  if (!readUnpublished) where.push(visibleStatusSql());
  if (worldScopes)
    where.push(
      `exists (select 1 from document_worlds sw where sw.document_id=d.id and sw.world_slug = any(${p([...worldScopes])}))`,
    );
  if (query.world)
    where.push(
      `exists (select 1 from document_worlds fw where fw.document_id=d.id and fw.world_slug = ${p(query.world)})`,
    );
  if (query.topic)
    where.push(
      `exists (select 1 from document_topics ft where ft.document_id=d.id and ft.topic_id = ${p(query.topic)})`,
    );
  if (query.docType) where.push(`d.doc_type = ${p(query.docType)}`);
  if (query.tag?.length) where.push(`d.tags @> ${p(query.tag)}::text[]`);
  if (query.category) where.push(`d.category = ${p(query.category)}`);
  if (query.wave) where.push(`d.wave = ${p(query.wave)}`);
  if (query.priority) where.push(`d.priority = ${p(query.priority)}`);
  if (query.status) where.push(`d.status = ${p(query.status)}`);
  if (query.drafts) where.push(`d.status = 'draft'`);
  if (query.q) {
    const i = p(query.q);
    // `kb_tsquery` (migration 0027) is `plainto_tsquery` with the same stopwords the
    // `search_vector` trigger strips at index time. With a plain `plainto_tsquery` the `@@`
    // arm could never be satisfied for a query containing one of them — a phrase like
    // "חוב של לקוח" silently lost every full-text match.
    where.push(`(d.search_vector @@ kb_tsquery(${i}) or d.title ilike '%' || ${i} || '%')`);
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
    left join (select document_id, array_agg(world_slug order by world_slug) ws from document_worlds group by 1) dw on dw.document_id=d.id
    left join (select document_id, array_agg(topic_id::text order by topic_id) ts from document_topics group by 1) dt on dt.document_id=d.id
    left join users au on au.id=d.updated_by
    left join users ou on ou.id=d.owner_id
    where ${where.join(' and ')}`;

  const total = (await q.query(`select count(*)::int n ${base}`, params)).rows[0].n as number;
  const limit = p(query.pageSize);
  const offset = p((query.page - 1) * query.pageSize);
  const rows = await q.query(
    `select d.*, coalesce(st.n,0)::int step_count, coalesce(st.shared,false) shared,
       coalesce(lo.n,0)::int links_out, coalesce(li.n,0)::int links_in, coalesce(v.total,0)::int views,
       coalesce(cf.names,'{}') crm, (p.user_id is not null) pinned, au.display_name author_name,
       coalesce(dw.ws,'{}') ws, coalesce(dt.ts,'{}') ts, ou.display_name owner_name
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
        docType: r.doc_type,
        tags: r.tags ?? [],
        worlds: orderWorlds(r.category, r.ws),
        topics: r.ts,
        ownerId: r.owner_id ?? null,
        ownerName: r.owner_name ?? null,
        editorId: r.editor_id ?? null,
        approverId: r.approver_id ?? null,
        publishedAt: iso(r.published_at),
        sourceReviewNeeded: r.source_review_needed ?? false,
        sourceReviewReason: r.source_review_reason ?? null,
        // Only for `kind: 'text'`, whose body is its content — a `steps` card has never carried
        // its step text and still does not. This is what `GET /documents?docType=T` needs in
        // order to replace `/scripts` for the step-level phrasing picker.
        bodyHtml: r.kind === 'text' ? ((r.body_html as string | null) ?? undefined) : undefined,
      }),
    ),
  };
}

/** `slugify` ends in 5 random base-36 chars against a unique constraint: retry rather than 500. */
const SLUG_ATTEMPTS = 5;

/**
 * C-C2 — spec §2.1 defines the column as "`documents.body_html text` (**sanitized HTML**, used
 * by kind `text`)", and nothing on this path sanitized: `TaxonomyWriteFields` accepted the
 * string and both writes put it straight into the column. It is the canonical body for kind
 * `text`, and the 0030 fold means every type-T document lives in it, so the store was already
 * populated at scale — and the neighbouring content model for the same authoring surface
 * (`source_documents.html`) *is* rendered with `dangerouslySetInnerHTML`.
 *
 * Sanitizing at the repo boundary rather than in the routes means no caller can forget, the
 * same way `saveSourceDocument` does it for the source pane.
 */
const cleanBody = (html: string | null | undefined): string | null =>
  html == null ? (html ?? null) : sanitizeHtml(html);

export async function insertDocument(
  tx: Tx,
  body: CreateDocumentBody,
  userId: string | null,
): Promise<Document> {
  const docType = body.docType ?? (body.kind === 'text' ? 'I' : 'R');
  const values = (slug: string) => [
    slug,
    body.title,
    body.description ?? '',
    body.category,
    body.wave,
    body.priority,
    body.kind,
    'draft',
    docType,
    body.tags ?? [],
    cleanBody(body.bodyHtml),
    userId,
  ];
  const sql = `insert into documents(slug, title, description, category, wave, priority, kind, status, doc_type, tags, body_html, created_by, updated_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$12) returning id`;
  for (let attempt = 0; ; attempt++) {
    // A caller-supplied slug is their choice, so a collision there is a real 409.
    const slug = body.slug ?? slugify(body.title);
    try {
      await tx.query('savepoint insert_document');
      const r = await tx.query(sql, values(slug));
      try {
        await syncMemberships(
          tx,
          r.rows[0].id as string,
          body.category,
          body.worlds ?? [],
          body.topics ?? [],
        );
      } catch (e) {
        mapTaxonomyFkError(e);
      }
      await tx.query('release savepoint insert_document');
      return (await getDocument(tx, r.rows[0].id as string))!;
    } catch (e) {
      await tx.query('rollback to savepoint insert_document');
      const unique = (e as { code?: string }).code === '23505';
      if (!unique) mapTaxonomyFkError(e);
      if (body.slug) throw httpError(409, 'SLUG_TAKEN', 'המזהה (slug) כבר בשימוש');
      if (attempt >= SLUG_ATTEMPTS - 1)
        throw httpError(409, 'SLUG_TAKEN', 'לא הצלחנו להקצות מזהה ייחודי, נסה שוב');
    }
  }
}

const PATCH_COLUMNS: Record<string, string> = {
  title: 'title',
  description: 'description',
  category: 'category',
  wave: 'wave',
  priority: 'priority',
  code: 'code',
  sourceRef: 'source_ref',
  docType: 'doc_type',
  tags: 'tags',
  bodyHtml: 'body_html',
  ownerId: 'owner_id',
  editorId: 'editor_id',
};

/**
 * `ifMatch` is honoured when the caller sends it (412 on conflict), like
 * `saveStructure`. The row lock + `rowCount` assertion also stop a patch of a
 * concurrently-deleted document from 500ing on `getDocument(...)!` returning null.
 */
export async function patchDocument(
  tx: Tx,
  id: string,
  body: PatchDocumentBody,
  userId: string,
  ifMatch?: string,
): Promise<Document> {
  const cur = await tx.query(
    'select etag, category from documents where id=$1 and deleted_at is null for update',
    [id],
  );
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  if (ifMatch && ifMatch !== cur.rows[0].etag)
    throw httpError(412, 'ETAG_MISMATCH', 'המסמך השתנה בינתיים — טען מחדש ונסה שוב');
  // A dangling owner/editor would silently render as "unassigned"; fail loudly instead.
  for (const key of ['ownerId', 'editorId'] as const) {
    const v = body[key];
    if (v) {
      const u = await tx.query('select 1 from users where id=$1 and active', [v]);
      if (!u.rowCount)
        throw httpError(400, 'UNKNOWN_USER', 'המשתמש שנבחר אינו קיים או אינו פעיל', { field: key });
    }
  }
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [key, col] of Object.entries(PATCH_COLUMNS)) {
    const v = body[key as keyof PatchDocumentBody];
    if (v !== undefined) {
      params.push(key === 'bodyHtml' ? cleanBody(v as string | null) : v);
      sets.push(`${col} = $${params.length}`);
    }
  }
  params.push(userId, id);
  let updated;
  try {
    updated = await tx.query(
      `update documents set ${sets.length ? sets.join(', ') + ',' : ''} updated_by = $${params.length - 1},
       updated_at = now(), etag = gen_random_uuid()::text
     where id = $${params.length} and deleted_at is null`,
      params,
    );
  } catch (e) {
    mapTaxonomyFkError(e);
  }
  if (!updated!.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  // A text document never goes through `saveStructure`, so this is the only place its body
  // reaches `search_text`.
  if (body.bodyHtml !== undefined) await updateSearchText(tx, (await getDocument(tx, id))!);
  if (body.category !== undefined || body.worlds !== undefined || body.topics !== undefined) {
    const primary = body.category ?? (cur.rows[0].category as string);
    const extra =
      body.worlds ??
      (await tx.query('select world_slug from document_worlds where document_id=$1', [id])).rows.map(
        (x) => x.world_slug as string,
      );
    try {
      await syncMemberships(tx, id, primary, extra, body.topics);
    } catch (e) {
      mapTaxonomyFkError(e);
    }
  }
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
  const [blocks, fields, refs] = await Promise.all([loadBlocksMap(tx), loadFieldNames(tx), loadDocRefs(tx)]);
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
      // A-M13: `detectLinks` dedupes within a step, but `doc.related` is a plain list and can
      // name the same document twice; with 0037's edge index that second row is now a conflict
      // rather than a duplicate edge, and skipping it is the same result the caller expects.
      `insert into document_links(from_document_id, from_step_key, to_document_id, to_block_id, to_field_name, to_source_id, type, origin)
       values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict do nothing`,
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
  await updateSearchText(tx, doc, blocks);
}

/**
 * `search_text` is what the 0030/0035 trigger indexes and what `updateEmbedding` embeds, and it
 * was built from phases/steps only. A `kind: 'text'` document — the whole point of spec §2.1 —
 * keeps its content in `body_html` and never goes through `saveStructure`, so its body was not
 * searchable at all: `GET /documents?q=`, the `documents` search group and the semantic re-rank
 * matched its title and tags and nothing else.
 */
export async function updateSearchText(tx: Tx, doc: Document, blocks?: Map<string, Block>): Promise<void> {
  const b = blocks ?? (await loadBlocksMap(tx));
  const structure = doc.phases
    .flatMap((p) => p.steps.map((s) => stepText(s, s.blockId ? b.get(s.blockId) : null)))
    .join(' \n ');
  const body = doc.bodyHtml ? htmlToText(doc.bodyHtml) : '';
  await tx.query('update documents set search_text=$2 where id=$1', [
    doc.id,
    [structure, body].filter(Boolean).join(' \n '),
  ]);
}

/** Rewrite the whole phase/step tree in one transaction; rotates the etag. */
export async function saveStructure(
  tx: Tx,
  id: string,
  body: StructureBody,
  userId: string | null,
  ifMatch?: string,
): Promise<Document> {
  const cur = await tx.query(
    'select etag, status from documents where id=$1 and deleted_at is null for update',
    [id],
  );
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
        const br = await tx.query(
          'insert into step_branches(step_id, question) values ($1,$2) returning id',
          [sid, s.branch.q],
        );
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

// ---------------------------------------------------------------------------
// Publish / versions / restore
// ---------------------------------------------------------------------------

/** A document is "partial" when any step has no body at all (no actions, branch, script or block). */
export const isPartial = (doc: Document, blocks: Map<string, Block>): boolean =>
  doc.phases
    .flatMap((p) => p.steps)
    .some(
      (s) =>
        !s.actions.some((a) => a.text.trim()) &&
        !s.branch &&
        !s.script &&
        !(s.blockId && blocks.has(s.blockId)) &&
        !s.extras,
    );

export interface PublishOptions {
  actorId: string | null;
  label: string;
  suggestionId?: string | null;
  markPartial?: boolean;
  kind?: 'published' | 'restore' | 'system' | 'sync';
  /**
   * W4: the `source_documents.current_version` this working version was derived from. Left out,
   * it is read here — every publish path (the editor, an accepted suggestion, a sync push, a
   * review approval) then records the link without having to know about source documents.
   */
  sourceVersion?: number | null;
}

/**
 * Freeze the assembled document into `document_versions` and bump `current_version`.
 * Cross-lane entry point: L5 (apply-a-suggestion) and L6 (sync) call this inside their transaction.
 */
export async function publishDocument(
  tx: Tx,
  doc: Document | string,
  opts: PublishOptions,
): Promise<{ doc: Document; version: number; versionId: string }> {
  const id = typeof doc === 'string' ? doc : doc.id;
  const cur = await tx.query(
    'select current_version from documents where id=$1 and deleted_at is null for update',
    [id],
  );
  if (!cur.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  const before = (await getDocument(tx, id))!;
  const blocks = await loadBlocksMap(tx);
  const version = (cur.rows[0].current_version as number) + 1;
  const status = opts.markPartial || isPartial(before, blocks) ? 'partial' : 'published';
  /**
   * This is the shared entry point for the editor publish, an accepted suggestion, a sync push
   * (`kind: 'sync'`) and a restore. `approver_id` answers "who signed this off" (spec §2.2), so
   * a system/sync publish with a null actor must not erase it and a restore must not re-stamp
   * the restorer as the approver. Same for the source-review flag: a WordPress-originated sync
   * clearing "the source moved, an editor must look" is the opposite of what the flag means.
   */
  const humanPublish = (opts.kind ?? 'published') === 'published' && opts.actorId !== null;
  /**
   * E-1: a human publish closes the editorial loop, but only if nothing is still owed to the
   * remote. While a sync link is `conflict` or `pending_push` the flag is not stale editorial
   * state — it is a live "the source and the item disagree" that publishing does not settle — so
   * the flag is kept and its reason restated from the current link state rather than cleared.
   */
  const sync = humanPublish ? await getDocumentSyncState(tx, id) : null;
  const keepFlag = sync !== null && sync.flagReason !== null;
  await tx.query(
    `update documents set current_version=$2, status=$3, updated_by=$4, updated_at=now(), etag=gen_random_uuid()::text,
            published_at=now()${humanPublish ? ', approver_id=$4' : ''}${
              humanPublish && !keepFlag
                ? `,
            source_review_needed=false, source_review_reason=null, source_review_at=null`
                : ''
            }${
              keepFlag
                ? `,
            source_review_needed=true, source_review_reason=$5, source_review_at=now()`
                : ''
            }
      where id=$1`,
    keepFlag ? [id, version, status, opts.actorId, sync.flagReason] : [id, version, status, opts.actorId],
  );
  const published = (await getDocument(tx, id))!;
  const sourceVersion =
    opts.sourceVersion ??
    ((await tx.query(`select current_version from source_documents where document_id=$1`, [id])).rows[0]
      ?.current_version as number | undefined) ??
    null;
  const inserted = await tx.query(
    'insert into document_versions(document_id, version, snapshot, author_id, label, kind, suggestion_id, schema_version, source_version) values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id',
    [
      id,
      version,
      JSON.stringify(published),
      opts.actorId,
      opts.label,
      opts.kind ?? 'published',
      opts.suggestionId ?? null,
      CURRENT_DOCUMENT_SCHEMA_VERSION,
      sourceVersion,
    ],
  );
  return { doc: published, version, versionId: inserted.rows[0].id as string };
}

export interface VersionRow {
  documentId: string;
  version: number;
  kind: 'published' | 'restore' | 'system' | 'sync';
  label: string;
  authorId: string | null;
  authorName: string;
  createdAt: string;
  suggestionId: string | null;
}

export async function listVersions(q: Q, id: string): Promise<VersionRow[]> {
  const r = await q.query(
    'select v.*, u.display_name from document_versions v left join users u on u.id=v.author_id where v.document_id=$1 order by v.version',
    [id],
  );
  return r.rows.map((v) => ({
    documentId: v.document_id,
    version: v.version,
    kind: v.kind,
    label: v.label,
    authorId: v.author_id,
    authorName: v.display_name ?? 'מערכת',
    createdAt: iso(v.created_at)!,
    suggestionId: v.suggestion_id ?? null,
  }));
}

/**
 * The `DocumentSchema` version `document_versions.snapshot` rows are written under.
 * Bump this and add an entry to `SNAPSHOT_MIGRATIONS` keyed by the *old* version whenever
 * a change to `DocumentSchema` stops it from parsing snapshots written under the previous
 * version — see `parseSnapshot` below (backend review deferred minor #15).
 */
export const CURRENT_DOCUMENT_SCHEMA_VERSION = 1;

/** `oldVersion -> (raw snapshot as stored) -> raw snapshot shaped for oldVersion + 1`. */
const SNAPSHOT_MIGRATIONS: Record<number, (raw: unknown) => unknown> = {};

/**
 * Parses a stored snapshot against `DocumentSchema`, running it through every migration
 * step between the version it was written under and `CURRENT_DOCUMENT_SCHEMA_VERSION`
 * first. Rows written before this column existed default to `schema_version = 1` (the
 * only version that has ever existed), so this is a no-op today and only changes
 * behaviour once `DocumentSchema` actually changes shape. A snapshot that still fails to
 * parse after migration is a genuine data problem, not a crash: it surfaces as a clean
 * 410 instead of an unhandled 500 (the failure mode the review flagged).
 */
function parseSnapshot(raw: unknown, schemaVersion: number): Document {
  let migrated = raw;
  for (let v = schemaVersion; v < CURRENT_DOCUMENT_SCHEMA_VERSION; v++) {
    const step = SNAPSHOT_MIGRATIONS[v];
    if (step) migrated = step(migrated);
  }
  const parsed = DocumentSchema.safeParse(migrated);
  if (!parsed.success) {
    throw httpError(
      410,
      'VERSION_SCHEMA_UNSUPPORTED',
      'גרסה זו נשמרה בפורמט שאינו נתמך יותר ואינה ניתנת להצגה',
    );
  }
  return parsed.data;
}

export async function getVersion(q: Q, id: string, v: number): Promise<Document | null> {
  const r = await q.query(
    'select snapshot, schema_version from document_versions where document_id=$1 and version=$2',
    [id, v],
  );
  return r.rowCount ? parseSnapshot(r.rows[0].snapshot, (r.rows[0].schema_version as number) ?? 1) : null;
}

/**
 * Batch form of `getVersion`: one query for every version in `versions` instead of one
 * round trip per version. Used by `GET /documents/:id/diff`'s blame pass, which used to
 * call `getVersion` once per version in the [from, to] range.
 */
export async function getVersionsBatch(q: Q, id: string, versions: number[]): Promise<Map<number, Document>> {
  const out = new Map<number, Document>();
  if (!versions.length) return out;
  const r = await q.query(
    'select version, snapshot, schema_version from document_versions where document_id=$1 and version = any($2)',
    [id, versions],
  );
  for (const row of r.rows)
    out.set(row.version as number, parseSnapshot(row.snapshot, (row.schema_version as number) ?? 1));
  return out;
}

// ---------------------------------------------------------------------------
// Soft delete, pins, views, links, related
// ---------------------------------------------------------------------------

export async function softDelete(tx: Tx, id: string, userId: string): Promise<void> {
  const r = await tx.query(
    'update documents set deleted_at=now(), deleted_by=$2 where id=$1 and deleted_at is null returning id',
    [id, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  await tx.query('delete from pins where document_id=$1', [id]);
}

export const setPin = async (q: Q, userId: string, id: string, on: boolean): Promise<void> => {
  if (on)
    await q.query('insert into pins(user_id, document_id) values ($1,$2) on conflict do nothing', [
      userId,
      id,
    ]);
  else await q.query('delete from pins where user_id=$1 and document_id=$2', [userId, id]);
};

export const recordView = async (q: Q, userId: string, id: string): Promise<void> => {
  await q.query(
    'insert into recent_views(user_id, document_id) values ($1,$2) on conflict (user_id, document_id) do update set viewed_at=now(), count=recent_views.count+1',
    [userId, id],
  );
};

const mapLink = (r: Record<string, unknown>) => ({
  fromDocumentId: r.from_document_id as string,
  fromStepKey: (r.from_step_key as string | null) ?? null,
  toDocumentId: (r.to_document_id as string | null) ?? null,
  toBlockId: (r.to_block_id as string | null) ?? null,
  toFieldName: (r.to_field_name as string | null) ?? null,
  toSourceId: (r.to_source_id as string | null) ?? null,
  type: r.type as string,
  origin: r.origin as string,
});

export async function linksFor(q: Q, id: string, readUnpublished = true) {
  const vis = readUnpublished
    ? ''
    : ` and (l.to_document_id is null or exists (select 1 from documents t where t.id=l.to_document_id and ${visibleStatusSql('t')}))`;
  const visIn = visibleWhere(readUnpublished);
  const [out, incoming] = await Promise.all([
    q.query(`select l.* from document_links l where l.from_document_id=$1${vis}`, [id]),
    q.query(
      `select l.* from document_links l join documents d on d.id=l.from_document_id where l.to_document_id=$1 and d.deleted_at is null${visIn}`,
      [id],
    ),
  ]);
  return { out: out.rows.map(mapLink), in: incoming.rows.map(mapLink) };
}

/** Explicit related + linked docs + docs sharing a block + docs sharing ≥2 CRM fields (max 6). */
export async function relatedFor(q: Q, doc: Document, readUnpublished = true) {
  const out = new Map<string, string>();
  for (const r of doc.related) out.set(r.documentId, r.why);
  for (const l of (
    await q.query(
      'select distinct to_document_id id from document_links where from_document_id=$1 and to_document_id is not null',
      [doc.id],
    )
  ).rows)
    if (!out.has(l.id)) out.set(l.id, 'מקושר מהמסמך');
  for (const r of (
    await q.query(
      `select distinct d.id, b.title from steps s join blocks b on b.id=s.block_id join documents d on d.id=s.document_id
       where s.block_id in (select block_id from steps where document_id=$1 and block_id is not null)
         and d.id<>$1 and d.deleted_at is null`,
      [doc.id],
    )
  ).rows)
    if (!out.has(r.id)) out.set(r.id, 'בלוק משותף: ' + r.title);
  for (const r of (
    await q.query(
      `select s2.document_id id, count(distinct f2.field_name) n
       from step_field_refs f1 join steps s1 on s1.id=f1.step_id
       join step_field_refs f2 on f2.field_name=f1.field_name join steps s2 on s2.id=f2.step_id
       where s1.document_id=$1 and s2.document_id<>$1 group by 1 having count(distinct f2.field_name)>=2`,
      [doc.id],
    )
  ).rows)
    if (!out.has(r.id)) out.set(r.id, 'משתף ' + r.n + ' שדות CRM');
  const ids = [...out.keys()].slice(0, 6);
  if (!ids.length) return [];
  const docs = await q.query(
    `select id, title, category from documents where id = any($1) and deleted_at is null${visibleWhere(
      readUnpublished,
      null,
    )}`,
    [ids],
  );
  return docs.rows.map((d) => ({
    documentId: d.id as string,
    title: d.title as string,
    category: d.category as string,
    why: out.get(d.id)!,
  }));
}

export const hasPublishedVersion = async (q: Q, id: string): Promise<boolean> =>
  ((await q.query(`select 1 from document_versions where document_id=$1 and kind='published' limit 1`, [id]))
    .rowCount ?? 0) > 0;

/** PRD §10: once-published items are never deleted; they move to 'invalid' or 'archived' (or back to 'draft' to be reworked). */
export async function setStatus(
  tx: Tx,
  id: string,
  status: 'invalid' | 'archived' | 'draft',
  userId: string,
): Promise<Document> {
  const r = await tx.query(
    `update documents set status=$2, updated_by=$3, updated_at=now(), etag=gen_random_uuid()::text
      where id=$1 and deleted_at is null returning id`,
    [id, status, userId],
  );
  if (!r.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  return (await getDocument(tx, id))!;
}

export async function restoreVersion(tx: Tx, id: string, v: number, userId: string) {
  const snap = await getVersion(tx, id, v);
  if (!snap) throw httpError(404, 'NOT_FOUND', 'הגרסה לא נמצאה');
  await saveStructure(tx, id, { phases: snap.phases, related: snap.related }, userId);
  const r = await publishDocument(tx, id, {
    actorId: userId,
    label: 'שוחזר מגרסה v' + v,
    kind: 'restore',
  });
  return r;
}
