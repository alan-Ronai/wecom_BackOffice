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

/** What the gate needs off a document: the primary world, plus the full membership since W1. */
export type ScopedDoc = { category: Category; worlds?: Category[] | null };

/**
 * Effective permission check. World scopes narrow `docs.*` to the listed worlds, mirroring the
 * server-side rule in spec §3.
 *
 * Two details this has to get right, both of which it used to get wrong. The scope is read from
 * `worldScopes` with `categoryScopes` only as the deprecated fallback, so it keeps working across
 * the rename in either direction. And the intersection is against the document's *whole* world
 * set, not its primary world: since W1 a document belongs to several worlds and the server
 * intersects the lot (`list.some(w => user.worldScopes.includes(w))`). Checking only
 * `doc.category` made the client stricter than the API it mirrors — a scoped editor lost the edit
 * affordances on a document their world was a secondary member of, with no error to chase.
 */
export function can(me: Me | undefined, permission: Permission, doc?: ScopedDoc): boolean {
  if (!me) return false;
  if (!me.permissions.includes(permission)) return false;
  if (doc && permission.startsWith('docs.')) {
    const scopes = me.worldScopes ?? me.categoryScopes;
    const worlds = doc.worlds?.length ? doc.worlds : [doc.category];
    if (scopes && !worlds.some((w) => scopes.includes(w))) return false;
  }
  return true;
}

export function useCan(): (p: Permission, doc?: ScopedDoc) => boolean {
  const { data } = useMe();
  return (p, doc) => can(data, p, doc);
}
