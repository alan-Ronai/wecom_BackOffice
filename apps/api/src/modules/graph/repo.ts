import type { GraphEdge, GraphNode } from '@wecom/shared';
import type { Q } from '../documents/repo.js';

/** `@wecom/shared` exports `LinkTypeSchema` but no inferred alias; the edge carries it. */
export type LinkType = GraphEdge['type'];

/* ── node ids ───────────────────────────────────────────────────────────── */

/** The `doc:` prefix is the contract's spelling; the node kind is `document`. */
const PREFIX_TO_KIND = {
  doc: 'document',
  block: 'block',
  field: 'field',
  source: 'source',
  script: 'script',
} as const;
const KIND_TO_PREFIX = {
  document: 'doc',
  block: 'block',
  field: 'field',
  source: 'source',
  script: 'script',
} as const;

export type NodeKind = GraphNode['kind'];
export interface NodeRef {
  kind: NodeKind;
  key: string;
}

export const nodeId = (kind: NodeKind, key: string): string => `${KIND_TO_PREFIX[kind]}:${key}`;

/** `field:` keys are CRM field names, which are Hebrew and may contain `:` themselves. */
export function parseNodeId(raw: string): NodeRef | null {
  const at = raw.indexOf(':');
  if (at <= 0) return null;
  const prefix = raw.slice(0, at) as keyof typeof PREFIX_TO_KIND;
  const kind = PREFIX_TO_KIND[prefix];
  if (!kind) return null;
  const key = raw.slice(at + 1);
  return key ? { kind, key } : null;
}

/* ── loading ────────────────────────────────────────────────────────────── */

export interface GraphFilter {
  types?: LinkType[];
  kinds?: NodeKind[];
  category?: string;
}

export interface GraphData {
  nodes: Map<string, GraphNode>;
  edges: GraphEdge[];
  adjacency: Map<string, Set<string>>;
}

const edgeKey = (e: GraphEdge) => `${e.from}|${e.to}|${e.type}|${e.fromStepKey ?? ''}`;

/**
 * The whole connected-data graph, assembled from the derived tables L2 already maintains:
 * `document_links` (explicit + detected), `steps.block_id`/`steps.block_refs`,
 * `step_field_refs`, `documents.source_id` and `script_refs`. Everything is loaded once and
 * traversed in memory — this is a single-tenant LAN KB, so the whole graph is a few
 * thousand rows and a per-request round trip per BFS level would cost far more.
 */
