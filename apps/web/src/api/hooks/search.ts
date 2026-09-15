import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import type { SearchResponse } from '../types.js';

/**
 * How many characters a query needs before `GET /search` is called at all.
 *
 * `docs/perf.md` § "What stays broken": the search predicates are `ilike '%…%'`, and the trigram
 * indexes migration 0044 added cannot serve a pattern shorter than one trigram. A two-character
 * Hebrew prefix — `ilike '%חב%'`, the first thing an agent types — therefore falls back to a full
 * scan of every search expression, once per keystroke, for every client on the call floor. Three
 * characters is the first length an index can answer, so below it the client stops asking and
 * answers out of what it already has.
 *
 * It is a plain character count: digits and Latin letters are characters too, and a three-letter
 * Latin query (`sim`) is exactly as indexable as a three-letter Hebrew one.
 */
export const MIN_SEARCH_CHARS = 3;

/** Whether a query has earned a round trip. The one gate every `GET /search` caller shares. */
export const isSearchable = (q: string): boolean => q.trim().length >= MIN_SEARCH_CHARS;

export const useSearch = (q: string, types?: string) =>
  useQuery({
    queryKey: keys.search(q, types),
    enabled: isSearchable(q),
    placeholderData: keepPreviousData,
    queryFn: async (): Promise<SearchResponse> =>
      unwrap(
        await api.GET('/search', {
          params: { query: { q, ...(types && types !== 'all' ? { types } : {}) } },
        }),
      ),
  });
