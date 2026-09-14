import { useState } from 'react';
import { useAudit } from '../../api/hooks/admin.js';
import { useAdminUsers, useAuditEntry } from '../../api/hooks/stage5.js';
import type { AuditDiffRow } from '../../api/stage5.js';
import type { AuditQuery } from '../../api/types.js';
import { download, fmtDate, fmtTime } from '../../lib/format.js';
import { Chip, LoadError } from '../ui/index.js';
import { useFocusTrap } from '../ui/useFocusTrap.js';

const ENTITY_LABEL: Record<string, string> = {
  document: 'מסמך',
  block: 'בלוק',
  field: 'שדה CRM',
  user: 'משתמש',
  role: 'תפקיד',
  connector: 'מחבר',
  source: 'מקור',
};

const RANGES: [string, number | null][] = [
  ['7 ימים', 7],
  ['30 יום', 30],
  ['90 יום', 90],
  ['הכל', null],
];

/**
 * Rounded down to the hour on purpose. A raw `Date.now()` would produce a different `from` on
 * every render, which means a different query key, which means the list refetches forever and
 * never settles.
 */
const HOUR = 3_600_000;
const daysAgo = (n: number) => new Date(Math.floor((Date.now() - n * 24 * HOUR) / HOUR) * HOUR).toISOString();

/** `null` and `undefined` are different things in a diff; neither is the string "null". */
const renderValue = (v: unknown): string => {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'string') return v;
  return JSON.stringify(v);
};

