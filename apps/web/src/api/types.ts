/**
 * Types the API surface needs that `@wecom/shared` publishes only as zod schemas.
 * Everything here is derived — never hand-shaped — so a contract change fails typecheck.
 * When L0 adds the matching `export type` aliases these can be re-exported instead.
 */
import type { z } from 'zod';
import type {
  AdminUserPatchSchema,
  AuditQuerySchema,
  CreateDocumentBodySchema,
  CreateNoteBodySchema,
  GroupMapPutSchema,
  GroupMapSchema,
  HealthResponseSchema,
  ListDocumentsQuerySchema,
  ListDocumentsResponseSchema,
  PatchDocumentBodySchema,
  PublishBodySchema,
  RelatedDocSchema,
  RoleUpsertSchema,
  SearchHitSchema,
  SearchResponseSchema,
  SessionSchema,
  StructureBodySchema,
  SuggestionsQuerySchema,
  TrashItemSchema,
  TrashListSchema,
  UpsertBlockBodySchema,
  UpsertFieldBodySchema,
  UpsertScriptBodySchema,
  UserRoleSchema,
} from '@wecom/shared';

export type ListDocumentsQuery = z.input<typeof ListDocumentsQuerySchema>;
export type ListDocumentsResponse = z.infer<typeof ListDocumentsResponseSchema>;
export type CreateDocumentBody = z.input<typeof CreateDocumentBodySchema>;
export type PatchDocumentBody = z.input<typeof PatchDocumentBodySchema>;
export type StructureBody = z.input<typeof StructureBodySchema>;
export type PublishBody = z.input<typeof PublishBodySchema>;
export type RelatedDoc = z.infer<typeof RelatedDocSchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type TrashItem = z.infer<typeof TrashItemSchema>;
export type TrashList = z.infer<typeof TrashListSchema>;
export type CreateNoteBody = z.input<typeof CreateNoteBodySchema>;
export type UpsertBlockBody = z.input<typeof UpsertBlockBodySchema>;
export type UpsertFieldBody = z.input<typeof UpsertFieldBodySchema>;
export type UpsertScriptBody = z.input<typeof UpsertScriptBodySchema>;
export type SuggestionsQuery = z.input<typeof SuggestionsQuerySchema>;
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
export type AdminUserPatch = z.input<typeof AdminUserPatchSchema>;
export type RoleUpsert = z.input<typeof RoleUpsertSchema>;
export type GroupMap = z.infer<typeof GroupMapSchema>;
export type GroupMapPut = z.input<typeof GroupMapPutSchema>;
export type UserRole = z.infer<typeof UserRoleSchema>;
export type Session = z.infer<typeof SessionSchema>;
export type AuditQuery = z.input<typeof AuditQuerySchema>;

/** `GET /blocks/:id/usage` row. */
export interface BlockUsage {
  documentId: string;
  title: string;
  stepKey: string;
  stepNum: string;
  embedded: boolean;
}
/** `GET /fields/:name/usage` row. */
export interface FieldUsage {
  documentId: string;
  title: string;
  category: string;
  currentVersion: number;
}
/** `GET /admin/system`. */
export interface SystemStatus {
  db: boolean;
  model: boolean;
  queue: number;
  connectors: Record<string, boolean>;
  dbSizeMb: number;
  backups: { name: string; sizeMb: number; at: string }[];
}
/** `GET /auth/providers`. */
export interface AuthProviders {
  providers: { id: string; label: string }[];
}
/** `GET /documents/:id/draft`. */
export interface DraftEnvelope {
  payload: Record<string, unknown>;
  updatedAt: string;
  userId?: string;
  userName?: string;
}
/** `GET /documents/:id/links`. */
export interface LinkSets {
  out: import('@wecom/shared').DocumentLink[];
  in: import('@wecom/shared').DocumentLink[];
}
export interface Ok {
  ok: boolean;
}
export interface PinState {
  pinned: boolean;
}
export type AdminUser = import('@wecom/shared').User & {
  roles?: { roleId: string; roleName: string; categoryScope: string[] | null }[];
};
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
