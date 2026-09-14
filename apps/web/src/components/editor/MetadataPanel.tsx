import { useState } from 'react';
import { DOC_TYPES, DOC_TYPE_LABELS, type DocType } from '@wecom/shared';
import { useDebounced } from '../../lib/useDebounced.js';
import { useTags, useTopics, useWorlds } from '../../api/hooks/taxonomy.js';

export interface MetadataValue {
  docType: DocType;
  category: string; // primary world
  worlds: string[]; // extra worlds
  topics: string[]; // topic ids
  tags: string[];
}

/**
 * Editor side panel for PRD §2/§3/§7 metadata — exactly the fields `PATCH /documents/:id`
 * accepts. Owner/editor pickers arrive with W2's columns and are mounted by W6.
 */
export function MetadataPanel({
  value,
  onChange,
  disabled = false,
}: {
  value: MetadataValue;
  onChange: (v: MetadataValue) => void;
  disabled?: boolean;
}) {
  const worlds = useWorlds();
  const topics = useTopics(value.category);
  const [tagQ, setTagQ] = useState('');
  // Debounced key: one request per pause, not one per keystroke.
  const suggestions = useTags(useDebounced(tagQ, 250));
  const set = (patch: Partial<MetadataValue>) => onChange({ ...value, ...patch });
  const toggle = (list: string[], item: string) =>
    list.includes(item) ? list.filter((x) => x !== item) : [...list, item];
  const addTag = (raw: string) => {
    const t = raw.trim().toLowerCase();
    if (t && !value.tags.includes(t)) set({ tags: [...value.tags, t] });
    setTagQ('');
  };
  const wl = worlds.data ?? [];

  return (
    <div className="metadata-panel">
      <label>
        סוג פריט
        <select
          aria-label="סוג פריט"
          value={value.docType}
          disabled={disabled}
          onChange={(e) => set({ docType: e.target.value as DocType })}
        >
          {DOC_TYPES.map((t) => (
            <option key={t} value={t}>
              {t} · {DOC_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      <label>
        עולם תוכן ראשי
        <select
          aria-label="עולם תוכן ראשי"
          value={value.category}
          disabled={disabled}
          // Moving the primary world drops it from the extras and clears the topics, which
          // belong to the world that is being left.
          onChange={(e) =>
            set({
              category: e.target.value,
              worlds: value.worlds.filter((w) => w !== e.target.value),
              topics: [],
            })
          }
        >
          {wl.map((w) => (
            <option key={w.slug} value={w.slug}>
              {w.name}
            </option>
          ))}
        </select>
      </label>
      <fieldset data-testid="extra-worlds">
        <legend>עולמות נוספים</legend>
        {wl
          .filter((w) => w.slug !== value.category)
          .map((w) => (
            <label key={w.slug} className="check">
              <input
                type="checkbox"
                aria-label={w.name}
                disabled={disabled}
                checked={value.worlds.includes(w.slug)}
                onChange={() => set({ worlds: toggle(value.worlds, w.slug) })}
              />
              {w.name}
            </label>
          ))}
      </fieldset>
      <fieldset data-testid="topics">
        <legend>נושאים ({wl.find((w) => w.slug === value.category)?.name ?? value.category})</legend>
        {(topics.data ?? []).map((t) => (
          <label key={t.id} className="check">
            <input
              type="checkbox"
              aria-label={t.name}
              disabled={disabled}
              checked={value.topics.includes(t.id)}
              onChange={() => set({ topics: toggle(value.topics, t.id) })}
            />
            {t.name}
          </label>
        ))}
        {topics.data && topics.data.length === 0 ? (
          <small className="muted">אין נושאים בעולם התוכן הזה עדיין</small>
        ) : null}
      </fieldset>
      <div className="tags-edit">
        <span className="label">תגיות</span>
        {value.tags.map((t) => (
          <span key={t} className="tag">
            {t}
            <button
              type="button"
              aria-label={`הסר תגית ${t}`}
              disabled={disabled}
              onClick={() => set({ tags: value.tags.filter((x) => x !== t) })}
            >
              ✕
            </button>
          </span>
        ))}
        <input
          aria-label="הוסף תגית"
          list="tag-suggestions"
          placeholder="תגית + Enter"
          value={tagQ}
          disabled={disabled}
          onChange={(e) => setTagQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addTag(tagQ);
            }
          }}
        />
        <datalist id="tag-suggestions">
          {(suggestions.data ?? []).map((s) => (
            <option key={s.tag} value={s.tag}>
              {s.count}
            </option>
          ))}
        </datalist>
      </div>
    </div>
  );
}