function DiffRows({ rows }: { rows: AuditDiffRow[] }) {
  if (!rows.length) return <div className="small muted">אין שינוי בשדות — הפעולה לא שינתה נתונים.</div>;
  return (
    <table className="table diff-rows">
      <thead>
        <tr>
          <th>שדה</th>
          <th>לפני</th>
          <th>אחרי</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.path}>
            <td>
              <bdi className="lat" dir="ltr">
                {r.path}
              </bdi>
            </td>
            <td className="was">{renderValue(r.before)}</td>
            <td className="now">{renderValue(r.after)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * One CSV field.
 *
 * Quoting everything rather than only what needs it: an audit log is read by whoever is asking
 * what happened, usually in Excel, and a `requestId` that starts with `=` or `+` is a formula to
 * Excel unless it arrives quoted. The leading apostrophe on those is the standard defence against
 * CSV injection, and this is a file built from values users control.
 */
const csvCell = (v: unknown): string => {
  const s = v === null || v === undefined ? '' : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
};

/**
 * The explorer: filters narrow the query on the server, and a row opens a drawer that fetches
 * `GET /admin/audit/:id` for the **computed** before/after rows. The page used to word-diff two
 * pretty-printed JSON blobs in the browser, which turned "status: draft → published" into a wall
 * of punctuation and could not tell a reordered key from an edited value.
 */
export function AuditPage() {
  const [entityType, setEntityType] = useState('');
  const [actorId, setActorId] = useState('');
  const [days, setDays] = useState<number | null>(7);
  const [openId, setOpenId] = useState<string | null>(null);
  const drawer = useFocusTrap<HTMLElement>(!!openId);

  const query: AuditQuery = {
    ...(entityType ? { entityType } : {}),
    ...(actorId ? { actorId } : {}),
    ...(days ? { from: daysAgo(days) } : {}),
  };
  const audit = useAudit(query);
  const users = useAdminUsers({ pageSize: 200 });
  const detail = useAuditEntry(openId);

  const items = audit.data?.items ?? [];
  const actors = users.data?.items ?? [];
  const actorName = (id: string) => actors.find((u) => u.id === id)?.displayName ?? id;

  /**
   * Exports what is on screen — the filtered rows, not the whole log.
   *
   * That is the honest scope: the filters are the question being asked, and the list route is
   * paged, so "export everything" would mean walking pages the operator never looked at. The
   * header names the filter in the filename so two exports taken minutes apart are not both
   * called `audit.csv`.
   */
  const exportCsv = () => {
    const head = ['מתי', 'מי', 'פעולה', 'סוג ישות', 'מזהה ישות', 'כתובת IP', 'מזהה בקשה'];
    const rows = items.map((e) => [
      `${fmtDate(e.at)} ${fmtTime(e.at)}`,
      // A system action has no actor — that is a real state, and it should read as one rather
      // than as a uuid or an empty cell.
      e.actorId ? actorName(e.actorId) : 'מערכת',
      e.action,
      ENTITY_LABEL[e.entityType] ?? e.entityType,
      e.entityId,
      e.ip,
      e.requestId,
    ]);
    // BOM first: Excel reads a BOM-less UTF-8 CSV as the system codepage, which turns every
    // Hebrew column into mojibake — the one detail that decides whether this file is usable.
    const csv = '\uFEFF' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const scope = [entityType, actorId ? actorName(actorId) : '', days ? `${days}d` : 'הכל']
      .filter(Boolean)
      .join('-');
    download(`audit-${scope}.csv`, csv, 'text/csv;charset=utf-8');
  };

  return (
    <>
      {audit.isError ? <LoadError what="יומן הפעולות" error={audit.error} /> : null}
      <div className="lib-head">
        <div>
          <h1>
            יומן פעולות<span>{audit.data?.total ?? 0} רשומות</span>
          </h1>
          <p>כל פעולה משנה נרשמת בתוך אותה טרנזקציה, עם המצב לפני ואחרי. שמירה: 400 יום.</p>
        </div>
        <div className="facets">
          <select aria-label="סוג ישות" value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">כל הישויות</option>
            {Object.entries(ENTITY_LABEL).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select aria-label="מבצע הפעולה" value={actorId} onChange={(e) => setActorId(e.target.value)}>
            <option value="">כל המשתמשים</option>
            {actors.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName}
              </option>
            ))}
          </select>
          <button className="btn sm" disabled={!items.length} onClick={exportCsv}>
            ⬇ ייצוא CSV
          </button>
          <div className="pill-toggle" style={{ marginBottom: 0 }}>
            {RANGES.map(([label, n]) => (
              <span
                key={label}
                role="button"
                tabIndex={0}
                className={days === n ? 'on' : ''}
                onClick={() => setDays(n)}
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Active filters, each removable where it stands — otherwise "no records" reads as a bug. */}
      {entityType || actorId ? (
        <div className="facets" style={{ justifyContent: 'flex-start', marginBottom: 10 }}>
          {entityType ? (
            <button className="facet on" onClick={() => setEntityType('')}>
              ישות: {ENTITY_LABEL[entityType] ?? entityType} ✕
            </button>
          ) : null}
          {actorId ? (
            <button className="facet on" onClick={() => setActorId('')}>
              משתמש: {actorName(actorId)} ✕
            </button>
          ) : null}
        </div>
      ) : null}

      {!items.length && !audit.isPending ? (
        <div className="empty">
          <b>אין רשומות בטווח הזה</b>
          הרחיבו את הטווח או נקו את המסננים
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>מתי</th>
              <th>מי</th>
              <th>פעולה</th>
              <th>ישות</th>
              <th>בקשה</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id}>
                <td>
                  {fmtDate(e.at)} {fmtTime(e.at)}
                </td>
                <td>{e.actorName ?? 'מערכת'}</td>
                <td>
                  <bdi className="lat" dir="ltr">
                    {e.action}
                  </bdi>
                </td>
                <td>
                  <Chip>{ENTITY_LABEL[e.entityType] ?? e.entityType}</Chip>
                  <div className="small muted">
                    <bdi className="lat" dir="ltr">
                      {e.entityId ?? ''}
                    </bdi>
                  </div>
                </td>
                <td className="small muted">
                  <bdi className="lat" dir="ltr">
                    {e.requestId ?? '—'}
                  </bdi>
                </td>
                <td>
                  <button className="btn xs" onClick={() => setOpenId(e.id)}>
                    לפני / אחרי
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {openId ? (
        <aside ref={drawer} className="drawer" role="dialog" aria-modal="true" aria-label="פרטי רשומת ביקורת">
          <div className="drawer-head">
            <b>פרטי הפעולה</b>
            <button className="btn ghost xs" onClick={() => setOpenId(null)}>
              סגור
            </button>
          </div>
          {detail.isPending ? <div className="route-loading">טוען…</div> : null}
          {detail.isError ? <LoadError what="פרטי הרשומה" error={detail.error} /> : null}
          {detail.data ? (
            <div className="drawer-body">
              <dl className="kv">
                <dt>פעולה</dt>
                <dd>
                  <bdi className="lat" dir="ltr">
                    {detail.data.action}
                  </bdi>
                </dd>
                <dt>מי</dt>
                <dd>{detail.data.actorName ?? 'מערכת'}</dd>
                <dt>מתי</dt>
                <dd>
                  {fmtDate(detail.data.at)} {fmtTime(detail.data.at)}
                </dd>
                <dt>ישות</dt>
                <dd>
                  {ENTITY_LABEL[detail.data.entityType] ?? detail.data.entityType} ·{' '}
                  <bdi className="lat" dir="ltr">
                    {detail.data.entityId ?? '—'}
                  </bdi>
                </dd>
                <dt>כתובת IP</dt>
                <dd>
                  <bdi className="lat" dir="ltr">
                    {detail.data.ip ?? '—'}
                  </bdi>
                </dd>
                <dt>מזהה בקשה</dt>
                <dd>
                  <bdi className="lat" dir="ltr">
                    {detail.data.requestId ?? '—'}
                  </bdi>
                </dd>
              </dl>
              <div className="eyebrow" style={{ marginTop: 14 }}>
                שדות שהשתנו
              </div>
              <DiffRows rows={detail.data.diff} />
            </div>
          ) : null}
        </aside>
      ) : null}
    </>
  );
}
