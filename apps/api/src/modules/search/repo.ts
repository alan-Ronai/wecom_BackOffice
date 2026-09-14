import type { ModelClient } from '@wecom/model';
import type { SearchHit, SearchQuery, SearchResponse } from '@wecom/shared';
import type pg from 'pg';
import { getDocument, recomputeDerived, type Q } from '../documents/repo.js';
import { htmlToText } from '../scripts/html.js';
import { withTransaction } from '../../lib/sql.js';
import { visibleWhere } from '../../lib/visibility.js';

/** Hebrew category labels, mirroring the legacy `KB.CATS`. */
export const CATEGORY_LABELS: Record<string, string> = {
  sim: 'SIM / eSIM',
  tech: 'תמיכה טכנית',
  billing: 'חיובים',
  plans: 'מסלולים',
  intl: 'חו"ל ונדידה',
  ops: 'טיפול בשיחה',
};
/** The static library file a hit would have come from, kept for the "N קבצים" counter. */
export const sourceFile = (category: string) => (category === 'intl' ? 'intl-roaming.json' : 'topics.json');

export type SearchGroupType = SearchResponse['groups'][number]['type'];
const GROUP_ORDER: SearchGroupType[] = ['blocks', 'steps', 'documents', 'tags', 'fields', 'scripts'];
const ALL_TYPES = new Set(GROUP_ORDER);

const words = (q: string) => q.trim().split(/\s+/).filter(Boolean);

const wordClause = (cols: string[], w: string, params: unknown[]): string => {
  params.push(w);
  const i = '$' + params.length;
  return '(' + cols.map((c) => `${c} ilike '%' || ${i} || '%'`).join(' or ') + ')';
};
/** Documents and steps must contain every word: "ריענון sim" is one step, not two results. */
const allWords = (cols: string[], ws: string[], params: unknown[]): string =>
  ws.map((w) => wordClause(cols, w, params)).join(' and ');
/** Catalogue entries (blocks, CRM fields, scripts) match any single word of the query. */
const anyWord = (cols: string[], ws: string[], params: unknown[]): string =>
  ws.map((w) => wordClause(cols, w, params)).join(' or ');

/**
 * `worldScopes` is the caller's `user_roles.world_scope` union (null = every world) and
 * narrows every document-bearing group by INTERSECTION with `document_worlds`. Blocks and
 * CRM fields are catalogue-wide and carry no world, so they are not narrowed.
 */
