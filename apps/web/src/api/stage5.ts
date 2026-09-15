/**
 * The stage-5 surface: identity settings, the admin polish routes, the connector registry and the
 * sync queue.
 *
 * Transport is the **generated** client (`api`, typed by `schema.d.ts` from
 * `docs/api/openapi.json`), like every other call in this app. Lane B has since published these
 * routes, so the hand-rolled `fetch` bridge this module was built on — written because the routes
 * did not exist yet — is gone, and there is once again exactly one contract.
 *
 * The exported *types* stay `z.infer` off the shared zod schemas in
 * `packages/shared/src/schemas/stage45.ts`, which are what the routes validate with and what the
 * OpenAPI file is generated from. Annotating each function with the zod type while the body
 * returns the generated one makes the two sides check against each other: if the published
 * contract ever drifts from the schema that is supposed to produce it, this file stops compiling.
 * `src/api/stage4.ts` is built the same way.
 *
 * Every route below also goes through `checked()` (`src/api/stage45.ts`): the generated types are
 * erased at build time and describe what the contract *says*, while `checked` is what notices when
 * an answer disagrees with it.
 *
 * There is no longer a hand-typed bridge on this surface. It carried five routes and each has been
 * retired for its own reason: `POST /connectors/test` and `POST /sync/links/{id}/sync` were
 * published and correctly shaped all along (and going through the generated client is what lets
 * the latter's declared 409 reach the UI as a status instead of a generic error), while the three
 * single-connector routes were bridged because the contract answered them with a different shape
 * from the list — a divergence that, because it was hand-typed, neither the compiler nor the tests
 * could see, and which loaded the edit form blank and PATCHed the blank back. The backend has
 * since converged all four routes onto the row, and `_ConnectorShapeIsOne` below is what keeps
 * them converged.
 */
import { z } from 'zod';
import {
  AdminUserRowSchema,
  AdminUsersQuerySchema,
  AuditDiffRowSchema,
  AuditEntryDetailSchema,
  ConflictViewSchema,
  ConnectorRowSchema,
  DocumentSyncStateSchema,
  ConnectorTypeInfoSchema,
  GroupSearchResponseSchema,
  IdentitySettingsPutSchema,
  IdentitySettingsSchema,
  IdentityTestResultSchema,
  ParityResponseSchema,
  ResolveConflictBodySchema,
  RoleMatrixSchema,
  SyncLinkCreateBodySchema,
  SyncLinkRowSchema,
  SyncLinksQuerySchema,
  SyncQueueResponseSchema,
  SyncRunResultSchema,
  paginated,
} from '@wecom/shared';
import { api, API_BASE } from './client.js';
import { checked } from './stage45.js';
import { unwrap } from './unwrap.js';
import type { Paginated, Res } from './types.js';

/* ── types, all inferred from the schemas the routes validate with ────────── */

export type IdentitySettings = z.infer<typeof IdentitySettingsSchema>;
export type IdentitySettingsPut = z.input<typeof IdentitySettingsPutSchema>;
export type IdentityTestResult = z.infer<typeof IdentityTestResultSchema>;
export type IdentityProvider = IdentityTestResult['provider'];
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;
export type AdminUsersQuery = z.input<typeof AdminUsersQuerySchema>;
export type AuditDiffRow = z.infer<typeof AuditDiffRowSchema>;
export type AuditEntryDetail = z.infer<typeof AuditEntryDetailSchema>;
export type RoleMatrix = z.infer<typeof RoleMatrixSchema>;
export type MatrixRole = RoleMatrix['roles'][number];
export type ConnectorTypeInfo = z.infer<typeof ConnectorTypeInfoSchema>;
export type ConnectorRow = z.infer<typeof ConnectorRowSchema>;

/**
 * One shape for all four connector routes, and a compile-time proof of it.
 *
 * This used to be two shapes. `openapi.json` published `config` + `links` + `conflicts` on the
 * list and `configMasked` + `capabilities` on `GET|POST|PATCH /connectors/{id}`, while the client
 * read `.config` off all four — so against a backend implementing the published contract, the edit
 * form loaded blank and then PATCHed the blank back over a saved configuration. The backend wave
 * has since converged the detail routes onto the row, which is the shape `ConnectorRowSchema` in
 * `@wecom/shared` declares and the shape these screens were always written to.
 *
 * The assertion below is what keeps that settled. It is not decoration: it failed on the very
 * merge that brought the contract change in, which is how this file came to be corrected rather
 * than left describing a split that no longer exists.
 */
type _ConnectorShapeIsOne =
  Res<'/connectors/{id}', 'get'> extends ConnectorRow
    ? Res<'/connectors', 'post'> extends ConnectorRow
      ? Res<'/connectors/{id}', 'patch'> extends ConnectorRow
        ? true
        : never
      : never
    : never;
