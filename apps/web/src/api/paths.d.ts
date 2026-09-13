/**
 * Stage-1 route typing for `openapi-fetch`.
 *
 * `docs/api/openapi.json` only carries `/system/health` until L2/L3 publish their routes, so the
 * generated `schema.d.ts` cannot type the client yet. This file declares the same surface as
 * spec §4, with every request and response shape derived from `@wecom/shared`. It is a *fallback*:
 * once the generated file covers the stage-1 routes, point `client.ts` back at `./schema.js` and
 * delete this file. `schema.d.ts` itself is never hand-edited.
 */
import type {
  Block,
  CrmField,
  Document,
  Me,
  Note,
  Permission,
  Preferences,
  Role,
  Script,
  Source,
  SourceRevision,
  Suggestion,
  SuggestionPayload,
  User,
  Version,
} from '@wecom/shared';
import type {
  AdminUser,
  AdminUserPatch,
  AuditQuery,
  AuthProviders,
  BlockUsage,
  CreateDocumentBody,
  CreateNoteBody,
  DraftEnvelope,
  FieldUsage,
  GroupMap,
  GroupMapPut,
  HealthResponse,
  LinkSets,
  ListDocumentsQuery,
  ListDocumentsResponse,
  Ok,
  Paginated,
  PatchDocumentBody,
  PinState,
  PublishBody,
  RelatedDoc,
  RoleUpsert,
  SearchResponse,
  Session,
  StructureBody,
  SuggestionsQuery,
  SystemStatus,
  TrashList,
  UpsertBlockBody,
  UpsertFieldBody,
  UserRole,
} from './types.js';

type NoParams = { query?: never; header?: never; path?: never; cookie?: never };
type P<T> = { query?: never; header?: never; path: T; cookie?: never };
type Q<T> = { query?: T; header?: never; path?: never; cookie?: never };
type PQ<TPath, TQuery> = { query?: TQuery; header?: never; path: TPath; cookie?: never };
type PH<TPath, THeader> = { query?: never; header?: THeader; path: TPath; cookie?: never };

type Res<T> = { 200: { headers: Record<string, unknown>; content: { 'application/json': T } } };
type Body<T> = { content: { 'application/json': T } };

type Read<T, TParams = NoParams> = {
  parameters: TParams;
  requestBody?: never;
  responses: Res<T>;
};
type Write<T, TBody, TParams = NoParams> = {
  parameters: TParams;
  requestBody: Body<TBody>;
  responses: Res<T>;
};
type Call<T, TParams = NoParams> = {
  parameters: TParams;
  requestBody?: never;
  responses: Res<T>;
};

type Id = { id: string };

export interface KbPaths {
  '/auth/me': { parameters: NoParams; get: Read<Me> };
  '/auth/providers': { parameters: NoParams; get: Read<AuthProviders> };
  '/auth/logout': { parameters: NoParams; post: Call<Ok> };
  '/auth/local': {
    parameters: NoParams;
    post: Write<Ok, { username: string; password: string }>;
  };

  '/documents': {
    parameters: NoParams;
    get: Read<ListDocumentsResponse, Q<ListDocumentsQuery>>;
    post: Write<Document, CreateDocumentBody>;
  };
  '/documents/{id}': {
    parameters: P<Id>;
    get: Read<Document, P<Id>>;
    patch: Write<Document, PatchDocumentBody, P<Id>>;
    delete: Call<Ok, P<Id>>;
  };
  '/documents/{id}/structure': {
    parameters: P<Id>;
    put: Write<Document, StructureBody, PH<Id, { 'If-Match'?: string }>>;
  };
  '/documents/{id}/publish': {
    parameters: P<Id>;
    post: Write<Document, PublishBody, P<Id>>;
  };
  '/documents/{id}/versions': { parameters: P<Id>; get: Read<Version[], P<Id>> };
  '/documents/{id}/versions/{v}': {
    parameters: P<{ id: string; v: number }>;
    get: Read<Document, P<{ id: string; v: number }>>;
  };
  '/documents/{id}/restore/{v}': {
    parameters: P<{ id: string; v: number }>;
    post: Call<Document, P<{ id: string; v: number }>>;
  };
  '/documents/{id}/pin': {
    parameters: P<Id>;
    post: Call<PinState, P<Id>>;
    delete: Call<PinState, P<Id>>;
  };
  '/documents/{id}/view': { parameters: P<Id>; post: Call<Ok, P<Id>> };
  '/documents/{id}/links': { parameters: P<Id>; get: Read<LinkSets, P<Id>> };
  '/documents/{id}/related': { parameters: P<Id>; get: Read<RelatedDoc[], P<Id>> };
  '/documents/{id}/notes': {
    parameters: P<Id>;
    get: Read<Note[], P<Id>>;
    post: Write<Note, CreateNoteBody, P<Id>>;
  };
  '/documents/{id}/draft': {
    parameters: P<Id>;
    get: Read<DraftEnvelope, P<Id>>;
    put: Write<{ ok: boolean; updatedAt: string }, { payload: Record<string, unknown> }, P<Id>>;
    delete: Call<Ok, P<Id>>;
  };