export async function search(
  q: Q,
  query: SearchQuery,
  model: ModelClient | null = null,
  worldScopes: readonly string[] | null = null,
  readUnpublished = true,
): Promise<SearchResponse> {
  const started = Date.now();
  /** W2 visibility: a read-only role never sees unpublished documents (or their steps). */
  const visTerm = visibleWhere(readUnpublished);
  const text = query.q.trim();
  const requested = query.types
    ? new Set(query.types.split(',').map((t) => t.trim()) as SearchGroupType[])
    : ALL_TYPES;
  const want = (t: SearchGroupType) => requested.has(t);
  const limit = query.limit;
  if (!text) return { groups: [], total: 0, tookMs: Date.now() - started, files: 0 };
  const ws = words(text);
  const files = new Set<string>();
  /** Appends the world-scope intersection term when the caller is scoped. */
  const scopeTerm = (params: unknown[]): string => {
    if (!worldScopes) return '';
    params.push([...worldScopes]);
    return ` and exists (select 1 from document_worlds sw where sw.document_id = d.id and sw.world_slug = any($${params.length}))`;
  };
  /** The `TaxonomyFilterSchema` facets, as SQL over `d`. */
  const taxTerm = (params: unknown[]): string => {
    const t: string[] = [];
    if (query.world) {
      params.push(query.world);
      t.push(
        `exists (select 1 from document_worlds fw where fw.document_id = d.id and fw.world_slug = $${params.length})`,
      );
    }
    if (query.topic) {
      params.push(query.topic);
      t.push(
        `exists (select 1 from document_topics ft where ft.document_id = d.id and ft.topic_id = $${params.length})`,
      );
    }
    if (query.docType) {
      params.push(query.docType);
      t.push(`d.doc_type = $${params.length}`);
    }
    if (query.tag?.length) {
      params.push(query.tag);
      t.push(`d.tags @> $${params.length}::text[]`);
    }
    return t.length ? ' and ' + t.join(' and ') : '';
  };

  // steps -------------------------------------------------------------------
  const stepHits: SearchHit[] = [];
  if (want('steps')) {
    const params: unknown[] = [];
    const cond = allWords(
      [
        's.title',
        "coalesce(s.description,'')",
        "coalesce((select string_agg(a.text, ' ') from step_actions a where a.step_id=s.id),'')",
        "coalesce(s.script,'')",
        "coalesce(b.title,'')",
      ],
      ws,
      params,
    );
    const stepScope = scopeTerm(params);
    const stepTax = taxTerm(params);
    params.push(limit);
    const r = await q.query(
      `select s.document_id, d.title doc_title, d.category, s.step_key, s.num, s.title, p.label phase_label,
              s.block_id, b.title block_title,
              (select a.text from step_actions a where a.step_id=s.id order by a.position limit 1) first_action
       from steps s join documents d on d.id=s.document_id join phases p on p.id=s.phase_id
       left join blocks b on b.id=s.block_id
       where d.deleted_at is null and (${cond})${stepScope}${stepTax}${visTerm}
       order by d.title, s.position limit $${params.length}`,
      params,
    );
    for (const x of r.rows) {
      files.add(sourceFile(x.category as string));
      const meta = [
        sourceFile(x.category as string),
        CATEGORY_LABELS[x.category as string] ?? x.category,
        x.phase_label || null,
        x.block_title ? '⧉ ' + x.block_title : null,
      ]
        .filter(Boolean)
        .join(' · ');
      stepHits.push({
        type: 'step',
        id: `${x.document_id}#${x.step_key}`,
        title: x.title as string,
        snippet: (x.first_action as string | null) ?? (x.doc_title as string),
        meta,
        score: 1,
        documentId: x.document_id as string,
        stepKey: x.step_key as string,
        num: x.num as string,
      });
    }
  }

  // documents ---------------------------------------------------------------
  // Metadata-level matches only: a document whose body matched is already represented by its
  // step hits, so listing it again would duplicate the same result.
  const coveredByStep = new Set(stepHits.map((h) => h.documentId!));
  const docHits: SearchHit[] = [];
  if (want('documents')) {
    const params: unknown[] = [text];
    const cond = allWords(['d.title', "coalesce(d.description,'')", "coalesce(d.code,'')"], ws, params);
    const docScope = scopeTerm(params);
    const docTax = taxTerm(params);
    // Prefix-match the last word (palette-friendly incremental search), so the palette ranks
    // "רענ" as a hit for "ריענון" before the whole word is typed. `kb_tsquery_prefix`
    // (migration 0027) tokenises and strips stopwords through exactly the pipeline the
    // `search_vector` trigger uses, and quotes each lexeme, so a query made of tsquery syntax
    // characters is data rather than operators and needs no separate escape pass here.
    const rankExpr = `ts_rank(d.search_vector, kb_tsquery_prefix($1))`;
    params.push(limit);
    const r = await q.query(
      `select d.id, d.title, d.description, d.category, d.current_version,
              ${rankExpr} + similarity(d.title, $1) score
       from documents d where d.deleted_at is null and (${cond})${docScope}${docTax}${visTerm}
       order by score desc, d.title limit $${params.length}`,
      params,
    );
    for (const x of r.rows) {
      if (coveredByStep.has(x.id as string)) continue;
      files.add(sourceFile(x.category as string));
      docHits.push({
        type: 'document',
        id: x.id as string,
        title: x.title as string,
        snippet: (x.description as string) || '',
        meta: [
          sourceFile(x.category as string),
          CATEGORY_LABELS[x.category as string],
          'v' + x.current_version,
        ]
          .filter(Boolean)
          .join(' · '),
        score: Number(x.score ?? 0),
        documentId: x.id as string,
      });
    }
    if (model?.embed && text.length > 3 && docHits.length > 1) await rerank(q, docHits, text, model);
  }

  // tags --------------------------------------------------------------------
  const tagHits: SearchHit[] = [];
  if (want('tags')) {
    const params: unknown[] = [ws];
    const scope = scopeTerm(params);
    const tax = taxTerm(params);
    params.push(limit);
    const r = await q.query(
      `select d.id, d.title, d.category, d.tags from documents d
        where d.deleted_at is null and d.tags && $1::text[]${scope}${tax}${visTerm} order by d.title limit $${params.length}`,
      params,
    );
    for (const x of r.rows) {
      files.add(sourceFile(x.category as string));
      const matched = (x.tags as string[]).filter((t) => ws.includes(t));
      tagHits.push({
        type: 'document',
        id: x.id as string,
        title: x.title as string,
        snippet: (x.tags as string[]).join(' · '),
        meta: 'תגית: ' + matched.join(', '),
        score: 1,
        documentId: x.id as string,
      });
    }
  }

  // blocks ------------------------------------------------------------------
  const blockHits: SearchHit[] = [];
  if (want('blocks')) {
    const params: unknown[] = [];
    const cond = anyWord(
      [
        'b.title',
        "coalesce(b.description,'')",
        "coalesce(b.script,'')",
        "coalesce((select string_agg(a.text, ' ') from block_actions a where a.block_id=b.id),'')",
      ],
      ws,
      params,
    );
    params.push(limit);
    const r = await q.query(
      `select b.id, b.title, b.kind, b.current_version,
              (select a.text from block_actions a where a.block_id=b.id order by a.position limit 1) first_action,
              (select count(*)::int from steps s where s.block_id=b.id or b.id = any(s.block_refs)) used
       from blocks b where b.deleted_at is null and (${cond}) order by b.title limit $${params.length}`,
      params,
    );
    for (const x of r.rows)
      blockHits.push({
        type: 'block',
        id: x.id as string,
        title: x.title as string,
        snippet: (x.first_action as string | null) ?? '',
        meta: `בלוק משותף · ${x.kind === 'script' ? 'תסריט' : 'שלב'} · v${x.current_version} · ${x.used} שימושים`,
        score: 1,
      });
  }

  // fields ------------------------------------------------------------------
  const fieldHits: SearchHit[] = [];
  if (want('fields')) {
    const params: unknown[] = [];
    const cond = anyWord(['f.name', "coalesce(f.path,'')", "coalesce(f.note,'')"], ws, params);
    params.push(limit);
    const r = await q.query(
      `select f.name, f.status, f.path from crm_fields f where f.deleted_at is null and (${cond}) order by f.name limit $${params.length}`,
      params,
    );
    for (const x of r.rows) {
      files.add('crm-fields.json');
      fieldHits.push({
        type: 'field',
        id: x.name as string,
        title: x.name as string,
        snippet: (x.path as string) || '',
        meta: `crm-fields.json · ${x.status}`,
        score: 1,
      });
    }
  }

  // scripts -----------------------------------------------------------------
  const scriptHits: SearchHit[] = [];
  if (want('scripts')) {
    const params: unknown[] = [];
    const cond = anyWord(['d.title', "coalesce(d.body_html,'')"], ws, params);
    const scope = scopeTerm(params);
    params.push(limit);
    const r = await q.query(
      `select d.id, d.title, coalesce(d.body_html,'') body from documents d
        where d.deleted_at is null and d.doc_type = 'T' and d.kind = 'text' and (${cond})${scope}${visTerm} order by d.title limit $${params.length}`,
      params,
    );
    for (const x of r.rows) {
      files.add('scripts.json');
      scriptHits.push({
        type: 'script',
        id: x.id as string,
        title: x.title as string,
        snippet: htmlToText(x.body as string),
        meta: 'scripts.json',
        score: 1,
      });
    }
  }

  const byType: Record<SearchGroupType, SearchHit[]> = {
    blocks: blockHits,
    steps: stepHits,
    documents: docHits,
    fields: fieldHits,
    scripts: scriptHits,
    tags: tagHits,
    actions: [],
  };
  const groups = GROUP_ORDER.filter((t) => byType[t].length).map((type) => ({ type, hits: byType[type] }));
  return {
    groups,
    total: groups.reduce((a, g) => a + g.hits.length, 0),
    tookMs: Date.now() - started,
    files: files.size,
  };
}

