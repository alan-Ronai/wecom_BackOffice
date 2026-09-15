export type PaneMode = 'work' | 'source' | 'split';

/** Exported so A-6's overflow menu offers the same three modes under the same three labels. */
export const PANE_MODES: { id: PaneMode; label: string; needsSource: boolean }[] = [
  { id: 'work', label: 'תצוגת עבודה', needsSource: false },
  { id: 'source', label: 'מקור', needsSource: true },
  { id: 'split', label: 'מפוצל', needsSource: true },
];

/** Article pane switch. Persisted by the caller through `Preferences.paneMode`. */
export function PaneModeToggle({
  value,
  onChange,
  hasSource,
}: {
  value: PaneMode;
  onChange: (m: PaneMode) => void;
  hasSource: boolean;
}) {
  return (
    <div className="seg" role="group" aria-label="מצב תצוגה">
      {PANE_MODES.map((m) => (
        <button
          key={m.id}
          type="button"
          className={'seg-btn' + (value === m.id ? ' on' : '')}
          aria-pressed={value === m.id}
          disabled={m.needsSource && !hasSource}
          onClick={() => onChange(m.id)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}
