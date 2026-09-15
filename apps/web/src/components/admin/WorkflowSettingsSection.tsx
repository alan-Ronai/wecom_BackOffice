import { useEffect, useRef, useState } from 'react';
import type { WorkflowSettings } from '@wecom/shared';
import { useCan } from '../../api/hooks/me.js';
import { usePutWorkflowSettings, useWorkflowSettings } from '../../api/hooks/workflow.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

/**
 * A number field that lets you empty it.
 *
 * Coercing on every keystroke — `Number(v) || fallback` — snapped a cleared field straight back to
 * its old value, so clearing it and typing a new one appended to the old one ("180" → "180120").
 * The text is local and only a parseable value is committed upward; the effect re-syncs when the
 * saved settings change under it.
 *
 * `min`/`max` are enforced, not advisory: the browser's own validation does nothing until a form
 * is submitted and there is no form here, so a pass mark of 999 used to reach the PUT. An
 * out-of-range value stays in the field, marked invalid, and is not committed.
 */
function NumField({
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

/**
 * Spec §1.6 / §5: the approver switch plus the learning and gap thresholds.
 *
 * The GET is readable with `docs.read` — the review queue needs `requireApprover` to know whether
 * to show its hint — so this renders read-only for anyone without `system.admin` rather than
 * disappearing: a lead who cannot change the rule still benefits from seeing what it is. V6 mounts
 * it in `IdentityPage` for `system.admin`.
 */
export function WorkflowSettingsSection() {
  const can = useCan();
  const mayEdit = can('system.admin');
  const s = useWorkflowSettings(true);
  const put = usePutWorkflowSettings();
  const toast = useToast();
  const [draft, setDraft] = useState<WorkflowSettings | null>(null);
  /**
   * A background refetch of `/admin/workflow` used to overwrite an edit in progress. The server
   * copy is adopted only while nothing is unsaved — and again after a save, which is what clears
   * the flag.
   */
  const dirty = useRef(false);
  useEffect(() => {
    if (s.data && !dirty.current) setDraft(s.data);
  }, [s.data]);
  const edit = (next: WorkflowSettings) => {
    dirty.current = true;
    setDraft(next);
  };

  if (s.isError) return <LoadError what="הגדרות תהליך" error={s.error} />;
  if (!draft) return null;

  const save = (patch: Parameters<typeof put.mutateAsync>[0]) =>
    put
      .mutateAsync(patch)
      .then(() => {
        dirty.current = false;
        toast('ההגדרות נשמרו', 'ok');
      })
      .catch(() => toast('השמירה נכשלה', 'warn'));

  return (
    <section className="settings-card workflow-section" aria-label="תהליך עבודה ולמידה">
      <div className="eyebrow">תהליך עבודה · למידה · פערי ידע</div>
      <div className="form">
        <label className="row">
          <input
            type="checkbox"
            aria-label="דרוש מאשר לפרסום"
            disabled={!mayEdit || put.isPending}
            checked={draft.requireApprover}
            onChange={(e) => {
              edit({ ...draft, requireApprover: e.target.checked });
              void save({ requireApprover: e.target.checked });
            }}
          />
          דרוש מאשר לפרסום
          <small>כשמופעל, אישור סקירה דורש תפקיד &quot;מאשר&quot;; הרשאת פרסום לבדה אינה מספיקה.</small>
        </label>
        <NumField
          label="ציון עובר ברירת מחדל (%)"
          min={1}
          max={100}
          disabled={!mayEdit}
          value={draft.learning.defaultPassMark}
          onChange={(n) => edit({ ...draft, learning: { ...draft.learning, defaultPassMark: n } })}
        />
        <label>
          ניסיונות מרביים ברירת מחדל
          <select
            aria-label="ניסיונות מרביים ברירת מחדל"
            disabled={!mayEdit}
            value={draft.learning.defaultMaxAttempts ?? ''}
            onChange={(e) =>
              edit({
                ...draft,
                learning: {
                  ...draft.learning,
                  defaultMaxAttempts: e.target.value ? Number(e.target.value) : null,
                },
              })
            }
          >
            {/* `null` = unlimited retakes (spec §1.4). */}
            <option value="">ללא הגבלה</option>
            {[1, 2, 3, 5, 10].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <NumField
          label="ימים להשלמת רענון ידע"
          min={1}
          max={90}
          disabled={!mayEdit}
          value={draft.learning.refreshDueDays}
          onChange={(n) => edit({ ...draft, learning: { ...draft.learning, refreshDueDays: n } })}
        />
        <NumField
          label="תזכורת לפני מועד היעד (ימים)"
          min={0}
          max={30}
          disabled={!mayEdit}
          value={draft.learning.reminderDaysBefore}
          onChange={(n) => edit({ ...draft, learning: { ...draft.learning, reminderDaysBefore: n } })}
        />
        <NumField
          label="מינימום חיפושים ללא תוצאה"
          min={1}
          disabled={!mayEdit}
          value={draft.gaps.zeroResultMin}
          onChange={(n) => edit({ ...draft, gaps: { ...draft.gaps, zeroResultMin: n } })}
        />
        <NumField
          label="מינימום משובים לאשכול"
          min={1}
          disabled={!mayEdit}
          value={draft.gaps.feedbackClusterMin}
          onChange={(n) => edit({ ...draft, gaps: { ...draft.gaps, feedbackClusterMin: n } })}
        />
        <NumField
          label="פריט נחשב מיושן אחרי (ימים)"
          min={30}
          disabled={!mayEdit}
          value={draft.gaps.staleDays}
          onChange={(n) => edit({ ...draft, gaps: { ...draft.gaps, staleDays: n } })}
        />
        <NumField
          label="שיעור כישלון לשאלה בעייתית"
          min={0.1}
          max={1}
          step={0.05}
          disabled={!mayEdit}
          value={draft.gaps.failedQuestionRate}
          onChange={(n) => edit({ ...draft, gaps: { ...draft.gaps, failedQuestionRate: n } })}
        />
        {mayEdit ? (
          <button
            type="button"
            className="btn primary sm"
            disabled={put.isPending}
            onClick={() => void save({ learning: draft.learning, gaps: draft.gaps })}
          >
            שמור הגדרות
          </button>
        ) : null}
      </div>
    </section>
  );
}
