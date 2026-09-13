import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Preferences } from '@wecom/shared';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import { applyPrefs } from '../../lib/prefs.js';
import { useMe } from './me.js';

export const usePreferences = () => {
  const me = useMe();
  return useQuery({
    queryKey: keys.prefs,
    initialData: me.data?.preferences,
    queryFn: async (): Promise<Preferences> => unwrap(await api.GET('/me/preferences')),
  });
};

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: Preferences): Promise<Preferences> =>
      unwrap(await api.PUT('/me/preferences', { body })),
    onMutate: (body) => {
      applyPrefs(body);
      qc.setQueryData(keys.prefs, body);
    },
    onSuccess: (p) => {
      applyPrefs(p);
      qc.setQueryData(keys.prefs, p);
      void qc.invalidateQueries({ queryKey: keys.me });
    },
  });
}
