import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react';

const same = (a: unknown, b: unknown): boolean => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * A local, explicitly-saved draft of a server value — B-M11 (wave 5), the B-C2 `dirty` guard as a
 * hook for the briefing and quiz builders.
 *
 * `useEffect(() => setDraft(server), [server])` discards an unsaved draft whenever the server
 * array's *identity* changes: a refetch that TanStack's structural sharing cannot preserve (a
 * payload differing by a timestamp, a library upgrade) and the manager's work is gone without a
 * word. Here a server copy is adopted only while the draft is clean — untouched since it was last
 * taken from the server, or edited back to exactly that — and one arriving mid-edit waits.
 *
 * `commit` runs the save and then adopts the server's answer (normalised, possibly reordered) as the
 * new clean base, unless the user edited again while it was in flight.
 */
export function useServerDraft<T>(server: T) {
  const [draft, setDraftState] = useState<T>(server);
  /** The server copy the draft was last taken from. */
  const base = useRef<T>(server);
  /** Edits since then. Non-zero with a draft equal to `base` still counts as clean. */
  const edits = useRef(0);
  const current = useRef<T>(draft);
  current.current = draft;

  const adopt = useCallback((copy: T) => {
    edits.current = 0;
    base.current = copy;
    setDraftState(copy);
  }, []);

  useEffect(() => {
    if (edits.current === 0 || same(current.current, base.current)) adopt(server);
  }, [server, adopt]);

  const setDraft = useCallback((next: SetStateAction<T>) => {
    edits.current += 1;
    setDraftState(next);
  }, []);

  const commit = useCallback(
    async <R>(run: () => Promise<R>, copyOf: (saved: R) => T): Promise<R> => {
      const at = edits.current;
      const saved = await run();
      if (edits.current === at) adopt(copyOf(saved));
      return saved;
    },
    [adopt],
  );

  return { draft, setDraft, dirty: !same(draft, server), commit };
}
