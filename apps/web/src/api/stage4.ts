/**
 * Stage 4 ("connected data") API surface: graph, field/block pages, the data explorer and the
 * dashboards.
 *
 * Transport is the **generated** client (`api`, typed by `schema.d.ts` from
 * `docs/api/openapi.json`), like every other call in this app — there is exactly one contract and
 * a route that changes shape becomes a typecheck error here rather than a runtime `TypeError` in
 * front of a user. See `README.md`: no second, hand-maintained contract.
 *
 * The exported *types*, though, are `z.infer` off the shared zod schemas in
 * `packages/shared/src/schemas/stage45.ts`, which are what validate these routes server-side and
 * what the OpenAPI file is generated from. Annotating each function with the zod type while the
 * body returns the generated one makes the two sides check against each other: if the published
 * contract ever drifts from the schema that is supposed to produce it, this file stops compiling.
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
import { api, apiUpload } from './client.js';
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

/* ── graph ────────────────────────────────────────────────────────────────── */

export const getGraph = async (query: GraphQuery = {}): Promise<GraphResponse> =>
  unwrap(await api.GET('/graph', { params: { query } }));

/**
 * A node id is `<kind>:<tail>` where the tail is free-form (`field:שירות נדידה`), so it is one
 * path segment — which `openapi-fetch` percent-encodes for us.
 */
export const getImpact = async (nodeId: string): Promise<ImpactResponse> =>
  unwrap(await api.GET('/graph/impact/{nodeId}', { params: { path: { nodeId } } }));

/* ── field & block pages ──────────────────────────────────────────────────── */

export const getFieldPage = async (name: string): Promise<FieldPage> =>
  unwrap(await api.GET('/fields/{name}/page', { params: { path: { name } } }));

export const renameField = async (name: string, body: FieldRenameBody): Promise<FieldRenameResult> =>
  unwrap(await api.POST('/fields/{name}/rename', { params: { path: { name } }, body }));

export const getBlockPage = async (id: string): Promise<BlockPage> =>
  unwrap(await api.GET('/blocks/{id}/page', { params: { path: { id } } }));

/* ── data explorer ────────────────────────────────────────────────────────── */

export const getDataFiles = async (): Promise<DataFilesResponse> => unwrap(await api.GET('/data/files'));

export const getDataPreview = async (sourceId: string, query: DataPreviewQuery = {}): Promise<DataPreview> =>
  unwrap(await api.GET('/data/files/{sourceId}/preview', { params: { path: { sourceId }, query } }));

export const putMapping = async (sourceId: string, body: PutMappingBody): Promise<DataFile> =>
  unwrap(await api.PUT('/data/files/{sourceId}/mapping', { params: { path: { sourceId } }, body }));

export const reimportDataFile = async (sourceId: string): Promise<ReimportResult> =>
  unwrap(await api.POST('/data/files/{sourceId}/reimport', { params: { path: { sourceId } } }));

/**
 * OpenAPI describes this route with a multipart body, which `openapi-fetch` cannot type or
 * serialise, so it goes through `apiUpload` — the same escape hatch `/sources/upload` uses. The
 * response is still the contract's `DataFile`.
 */
export const uploadDataFile = (file: File): Promise<DataFile> => {
  const form = new FormData();
  form.append('file', file);
  return apiUpload<DataFile>('/data/files', form).then(unwrap);
};

/* ── dashboards & telemetry ───────────────────────────────────────────────── */

export const getDashboards = async (): Promise<Dashboard> => unwrap(await api.GET('/dashboards'));

/** 204, so nothing is unwrapped — usage tiles are only real if the web actually reports. */
export const postTelemetry = async (body: TelemetryBatch): Promise<void> => {
  unwrap(await api.POST('/telemetry', { body }));
};
