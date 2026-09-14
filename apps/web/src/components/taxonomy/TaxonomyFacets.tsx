import { useState } from 'react';
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from '@wecom/shared';
import { useDebounced } from '../../lib/useDebounced.js';
import { useTags, useTopics, useWorlds } from '../../api/hooks/taxonomy.js';

export interface TaxonomyFacetValue {
  /** World slug, or null for "every world the caller can read". */
  world: string | null;
  /** Topic id. Only meaningful inside a world, so picking a world clears it. */
  topic: string | null;
  docType: DocType | null;
  tags: string[];
}

/**
 * Controlled facet row: world and topic selects, one button per item type, then tag chips (active
 * first, then suggestions).
 *
 * World and topic were originally left to the sidebar and the topic page, on the grounds that
 * `?world=`/`?topic=` were honoured in the URL so a link could still reproduce any combination.
 * What that could not do was let an agent *narrow to a second world* from the toolbar — they had
 * to go back to the sidebar and lose the type and tag filters they had built up. The selects write
 * the same two query parameters the sidebar does, so nothing about the URL contract changes.
 *
 * Topic is scoped to the chosen world because `GET /worlds/:slug/topics` is the only list of
 * topics there is; with no world picked the select is disabled rather than absent, so the row does
 * not reflow when a world is chosen.
 */
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
  const worlds = useWorlds();
  const topics = useTopics(value.world ?? undefined);
  const suggestions = (tags.data ?? []).filter((t) => !value.tags.includes(t.tag)).slice(0, 8);
  const toggleType = (t: DocType) => onChange({ ...value, docType: value.docType === t ? null : t });
  const addTag = (t: string) => onChange({ ...value, tags: [...value.tags, t] });
  const removeTag = (t: string) => onChange({ ...value, tags: value.tags.filter((x) => x !== t) });

  return (
    <div className="facets taxonomy-facets">
      <select
        className="facet-select"
        aria-label="עולם תוכן"
        value={value.world ?? ''}
        // A topic belongs to exactly one world, so keeping it across a world change would produce
        // a filter pair that matches nothing.
        onChange={(e) => onChange({ ...value, world: e.target.value || null, topic: null })}
      >
        <option value="">כל העולמות</option>
        {(worlds.data ?? []).map((w) => (
          <option key={w.slug} value={w.slug}>
            {w.name}
          </option>
        ))}
      </select>
      <select
        className="facet-select"
        aria-label="נושא"
        value={value.topic ?? ''}
        disabled={!value.world}
        onChange={(e) => onChange({ ...value, topic: e.target.value || null })}
      >
        <option value="">{value.world ? 'כל הנושאים' : 'בחר עולם תחילה'}</option>
        {(topics.data ?? []).map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>
      <span className="vsep" />
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
