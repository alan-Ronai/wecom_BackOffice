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
 * Five routes the screens need are not usable from the generated client yet — two are missing
 * from the contract and three are published with the wrong shape — and go through the small
 * `pending` bridge below, which names each one. They are the whole of the remaining backend ask.
 */
import type { z } from 'zod';
import type {
  AdminUserRowSchema,
  AdminUsersQuerySchema,
  AuditDiffRowSchema,
  AuditEntryDetailSchema,
  ConflictViewSchema,
  ConnectorRowSchema,
  ConnectorTypeInfoSchema,
  IdentitySettingsPutSchema,
  IdentitySettingsSchema,
  IdentityTestResultSchema,
  ResolveConflictBodySchema,
  RoleMatrixSchema,
  SyncLinkRowSchema,
  SyncLinksQuerySchema,
  SyncQueueResponseSchema,
  SyncRunResultSchema,
} from '@wecom/shared';
import { api, API_BASE } from './client.js';
import { ApiError, unwrap } from './unwrap.js';
import type { Paginated } from './types.js';

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
export type SyncLinkRow = z.infer<typeof SyncLinkRowSchema>;
export type SyncLinkState = SyncLinkRow['state'];
export type SyncLinksQuery = z.input<typeof SyncLinksQuerySchema>;
export type SyncQueueResponse = z.infer<typeof SyncQueueResponseSchema>;
export type SyncCounts = SyncQueueResponse['counts'];
export type ConflictView = z.infer<typeof ConflictViewSchema>;
export type ResolveConflictBody = z.input<typeof ResolveConflictBodySchema>;
export type SyncRunResult = z.infer<typeof SyncRunResultSchema>;

/** `configSchema` is a JSON-Schema object; this is the slice the wizard renders. */
export interface ConfigField {
  key: string;
  type: 'string' | 'secret' | 'url' | 'array' | 'enum' | 'boolean' | 'number';
  title: string;
  description?: string;
  required: boolean;
  enum?: string[];
  default?: unknown;
  placeholder?: string;
}

/** `POST /connectors` / `PATCH /connectors/:id` — the existing L6 body. */
export interface ConnectorUpsert {
  type: string;
  name: string;
  config: Record<string, unknown>;
  schedule?: string | null;
  enabled?: boolean;
}

/** `POST /connectors/:id/test` and the unsaved-connector dry run. */
export interface ConnectorTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/* ── routes not in the published contract yet ─────────────────────────────── */

/**
 * The five routes below are the only ones these screens call that the generated client cannot
 * type today. Everything else goes through `api`.
 *
 * Two are simply not in `docs/api/openapi.json`:
 *   - `POST /connectors/test` — the wizard's step-2 dry run, before the connector exists and has
 *     an id to test against;
 *   - `POST /sync/links/{id}/sync` — a queue row's "ייבא עכשיו" / "דחוף עכשיו".
 *
 * Three are published, but with the **wrong shape**, and that is worth naming because the
 * compiler is what found it: `GET /connectors` answers `ConnectorRowSchema` (with `config`,
 * `links` and `conflicts`, and `schedule` nullable) while `GET`/`POST`/`PATCH` on the single
 * connector still answer the older `ConnectorSchema` (`configMasked`, `capabilities`, no counts,
 * `schedule` non-null). One resource with two shapes depending on whether you list it or fetch
 * it. The screens are written to the row shape the list returns, which is also the shape the
 * stage-5 contract specifies, so routing these three through `api` would only have been possible
 * by casting the mismatch away — which is the thing this codebase does not do.
 *
 * The bridge raises the same typed `ApiError` as `unwrap`, so a 403 from one of these still
 * surfaces through `LoadError` like a 403 from a generated call. Each line disappears the moment
 * its route is published or corrected; nothing else changes.
 */