const _connectorShapeIsOne: _ConnectorShapeIsOne = true;
void _connectorShapeIsOne;
export type SyncLinkRow = z.infer<typeof SyncLinkRowSchema>;
export type SyncLinkState = SyncLinkRow['state'];
export type SyncLinksQuery = z.input<typeof SyncLinksQuerySchema>;
export type SyncQueueResponse = z.infer<typeof SyncQueueResponseSchema>;
export type SyncCounts = SyncQueueResponse['counts'];
export type ConflictView = z.infer<typeof ConflictViewSchema>;
export type DocumentSyncState = z.infer<typeof DocumentSyncStateSchema>;
export type ResolveConflictBody = z.input<typeof ResolveConflictBodySchema>;
export type SyncRunResult = z.infer<typeof SyncRunResultSchema>;
export type GroupSearchItem = z.infer<typeof GroupSearchResponseSchema>['items'][number];
export type ParityResponse = z.infer<typeof ParityResponseSchema>;
export type ParityConnector = ParityResponse['connectors'][number];
export type ParityLinkRow = ParityConnector['items'][number];
export type ParityUnlinkedDocument = ParityConnector['unlinked']['documents'][number];
export type ParityUnlinkedRemote = ParityConnector['unlinked']['remote'][number];
export type SyncLinkCreate = z.input<typeof SyncLinkCreateBodySchema>;

/** `configSchema` is a JSON-Schema object; this is the slice the wizard renders. */
export interface ConfigField {
  key: string;
  type: 'string' | 'secret' | 'url' | 'array' | 'enum' | 'boolean' | 'number' | 'map' | 'json';
  title: string;
  description?: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
  placeholder?: string;
  /** The connector's own `z.string().min(n)` / `z.array(...).min(n)`, re-applied in the form. */
  minLength?: number;
  minItems?: number;
}

/** `POST /connectors` / `PATCH /connectors/:id` — the existing L6 body. */
export interface ConnectorUpsert {
  type: string;
  name: string;
  config: Record<string, unknown>;
  schedule?: string | null;
  enabled?: boolean;
}

/**
 * Drops `schedule: null` from a write body, because the contract has no spelling for it.
 *
 * Every connector *response* declares `schedule` nullable, and the wizard offers "ללא תזמון", but
 * `ConnectorCreateBodySchema` declares the write side `z.string().regex(…).optional()` — no null.
 * So a real backend answers 400 to the one payload that means "stop running this on a timer",
 * and omitting the key on a PATCH means "leave it as it is". There is no third option available
 * to a client, so this function picks the one that fails safe rather than loudly: the schedule is
 * left alone, and `ConnectorWizard` tells the operator that in so many words instead of letting
 * them believe a cleared schedule was saved.
 *
 * **Backend ask**: make `schedule` nullable on `POST /connectors` and `PATCH /connectors/{id}`,
 * as it already is on every connector response. Then this function and the wizard's hint both go.
 */
const writeBody = <T extends { schedule?: string | null }>({ schedule, ...rest }: T) => ({
  ...rest,
  ...(typeof schedule === 'string' ? { schedule } : {}),
});

/** `POST /connectors/:id/test` and the unsaved-connector dry run. */
export interface ConnectorTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/* ── response schemas the shared package does not declare ─────────────────── */

/**
 * `@wecom/shared` declares the row and the type-info object but not the envelopes they arrive in,
 * nor the connector-test result. Declaring them here costs four lines and buys `checked()` the
 * same coverage on these routes as everywhere else.
 */
