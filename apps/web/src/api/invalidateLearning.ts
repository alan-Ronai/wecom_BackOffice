import type { QueryClient } from '@tanstack/react-query';

/**
 * Every learning write can move the manager list, the item, its versions, its completion, the
 * dashboard and the agent's own assignment list — one helper so no mutation forgets a half of it.
 */
export function invalidateLearning(qc: QueryClient, itemId?: string): void {
  for (const queryKey of [
    ['learning', 'items'],
    ['learning', 'dashboard'],
    ['learning', 'my'],
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
