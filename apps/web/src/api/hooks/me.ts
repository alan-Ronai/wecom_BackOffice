import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import type { Category, Me, Permission } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { ApiError, unwrap } from '../unwrap.js';

export function useMe(): UseQueryResult<Me, Error> {
  return useQuery({
    queryKey: keys.me,
    queryFn: async () => unwrap(await api.GET('/auth/me')),
    retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2,
    staleTime: 60_000,
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/auth/logout')),
    onSuccess: () => {
      qc.clear();
      window.location.assign('/login');
    },
  });
}

/**
 * Effective permission check. `categoryScopes` narrows `docs.*` to listed categories,
 * matching the server-side rule in spec §3.
 */
export function can(me: Me | undefined, permission: Permission, doc?: { category: Category }): boolean {
  if (!me) return false;
  if (!me.permissions.includes(permission)) return false;
  if (doc && permission.startsWith('docs.') && me.categoryScopes && !me.categoryScopes.includes(doc.category))
    return false;
  return true;
}

export function useCan(): (p: Permission, doc?: { category: Category }) => boolean {
  const { data } = useMe();
  return (p, doc) => can(data, p, doc);
}
