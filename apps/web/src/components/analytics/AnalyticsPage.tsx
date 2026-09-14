import type { CSSProperties } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CategorySchema } from '@wecom/shared';
import { useUsageAnalytics } from '../../api/hooks/usage.js';
import { useCan } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import { fmtDate } from '../../lib/format.js';

/** Until W1's `/worlds` is mounted (W6), the world filter lists the six seeded slugs. */
const WORLDS = CategorySchema.options;

/**
 * Four plain tables over `GET /analytics/usage` (PRD §13): which items and topics people open,
 * which searches come back empty, and what has gone stale. Deliberately no wave 3 dashboard
 * cards — W6 may swap the tables for them once both lanes are merged.
 *
 * The grid is styled inline rather than through a class in `src/styles/app.css`: that stylesheet
 * is shared with every other wave 4 lane and is not on W5's append-only list.
 */
const GRID: CSSProperties = {
  display: 'grid',
  gap: 16,
  gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
  marginTop: 16,
};

export function AnalyticsPage() {
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const can = useCan();
  const q = {
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    world: sp.get('world') ?? undefined,
  };
  const usage = useUsageAnalytics(q);
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const toIso = (d: string, endOfDay = false) =>
    d ? new Date(d + (endOfDay ? 'T23:59:59.999Z' : 'T00:00:00.000Z')).toISOString() : '';
  const day = (iso?: string) => (iso ? iso.slice(0, 10) : '');

  if (usage.error instanceof ApiError && usage.error.status === 403)
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
            {WORLDS.map((w) => (
              <option key={w} value={w}>
                {w}
              </option>
            ))}
          </select>
        </div>
      </div>

      {!d ? (
        <div className="empty">{usage.isLoading ? 'טוען…' : 'לא ניתן לטעון נתוני שימוש'}</div>
      ) : (
        <div style={GRID}>
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
                      <a
                        href={`/doc/${r.documentId}`}
                        onClick={(e) => {
                          e.preventDefault();
                          nav(`/doc/${r.documentId}`);
                        }}
                      >
                        {r.title}
                      </a>
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
