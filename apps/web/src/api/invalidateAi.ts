import type { QueryClient } from '@tanstack/react-query';

/**
 * Everything under `ai`, plus the suggestion analytics.
 *
 * The analytics are grouped by model and prompt version, so a change to the brief, the style or
 * the model slots changes what the next rows mean — leaving them cached would show yesterday's
 * acceptance rate under today's prompt version.
 */
export const invalidateAi = (qc: QueryClient): void => {
  for (const queryKey of [['ai'], ['suggestions', 'analytics']]) void qc.invalidateQueries({ queryKey });
};