export async function loadGraph(q: Q, filter: GraphFilter = {}): Promise<GraphData> {
  const [documents, blocks, fields, sources, scripts, links, blockUse, fieldUse, docSources, scriptUse] =
    await Promise.all([
      q.query('select id, title, category, status from documents where deleted_at is null'),
      q.query('select id, title from blocks where deleted_at is null'),
      q.query('select name, status from crm_fields where deleted_at is null'),
      q.query('select id, title, kind from sources where deleted_at is null'),
      q.query('select id, title from scripts where deleted_at is null'),
      q.query(
        `select l.from_document_id, l.from_step_key, l.to_document_id, l.to_block_id, l.to_field_name,
                l.to_source_id, l.type, l.origin
           from document_links l
           join documents d on d.id = l.from_document_id and d.deleted_at is null`,
      ),
      q.query(
        `select s.document_id, s.step_key, b.id as block_id
           from steps s
           join documents d on d.id = s.document_id and d.deleted_at is null
           join blocks b on b.deleted_at is null and (b.id = s.block_id or b.id = any(s.block_refs))`,
      ),
      q.query(
        `select s.document_id, s.step_key, r.field_name
           from step_field_refs r
           join steps s on s.id = r.step_id
           join documents d on d.id = s.document_id and d.deleted_at is null`,
      ),
      q.query('select id, source_id from documents where deleted_at is null and source_id is not null'),
      q.query(
        `select r.document_id, r.step_key, r.script_id
           from script_refs r
           join documents d on d.id = r.document_id and d.deleted_at is null`,
      ),
    ]);

  const kinds = filter.kinds?.length ? new Set<NodeKind>(filter.kinds) : null;
  const types = filter.types?.length ? new Set<LinkType>(filter.types) : null;
  const nodes = new Map<string, GraphNode>();
  const add = (kind: NodeKind, key: string, node: Omit<GraphNode, 'id' | 'kind' | 'degree'>) => {
    if (kinds && !kinds.has(kind)) return;
    const id = nodeId(kind, key);
    nodes.set(id, { ...node, id, kind, degree: 0 });
  };

  for (const d of documents.rows) {
    if (filter.category && d.category !== filter.category) continue;
    add('document', d.id as string, {
      label: d.title as string,
      category: d.category as GraphNode['category'],
      status: d.status as string,
    });
  }
  for (const b of blocks.rows) add('block', b.id as string, { label: b.title as string });
  for (const f of fields.rows)
    add('field', f.name as string, { label: f.name as string, status: f.status as string });
  for (const s of sources.rows)
    add('source', s.id as string, { label: s.title as string, meta: { kind: s.kind as string } });
  for (const s of scripts.rows) add('script', s.id as string, { label: s.title as string });

  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  const push = (
    from: string,
    to: string | null,
    type: LinkType,
    fromStepKey: string | null,
    origin: GraphEdge['origin'],
  ) => {
    if (!to || from === to) return;
    if (types && !types.has(type)) return;
    if (!nodes.has(from) || !nodes.has(to)) return;
    const e: GraphEdge = { from, to, type, fromStepKey, origin };
    const k = edgeKey(e);
    if (seen.has(k)) return;
    seen.add(k);
    edges.push(e);
  };

  for (const l of links.rows) {
    const to =
      (l.to_document_id && nodeId('document', l.to_document_id as string)) ||
      (l.to_block_id && nodeId('block', l.to_block_id as string)) ||
      (l.to_field_name && nodeId('field', l.to_field_name as string)) ||
      (l.to_source_id && nodeId('source', l.to_source_id as string)) ||
      null;
    push(
      nodeId('document', l.from_document_id as string),
      to,
      l.type as LinkType,
      (l.from_step_key as string | null) ?? null,
      (l.origin as string) === 'explicit' ? 'explicit' : 'detected',
    );
  }
  for (const r of blockUse.rows)
    push(
      nodeId('document', r.document_id as string),
      nodeId('block', r.block_id as string),
      'shares_block',
      r.step_key as string,
      'detected',
    );
  for (const r of fieldUse.rows)
    push(
      nodeId('document', r.document_id as string),
      nodeId('field', r.field_name as string),
      'same_field',
      r.step_key as string,
      'detected',
    );
  for (const r of docSources.rows)
    push(
      nodeId('document', r.id as string),
      nodeId('source', r.source_id as string),
      'derived_from_source',
      null,
      'explicit',
    );
  for (const r of scriptUse.rows)
    push(
      nodeId('document', r.document_id as string),
      nodeId('script', r.script_id as string),
      'link',
      (r.step_key as string | null) ?? null,
      'explicit',
    );

  const adjacency = new Map<string, Set<string>>();
  const link = (a: string, b: string) => {
    const set = adjacency.get(a);
    if (set) set.add(b);
    else adjacency.set(a, new Set([b]));
  };
  for (const e of edges) {
    link(e.from, e.to);
    link(e.to, e.from);
  }
  for (const [id, set] of adjacency) {
    const n = nodes.get(id);
    if (n) n.degree = set.size;
  }
  return { nodes, edges, adjacency };
}

/* ── traversal ──────────────────────────────────────────────────────────── */

