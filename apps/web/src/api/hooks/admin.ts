import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { AdminUserCreate, AdminUserPatch, AuditQuery, GroupMap, RoleUpsert } from '../types.js';

/** `GET /admin/users` moved to the stage-5 row shape — see `hooks/stage5.ts#useAdminUsers`. */
export const usePatchUser = () => {
  const qc = useQueryClient();
  return useMutation({
    // Returns `{ ok, auditId }` — the caller must re-read the user from the invalidated list.
    mutationFn: async ({ id, ...body }: AdminUserPatch & { id: string }) =>
      unwrap(await api.PATCH('/admin/users/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

/**
 * `POST /admin/users` creates the local, non-federated login: a break-glass admin, or a service
 * account for an integration. Federated users appear on their own at first sign-in and are never
 * created here.
 */
export const useCreateUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: AdminUserCreate) => unwrap(await api.POST('/admin/users', { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useRoles = () =>
  useQuery({
    queryKey: keys.admin.roles,
    queryFn: async () => unwrap(await api.GET('/admin/roles')).items,
  });

export const useUpsertRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: RoleUpsert & { id?: string }) =>
      unwrap(
        id
          ? await api.PATCH('/admin/roles/{id}', { params: { path: { id } }, body })
          : await api.POST('/admin/roles', { body }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.admin.roles }),
  });
};

export const useDeleteRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/admin/roles/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.admin.roles }),
  });
};

export const useGroupsMap = () =>
  useQuery({
    queryKey: keys.admin.groups,
    queryFn: async () => unwrap(await api.GET('/admin/groups-map')).entries,
  });

export const useSaveGroupsMap = () => {
  const qc = useQueryClient();
  return useMutation({
    // Returns `{ ok, auditId }`; the refreshed entries come from the invalidated query.
    mutationFn: async (entries: GroupMap[]) =>
      unwrap(await api.PUT('/admin/groups-map', { body: { entries } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.admin.groups }),
  });
};

export const useSessions = () =>
  useQuery({
    queryKey: keys.admin.sessions,
    queryFn: async () => unwrap(await api.GET('/admin/sessions')).items,
  });

export const useRevokeSession = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) =>
      unwrap(await api.DELETE('/admin/sessions/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.admin.sessions }),
  });
};

export const useAudit = (q: AuditQuery = {}) =>
  useQuery({
    queryKey: keys.admin.audit(q),
    queryFn: async () => unwrap(await api.GET('/admin/audit', { params: { query: q } })),
  });

/**
 * The operator's diagnostic view: per-queue depth, backup age, connector health, pipeline
 * backlog. Requires `system.admin`, so a non-admin gets a 403 the page surfaces rather than
 * rendering blank rows.
 */
export const useSystem = () =>
  useQuery({
    queryKey: keys.admin.system,
    queryFn: async () => unwrap(await api.GET('/admin/system')),
    staleTime: 10_000,
  });

/** The liveness probe: cheap, unprivileged, and what the container healthcheck hits. */
export const useHealth = () =>
  useQuery({
    queryKey: keys.health,
    queryFn: async () => unwrap(await api.GET('/system/health')),
    staleTime: 30_000,
  });
