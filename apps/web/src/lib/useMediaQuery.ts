import { useEffect, useState } from 'react';

/**
 * Subscribes to a media query.
 *
 * Used where a breakpoint has to change the *markup*, not just its styling — A-6 collapses the
 * article topbar's actions into one overflow menu on a phone, and rendering both sets and hiding
 * one in CSS would put two copies of every control in the accessibility tree and in the tab order.
 *
 * `matchMedia` is guarded because jsdom has not always had it and a missing implementation should
 * mean "the wide layout", not a crash on mount.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia?.(query);
    if (!mq) return;
    // Re-read on subscribe: the query can have changed between the initial state and this effect.
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