const ConnectorsResponseSchema = z.object({ items: z.array(ConnectorRowSchema) });
const ConnectorTypesResponseSchema = z.object({ items: z.array(ConnectorTypeInfoSchema) });
const ConnectorTestResultSchema = z.object({
  ok: z.boolean(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
const AdminUsersResponseSchema = paginated(AdminUserRowSchema);

/* ── the routes ───────────────────────────────────────────────────────────── */

export const stage5 = {
  adminUsers: async (query: AdminUsersQuery): Promise<Paginated<AdminUserRow>> =>
    checked(AdminUsersResponseSchema, await api.GET('/admin/users', { params: { query } })),
  roleMatrix: async (): Promise<RoleMatrix> =>
    checked(RoleMatrixSchema, await api.GET('/admin/roles/matrix')),
  auditEntry: async (id: string): Promise<AuditEntryDetail> =>
    checked(AuditEntryDetailSchema, await api.GET('/admin/audit/{id}', { params: { path: { id } } })),
  identity: async (): Promise<IdentitySettings> =>
    checked(IdentitySettingsSchema, await api.GET('/admin/identity')),
  saveIdentity: async (body: IdentitySettingsPut): Promise<IdentitySettings> =>
    checked(IdentitySettingsSchema, await api.PUT('/admin/identity', { body })),
  testIdentity: async (provider: IdentityProvider): Promise<IdentityTestResult> =>
    checked(IdentityTestResultSchema, await api.POST('/admin/identity/test', { body: { provider } })),
  /**
   * Entra group lookup for the group-map screen (design 3d).
   *
   * Answers 503 when no issuer is configured and 502 when Graph itself is unreachable; both reach
   * the caller as an `ApiError` carrying `status`, which is what lets the box say "הגדירו את Entra
   * ID" for one and "נסו שוב" for the other instead of one shrug for both.
   */
  groupSearch: async (q: string): Promise<{ items: GroupSearchItem[] }> =>
    checked(GroupSearchResponseSchema, await api.GET('/admin/groups/search', { params: { query: { q } } })),

  connectorTypes: async (): Promise<{ items: ConnectorTypeInfo[] }> =>
    checked(ConnectorTypesResponseSchema, await api.GET('/connectors/types')),
  connectors: async (): Promise<{ items: ConnectorRow[] }> =>
    checked(ConnectorsResponseSchema, await api.GET('/connectors')),

  connector: async (id: string): Promise<ConnectorRow> =>
    checked(ConnectorRowSchema, await api.GET('/connectors/{id}', { params: { path: { id } } })),
  createConnector: async (body: ConnectorUpsert): Promise<ConnectorRow> =>
    checked(ConnectorRowSchema, await api.POST('/connectors', { body: writeBody(body) })),
  updateConnector: async (id: string, body: Partial<ConnectorUpsert>): Promise<ConnectorRow> =>
    checked(
      ConnectorRowSchema,
      await api.PATCH('/connectors/{id}', { params: { path: { id } }, body: writeBody(body) }),
    ),
  deleteConnector: async (id: string): Promise<void> => {
    unwrap(await api.DELETE('/connectors/{id}', { params: { path: { id } } }));
  },
  runConnector: async (id: string): Promise<SyncRunResult> =>
    checked(SyncRunResultSchema, await api.POST('/connectors/{id}/run', { params: { path: { id } } })),
  testConnector: async (id: string): Promise<ConnectorTestResult> =>
    checked(ConnectorTestResultSchema, await api.POST('/connectors/{id}/test', { params: { path: { id } } })),
  /** The wizard's step-2 check, before the connector exists and has an id to test against. */
  testConnectorConfig: async (body: {
    type: string;
    config: Record<string, unknown>;
  }): Promise<ConnectorTestResult> =>
    checked(ConnectorTestResultSchema, await api.POST('/connectors/test', { body })),

  syncLinks: async (query: SyncLinksQuery): Promise<SyncQueueResponse> =>
    checked(SyncQueueResponseSchema, await api.GET('/sync/links', { params: { query } })),
  /**
   * One document's sync state, for the article header. Unlike `syncLinks` this needs only
   * `docs.read`, which is the whole point: an editor reading an article has to be able to see
   * that the item is waiting to be pushed or is in conflict.
   */
  documentSyncState: async (id: string): Promise<DocumentSyncState> =>
    checked(
      DocumentSyncStateSchema,
      await api.GET('/documents/{id}/sync-state', { params: { path: { id } } }),
    ),
  conflict: async (id: string): Promise<ConflictView> =>
    checked(ConflictViewSchema, await api.GET('/sync/links/{id}/conflict', { params: { path: { id } } })),
  resolveConflict: async (id: string, body: ResolveConflictBody): Promise<SyncLinkRow> =>
    checked(
      SyncLinkRowSchema,
      await api.POST('/sync/links/{id}/resolve', { params: { path: { id } }, body }),
    ),
  /**
   * Per-row "ייבא עכשיו" / "דחוף עכשיו" — one link, one direction.
   *
   * The contract declares a 409 for "a sync is already running on this link". Going through the
   * generated client means `unwrap` raises an `ApiError` that still carries `status`, so the queue
   * can tell that apart from a generic failure — which the old hand-rolled bridge flattened.
   */
  syncLink: async (id: string, direction: 'import' | 'push'): Promise<SyncRunResult> =>
    checked(
      SyncRunResultSchema,
      await api.POST('/sync/links/{id}/sync', { params: { path: { id } }, body: { direction } }),
    ),

  /**
   * The parity report (design 4d). One request covers every connector; `connectorId` narrows it.
   *
   * The server caches each connector's remote listing for 60 s, which is what makes a page that
   * reads every remote item affordable to open — so this deliberately has no polling of its own.
   */
  parity: async (connectorId?: string): Promise<ParityResponse> =>
    checked(
      ParityResponseSchema,
      await api.GET('/sync/parity', { params: { query: connectorId ? { connectorId } : {} } }),
    ),
  /** The report's "קשר" on an unlinked document or remote item. 409 when either end is taken. */
  createSyncLink: async (body: SyncLinkCreate): Promise<SyncLinkRow> =>
    checked(SyncLinkRowSchema, await api.POST('/sync/links', { body })),
};

/* ── JSON-Schema → form fields ────────────────────────────────────────────── */

type JsonSchemaProp = ConnectorTypeInfo['configSchema']['properties'][string];

const fieldType = (p: JsonSchemaProp): ConfigField['type'] => {
  if (p.enum?.length) return 'enum';
  if (p.type === 'array') return 'array';
  if (p.type === 'boolean') return 'boolean';
  if (p.type === 'number' || p.type === 'integer') return 'number';
  // A free-keyed map (`additionalProperties`) is `key = value` rows; an object with a fixed
  // shape is edited as JSON, because inventing controls for a shape we were not given is how
  // a form comes to post something the server rejects.
  if (p.type === 'object') return p.additionalProperties ? 'map' : 'json';
  if (p.writeOnly || p.format === 'password') return 'secret';
  if (p.format === 'uri') return 'url';
  return 'string';
};

/**
 * Flattens a connector type's `configSchema` into the field list the wizard renders.
 *
 * Only the top level is walked; a nested object arrives as one `json` field rather than as
 * guessed-at controls. The `minLength`/`minItems` the API publishes come through so the form can
 * apply the connector's own rules before posting — see `fieldError`.
 */
export function configFields(configSchema: ConnectorTypeInfo['configSchema']): ConfigField[] {
  const required = new Set(configSchema.required);
  return Object.entries(configSchema.properties).map(([key, p]) => ({
    key,
    type: fieldType(p),
    title: p.title || key,
    description: p.description,
    required: required.has(key),
    enum: p.enum,
    default: p.default,
    placeholder: p.examples?.length ? String(p.examples[0]) : undefined,
    minLength: p.minLength,
    minItems: p.minItems,
  }));
}

/** `key = value` per line — how the wizard edits a free-keyed map such as `categoryMap`. */
export const formatMap = (value: unknown): string =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${k} = ${String(v)}`)
        .join('\n')
    : '';

/** The inverse, or `null` when a line is not `key = value`. */
export function parseMap(text: string): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf('=');
    if (at < 0) return null;
    const key = line.slice(0, at).trim();
    if (!key) return null;
    out[key] = line.slice(at + 1).trim();
  }
  return out;
}

/** Empty for the purposes of `required`: nothing typed, an empty list, an empty map. */
const isBlank = (v: unknown): boolean =>
  v === undefined ||
  v === null ||
  v === '' ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0);

/**
 * The connector's own validation, re-applied in the browser.
 *
 * The API validates the posted config against the connector's zod schema and answers a 400 whose
 * body is a `flatten()` of zod issues. Before W-1 the wizard rendered no config fields at all, so
 * that 400 was the *only* feedback an operator ever got — "הגדרות המחבר אינן תקינות", with
 * nowhere to type what was missing. These are the same rules as the schema publishes them
 * (`minLength`, `minItems`, `format: 'uri'`), said beside the field they belong to. The server
 * still decides: this only stops the obviously-wrong post.
 */
export function fieldError(field: ConfigField, value: unknown): string | null {
  // A masked secret means "the server already holds one"; it satisfies `required` and is not
  // measured against `minLength`, because it is not the value.
  if (typeof value === 'string' && value.startsWith(SECRET_MASK)) return null;
  if (isBlank(value)) return field.required ? 'שדה חובה' : null;
  // `map`/`json` keep the raw text in state while it does not parse — that is the error.
  if (field.type === 'map' && typeof value === 'string') return 'כל שורה היא "מפתח = ערך"';
  if (field.type === 'json' && typeof value === 'string') return 'JSON לא תקין';
  if (field.type === 'url') {
    let url: URL | undefined;
    try {
      url = new URL(String(value));
    } catch {
      /* not a URL at all */
    }
    if (!url || !/^https?:$/.test(url.protocol)) return 'כתובת לא תקינה — למשל https://example.com';
  }
  if (field.minLength !== undefined && String(value).length < field.minLength)
    return `לפחות ${field.minLength} תווים`;
  if (field.minItems !== undefined && Array.isArray(value) && value.length < field.minItems)
    return `יש להזין לפחות ${field.minItems} ערכים`;
  return null;
}

/** A saved secret comes back masked; re-sending the mask would overwrite the real value with it. */
export const SECRET_MASK = '••••';

/** The webhook endpoint a WordPress plugin posts to — same base as every other call. */
export const webhookUrl = (connectorId: string): string => `${API_BASE}/connectors/${connectorId}/webhook`;
