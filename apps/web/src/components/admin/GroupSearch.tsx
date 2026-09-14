import { useEffect, useRef, useState } from 'react';
import { useGroupSearch } from '../../api/hooks/stage5.js';
import { ApiError } from '../../api/unwrap.js';
import { useDebounced } from '../../lib/useDebounced.js';
import type { GroupSearchItem } from '../../api/stage5.js';

/**
 * Design 3d's "⌕ חפש קבוצה ב-Entra…".
 *
 * The box exists because the field it fills is an Entra **object id** — a GUID nobody knows by
 * heart, which was previously pasted in from the Azure portal. A mistyped GUID produces a mapping
 * that matches nobody, and that is indistinguishable from a correct mapping for an empty group, so
 * it is the one error on this screen that nothing downstream can catch.
 *
 * Two states are worth telling apart and are told apart: "this deployment has no Entra connection"
 * (503) points at the identity screen, while "Graph did not answer" (502) says so and leaves the
 * manual id field usable — because it still is.
 */
export function GroupSearch({
  onPick,
  taken,
}: {
  onPick: (g: GroupSearchItem) => void;
  /** Group ids already in the map: offering them again would produce a duplicate row. */
  taken: ReadonlySet<string>;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  // 300 ms: long enough that a typed word is one request, short enough that a pause feels answered.
  const debounced = useDebounced(term.trim(), 300);
  const search = useGroupSearch(debounced);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const status = search.error instanceof ApiError ? search.error.status : null;
  const items = search.data?.items ?? [];
  // The list is only meaningful for the term that is actually on screen; while the debounce is in
  // flight it would otherwise show results for the previous word under the new one.
  const settled = debounced === term.trim() && !search.isFetching;

  return (
    <div className="group-search" ref={box}>
      <input
        type="search"
        aria-label="חפש קבוצה ב-Entra"
        placeholder="⌕ חפש קבוצה ב-Entra…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && debounced ? (
        <div className="group-search-results" role="listbox" aria-label="תוצאות חיפוש קבוצות">
          {status === 503 ? (
            <div className="small muted">חיפוש קבוצות דורש חיבור ל-Entra ID · הגדירו אותו במסך הזהויות</div>
          ) : status ? (
            <div className="small muted">החיפוש ב-Entra ID נכשל · אפשר להזין מזהה קבוצה ידנית</div>
          ) : !settled ? (
            <div className="small muted">מחפש…</div>
          ) : !items.length ? (
            <div className="small muted">לא נמצאו קבוצות שמתחילות ב-{debounced}</div>
          ) : (
            items.map((g) => (
              <button
                key={g.id}
                type="button"
                role="option"
                aria-selected={false}
                className="group-search-item"
                disabled={taken.has(g.id)}
                onClick={() => {
                  onPick(g);
                  setTerm('');
                  setOpen(false);
                }}
              >
                <b>{g.displayName}</b>
                <span className="small muted">{taken.has(g.id) ? 'כבר ממופה' : (g.description ?? g.id)}</span>
              </button>
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