/** Blend the text score with cosine similarity against the query embedding (0.6 text / 0.4 vector). */
async function rerank(q: Q, hits: SearchHit[], text: string, model: ModelClient): Promise<void> {
  let vec: number[];
  try {
    vec = await model.embed!(text);
  } catch {
    return;
  }
  const top = hits.slice(0, 20).map((h) => h.id);
  const r = await q.query(
    'select id, 1 - (embedding <=> $2::vector) sim from documents where id = any($1) and embedding is not null',
    [top, JSON.stringify(vec)],
  );
  const sims = new Map(r.rows.map((x) => [x.id as string, Number(x.sim)]));
  if (!sims.size) return;
  const max = Math.max(...hits.map((h) => h.score), 1);
  for (const h of hits) h.score = 0.6 * (h.score / max) + 0.4 * (sims.get(h.id) ?? 0);
  hits.sort((a, b) => b.score - a.score);
}

/**
 * Embeds a document's title + description + derived search text and stores it in
 * `documents.embedding`, so the vector re-rank path in `search()` has something to
 * compare against. Best-effort: swallows model errors (an unreachable/disabled model
 * just means search stays text-only, same as before this existed) and no-ops when the
 * model has no `embed` method. The embedding input is capped at ~8000 chars — plenty for
 * a title/description/step-text summary and comfortably under typical embedding-model
 * context limits.
 */
