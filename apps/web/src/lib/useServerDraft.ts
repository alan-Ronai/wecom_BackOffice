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
  /**
   * A server copy arrived while the draft was dirty and was deferred. Once the draft is edited
   * back to its (now stale) base, that copy is adopted rather than left behind: otherwise the
   * draft reads as "dirty" against the newer copy and a save would silently overwrite it.
   */
  const pending = useRef(false);
  const current = useRef<T>(draft);
  current.current = draft;

  const adopt = useCallback((copy: T) => {
    edits.current = 0;
    base.current = copy;
    pending.current = false;
    setDraftState(copy);
  }, []);

  useEffect(() => {
    const d = current.current;
    if (edits.current === 0 || same(d, base.current) || same(d, server)) adopt(server);
    else pending.current = true;
  }, [server, adopt]);

  /*
   * Wave Y review: the base must not go stale. A draft that equals the server copy *is* the server
   * copy — whichever way it got there (edited to match a newer copy, or reverted to what a save
   * just wrote) — so it becomes the clean base and the next server copy is adopted. A draft edited
   * back to a stale base while a newer copy is waiting takes that newer copy.
   */
  useEffect(() => {
    if (same(draft, server)) {
      base.current = server;
      edits.current = 0;
      pending.current = false;
    } else if (pending.current && same(draft, base.current)) {
      adopt(server);
    }
  }, [draft, server, adopt]);

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
