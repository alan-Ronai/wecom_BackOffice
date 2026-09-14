import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackKind,
  type FeedbackStatus,
} from '@wecom/shared';
import { useFeedbackList } from '../../api/hooks/feedback.js';
import { useCan } from '../../api/hooks/me.js';
import { ago } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Chip, Empty, LoadError } from '../ui/index.js';
import { FeedbackDrawer } from './FeedbackDrawer.js';
import { FeedbackAnalyticsTab } from './FeedbackAnalyticsTab.js';

const STATUS_TONE: Record<FeedbackStatus, string> = {
  new: 'chip-red',
  in_review: 'chip-amber',
  needs_update: 'chip-amber',
  no_change: 'chip-gray',
  done: 'chip-green',
};

/** Editor queue for PRD §12 — status tabs, filters, table; the drawer is routed by `/feedback/:id`. */
export function FeedbackPage({ tab }: { tab?: 'analytics' } = {}) {
  const can = useCan();
  const go = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const [sp, setSp] = useSearchParams();
  const status = (sp.get('status') as FeedbackStatus | null) ?? undefined;
  const kind = (sp.get('kind') as FeedbackKind | null) ?? undefined;
  const world = sp.get('world') ?? undefined;
  const documentId = sp.get('documentId') ?? undefined;
  const list = useFeedbackList({ status, kind, world, documentId });

  if (!can('feedback.manage'))
    return (
      <div className="page">
        <Empty title="אין הרשאה לניהול משובים">המסך מיועד לעורכי תוכן.</Empty>
      </div>
    );

  const set = (k: string, v: string | undefined) => {
    const next = new URLSearchParams(sp);
    if (v) next.set(k, v);
    else next.delete(k);
    setSp(next, { replace: true });
  };
  const counts = list.data?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;

  return (
    <div className={'page feedback-page' + (id ? ' with-drawer' : '')}>
      <div className="topbar">
        <Hamburger />
        <h1>משובים ודיווחים</h1>
        <nav className="tabs" role="tablist" aria-label="תצוגה">
          <Link role="tab" aria-selected={!tab} className={'facet' + (!tab ? ' on' : '')} to="/feedback">
            תור טיפול
          </Link>
          <Link
            role="tab"
            aria-selected={tab === 'analytics'}
            className={'facet' + (tab === 'analytics' ? ' on' : '')}
            to="/feedback/analytics"
          >
            אנליטיקה
          </Link>
        </nav>
      </div>
      {tab === 'analytics' ? (
        <FeedbackAnalyticsTab world={world} />
      ) : (
        <>
          <div className="facets" role="tablist" aria-label="סטטוס">
            <span
              role="tab"
              aria-selected={!status}
              className={'facet' + (!status ? ' on' : '')}
              tabIndex={0}
              onClick={() => set('status', undefined)}
            >
              הכל ({total})
            </span>
            {FEEDBACK_STATUSES.map((s) => (
              <span
                key={s}
                role="tab"
                aria-selected={status === s}
                className={'facet' + (status === s ? ' on' : '')}
                tabIndex={0}
                onClick={() => set('status', s)}
              >
                {FEEDBACK_STATUS_LABELS[s]} ({counts?.[s] ?? 0})
              </span>
            ))}
            <span className="vsep" />
            <label className="small">
              סוג משוב
              <select
                aria-label="סוג משוב"
                value={kind ?? ''}
                onChange={(e) => set('kind', e.target.value || undefined)}
              >
                <option value="">הכל</option>
                {FEEDBACK_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {FEEDBACK_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </label>
            {documentId ? (
              <Chip tone="chip-gray">
                פריט אחד ·{' '}
                <span role="button" tabIndex={0} onClick={() => set('documentId', undefined)}>
                  ✕
                </span>
              </Chip>
            ) : null}
          </div>
          {list.isError ? <LoadError what="את המשובים" error={list.error} /> : null}
          {list.data && !list.data.items.length ? <Empty title="אין משובים בתצוגה זו" /> : null}
          {list.data?.items.length ? (
            <table className="table feedback-table">
              <thead>
                <tr>
                  <th>סוג</th>
                  <th>פריט ידע</th>
                  <th>גרסה</th>
                  <th>שלח</th>
                  <th>סטטוס</th>
                  <th>אחראי</th>
                  <th>מתי</th>
                </tr>
              </thead>
              <tbody>
                {list.data.items.map((f) => (
                  <tr key={f.id} className={f.id === id ? 'sel' : ''}>
                    <td>
                      <Link to={`/feedback/${f.id}${sp.toString() ? '?' + sp.toString() : ''}`}>
                        {FEEDBACK_KIND_LABELS[f.kind]}
                      </Link>
                    </td>
                    <td>
                      {f.documentTitle}
                      {f.stepKey ? <span className="small muted"> · {f.stepKey}</span> : null}
                    </td>
                    <td>
                      v{f.documentVersion}
                      {f.resolvedVersion ? <Chip tone="chip-green">v{f.resolvedVersion}</Chip> : null}
                    </td>
                    <td>{f.userName}</td>
                    <td>
                      <Chip tone={STATUS_TONE[f.status]}>{FEEDBACK_STATUS_LABELS[f.status]}</Chip>
                    </td>
                    <td>{f.assigneeName ?? '—'}</td>
                    <td className="small muted">{ago(f.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {id ? (
            <FeedbackDrawer id={id} onClose={() => go({ pathname: '/feedback', search: sp.toString() })} />
          ) : null}
        </>
      )}
    </div>
  );
}
