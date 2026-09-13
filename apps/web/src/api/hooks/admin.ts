import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { AdminUserPatch, AuditQuery, GroupMap, RoleUpsert } from '../types.js';

export const useUsers = (q: { q?: string; page?: number; pageSize?: number } = {}) =>
  useQuery({
    queryKey: keys.admin.users(q),
    queryFn: async () => unwrap(await api.GET('/admin/users', { params: { query: q } })),
  });

export const usePatchUser = () => {
  const qc = useQueryClient();
  return useMutation({
    // Returns `{ ok, auditId }` — the caller must re-read the user from the invalidated list.
    mutationFn: async ({ id, ...body }: AdminUserPatch & { id: string }) =>
      unwrap(await api.PATCH('/admin/users/{id}', { params: { path: { id } }, body })),
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
 * `GET /system/health` is the only status endpoint the API publishes. The port also queried
 * `GET /admin/system` (db size, connector health, backup list); that route does not exist in
 * `docs/api/openapi.json` or in `apps/api/src/modules/admin/routes.ts`, so it was removed rather
 * than left to retry in the background behind a permanently blank panel. If the richer status
 * payload is wanted, add the route to the API first — `schema.d.ts` will then publish it here.
 */
export const useHealth = () =>
  useQuery({
    queryKey: keys.health,
    queryFn: async () => unwrap(await api.GET('/system/health')),
    staleTime: 30_000,
  });
