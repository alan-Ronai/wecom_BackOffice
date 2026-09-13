import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { SearchResponse } from '../types.js';

export const useSearch = (q: string, types?: string) =>
  useQuery({
    queryKey: keys.search(q, types),
    enabled: q.trim().length > 0,
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchResponse> =>
      unwrap(
        await api.GET('/search', {
          params: { query: { q, ...(types && types !== 'all' ? { types } : {}) } },
        }),
      ),
  });