async function pending<T>(method: 'GET' | 'POST' | 'PATCH', path: string, body?: unknown): Promise<T> {
  const res = await globalThis.fetch(`${API_BASE}${path}`, {
    method,
    credentials: 'include',
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
  const payload: unknown = res.status === 204 ? undefined : await res.json().catch(() => undefined);
  if (!res.ok) {
    const e = (payload ?? {}) as { code?: string; message?: string; details?: unknown };
    throw new ApiError(res.status, e.code ?? 'ERROR', e.message ?? 'שגיאה', e.details);
  }
  return payload as T;
}

/* ── the routes ───────────────────────────────────────────────────────────── */

export const stage5 = {
  adminUsers: async (query: AdminUsersQuery): Promise<Paginated<AdminUserRow>> =>
    unwrap(await api.GET('/admin/users', { params: { query } })),
  roleMatrix: async (): Promise<RoleMatrix> => unwrap(await api.GET('/admin/roles/matrix')),
  auditEntry: async (id: string): Promise<AuditEntryDetail> =>
    unwrap(await api.GET('/admin/audit/{id}', { params: { path: { id } } })),
  identity: async (): Promise<IdentitySettings> => unwrap(await api.GET('/admin/identity')),
  saveIdentity: async (body: IdentitySettingsPut): Promise<IdentitySettings> =>
    unwrap(await api.PUT('/admin/identity', { body })),
  testIdentity: async (provider: IdentityProvider): Promise<IdentityTestResult> =>
    unwrap(await api.POST('/admin/identity/test', { body: { provider } })),

  connectorTypes: async (): Promise<{ items: ConnectorTypeInfo[] }> =>
    unwrap(await api.GET('/connectors/types')),
  connectors: async (): Promise<{ items: ConnectorRow[] }> => unwrap(await api.GET('/connectors')),
  // The three single-connector routes still answer the pre-stage-5 `ConnectorSchema` — see the
  // `pending` comment above.
  connector: (id: string) => pending<ConnectorRow>('GET', `/connectors/${encodeURIComponent(id)}`),
  createConnector: (body: ConnectorUpsert) => pending<ConnectorRow>('POST', '/connectors', body),
  updateConnector: (id: string, body: Partial<ConnectorUpsert>) =>
    pending<ConnectorRow>('PATCH', `/connectors/${encodeURIComponent(id)}`, body),
  deleteConnector: async (id: string): Promise<void> => {
    unwrap(await api.DELETE('/connectors/{id}', { params: { path: { id } } }));
  },
  runConnector: async (id: string): Promise<SyncRunResult> =>
    unwrap(await api.POST('/connectors/{id}/run', { params: { path: { id } } })),
  testConnector: async (id: string): Promise<ConnectorTestResult> =>
    unwrap(await api.POST('/connectors/{id}/test', { params: { path: { id } } })),
  /** The wizard's step-2 check, before the connector exists and has an id to test against. */
  testConnectorConfig: (body: { type: string; config: Record<string, unknown> }) =>
    pending<ConnectorTestResult>('POST', '/connectors/test', body),

  syncLinks: async (query: SyncLinksQuery): Promise<SyncQueueResponse> =>
    unwrap(await api.GET('/sync/links', { params: { query } })),
  conflict: async (id: string): Promise<ConflictView> =>
    unwrap(await api.GET('/sync/links/{id}/conflict', { params: { path: { id } } })),
  resolveConflict: async (id: string, body: ResolveConflictBody): Promise<SyncLinkRow> =>
    unwrap(await api.POST('/sync/links/{id}/resolve', { params: { path: { id } }, body })),
  /** Per-row "ייבא עכשיו" / "דחוף עכשיו" — one link, one direction. */
  syncLink: (id: string, direction: 'import' | 'push') =>
    pending<SyncRunResult>('POST', `/sync/links/${encodeURIComponent(id)}/sync`, { direction }),
};

/* ── JSON-Schema → form fields ────────────────────────────────────────────── */

interface JsonSchemaProp {
  type?: string;
  title?: string;
  description?: string;
  format?: string;
  enum?: unknown[];
  default?: unknown;
  writeOnly?: boolean;
  examples?: unknown[];
  items?: { type?: string };
}

const fieldType = (p: JsonSchemaProp): ConfigField['type'] => {
  if (p.enum?.length) return 'enum';
  if (p.type === 'array') return 'array';
  if (p.type === 'boolean') return 'boolean';
  if (p.type === 'number' || p.type === 'integer') return 'number';
  if (p.writeOnly || p.format === 'password') return 'secret';
  if (p.format === 'uri' || p.format === 'url') return 'url';
  return 'string';
};

/**
 * Flattens a connector type's `configSchema` into the field list the wizard renders. Only the top
 * level is walked — no connector declares a nested config object, and guessing at one would render
 * controls the server would reject.
 */
export function configFields(configSchema: Record<string, unknown>): ConfigField[] {
  const props = (configSchema.properties ?? {}) as Record<string, JsonSchemaProp>;
  const required = new Set((configSchema.required as string[] | undefined) ?? []);
  return Object.entries(props).map(([key, p]) => ({
    key,
    type: fieldType(p),
    title: p.title ?? key,
    description: p.description,
    required: required.has(key),
    enum: p.enum?.map(String),
    default: p.default,
    placeholder: p.examples?.length ? String(p.examples[0]) : undefined,
  }));
}

/** A saved secret comes back masked; re-sending the mask would overwrite the real value with it. */
export const SECRET_MASK = '••••';

/** The webhook endpoint a WordPress plugin posts to — same base as every other call. */
export const webhookUrl = (connectorId: string): string => `${API_BASE}/connectors/${connectorId}/webhook`;
