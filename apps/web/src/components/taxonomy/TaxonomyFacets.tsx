import { useState } from 'react';
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from '@wecom/shared';
import { useDebounced } from '../../lib/useDebounced.js';
import { useTags } from '../../api/hooks/taxonomy.js';

export interface TaxonomyFacetValue {
  docType: DocType | null;
  tags: string[];
}

/** Controlled facet row: one button per item type, plus tag chips (active first, then suggestions). */
export function TaxonomyFacets({
  value,
  onChange,
}: {
  value: TaxonomyFacetValue;
  onChange: (v: TaxonomyFacetValue) => void;
}) {
  const [q, setQ] = useState('');
  // The query key is the debounced value: typing a five-character tag used to issue five requests.
  const tags = useTags(useDebounced(q, 250));
  const suggestions = (tags.data ?? []).filter((t) => !value.tags.includes(t.tag)).slice(0, 8);
  const toggleType = (t: DocType) => onChange({ ...value, docType: value.docType === t ? null : t });
  const addTag = (t: string) => onChange({ ...value, tags: [...value.tags, t] });
  const removeTag = (t: string) => onChange({ ...value, tags: value.tags.filter((x) => x !== t) });

  return (
    <div className="facets taxonomy-facets">
      {DOC_TYPES.map((t) => (
        <button
          key={t}
          type="button"
          className={'facet' + (value.docType === t ? ' on' : '')}
          onClick={() => toggleType(t)}
        >
          {t} · {DOC_TYPE_LABELS[t]}
        </button>
      ))}
      <span className="vsep" />
      {value.tags.map((t) => (
        <button key={t} type="button" className="facet on" onClick={() => removeTag(t)} title="הסר תגית">
          #{t} ✕
        </button>
      ))}
      <input
        className="facet-input"
        placeholder="תגית…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="חיפוש תגית"
      />
      {suggestions.map((s) => (
        <button key={s.tag} type="button" className="facet" onClick={() => addTag(s.tag)}>
          {s.tag} <small>{s.count}</small>
        </button>
      ))}
    </div>
  );
}
