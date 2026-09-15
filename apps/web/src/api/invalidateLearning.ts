import type { QueryClient } from '@tanstack/react-query';

/**
 * Every learning write can move the manager list, the item, its versions, its completion, the
 * dashboard and the agent's own assignment list — one helper so no mutation forgets a half of it.
 *
 * `player`, `audienceOptions` and `changePreview` are in the list because the mutation path has to
 * cover what the SSE path already covers by prefix (`['learning']`): a publish that raises a
 * refresh must drop a player payload a learner already has open, an audience just created changes
 * the options, and a publish changes what the change preview would say next.
 */
export function invalidateLearning(qc: QueryClient, itemId?: string): void {
  for (const queryKey of [
    ['learning', 'items'],
    ['learning', 'dashboard'],
    ['learning', 'my'],
    ['learning', 'player'],
    ['learning', 'audienceOptions'],
    ['learning', 'changePreview'],
  ] as const)
    void qc.invalidateQueries({ queryKey });
  if (itemId)
    for (const queryKey of [
      ['learning', 'item', itemId],
      ['learning', 'versions', itemId],
      ['learning', 'completion', itemId],
      ['learning', 'doc'],
    ] as const)
      void qc.invalidateQueries({ queryKey });
}
