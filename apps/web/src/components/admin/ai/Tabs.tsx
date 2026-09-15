import { useRef, type KeyboardEvent } from 'react';

export interface TabDef {
  id: string;
  label: string;
}

/**
 * A roving tablist. `role="tablist"` promises arrow-key navigation, and the page is RTL, so
 * ArrowLeft moves *forward* through the tabs — reading order, not codepoint order, is what the
 * user means by "the next tab". Same rule as `feedback/FeedbackPage.tsx`'s status tabs.
 *
 * Only the selected tab is in the tab order (`tabIndex`), which is what makes a tablist one stop
 * for the keyboard rather than five.
 */
export function AdminTabs({
  tabs,
  value,
  onChange,
  controls,
  label = 'לשוניות',
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  controls: string;
  label?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = Math.max(
    0,
    tabs.findIndex((t) => t.id === value),
  );
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    ref.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[n]?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') go(idx + 1);
    else if (e.key === 'ArrowRight') go(idx - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(tabs.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div className="facets" role="tablist" aria-label={label} ref={ref} onKeyDown={onKey}>
      {tabs.map((t, i) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={i === idx}
          aria-controls={controls}
          tabIndex={i === idx ? 0 : -1}
          className={'facet' + (i === idx ? ' on' : '')}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
