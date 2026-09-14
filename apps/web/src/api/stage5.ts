/**
 * The stage-5 surface: identity settings, the admin polish routes, the connector registry and the
 * sync queue.
 *
 * Everything else in this app is typed from the **generated** contract (`schema.d.ts`). These
 * routes are not in it yet — backend lane B is landing them against
 * `docs/api/CONTRACTS-stage4-5.md` while this lane builds the screens — so the types here come
 * from the other half of the same contract: the zod schemas in `@wecom/shared`
 * (`packages/shared/src/schemas/stage45.ts`), which those routes validate with.
 *
 * That keeps the rule the README states (never hand-write a contract) intact: these are still
 * derived types, from the schema the server enforces. When the routes appear in
 * `docs/api/openapi.json`, the `Res`/`Body` aliases in `types.ts` can replace the `z.infer`s below
 * one at a time without touching a single call site.
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
import { API_BASE } from './client.js';
import { ApiError } from './unwrap.js';
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

/* ── transport ────────────────────────────────────────────────────────────── */

type QueryValue = string | number | boolean | undefined | null;

const qs = (query?: Record<string, QueryValue>): string => {
  if (!query) return '';
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(query))
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : '';
};

/**
 * Same credentials, same error envelope and the same typed `ApiError` as `unwrap`, so a 403 from
 * one of these routes surfaces through `LoadError` exactly like a 403 from a generated one.
 */
async function request<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  opts: { query?: Record<string, QueryValue>; body?: unknown } = {},
): Promise<T> {
  const res = await globalThis.fetch(`${API_BASE}${path}${qs(opts.query)}`, {
    method,
    credentials: 'include',
    ...(opts.body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(opts.body) }),
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
  adminUsers: (query: AdminUsersQuery) =>
    request<Paginated<AdminUserRow>>('GET', '/admin/users', {
      query: query as Record<string, QueryValue>,
    }),
  roleMatrix: () => request<RoleMatrix>('GET', '/admin/roles/matrix'),
  auditEntry: (id: string) => request<AuditEntryDetail>('GET', `/admin/audit/${encodeURIComponent(id)}`),
  identity: () => request<IdentitySettings>('GET', '/admin/identity'),
  saveIdentity: (body: IdentitySettingsPut) => request<IdentitySettings>('PUT', '/admin/identity', { body }),
  testIdentity: (provider: IdentityProvider) =>
    request<IdentityTestResult>('POST', '/admin/identity/test', { body: { provider } }),

  connectorTypes: () => request<{ items: ConnectorTypeInfo[] }>('GET', '/connectors/types'),
  connectors: () => request<{ items: ConnectorRow[] }>('GET', '/connectors'),
  connector: (id: string) => request<ConnectorRow>('GET', `/connectors/${encodeURIComponent(id)}`),
  createConnector: (body: ConnectorUpsert) => request<ConnectorRow>('POST', '/connectors', { body }),
  updateConnector: (id: string, body: Partial<ConnectorUpsert>) =>
    request<ConnectorRow>('PATCH', `/connectors/${encodeURIComponent(id)}`, { body }),
  deleteConnector: (id: string) => request<void>('DELETE', `/connectors/${encodeURIComponent(id)}`),
  runConnector: (id: string) => request<SyncRunResult>('POST', `/connectors/${encodeURIComponent(id)}/run`),
  testConnector: (id: string) =>
    request<ConnectorTestResult>('POST', `/connectors/${encodeURIComponent(id)}/test`),
  /** The wizard's step-2 check, before the connector exists and has an id to test against. */
  testConnectorConfig: (body: { type: string; config: Record<string, unknown> }) =>
    request<ConnectorTestResult>('POST', '/connectors/test', { body }),

  syncLinks: (query: SyncLinksQuery) =>
    request<SyncQueueResponse>('GET', '/sync/links', { query: query as Record<string, QueryValue> }),
  conflict: (id: string) => request<ConflictView>('GET', `/sync/links/${encodeURIComponent(id)}/conflict`),
  resolveConflict: (id: string, body: ResolveConflictBody) =>
    request<SyncLinkRow>('POST', `/sync/links/${encodeURIComponent(id)}/resolve`, { body }),
  /** Per-row "ייבא עכשיו" / "דחוף עכשיו" — one link, one direction. */
  syncLink: (id: string, direction: 'import' | 'push') =>
    request<SyncRunResult>('POST', `/sync/links/${encodeURIComponent(id)}/sync`, { body: { direction } }),
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
