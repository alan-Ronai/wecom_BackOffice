/**
 * TanStack hooks over `src/api/stage5.ts`. Mutations invalidate by key prefix so a run, a resolve
 * or a toggle refreshes every list that could have shown the stale row.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { keys } from '../keys.js';
import {
  stage5,
  type AdminUsersQuery,
  type ConnectorUpsert,
  type IdentityProvider,
  type IdentitySettingsPut,
  type ResolveConflictBody,
  type SyncLinkCreate,
  type SyncLinksQuery,
} from '../stage5.js';

/* ── identity & admin ─────────────────────────────────────────────────────── */

export const useAdminUsers = (q: AdminUsersQuery) =>
  useQuery({ queryKey: keys.admin.users(q), queryFn: () => stage5.adminUsers(q) });

export const useRoleMatrix = () =>
  useQuery({ queryKey: keys.admin.matrix, queryFn: () => stage5.roleMatrix() });

/** Only fetched once a row is actually expanded — the list itself carries no diff. */
export const useAuditEntry = (id: string | null) =>
  useQuery({
    queryKey: keys.admin.auditEntry(id ?? ''),
    queryFn: () => stage5.auditEntry(id as string),
    enabled: !!id,
  });

export const useIdentity = () =>
  useQuery({ queryKey: keys.admin.identity, queryFn: () => stage5.identity() });

export const useSaveIdentity = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: IdentitySettingsPut) => stage5.saveIdentity(body),
    onSuccess: (settings) => qc.setQueryData(keys.admin.identity, settings),
  });
};

/** Deliberately not a query: "בדוק חיבור" is an action with a result, not cached state. */
export const useTestIdentity = () =>
  useMutation({ mutationFn: (provider: IdentityProvider) => stage5.testIdentity(provider) });

/**
 * Entra group lookup behind the group-map screen's search box.
 *
 * `enabled` on a non-empty term is what keeps an empty box from asking the directory for
 * everything, and the caller passes an already-debounced term — a query per keystroke would be a
 * Graph call per keystroke, against a tenant that rate-limits. Results are held for five minutes:
 * a directory does not change while somebody fills in one row, and re-typing a term that was just
 * searched should not cost a round trip.
 */
export const useGroupSearch = (q: string) =>
  useQuery({
    queryKey: keys.admin.groupSearch(q),
    queryFn: () => stage5.groupSearch(q),
    enabled: q.trim().length > 0,
    staleTime: 5 * 60_000,
    retry: false,
  });

/* ── connectors ───────────────────────────────────────────────────────────── */

export const useConnectors = () =>
  useQuery({ queryKey: keys.connectors, queryFn: async () => (await stage5.connectors()).items });

export const useConnectorTypes = () =>
  useQuery({
    queryKey: keys.connectorTypes,
    queryFn: async () => (await stage5.connectorTypes()).items,
    staleTime: 5 * 60_000,
  });

export const useConnector = (id: string | undefined) =>
  useQuery({
    queryKey: keys.connector(id ?? ''),
    queryFn: () => stage5.connector(id as string),
    enabled: !!id,
  });

const invalidateConnectors = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: keys.connectors });
  void qc.invalidateQueries({ queryKey: ['sync'] });
};

/**
 * Create takes a whole `ConnectorUpsert`; edit takes whatever actually changed.
 *
 * The asymmetry is the point. `PATCH /connectors/{id}` accepts a partial body, and a connector's
 * config is the one field where "send it all every time" is destructive rather than merely
 * wasteful: the secrets in it never reach the browser, so anything the form can restate is by
 * definition a masked placeholder or a value the server already has. The wizard therefore omits
 * `config` when nothing in it changed, and this signature is what lets it.
 */
export type SaveConnectorArg =
  { id: string; patch: Partial<ConnectorUpsert> } | { id?: undefined; create: ConnectorUpsert };

export const useSaveConnector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (arg: SaveConnectorArg) =>
      arg.id !== undefined ? stage5.updateConnector(arg.id, arg.patch) : stage5.createConnector(arg.create),
    onSuccess: () => invalidateConnectors(qc),
  });
};

/**
 * Enable/disable only. Deliberately not `useSaveConnector` with a `config: {}`: PATCH takes a
 * whole config object, and a flick of the toggle must not be able to hand the server an empty one.
 */
export const useToggleConnector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      stage5.updateConnector(id, { enabled }),
    onSuccess: () => invalidateConnectors(qc),
  });
};

export const useDeleteConnector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stage5.deleteConnector(id),
    onSuccess: () => invalidateConnectors(qc),
  });
};

export const useRunConnector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => stage5.runConnector(id),
    onSuccess: () => invalidateConnectors(qc),
  });
};

export const useTestConnector = () =>
  useMutation({
    mutationFn: (arg: { id: string } | { type: string; config: Record<string, unknown> }) =>
      'id' in arg ? stage5.testConnector(arg.id) : stage5.testConnectorConfig(arg),
  });

/* ── sync ─────────────────────────────────────────────────────────────────── */

/**
 * `enabled` matters here: the sidebar reads this for a badge count, and `GET /sync/links` requires
 * `sources.manage` — firing it for every reader would be one guaranteed 403 per page load.
 */
export const useSyncLinks = (q: SyncLinksQuery, opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.syncLinks(q),
    queryFn: () => stage5.syncLinks(q),
    enabled: opts.enabled ?? true,
  });

export const useConflict = (id: string | undefined) =>
  useQuery({
    queryKey: keys.conflict(id ?? ''),
    queryFn: () => stage5.conflict(id as string),
    enabled: !!id,
  });

export const useResolveConflict = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ResolveConflictBody & { id: string }) => stage5.resolveConflict(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync'] });
      void qc.invalidateQueries({ queryKey: keys.connectors });
    },
  });
};

export const useSyncLink = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: 'import' | 'push' }) =>
      stage5.syncLink(id, direction),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync'] });
      void qc.invalidateQueries({ queryKey: keys.connectors });
    },
  });
};

/**
 * The parity report. Same permission as the queue (`sources.manage`), so `enabled` is the caller's
 * to set; the page gates on `useCan` before rendering and does not fire this for a reader.
 */
export const useParity = (connectorId?: string, opts: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: keys.parity(connectorId ?? '*'),
    queryFn: () => stage5.parity(connectorId),
    enabled: opts.enabled ?? true,
  });

/**
 * "קשר" — pair an unlinked document with an unlinked remote item.
 *
 * Invalidates the whole `sync` prefix rather than just the parity key: the new link belongs in the
 * queue too, and a report that refreshed while the queue still showed the old count would be two
 * screens disagreeing about a row the operator just created.
 */
export const useCreateSyncLink = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SyncLinkCreate) => stage5.createSyncLink(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['sync'] });
      void qc.invalidateQueries({ queryKey: keys.connectors });
    },
  });
};
