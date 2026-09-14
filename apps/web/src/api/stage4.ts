/**
 * Stage 4 ("connected data") API surface: graph, field/block pages, the data explorer and the
 * dashboards.
 *
 * Every request and response below is typed with `z.infer` off the **zod schemas** in
 * `@wecom/shared` (`packages/shared/src/schemas/stage45.ts`), which are the contract that
 * `docs/api/openapi.json` is itself generated from — the same source of truth as the rest of the
 * app, one step upstream. Backend lane A is publishing these routes concurrently; until they
 * appear in the OpenAPI file the generated `paths` map has no entries for them, so `openapi-fetch`
 * cannot type the calls. When they land, each wrapper becomes a one-line `api.GET(...)` and the
 * exported types do not move.
 *
 * This is deliberately **not** a second hand-maintained contract (see `README.md`): nothing here
 * describes a shape, it only names a path and defers every shape to the shared schema.
 */
import type { z } from 'zod';
import type {
  BlockPageSchema,
  ColumnMappingSchema,
  DashboardSchema,
  DataFileSchema,
  DataFilesResponseSchema,
  DataPreviewQuerySchema,
  DataPreviewSchema,
  FieldPageSchema,
  FieldRenameBodySchema,
  FieldRenameResultSchema,
  GraphEdgeSchema,
  GraphNodeKindSchema,
  GraphNodeSchema,
  GraphQuerySchema,
  GraphResponseSchema,
  ImpactResponseSchema,
  MappingFieldSchema,
  PutMappingBodySchema,
  ReimportResultSchema,
  TelemetryBatchSchema,
} from '@wecom/shared';
import { API_BASE } from './client.js';
import { unwrap } from './unwrap.js';

/* ── types, every one of them inferred from the shared zod schemas ────────── */

export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphNodeKind = z.infer<typeof GraphNodeKindSchema>;
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
/** Every field of `GraphQuerySchema` is optional on the wire; the server applies the defaults. */
export type GraphQuery = Partial<z.output<typeof GraphQuerySchema>>;
export type ImpactResponse = z.infer<typeof ImpactResponseSchema>;
export type FieldPage = z.infer<typeof FieldPageSchema>;
export type FieldRenameBody = z.input<typeof FieldRenameBodySchema>;
export type FieldRenameResult = z.infer<typeof FieldRenameResultSchema>;
export type BlockPage = z.infer<typeof BlockPageSchema>;
export type DataFile = z.infer<typeof DataFileSchema>;
export type DataFilesResponse = z.infer<typeof DataFilesResponseSchema>;
export type DataPreview = z.infer<typeof DataPreviewSchema>;
export type DataPreviewQuery = Partial<z.output<typeof DataPreviewQuerySchema>>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
export type MappingField = z.infer<typeof MappingFieldSchema>;
export type PutMappingBody = z.input<typeof PutMappingBodySchema>;
export type ReimportResult = z.infer<typeof ReimportResultSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type TelemetryBatch = z.input<typeof TelemetryBatchSchema>;

/* ── transport ────────────────────────────────────────────────────────────── */

/**
 * Same base and same cookie policy as `api` (`credentials: 'include'`), and the same typed
 * `ApiError` on failure, so a stage-4 call is indistinguishable from a generated one at the call
 * site. `fetch` is resolved per call rather than captured, so msw (tests) and instrumentation
 * intercept it exactly as they do for `openapi-fetch`.
 */
async function s4<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await globalThis.fetch(`${API_BASE}${path}`, { credentials: 'include', ...init });
  const body: unknown = response.status === 204 ? undefined : await response.json().catch(() => undefined);
  return unwrap<T>(response.ok ? { data: body as T, response } : { error: body, response });
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

/** `?a=1&b=2`, skipping anything the caller left undefined. */
const qs = (q: Record<string, string | number | undefined>): string => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v !== undefined && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : '';
};

/**
 * Node ids carry a `kind:` prefix and a free-form tail (`field:שירות נדידה`), so the whole id is
 * one path segment and must be escaped as such.
 */
const seg = (v: string): string => encodeURIComponent(v);

/* ── graph ────────────────────────────────────────────────────────────────── */

export const getGraph = (q: GraphQuery = {}): Promise<GraphResponse> =>
  s4(
    `/graph${qs({
      focus: q.focus,
      depth: q.depth,
      types: q.types,
      category: q.category,
      kinds: q.kinds,
      limit: q.limit,
    })}`,
  );

export const getImpact = (nodeId: string): Promise<ImpactResponse> => s4(`/graph/impact/${seg(nodeId)}`);

/* ── field & block pages ──────────────────────────────────────────────────── */

export const getFieldPage = (name: string): Promise<FieldPage> => s4(`/fields/${seg(name)}/page`);

export const renameField = (name: string, body: FieldRenameBody): Promise<FieldRenameResult> =>
  s4(`/fields/${seg(name)}/rename`, json('POST', body));

export const getBlockPage = (id: string): Promise<BlockPage> => s4(`/blocks/${seg(id)}/page`);

/* ── data explorer ────────────────────────────────────────────────────────── */

export const getDataFiles = (): Promise<DataFilesResponse> => s4('/data/files');

export const getDataPreview = (sourceId: string, q: DataPreviewQuery = {}): Promise<DataPreview> =>
  s4(`/data/files/${seg(sourceId)}/preview${qs({ limit: q.limit })}`);

export const putMapping = (sourceId: string, body: PutMappingBody): Promise<DataFile> =>
  s4(`/data/files/${seg(sourceId)}/mapping`, json('PUT', body));

export const reimportDataFile = (sourceId: string): Promise<ReimportResult> =>
  s4(`/data/files/${seg(sourceId)}/reimport`, { method: 'POST' });

/** multipart — the body is `FormData`, so no content-type header (the browser sets the boundary). */
export const uploadDataFile = (file: File): Promise<DataFile> => {
  const form = new FormData();
  form.append('file', file);
  return s4('/data/files', { method: 'POST', body: form });
};

/* ── dashboards & telemetry ───────────────────────────────────────────────── */

export const getDashboards = (): Promise<Dashboard> => s4('/dashboards');

/** 204, so nothing is unwrapped — usage tiles are only real if the web actually reports. */
export const postTelemetry = (body: TelemetryBatch): Promise<void> => s4('/telemetry', json('POST', body));
