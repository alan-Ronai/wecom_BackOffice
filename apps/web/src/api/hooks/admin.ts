import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AuditEntry, Role } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type {
  AdminUser,
  AdminUserPatch,
  AuditQuery,
  GroupMap,
  HealthResponse,
  Paginated,
  RoleUpsert,
  Session,
  SystemStatus,
} from '../types.js';

export const useUsers = (q: { q?: string; page?: number; pageSize?: number } = {}) =>
  useQuery({
    queryKey: keys.admin.users(q),
    queryFn: async (): Promise<Paginated<AdminUser>> =>
      unwrap(await api.GET('/admin/users', { params: { query: q } })),
  });

export const usePatchUser = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: AdminUserPatch & { id: string }) =>
      unwrap(await api.PATCH('/admin/users/{id}', { params: { path: { id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin', 'users'] }),
  });
};

export const useRoles = () =>
  useQuery({
    queryKey: keys.admin.roles,
    queryFn: async (): Promise<Role[]> => unwrap(await api.GET('/admin/roles')),
  });

export const useUpsertRole = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...body }: RoleUpsert & { id?: string }): Promise<Role> =>
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
    queryFn: async (): Promise<{ entries: GroupMap[] }> => unwrap(await api.GET('/admin/groups-map')),
  });

export const useSaveGroupsMap = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (entries: GroupMap[]) =>
      unwrap(await api.PUT('/admin/groups-map', { body: { entries } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.admin.groups }),
  });
};

export const useSessions = () =>
  useQuery({
    queryKey: keys.admin.sessions,
    queryFn: async (): Promise<(Session & { userName?: string })[]> =>
      unwrap(await api.GET('/admin/sessions')),
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
    queryFn: async (): Promise<Paginated<AuditEntry>> =>
      unwrap(await api.GET('/admin/audit', { params: { query: q } })),
  });

export const useSystem = () =>
  useQuery({
    queryKey: keys.admin.system,
    queryFn: async (): Promise<SystemStatus> => unwrap(await api.GET('/admin/system')),
  });

export const useHealth = () =>
  useQuery({
    queryKey: keys.health,
    queryFn: async (): Promise<HealthResponse> => unwrap(await api.GET('/system/health')),
    staleTime: 30_000,
  });
