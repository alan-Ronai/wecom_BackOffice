import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useUsageAnalytics } from '../../api/hooks/usage.js';
import { useWorlds } from '../../api/hooks/taxonomy.js';
import { useCan } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import { fmtDate } from '../../lib/format.js';

/**
 * Four plain tables over `GET /analytics/usage` (PRD §13): which items and topics people open,
 * which searches come back empty, and what has gone stale. Deliberately no wave 3 dashboard
 * cards — W6 may swap the tables for them once both lanes are merged.
 *
 * The grid used to be an inline `CSSProperties` constant because the per-lane rule forbade
 * editing the shared stylesheet. That constraint expired at the W6 merge; it is `.analytics-grid`
 * in `styles/app.css` now, with the rest of the wave-4 block.
 */

export function AnalyticsPage() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const can = useCan();
  const q = {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    world: sp.get('world') ?? undefined,
  };
  // Pre-gated rather than handling the 403 after the fact: without the permission the request is
  // a guaranteed round trip and console error on the way to the same empty state.
  const mayRead = can('analytics.read');
  const usage = useUsageAnalytics(q, mayRead);
  /** W6: the world filter is data now (W1's `/worlds`), not the six hard-coded slugs. */
  const worlds = useWorlds();
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  /**
   * `<input type="date">` gives a *local* calendar day, so the instant is built with the local
   * constructor and converted. `new Date(d + 'T00:00:00.000Z')` read it as UTC — in Israel
   * (UTC+2/+3) "from the 14th" started at 03:00 on the 14th and lost the first hours of the day.
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

  if (!mayRead || (usage.error instanceof ApiError && usage.error.status === 403))
    return (
      <div className="empty">
        <b>אין הרשאה לצפות בנתוני שימוש</b>
      </div>
    );
  const d = usage.data;

  return (
    <>
      <div className="lib-head">
        <div>
          <h1>
            נתוני שימוש<span>{d ? `${fmtDate(d.from)} – ${fmtDate(d.to)}` : ''}</span>
          </h1>
          <p>
            כניסות לפריטים ולנושאים, חיפושים ללא תוצאה ופריטים שלא עודכנו.
            {q.world ? ` מסונן: ${q.world}` : ''}
          </p>
        </div>
        <div className="facets">
          <label>
            מתאריך{' '}
            <input type="date" value={day(q.from)} onChange={(e) => set('from', toIso(e.target.value))} />
          </label>
          <label>
            עד תאריך{' '}
            <input type="date" value={day(q.to)} onChange={(e) => set('to', toIso(e.target.value, true))} />
          </label>
          <select aria-label="עולם תוכן" value={q.world ?? ''} onChange={(e) => set('world', e.target.value)}>
            <option value="">כל העולמות</option>
            {(worlds.data ?? []).map((w) => (
              <option key={w.slug} value={w.slug}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!d ? (
        <div className="empty">{usage.isLoading ? 'טוען…' : 'לא ניתן לטעון נתוני שימוש'}</div>
      ) : (
        <div className="analytics-grid">
          <section className="card">
            <h2>פריטים נצפים</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>פריט</th>
                  <th>סוג</th>
                  <th>כניסות</th>
                  <th>משתמשים</th>
                  <th>נצפה לאחרונה</th>
                </tr>
              </thead>
              <tbody>
                {d.itemViews.map((r) => (
                  <tr key={r.documentId}>
                    <td>
                      {/* `<Link>`, not an `<a>` with `preventDefault` + `nav()` reimplementing it. */}
                      <Link to={`/doc/${r.documentId}`}>{r.title}</Link>
                    </td>
                    <td>{r.docType ?? '—'}</td>
                    <td>{r.views}</td>
                    <td>{r.viewers}</td>
                    <td>{r.lastViewedAt ? fmtDate(r.lastViewedAt) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="small muted">הספירה מצטברת לכל משתמש ופריט; הטווח מסנן לפי הצפייה האחרונה.</p>
          </section>

          <section className="card">
            <h2>נושאים נצפים</h2>
            {d.topTopics.length ? (
              <table className="table">
                <thead>
                  <tr>
                    <th>נושא</th>
                    <th>עולם</th>
                    <th>כניסות</th>
                  </tr>
                </thead>
                <tbody>
                  {d.topTopics.map((t) => (
                    <tr key={t.topicId}>
                      <td>{t.name}</td>
                      <td>{t.worldSlug}</td>
                      <td>{t.views}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty small">אין צפיות בנושאים בטווח שנבחר</div>
            )}
          </section>

          <section className="card">
            <h2>חיפושים ללא תוצאה</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>מונח</th>
                  <th>פעמים</th>
                  <th>לאחרונה</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {d.zeroResultTerms.map((z) => (
                  <tr key={z.q}>
                    <td>{z.q}</td>
                    <td>{z.count}</td>
                    <td>{fmtDate(z.lastAt)}</td>
                    <td>
                      {can('docs.create') ? (
                        <button
                          className="btn xs"
                          onClick={() => nav(`/edit/new?title=${encodeURIComponent(z.q)}`)}
                        >
                          צור פריט
                        </button>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className="card">
            <h2>פריטים שלא עודכנו</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>פריט</th>
                  <th>אחראי</th>
                  <th>עודכן</th>
                  <th>פורסם</th>
                  <th>ימים ללא עדכון</th>
                </tr>
              </thead>
              <tbody>
                {d.staleness.map((s) => (
                  <tr key={s.documentId}>
                    <td>{s.title}</td>
                    <td>{s.ownerName ?? '—'}</td>
                    <td>{fmtDate(s.updatedAt)}</td>
                    <td>{s.publishedAt ? fmtDate(s.publishedAt) : '—'}</td>
                    <td>{s.daysSinceUpdate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </>
  );
}
