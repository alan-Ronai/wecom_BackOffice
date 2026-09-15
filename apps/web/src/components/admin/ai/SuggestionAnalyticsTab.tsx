import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCan } from '../../../api/hooks/me.js';
import { useSuggestionAnalytics } from '../../../api/hooks/suggestionAnalytics.js';
import { Empty } from '../../ui/index.js';

const pct = (x: number) => Math.round(x * 100) + '%';
const GROUPS = [
  ['byType', 'לפי סוג'],
  ['bySource', 'לפי מקור'],
  ['byModel', 'לפי מודל'],
  ['byPromptVersion', 'לפי גרסת הנחיות'],
] as const;
type GroupKey = (typeof GROUPS)[number][0];

/**
 * `<input type="date">` gives a *local* calendar day, so the instant is built with the local
 * constructor and converted. `new Date(d + 'T00:00:00.000Z')` reads it as UTC — in Israel
 * (UTC+2/+3) "from the 14th" would start at 03:00 on the 14th and lose the first hours of the day.
 * Same pair as `analytics/AnalyticsPage.tsx`, copied rather than imported: they are the page's own
 * local helpers, not a shared API.
 */
const toIso = (d: string, endOfDay = false) => {
  if (!d) return '';
  const [y, m, day_] = d.split('-').map(Number) as [number, number, number];
  return endOfDay
    ? new Date(y, m - 1, day_, 23, 59, 59, 999).toISOString()
    : new Date(y, m - 1, day_, 0, 0, 0, 0).toISOString();
};
/** Back to a local calendar day for the input, mirroring `toIso`. */
const day = (iso?: string) => {
  if (!iso) return '';
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/**
 * אנליטיקת הצעות — what the pipeline proposed and what editors did with it (spec §1.9).
 *
 * "נערכו" is the number the prompt work actually turns on: a suggestion accepted *after* an editor
 * rewrote it was useful but wrong in its details, and a high edit rate under one prompt version is
 * the signal that separates "the model is unhelpful" from "the model is nearly right".
 *
 * The window lives in the URL so a rate can be linked to; the breakdown is local, because it is a
 * way of looking at the same window rather than a different question.
 */
export function SuggestionAnalyticsTab() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const [group, setGroup] = useState<GroupKey>('byType');
  const from = sp.get('from') ?? undefined;
  const to = sp.get('to') ?? undefined;
  const mayRead = can('analytics.read');
  const a = useSuggestionAnalytics({ from, to }, mayRead);

  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };

  if (!mayRead) return <Empty title="אין הרשאה לצפייה באנליטיקה" />;
  if (!a.data) return <p className="muted">טוען…</p>;
  const rows = a.data[group];

  return (
    <div className="ai-analytics">
      <div className="row">
        <label>
          מתאריך
          <input
            type="date"
            aria-label="מתאריך"
            value={day(from)}
            onChange={(e) => set('from', toIso(e.target.value))}
          />
        </label>
        <label>
          עד תאריך
          <input
            type="date"
            aria-label="עד תאריך"
            value={day(to)}
            onChange={(e) => set('to', toIso(e.target.value, true))}
          />
        </label>
        <label>
          פילוח
          <select aria-label="פילוח" value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>
            {GROUPS.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="stats">
        <div className="stat">
          <b>{a.data.total}</b>
          <span>הצעות</span>
        </div>
        <div className="stat">
          <b>{pct(a.data.rates.accepted)}</b>
          <span>אושרו</span>
        </div>
        <div className="stat">
          <b>{pct(a.data.rates.edited)}</b>
          <span>נערכו ואושרו</span>
        </div>
        <div className="stat">
          <b>{pct(a.data.rates.rejected)}</b>
          <span>נדחו</span>
        </div>
        <div className="stat">
          <b>{a.data.meanMinutesToDecision ?? '—'}</b>
          <span>דקות עד החלטה</span>
        </div>
      </div>
      <table className="table" aria-label="פילוח הצעות">
        <thead>
          <tr>
            <th>{GROUPS.find(([k]) => k === group)?.[1]}</th>
            <th>סה&quot;כ</th>
            <th>אושרו</th>
            <th>נערכו</th>
            <th>נדחו</th>
            <th>ממתינות</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td dir="auto">{r.key}</td>
              <td>{r.total}</td>
              <td>{r.accepted}</td>
              <td>{r.edited}</td>
              <td>{r.rejected}</td>
              <td>{r.pending}</td>
            </tr>
          ))}
          {!rows.length ? (
            <tr>
              <td colSpan={6} className="muted">
                אין הצעות בטווח שנבחר.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}
