import { useEffect, useState } from 'react';

/**
 * A number field that lets you empty it. Lifted verbatim from `admin/WorkflowSettingsSection.tsx`,
 * where it is module-private; X6 may dedupe the two into `components/ui/`.
 *
 * Coercing on every keystroke — `Number(v) || fallback` — snaps a cleared field straight back to
 * its old value, so clearing it and typing a new one appends to the old one ("1024" → "1024768").
 * The text is local and only a parseable value is committed upward; the effect re-syncs when the
 * saved settings change under it.
 *
 * `min`/`max` are enforced, not advisory: the browser's own validation does nothing until a form
 * is submitted and there is no form here. An out-of-range value stays in the field, marked
 * invalid, and is not committed.
 */
export function NumField({
  label,
  value,
  onChange,
  disabled,
  min,
  max,
  step,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const n = Number(text);
  const inRange =
    text !== '' && Number.isFinite(n) && (min === undefined || n >= min) && (max === undefined || n <= max);
  return (
    <label>
      {label}
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={text}
        aria-invalid={text !== '' && !inRange}
        onChange={(e) => {
          setText(e.target.value);
          const v = Number(e.target.value);
          if (
            e.target.value !== '' &&
            Number.isFinite(v) &&
            (min === undefined || v >= min) &&
            (max === undefined || v <= max)
          )
            onChange(v);
        }}
      />
      {text !== '' && !inRange ? (
        <small className="form-error">
          ערך מותר: {min ?? '−∞'}–{max ?? '∞'}
        </small>
      ) : null}
    </label>
  );
}