export async function updateEmbedding(
  q: Q,
  id: string,
  model: ModelClient | null | undefined,
): Promise<boolean> {
  if (!model?.embed) return false;
  const r = await q.query(
    "select title, coalesce(description,'') description, coalesce(search_text,'') search_text from documents where id=$1 and deleted_at is null",
    [id],
  );
  if (!r.rowCount) return false;
  const {
    title,
    description,
    search_text: searchText,
  } = r.rows[0] as {
    title: string;
    description: string;
    search_text: string;
  };
  const text = [title, description, searchText].filter(Boolean).join('\n').slice(0, 8000);
  if (!text) return false;
  try {
    const vec = await model.embed(text);
    await q.query('update documents set embedding=$2::vector where id=$1', [id, JSON.stringify(vec)]);
    return true;
  } catch {
    return false;
  }
}

/**
 * `search.reindex` worker body: recompute derived text for every live document, and —
 * when a model with `embed` is available — its embedding too.
 *
 * The embedding call is deliberately **outside** the transaction. `updateEmbedding` is an HTTP
 * round trip to the model, and the target architecture is a CPU-local model where that is
 * seconds rather than milliseconds; doing it inside `withTransaction` pinned a pool connection
 * and held an open transaction for the whole call, so a 5,000-document reindex — which
 * `docs/operations.md` tells operators to run after any `EMBED_MODEL` change — held one for
 * hours. The publish path already gets this right and says why
 * (`documents/routes.ts`: a model outage must never fail a publish); the worker now matches it.
 *
 * The derived-text recompute keeps its transaction, because that is several dependent writes.
 * The embedding is a single `update`, so a re-run converges and a crash halfway leaves stale
 * vectors rather than corrupt ones.
 */
export async function reindexAll(pool: pg.Pool, model?: ModelClient | null): Promise<number> {
  const ids = (await pool.query('select id from documents where deleted_at is null')).rows.map(
    (r) => r.id as string,
  );
  let n = 0;
  for (const id of ids) {
    const recomputed = await withTransaction(pool, async (tx) => {
      const doc = await getDocument(tx, id);
      if (!doc) return false;
      await recomputeDerived(tx, doc);
      return true;
    });
    if (!recomputed) continue;
    n++;
    // On the pool, after the commit: the text it embeds is the text that was just written.
    await updateEmbedding(pool, id, model);
  }
  return n;
}
