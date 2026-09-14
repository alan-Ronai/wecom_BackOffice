import { useState } from 'react';
import { useSearch } from '../../../api/hooks/search.js';
import { useDebounced } from '../../../lib/useDebounced.js';

export interface PickedDoc {
  id: string;
  title: string;
}

/**
 * Search-backed picker over knowledge items.
 *
 * Only what the caller may see comes back — the API applies the same gate the library does — so
 * the picker never has to decide what a briefing is allowed to reference.
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
  const dq = useDebounced(q, 250);
  const res = useSearch(dq, 'documents');
  const hits = (res.data?.groups ?? [])
    .flatMap((g) => g.hits)
    .filter((h) => h.type === 'document' && !exclude.includes(h.id));

  return (
    <div className="doc-picker">
      <label className="small">
        {label}
        <input
          aria-label={label}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש פריט ידע…"
        />
      </label>
      {dq && hits.length ? (
        <div className="results" role="listbox" aria-label="תוצאות">
          {hits.slice(0, 12).map((h) => (
            <button
              key={h.id}
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => {
                onPick({ id: h.id, title: h.title });
                setQ('');
              }}
            >
              {h.title} <small>· {h.meta}</small>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
