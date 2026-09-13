import { useCallback } from 'react';
import type { Preferences } from '@wecom/shared';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { useModal } from '../ui/Modal.js';
import { Fmt } from '../Fmt.js';
import { useFields } from '../../api/hooks/content.js';

const SAMPLE = [
  'ודא שה-APN מוגדר ל-WE · אם לא מוגדר → הגדר. סימון רשת: H+ / 3G / LTE / 5G.',
  'CRM ← מצב עריכה ← sim block lbl ← שמור · שוב עריכה ← sim allow lbl ← שמור',
  'בקש מהלקוח להריץ Speedtest — מעל 6 Mbps תקין · עודכן 12.06.2025 · גרסה v7',
];

function Pill({
  options,
  value,
  onPick,
}: {
  options: { key: string; label: string }[];
  value: string;
  onPick: (k: string) => void;
}) {
  return (
    <span className="pill-toggle">
      {options.map((o) => (
        <span
          key={o.key}
          className={o.key === value ? 'on' : ''}
          role="button"
          tabIndex={0}
          onClick={() => onPick(o.key)}
        >
          {o.label}
        </span>
      ))}
    </span>
  );
}

/** Port of legacy KB.showSettings — typography, theme, panel, live type sample, local reset. */
export function SettingsBody() {
  const prefs = usePreferences();
  const save = useSavePreferences();
  const fields = useFields();
  const p: Preferences = prefs.data ?? {
    theme: null,
    font: 'plex',
    panel: true,
    callMode: true,
    sidebarExpanded: false,
  };
  const set = (patch: Partial<Preferences>) => save.mutate({ ...p, ...patch });

  return (
    <div>
      <div className="settings-row">
        <div>
          מערכת טיפוגרפיה
          <div className="d">החלפה חיה בין המערכת הנוכחית למוצעת</div>
        </div>
        <Pill
          value={p.font}
          options={[
            { key: 'rubik', label: 'מצב נוכחי (Rubik)' },
            { key: 'plex', label: 'מוצע (Plex Hebrew)' },
          ]}
          onPick={(k) => set({ font: k as Preferences['font'] })}
        />
      </div>
      <div className="settings-row">
        <div>
          ערכת צבעים
          <div className="d">מצב כהה לנציגים במשמרות לילה · Ctrl D</div>
        </div>
        <Pill
          value={p.theme ?? 'system'}
          options={[
            { key: 'light', label: 'בהיר' },
            { key: 'dark', label: 'כהה' },
            { key: 'system', label: 'לפי המערכת' },
          ]}
          onPick={(k) => set({ theme: k === 'system' ? null : (k as 'light' | 'dark') })}
        />
      </div>
      <div className="settings-row">
        <div>
          פאנל קשרים במסמך
          <div className="d">הפאנל הימני: קשרים · הערות · גרסאות</div>
        </div>
        <Pill
          value={p.panel ? 'on' : 'off'}
          options={[
            { key: 'on', label: 'מוצג' },
            { key: 'off', label: 'מוסתר' },
          ]}
          onPick={(k) => set({ panel: k === 'on' })}
        />
      </div>
      <div className="settings-row">
        <div>
          מצב שיחה כברירת מחדל
          <div className="d">ניווט במקלדת, מעקב תוצאות וסיכום לתיעוד</div>
        </div>
        <Pill
          value={p.callMode ? 'on' : 'off'}
          options={[
            { key: 'on', label: 'פעיל' },
            { key: 'off', label: 'מצב קריאה' },
          ]}
          onPick={(k) => set({ callMode: k === 'on' })}
        />
      </div>

      <div className="eyebrow" style={{ margin: '16px 0 8px' }}>
        דוגמת טקסט מעורב
      </div>
      <div className="type-sample">
        {SAMPLE.map((s) => (
          <Fmt key={s} as="div" text={s} fields={fields.data ?? []} docs={[]} />
        ))}
        <div className="n">
          {p.font === 'rubik'
            ? 'נוכחי: Rubik Latin רחב ובהיר יותר מהעברית; מזהים לטיניים עדיין מבודדים (bdi ltr) כדי שהסדר לא יתהפך.'
            : 'מוצע: אותיות עבריות ולטיניות באותו משקל וגובה x, כל מזהה מבודד (bdi ltr) — הסדר קבוע גם עם "/" ו-"=".'}
        </div>
      </div>

      <div className="settings-row" style={{ marginTop: 14, border: 0 }}>
        <div>
          איפוס מצב מקומי
          <div className="d">מנקה לשוניות, התקדמות שיחה וטיוטות שנשמרו בדפדפן זה בלבד</div>
        </div>
        <button
          className="btn sm danger"
          onClick={() => {
            sessionStorage.clear();
            window.location.reload();
          }}
        >
          אפס
        </button>
      </div>
    </div>
  );
}

export function useSettings(): { open: () => void } {
  const modal = useModal();
  const open = useCallback(
    () => void modal.open({ title: '⚙ תצוגה וטיפוגרפיה', body: <SettingsBody />, wide: true }),
    [modal],
  );
  return { open };
}
