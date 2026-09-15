import { useEffect, useState } from 'react';
import {
  MODEL_TIER_PRESETS,
  type AiLimitsSettings,
  type AiModelsSettings,
  type ModelSlot,
  type ModelTestResult,
  type ModelTier,
} from '@wecom/shared';
import { useAiSettings, usePutAiSettings, useReindex, useTestModel } from '../../../api/hooks/aiAdmin.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { NumField } from './NumField.js';

const SLOTS: ModelSlot[] = ['suggest', 'chat', 'embed'];
const SLOT_LABEL: Record<ModelSlot, string> = {
  suggest: 'מודל הצעות',
  chat: "מודל צ'אט",
  embed: 'מודל הטמעה',
};
const SLOT_FIELD = {
  suggest: 'suggestModel',
  chat: 'chatModel',
  embed: 'embedModel',
} as const satisfies Record<ModelSlot, keyof AiModelsSettings>;
const TIERS: ModelTier[] = [0, 1, 2, 3, 4];
const fmtBytes = (n?: number) => (n ? (n / 1e9).toFixed(1) + ' GB' : '—');

/**
 * מודלים — the tier preset, the three slots, a reachability test per slot, and the reindex job
 * (spec §6).
 *
 * A tier is configuration, not code: picking one fills the three slots from `MODEL_TIER_PRESETS`
 * and each slot stays individually editable afterwards. Nothing is saved until "שמור", so an
 * admin can compare a tier against what is running before committing to it.
 *
 * Changing `embedDimension` is the one setting that invalidates data: existing vectors are not
 * convertible, so the screen says so and the reindex confirmation repeats it.
 */
export function ModelsTab() {
  const s = useAiSettings();
  const put = usePutAiSettings();
  const test = useTestModel();
  const reindex = useReindex();
  const modal = useModal();
  const toast = useToast();
  const [m, setM] = useState<AiModelsSettings | null>(null);
  const [limits, setLimits] = useState<AiLimitsSettings | null>(null);
  const [results, setResults] = useState<Partial<Record<ModelSlot, ModelTestResult>>>({});

  useEffect(() => {
    if (!s.data) return;
    setM((cur) => cur ?? s.data.models);
    setLimits((cur) => cur ?? s.data.limits);
  }, [s.data]);

  if (!m || !limits || !s.data) return <p className="muted">טוען…</p>;

  const preset = MODEL_TIER_PRESETS[m.tier];
  const applyTier = (tier: ModelTier) => {
    const p = MODEL_TIER_PRESETS[tier];
    setM({
      tier,
      suggestModel: p.suggestModel,
      chatModel: p.chatModel,
      embedModel: p.embedModel,
      embedDimension: p.embedDimension,
    });
  };
  const dimsChanged = m.embedDimension !== s.data.models.embedDimension;

  return (
    <div className="ai-models">
      <section className="settings-card">
        <h2>דרגת מודלים</h2>
        <label>
          דרגה
          <select
            aria-label="דרגה"
            value={m.tier}
            onChange={(e) => applyTier(Number(e.target.value) as ModelTier)}
          >
            {TIERS.map((t) => (
              <option key={t} value={t}>
                דרגה {t}
              </option>
            ))}
          </select>
        </label>
        <p className="muted small">
          {preset.vm} · {preset.notes}
        </p>
        <p className="muted small">
          בחירת דרגה ממלאת את שלוש המשבצות מהתצורה המומלצת; אפשר לערוך כל משבצת בנפרד.
        </p>
      </section>

      {SLOTS.map((slot) => {
        const field = SLOT_FIELD[slot];
        const r = results[slot];
        return (
          <section className="settings-card" key={slot}>
            <h2>{SLOT_LABEL[slot]}</h2>
            <label>
              תג המודל
              <input
                dir="ltr"
                aria-label={`תג המודל · ${SLOT_LABEL[slot]}`}
                value={m[field]}
                onChange={(e) => setM({ ...m, [field]: e.target.value })}
              />
            </label>
            {slot === 'embed' ? (
              <NumField
                label="מספר ממדים"
                value={m.embedDimension}
                min={64}
                max={4096}
                onChange={(n) => setM({ ...m, embedDimension: n })}
              />
            ) : null}
            <div className="row">
              <button
                type="button"
                className="btn sm"
                disabled={test.isPending}
                onClick={() =>
                  void test
                    .mutateAsync({ slot })
                    .then((res) => setResults((x) => ({ ...x, [slot]: res })))
                    .catch(() => toast('הבדיקה נכשלה', 'warn'))
                }
              >
                בדוק
              </button>
              {r ? (
                <span role="status">
                  {r.reachable ? '✔ זמין' : '✖ לא זמין'} · {fmtBytes(r.sizeBytes)}
                  {r.dims ? ` · ${r.dims} ממדים` : ''}
                  {r.tokensPerSec ? ` · ${r.tokensPerSec.toFixed(1)} טוקנים/שנייה` : ''}
                  {r.error ? ` · ${r.error}` : ''}
                </span>
              ) : null}
            </div>
          </section>
        );
      })}

      <section className="settings-card">
        <h2>מגבלות</h2>
        <NumField
          label="הודעות צ'אט למשתמש לשעה"
          value={limits.chatPerUserPerHour}
          min={1}
          max={10000}
          onChange={(n) => setLimits({ ...limits, chatPerUserPerHour: n })}
        />
        <NumField
          label="תקציב הקשר (תווים)"
          value={limits.maxContextChars}
          min={1000}
          max={1000000}
          step={1000}
          onChange={(n) => setLimits({ ...limits, maxContextChars: n })}
        />
      </section>

      <div className="row">
        <button
          type="button"
          className="btn"
          disabled={put.isPending}
          onClick={() =>
            void put
              .mutateAsync({ models: m, limits })
              .then(() => toast('המודלים נשמרו', 'ok'))
              .catch((e: unknown) => toast(e instanceof Error ? e.message : 'השמירה נכשלה', 'warn'))
          }
        >
          שמור
        </button>
        <button
          type="button"
          className="btn ghost"
          disabled={reindex.isPending}
          onClick={async () => {
            const ok = await modal.confirm(
              'אינדוקס מחדש של כל ההטמעות?',
              dimsChanged
                ? 'מספר הממדים השתנה — חובה לבצע אינדוקס מחדש אחרי השמירה. עד שיסתיים, החיפוש מדורג לקסיקלית בלבד.'
                : 'הפעולה רצה ברקע ועשויה להימשך דקות.',
            );
            if (!ok) return;
            try {
              await reindex.mutateAsync();
              toast('האינדוקס נוסף לתור', 'ok');
            } catch {
              toast('לא ניתן להפעיל אינדוקס', 'warn');
            }
          }}
        >
          אינדוקס מחדש
        </button>
        {dimsChanged ? <span className="chip warn">שינוי ממדים דורש אינדוקס מחדש</span> : null}
      </div>
    </div>
  );
}
