/**
 * Every type the API surface needs, derived from the **generated** contract (`schema.d.ts`,
 * produced from `docs/api/openapi.json`) or from `@wecom/shared`'s zod schemas.
 *
 * Nothing here is hand-shaped. If the backend changes a response, `pnpm generate:client` picks it
 * up and the mismatch becomes a typecheck error at the call site rather than a runtime `TypeError`.
 */
import type { z } from 'zod';
import type {
  AdminUserPatchSchema,
  AuditQuerySchema,
  CreateDocumentBodySchema,
  CreateNoteBodySchema,
  GroupMapPutSchema,
  PatchDocumentBodySchema,
  PublishBodySchema,
  RoleUpsertSchema,
  StructureBodySchema,
  UpsertBlockBodySchema,
  UpsertFieldBodySchema,
  UpsertScriptBodySchema,
} from '@wecom/shared';
import type { paths } from './schema.js';

/* ── generic accessors over the generated `paths` map ─────────────────────── */

type JsonOf<R> = R extends { content: { 'application/json': infer B } } ? B : never;
/** The 200/201 JSON body of `paths[P][M]`. */
export type Res<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends { responses: infer R }
  ? R extends { 200: infer Ok }
    ? JsonOf<Ok>
    : R extends { 201: infer Created }
      ? JsonOf<Created>
      : never
  : never;
/** The JSON request body of `paths[P][M]`. */
export type Body<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  requestBody?: infer B;
}
  ? JsonOf<NonNullable<B>>
  : never;
/** The querystring of `paths[P][M]`. */
export type Query<P extends keyof paths, M extends keyof paths[P]> = paths[P][M] extends {
  parameters: { query?: infer Q };
}
  ? NonNullable<Q>
  : never;
/** The element type of an `{ items: T[] }` envelope. */
export type ItemOf<T> = T extends { items: (infer E)[] } ? E : never;

/* ── query/body aliases (zod is still the source for request shapes) ──────── */

export type ListDocumentsQuery = Query<'/documents', 'get'>;
export type ListDocumentsResponse = Res<'/documents', 'get'>;
export type CreateDocumentBody = z.input<typeof CreateDocumentBodySchema>;
export type PatchDocumentBody = z.input<typeof PatchDocumentBodySchema>;
export type StructureBody = z.input<typeof StructureBodySchema>;
export type PublishBody = z.input<typeof PublishBodySchema>;
export type CreateNoteBody = z.input<typeof CreateNoteBodySchema>;
export type UpsertBlockBody = z.input<typeof UpsertBlockBodySchema>;
export type UpsertFieldBody = z.input<typeof UpsertFieldBodySchema>;
export type UpsertScriptBody = z.input<typeof UpsertScriptBodySchema>;
export type AdminUserPatch = z.input<typeof AdminUserPatchSchema>;
export type RoleUpsert = z.input<typeof RoleUpsertSchema>;
export type GroupMapPut = z.input<typeof GroupMapPutSchema>;
export type AuditQuery = z.input<typeof AuditQuerySchema>;
export type SuggestionsQuery = Query<'/suggestions', 'get'>;

/* ── response aliases, all derived ────────────────────────────────────────── */

export type HealthResponse = Res<'/system/health', 'get'>;
export type AuthProviders = Res<'/auth/providers', 'get'>;
export type SearchResponse = Res<'/search', 'get'>;
export type SearchHit = SearchResponse['groups'][number]['hits'][number];
export type TrashList = Res<'/trash', 'get'>;
export type TrashItem = ItemOf<TrashList>;
export type RelatedDoc = ItemOf<Res<'/documents/{id}/related', 'get'>>;
export type LinkSets = Res<'/documents/{id}/links', 'get'>;
/** `GET|PUT /documents/{id}/draft` — the full envelope, including `otherEditors`. */
export type DraftEnvelope = Res<'/documents/{id}/draft', 'get'>;
export type BlockUsage = ItemOf<Res<'/blocks/{id}/usage', 'get'>>;
export type FieldUsage = ItemOf<Res<'/fields/{name}/usage', 'get'>>;
export type DocumentDiff = Res<'/documents/{id}/diff', 'get'>;
export type PublishResult = Res<'/documents/{id}/publish', 'post'>;
export type GroupMap = Res<'/admin/groups-map', 'get'>['entries'][number];
export type Session = ItemOf<Res<'/admin/sessions', 'get'>>;
export type AdminUser = ItemOf<Res<'/admin/users', 'get'>>;
export type UploadSourceResult = Res<'/sources/upload', 'post'>;
export type ProcessSourceResult = Res<'/sources/{id}/process', 'post'>;
export type TrashRefType = NonNullable<paths['/trash/{type}/{id}']['delete']['parameters']['path']>['type'];

/** Any `{ items, total, page, pageSize }` list envelope. */
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
