import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { TrashRefType } from '../types.js';

export const useTrash = () =>
  useQuery({
    queryKey: keys.trash,
    queryFn: async () => unwrap(await api.GET('/trash')),
  });

/** The API only accepts these four entity kinds in the path. */
type Ref = { type: TrashRefType; id: string };

const useTrashMutation = <TVars, TData>(fn: (v: TVars) => Promise<TData>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.trash });
      void qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
};

export const useRestoreTrash = () =>
  useTrashMutation(async ({ type, id }: Ref) =>
    unwrap(await api.POST('/trash/{type}/{id}/restore', { params: { path: { type, id } } })),
  );

export const usePurgeTrash = () =>
  useTrashMutation(async ({ type, id }: Ref) =>
    unwrap(await api.DELETE('/trash/{type}/{id}', { params: { path: { type, id } } })),
  );

export const useRestoreAllTrash = () =>
  useTrashMutation(async () => unwrap(await api.POST('/trash/restore-all')));

export const useEmptyTrash = () => useTrashMutation(async () => unwrap(await api.DELETE('/trash')));
