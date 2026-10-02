import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { useSearch } from '../../../api/hooks/search.js';
import { useDebounced } from '../../../lib/useDebounced.js';

export interface PickedDoc {
  id: string;
  title: string;
}

const MAX_RESULTS = 12;

/**
 * Search-backed picker over knowledge items.
 *
 * Only what the caller may see comes back — the API applies the same gate the library does — so
 * the picker never has to decide what a briefing is allowed to reference.
 *
 * An ARIA 1.2 combobox: focus never leaves the input; the active result is announced through
 * `aria-activedescendant`, moved with ArrowUp/ArrowDown (Home/End jump), picked with Enter and
 * dismissed with Escape. The mouse still works — options keep focus in the input on press.
 */
export function DocumentPicker({
  onPick,
  exclude = [],
  label = 'הוסף פריט ידע',
}: {
  onPick: (d: PickedDoc) => void;
  exclude?: string[];
  label?: string;
}) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(-1);
  const [dismissed, setDismissed] = useState(false);
  const baseId = useId();
  const listId = `${baseId}-results`;
  const optionId = (i: number) => `${baseId}-opt-${i}`;

  const dq = useDebounced(q, 250);
  const res = useSearch(dq, 'documents');
  const hits = (res.data?.groups ?? [])
    .flatMap((g) => g.hits)
    .filter((h) => h.type === 'document' && !exclude.includes(h.id))
    .slice(0, MAX_RESULTS);

  const open = Boolean(dq) && hits.length > 0 && !dismissed;
  // A new result set can be shorter than the old one; an index past its end means "none".
  const activeIdx = open && active < hits.length ? active : -1;

  const activeId = activeIdx >= 0 ? optionId(activeIdx) : undefined;
  useEffect(() => {
    if (!activeId) return;
    // Long result lists scroll; keep the announced option in view.
    document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  const pick = (i: number) => {
    const h = hits[i];
    if (!h) return;
    onPick({ id: h.id, title: h.title });
    setQ('');
    setActive(-1);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        if (!hits.length || !dq) return;
        e.preventDefault();
        const down = e.key === 'ArrowDown';
        if (!open) {
          setDismissed(false);
          setActive(down ? 0 : hits.length - 1);
          return;
        }
        const next =
          activeIdx < 0
            ? down
              ? 0
              : hits.length - 1
            : (activeIdx + (down ? 1 : -1) + hits.length) % hits.length;
        setActive(next);
        return;
      }
      case 'Home':
      case 'End':
        if (!open) return;
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : hits.length - 1);
        return;
      case 'Enter':
        // Never let Enter submit an enclosing form while the list is open.
        if (!open) return;
        e.preventDefault();
        if (activeIdx >= 0) pick(activeIdx);
        return;
      case 'Escape':
        if (!open) return;
        // Consumed here, so a dialog around the picker does not close with it.
        e.preventDefault();
        e.stopPropagation();
        setDismissed(true);
        setActive(-1);
        return;
      default:
    }
  };

  return (
    <div className="doc-picker">
      <label className="small">
        {label}
        <input
          role="combobox"
          aria-label={label}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={listId}
          aria-activedescendant={activeId}
          autoComplete="off"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setDismissed(false);
            setActive(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setActive(-1)}
          placeholder="חיפוש פריט ידע…"
        />
      </label>
      <ul id={listId} className="results" role="listbox" aria-label="תוצאות" hidden={!open}>
        {open
          ? hits.map((h, i) => (
              <li
                key={h.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === activeIdx}
                className={i === activeIdx ? 'active' : undefined}
                // Keep focus (and the active descendant) in the input while the mouse presses.
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                {h.title} <small>· {h.meta}</small>
              </li>
            ))
          : null}
      </ul>
    </div>
  );
}
