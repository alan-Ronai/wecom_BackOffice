import { useEffect, useState } from 'react';
import {
  MODEL_TIER_PRESETS,
  type AiLimitsSettings,
  type AiModelsSettings,
  type ModelSlot,
  type ModelTestResult,
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
const SLOT_ENV: Record<ModelSlot, string> = {
  suggest: 'SUGGEST_MODEL',
  chat: 'CHAT_MODEL',
  embed: 'EMBED_MODEL',
};
const fmtBytes = (n?: number) => (n ? (n / 1e9).toFixed(1) + ' GB' : '—');

/**
 * מודלים — the resolved tier and slots (read-only), a reachability test per slot, the request
 * limits, and the reindex job (spec §6).
 *
 * **The model block is the environment's, not this screen's.** `MODEL_TIER`, `SUGGEST_MODEL`,
 * `CHAT_MODEL`, `EMBED_MODEL` and `EMBED_DIMENSION` are resolved at boot and are what the pull
 * scripts, the embedding column width and the running process all agree on; `PUT
 * /admin/ai/settings` rejects a `models` block outright with 400 `MODELS_ENV_ONLY`. Editing them
 * here would have written a row the process never reads — a settings page that lies. Switching a
 * model is a deploy change: edit the environment, run `deploy/ollama-pull.sh`, restart.
 *
 * What stays editable is `ai.limits`, which the API reads per request. "בדוק" stays live too, and
 * it now always reports the slot that is actually running — there is no unsaved tag for it to
 * disagree with.
 */
export function ModelsTab() {
  const s = useAiSettings();
  const put = usePutAiSettings();
  const test = useTestModel();
  const reindex = useReindex();
  const modal = useModal();
  const toast = useToast();
  const [limits, setLimits] = useState<AiLimitsSettings | null>(null);
  const [results, setResults] = useState<Partial<Record<ModelSlot, ModelTestResult>>>({});

  useEffect(() => {
    if (!s.data) return;
    setLimits((cur) => cur ?? s.data.limits);
  }, [s.data]);

  if (!limits || !s.data) return <p className="muted">טוען…</p>;

  const m = s.data.models;
  const preset = MODEL_TIER_PRESETS[m.tier];

  return (
    <div className="ai-models">
      <section className="settings-card">
        <h2>דרגת מודלים</h2>
        <p>
          <b>דרגה {m.tier}</b> · {preset.vm} · {preset.notes}
        </p>
        <p className="muted small">
          הדרגה והמשבצות נקבעות בתצורת השרת (<bdi dir="ltr">MODEL_TIER</bdi>) ומוצגות כאן לקריאה בלבד. החלפת
          מודל היא שינוי פריסה: יש לעדכן את משתני הסביבה, להריץ <bdi dir="ltr">deploy/ollama-pull.sh</bdi>{' '}
          ולהפעיל מחדש.
        </p>
      </section>

      {SLOTS.map((slot) => {
        const r = results[slot];
        return (
          <section className="settings-card" key={slot}>
            <h2>{SLOT_LABEL[slot]}</h2>
            <p>
              <span className="small muted">תג המודל · </span>
              <bdi dir="ltr" aria-label={`תג המודל · ${SLOT_LABEL[slot]}`}>
                {m[SLOT_FIELD[slot]]}
              </bdi>
            </p>
            <p className="muted small">
              מתוך <bdi dir="ltr">{SLOT_ENV[slot]}</bdi>
              {slot === 'embed' ? ` · ${m.embedDimension} ממדים (EMBED_DIMENSION)` : ''}
            </p>
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
              // `limits` only: a `models` block is refused with 400 `MODELS_ENV_ONLY`.
              .mutateAsync({ limits })
              .then(() => toast('המגבלות נשמרו', 'ok'))
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
              'הפעולה רצה ברקע ועשויה להימשך דקות. אחרי שינוי של EMBED_MODEL או EMBED_DIMENSION בתצורת השרת האינדוקס הוא חובה — עד שיסתיים, החיפוש מדורג לקסיקלית בלבד.',
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
      </div>
    </div>
  );
}
