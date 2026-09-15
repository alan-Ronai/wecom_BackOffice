import { useCompletion } from '../../../api/hooks/learningManage.js';
import { download, fmtDate } from '../../../lib/format.js';
import { worldLabel } from '../../taxonomy/TypeBadge.js';
import { LoadError } from '../../ui/index.js';

const STATUS: Record<string, string> = {
  open: 'פתוח',
  completed: 'הושלם',
  overdue: 'באיחור',
  invalidated: 'בוטל (רענון)',
};

/**
 * One CSV cell, safe to open in Excel.
 *
 * Quoting alone is not enough: a cell that *starts* with `=`, `+`, `-`, `@` (or a control
 * character) is a formula to Excel and Sheets no matter how it is quoted, so a display name typed
 * as `=cmd|...` would execute for the lead who opens the export — and the BOM below exists
 * precisely so they will open it there. A leading apostrophe makes it text again.
 */
const RISKY = /^[=+\-@\t\r]/;
const csvCell = (v: unknown) => {
  const s = String(v ?? '');
  return `"${(RISKY.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
};

/** Per-item completion (spec §5), with the CSV a team lead actually takes to a meeting. */
export function CompletionDashboard({ itemId }: { itemId: string }) {
  const c = useCompletion(itemId);
  if (c.isError) return <LoadError what="נתוני השלמה" error={c.error} />;
  if (!c.data) return <div className="route-loading">טוען…</div>;
  const rows = c.data.rows;

  const exportCsv = () => {
    const head = ['שם', 'עולמות', 'סטטוס', 'יעד', 'הושלם', 'ציון', 'ניסיונות'];
    const body = rows.map((r) =>
      [
        r.displayName,
        r.worldSlugs.map(worldLabel).join(' '),
        STATUS[r.status] ?? r.status,
        // The dates the table shows, not the raw ISO the API sends.
        fmtDate(r.dueAt),
        r.completedAt ? fmtDate(r.completedAt) : '',
        r.score ?? '',
        r.attempts,
      ]
        .map(csvCell)
        .join(','),
    );
    // The BOM is what keeps Excel reading the Hebrew as UTF-8 rather than as mojibake.
    download(
      `completion-${itemId}.csv`,
      '﻿' + [head.map(csvCell).join(','), ...body].join('\n'),
      'text/csv;charset=utf-8',
    );
  };

  return (
    <section className="completion" aria-label="השלמה">
      <div className="stats">
        {c.data.byWorld.map((w) => (
          <div className="stat" key={w.worldSlug}>
            <b>
              {w.completed}/{w.assigned}
            </b>
            <span>
              {worldLabel(w.worldSlug)} · {w.overdue} באיחור
            </span>
          </div>
        ))}
      </div>
      <div className="row-actions">
        <button type="button" className="btn sm" onClick={exportCsv}>
          ייצוא CSV
        </button>
      </div>
      <table className="table" aria-label="השלמות">
        <thead>
          <tr>
            <th>שם</th>
            <th>עולמות</th>
            <th>סטטוס</th>
            <th>יעד</th>
            <th>הושלם</th>
            <th>ציון</th>
            <th>ניסיונות</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId} className={r.status === 'overdue' ? 'warn' : ''}>
              <td>{r.displayName}</td>
              <td>{r.worldSlugs.map(worldLabel).join(', ')}</td>
              <td>{STATUS[r.status]}</td>
              <td>{fmtDate(r.dueAt)}</td>
              <td>{r.completedAt ? fmtDate(r.completedAt) : '—'}</td>
              <td>{r.score ?? '—'}</td>
              <td>{r.attempts}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
