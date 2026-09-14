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

export const useSaveConnector = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: ConnectorUpsert & { id?: string }) =>
      id ? stage5.updateConnector(id, body) : stage5.createConnector(body),
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

export const useSyncLinks = (q: SyncLinksQuery) =>
  useQuery({ queryKey: keys.syncLinks(q), queryFn: () => stage5.syncLinks(q) });

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
