import { useNavigate } from 'react-router-dom';
import { useDashboards } from '../../api/hooks/stage4.js';
import { cat } from '../../lib/constants.js';
import { ago, fmtDate } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { LoadError } from '../ui/index.js';
import { BarList, Donut, Stat } from './charts.js';

/**
 * `/dashboards` — five tiles over `GET /dashboards` (design card 5e).
 *
 * Every tile answers one operational question and ends in a link to the list that answers it in
 * detail, because a number nobody can act on is decoration: coverage → the library, freshness →
 * the stale documents, usage → the top documents, pipeline → the suggestion queue, parity → sync.
 */
export function DashboardsPage() {
  const go = useNavigate();
  const q = useDashboards();
  const d = q.data;

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <b>לוחות בקרה</b>
        </div>
        {d ? <span className="small muted">עודכן {ago(d.generatedAt)}</span> : null}
        <div className="actions">
          <button className="btn sm" disabled={q.isFetching} onClick={() => void q.refetch()}>
            ⟳ רענן
          </button>
        </div>
      </div>

      <div className="scroll-area">
        <div className="lib-body">
          {q.isError ? <LoadError what="לוחות הבקרה" error={q.error} /> : null}
          {!d ? (
            q.isError ? null : (
              <div className="empty">טוען…</div>
            )
          ) : (
            <div className="dash-grid">
              {/* ── כיסוי ─────────────────────────────────────────────── */}
              <section className="card dash-tile" aria-labelledby="dash-coverage">
                <div className="hd">
                  <b id="dash-coverage">כיסוי</b>
                  <span className="small muted">{d.coverage.cards} כרטיסים</span>
                  <button className="btn xs" onClick={() => go('/library')}>
                    פתח רשימה
                  </button>
                </div>
                <Donut
                  caption="כיסוי כרטיסים"
                  center={`${Math.round((d.coverage.withDocument / Math.max(1, d.coverage.cards)) * 100)}%`}
                  slices={[
                    { label: 'עם מסמך', value: d.coverage.withDocument, color: 'var(--ok)' },
                    { label: 'חלקיים', value: d.coverage.partial, color: 'var(--warn)' },
                    { label: 'טיוטות', value: d.coverage.drafts, color: 'var(--info)' },
                    {
                      label: 'ללא מסמך',
                      value: Math.max(
                        0,
                        d.coverage.cards - d.coverage.withDocument - d.coverage.partial - d.coverage.drafts,
                      ),
                      color: 'var(--border-2)',
                    },
                  ]}
                />
                <BarList
                  caption="כיסוי לפי קטגוריה"
                  bars={d.coverage.byCategory.map((c) => ({
                    label: cat(c.category).label,
                    value: c.withDocument,
                    of: c.cards,
                    color: cat(c.category).color,
                    onClick: () => go(`/library/${c.category}`),
                  }))}
                />
              </section>

              {/* ── רעננות ────────────────────────────────────────────── */}
              <section className="card dash-tile" aria-labelledby="dash-freshness">
                <div className="hd">
                  <b id="dash-freshness">רעננות</b>
                  <span className="small muted">עודכן ב-30 יום</span>
                  <button className="btn xs" onClick={() => go('/recent')}>
                    פתח רשימה
                  </button>
                </div>
                <div className="stat-row">
                  <Stat value={d.freshness.updatedLast30d} label="עודכנו ב-30 יום" />
                  <Stat
                    value={d.freshness.staleOver180d}
                    label="מעל 180 יום"
                    tone={d.freshness.staleOver180d ? 'warn' : undefined}
                  />
                </div>
                <BarList
                  caption="חציון ימים מאז עדכון, לפי קטגוריה"
                  suffix=" ימים"
                  bars={d.freshness.byCategory.map((c) => ({
                    label: cat(c.category).label,
                    value: Math.round(c.median_days),
                    color:
                      c.median_days > 180 ? 'var(--red)' : c.median_days > 90 ? 'var(--warn)' : 'var(--ok)',
                    onClick: () => go(`/library/${c.category}`),
                  }))}
                />
                <ul className="dash-list">
                  {d.freshness.byCategory
                    .filter((c) => c.median_days > 180)
                    .map((c) => (
                      <li key={c.category}>
                        <span className="chip chip-amber">ישן</span>
                        {cat(c.category).label} · עודכן לאחרונה{' '}
                        {c.lastUpdatedAt ? fmtDate(c.lastUpdatedAt) : 'מעולם לא'}
                      </li>
                    ))}
                </ul>
              </section>

              {/* ── שימוש ─────────────────────────────────────────────── */}
              <section className="card dash-tile" aria-labelledby="dash-usage">
                <div className="hd">
                  <b id="dash-usage">שימוש</b>
                  <span className="small muted">7 ימים</span>
                  <button className="btn xs" onClick={() => go('/recent')}>
                    פתח רשימה
                  </button>
                </div>
                <div className="stat-row">
                  <Stat value={d.usage.views7d} label="צפיות · 7 ימים" />
                  <Stat value={d.usage.views30d} label="צפיות · 30 ימים" />
                  <Stat value={d.usage.outcomesPicked7d} label="תוצאות שנבחרו" />
                  <Stat value={d.usage.callsCompleted7d} label="שיחות שהושלמו" />
                </div>
                <BarList
                  caption="המסמכים המובילים"
                  bars={d.usage.topDocuments.map((t) => ({
                    label: t.title,
                    value: t.views,
                    onClick: () => go(`/doc/${t.documentId}`),
                  }))}
                />
              </section>

              {/* ── צינור הצעות ───────────────────────────────────────── */}
              <section className="card dash-tile" aria-labelledby="dash-pipeline">
                <div className="hd">
                  <b id="dash-pipeline">צינור הצעות</b>
                  <span className="small muted">לפי מקור</span>
                  <button className="btn xs" onClick={() => go('/sources')}>
                    פתח רשימה
                  </button>
                </div>
                <Donut
                  caption="מצב ההצעות"
                  center={String(d.pipeline.pending)}
                  slices={[
                    { label: 'ממתינות', value: d.pipeline.pending, color: 'var(--warn)' },
                    { label: 'אושרו', value: d.pipeline.accepted, color: 'var(--info)' },
                    { label: 'הוחלו', value: d.pipeline.applied, color: 'var(--ok)' },
                    { label: 'נדחו', value: d.pipeline.rejected, color: 'var(--border-2)' },
                  ]}
                />
                <BarList
                  caption="ממתינות לפי מקור"
                  bars={d.pipeline.bySource.map((s) => ({
                    label: s.title,
                    value: s.pending,
                    of: s.pending + s.applied,
                    color: 'var(--warn)',
                    onClick: () => go(`/sources/${s.sourceId}`),
                  }))}
                />
              </section>

              {/* ── סנכרון ────────────────────────────────────────────── */}
              <section className="card dash-tile" aria-labelledby="dash-sync">
                <div className="hd">
                  <b id="dash-sync">התאמת סנכרון</b>
                  <span className="small muted">
                    {d.sync.lastRunAt ? `ריצה אחרונה ${ago(d.sync.lastRunAt)}` : 'טרם רץ'}
                  </span>
                  <button className="btn xs" onClick={() => go('/sources')}>
                    פתח רשימה
                  </button>
                </div>
                <Donut
                  caption="מצב הקישורים"
                  center={String(d.sync.links)}
                  slices={[
                    { label: 'זהים', value: d.sync.synced, color: 'var(--ok)' },
                    { label: 'ממתין לייבוא', value: d.sync.pendingImport, color: 'var(--info)' },
                    { label: 'ממתין לדחיפה', value: d.sync.pendingPush, color: 'var(--warn)' },
                    { label: 'קונפליקטים', value: d.sync.conflicts, color: 'var(--red)' },
                  ]}
                />
                <div className="stat-row">
                  <Stat value={d.sync.links} label="קישורים" />
                  <Stat
                    value={d.sync.conflicts}
                    label="קונפליקטים"
                    tone={d.sync.conflicts ? 'warn' : undefined}
                  />
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