export interface GraphSelection {
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

/**
 * BFS from `focus` out to `depth` hops, stopping at `limit` nodes (`truncated` then says so).
 * Without a focus the densest `limit` nodes are returned instead, which is what an
 * un-focused "show me the map" request wants.
 */
export function selectGraph(
  data: GraphData,
  opts: { focus?: string; depth: number; limit: number },
): GraphSelection {
  const all = [...data.nodes.values()];
  let picked: GraphNode[];
  let truncated = false;
  if (opts.focus) {
    const start = data.nodes.get(opts.focus);
    if (!start) return { nodes: [], edges: [], truncated: false };
    const kept = new Set<string>([start.id]);
    let frontier = [start.id];
    for (let d = 0; d < opts.depth && frontier.length && kept.size < opts.limit; d++) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const neighbour of data.adjacency.get(id) ?? []) {
          if (kept.has(neighbour)) continue;
          if (kept.size >= opts.limit) {
            truncated = true;
            break;
          }
          kept.add(neighbour);
          next.push(neighbour);
        }
        if (truncated) break;
      }
      frontier = next;
    }
    picked = [...kept].map((id) => data.nodes.get(id)!);
  } else {
    const sorted = all.sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label, 'he'));
    truncated = sorted.length > opts.limit;
    picked = sorted.slice(0, opts.limit);
  }
  const ids = new Set(picked.map((n) => n.id));
  return { nodes: picked, edges: data.edges.filter((e) => ids.has(e.from) && ids.has(e.to)), truncated };
}

/* ── impact ─────────────────────────────────────────────────────────────── */

export interface InboundRow {
  documentId: string;
  title: string;
  stepKey: string | null;
  type: LinkType;
}

/** Every live document that points at the node, however the reference is recorded. */
export async function inboundFor(q: Q, ref: NodeRef): Promise<InboundRow[]> {
  const parts: { sql: string; params: unknown[] }[] = [];
  const linkColumn = {
    document: 'to_document_id',
    block: 'to_block_id',
    field: 'to_field_name',
    source: 'to_source_id',
    script: null,
  }[ref.kind];
  if (linkColumn)
    parts.push({
      sql: `select d.id, d.title, l.from_step_key as step_key, l.type
              from document_links l join documents d on d.id = l.from_document_id and d.deleted_at is null
             where l.${linkColumn} = $1`,
      params: [ref.key],
    });
  if (ref.kind === 'block')
    parts.push({
      sql: `select d.id, d.title, s.step_key, 'shares_block' as type
              from steps s join documents d on d.id = s.document_id and d.deleted_at is null
             where s.block_id = $1 or $1 = any(s.block_refs)`,
      params: [ref.key],
    });
  if (ref.kind === 'field')
    parts.push({
      sql: `select d.id, d.title, s.step_key, 'same_field' as type
              from step_field_refs r join steps s on s.id = r.step_id
              join documents d on d.id = s.document_id and d.deleted_at is null
             where r.field_name = $1`,
      params: [ref.key],
    });
  if (ref.kind === 'source')
    parts.push({
      sql: `select d.id, d.title, null as step_key, 'derived_from_source' as type
              from documents d where d.deleted_at is null and d.source_id = $1`,
      params: [ref.key],
    });
  if (ref.kind === 'script')
    parts.push({
      sql: `select d.id, d.title, r.step_key, 'link' as type
              from script_refs r join documents d on d.id = r.document_id and d.deleted_at is null
             where r.script_id = $1`,
      params: [ref.key],
    });

  const out = new Map<string, InboundRow>();
  for (const p of parts)
    for (const r of (await q.query(p.sql, p.params)).rows) {
      const row: InboundRow = {
        documentId: r.id as string,
        title: r.title as string,
        stepKey: (r.step_key as string | null) ?? null,
        type: r.type as LinkType,
      };
      out.set(`${row.documentId}|${row.stepKey ?? ''}|${row.type}`, row);
    }
  return [...out.values()].sort(
    (a, b) => a.title.localeCompare(b.title, 'he') || (a.stepKey ?? '').localeCompare(b.stepKey ?? ''),
  );
}

/**
 * References recorded against a step key that no longer exists in the referring document —
 * the links that are already dangling and would stay dangling if the node went away.
 */
export async function brokenLinkCount(q: Q, ref: NodeRef): Promise<number> {
  const column = {
    document: 'to_document_id',
    block: 'to_block_id',
    field: 'to_field_name',
    source: 'to_source_id',
    script: null,
  }[ref.kind];
  if (!column) return 0;
  const r = await q.query(
    `select count(*)::int n from document_links l
      where l.${column} = $1 and l.from_step_key is not null
        and not exists (select 1 from steps s where s.document_id = l.from_document_id and s.step_key = l.from_step_key)`,
    [ref.key],
  );
  return r.rows[0].n as number;
}