  '/notes/{id}': { parameters: P<Id>; delete: Call<Ok, P<Id>> };
  '/notes/{id}/like': { parameters: P<Id>; post: Call<Note, P<Id>> };

  '/blocks': { parameters: NoParams; get: Read<Block[]>; post: Write<Block, UpsertBlockBody> };
  '/blocks/{id}': {
    parameters: P<Id>;
    put: Write<Block, UpsertBlockBody, P<Id>>;
    delete: Call<Ok, P<Id>>;
  };
  '/blocks/{id}/usage': { parameters: P<Id>; get: Read<BlockUsage[], P<Id>> };

  '/fields': { parameters: NoParams; get: Read<CrmField[]> };
  '/fields/{name}': {
    parameters: P<{ name: string }>;
    put: Write<CrmField, UpsertFieldBody, P<{ name: string }>>;
  };
  '/fields/{name}/usage': {
    parameters: P<{ name: string }>;
    get: Read<FieldUsage[], P<{ name: string }>>;
  };

  '/scripts': { parameters: NoParams; get: Read<Script[]> };

  '/search': {
    parameters: NoParams;
    get: Read<SearchResponse, Q<{ q: string; types?: string; limit?: number }>>;
  };

  '/trash': { parameters: NoParams; get: Read<TrashList>; delete: Call<Ok> };
  '/trash/restore-all': { parameters: NoParams; post: Call<Ok> };
  '/trash/{type}/{id}': {
    parameters: P<{ type: string; id: string }>;
    delete: Call<Ok, P<{ type: string; id: string }>>;
  };
  '/trash/{type}/{id}/restore': {
    parameters: P<{ type: string; id: string }>;
    post: Call<Ok, P<{ type: string; id: string }>>;
  };

  '/sources': { parameters: NoParams; get: Read<Source[]> };
  '/sources/upload': { parameters: NoParams; post: Write<Source, FormData> };
  '/sources/{id}/process': { parameters: P<Id>; post: Call<Source, P<Id>> };
  '/sources/{id}/revisions/{rev}': {
    parameters: P<{ id: string; rev: string }>;
    get: Read<SourceRevision, P<{ id: string; rev: string }>>;
  };

  '/suggestions': {
    parameters: NoParams;
    get: Read<Paginated<Suggestion>, Q<SuggestionsQuery>>;
  };
  '/suggestions/publish': { parameters: NoParams; post: Call<{ applied: number }> };
  '/suggestions/{id}/edit': {
    parameters: P<Id>;
    put: Write<Suggestion, { editedPayload: SuggestionPayload }, P<Id>>;
  };
  '/suggestions/{id}/{decision}': {
    parameters: P<{ id: string; decision: 'accept' | 'reject' | 'reset' }>;
    post: Call<Suggestion, P<{ id: string; decision: 'accept' | 'reject' | 'reset' }>>;
  };

  '/me/preferences': {
    parameters: NoParams;
    get: Read<Preferences>;
    put: Write<Preferences, Preferences>;
  };

  '/admin/users': {
    parameters: NoParams;
    get: Read<Paginated<AdminUser>, Q<{ q?: string; page?: number; pageSize?: number }>>;
  };
  '/admin/users/{id}': {
    parameters: P<Id>;
    patch: Write<User, AdminUserPatch, P<Id>>;
  };
  '/admin/roles': { parameters: NoParams; get: Read<Role[]>; post: Write<Role, RoleUpsert> };
  '/admin/roles/{id}': {
    parameters: P<Id>;
    patch: Write<Role, RoleUpsert, P<Id>>;
    delete: Call<Ok, P<Id>>;
  };
  '/admin/groups-map': {
    parameters: NoParams;
    get: Read<{ entries: GroupMap[] }>;
    put: Write<{ entries: GroupMap[] }, GroupMapPut>;
  };
  '/admin/sessions': { parameters: NoParams; get: Read<(Session & { userName?: string })[]> };
  '/admin/sessions/{id}': { parameters: P<Id>; delete: Call<Ok, P<Id>> };
  '/admin/audit': {
    parameters: NoParams;
    get: Read<Paginated<import('@wecom/shared').AuditEntry>, Q<AuditQuery>>;
  };
  '/admin/system': { parameters: NoParams; get: Read<SystemStatus> };

  '/system/health': { parameters: NoParams; get: Read<HealthResponse> };
}

/** Re-exported so callers can name the role/permission/user-role shapes without a second import. */
export type { Permission, Role, User, UserRole };
