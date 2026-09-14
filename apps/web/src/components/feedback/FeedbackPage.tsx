import { useRef } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type DocType,
  type FeedbackKind,
  type FeedbackStatus,
} from '@wecom/shared';
import { useFeedbackList } from '../../api/hooks/feedback.js';
import { useMentionable } from '../../api/hooks/collab.js';
import { useWorlds } from '../../api/hooks/taxonomy.js';
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
  const docType = (sp.get('docType') as DocType | null) ?? undefined;
  const assigneeId = sp.get('assigneeId') ?? undefined;
  const documentId = sp.get('documentId') ?? undefined;
  const mayManage = can('feedback.manage');
  // `enabled`: without the permission the route is a guaranteed 403, and asking anyway costs a
  // round trip and a console error on a screen that is about to render the empty state instead.
  const list = useFeedbackList({ status, kind, world, docType, assigneeId, documentId }, mayManage);
  const worlds = useWorlds();
  const people = useMentionable('', mayManage);
  /** The status tabs, for roving focus: `role="tablist"` promises arrow-key navigation. */
  const tabsRef = useRef<HTMLDivElement>(null);

  if (!mayManage)
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
  /**
   * Arrow keys across the status tabs, which `role="tablist"` implies and which nothing provided.
   * The page is RTL, so ArrowLeft moves *forward* through the tabs — reading order, not codepoint
   * order, is what the user means by "the next tab".
   */
  const onTabKeys = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const tabs = [...(tabsRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? [])];
    if (!tabs.length) return;
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    const step = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0;
    const next =
      e.key === 'Home'
        ? 0
        : e.key === 'End'
          ? tabs.length - 1
          : (Math.max(at, 0) + step + tabs.length) % tabs.length;
    e.preventDefault();
    tabs[next]?.focus();
    tabs[next]?.click();
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
          <div className="facets" role="tablist" aria-label="סטטוס" ref={tabsRef} onKeyDown={onTabKeys}>
            {/* Real `<button>`s. As `<span role="tab" tabIndex={0}>` they were focusable and
                announced as tabs, and Enter/Space did nothing — the `role` promised an
                interaction the element could not deliver. */}
            <button
              type="button"
              role="tab"
              aria-selected={!status}
              aria-controls="feedback-queue"
              className={'facet' + (!status ? ' on' : '')}
              tabIndex={!status ? 0 : -1}
              onClick={() => set('status', undefined)}
            >
              הכל ({total})
            </button>
            {FEEDBACK_STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                role="tab"
                aria-selected={status === s}
                aria-controls="feedback-queue"
                className={'facet' + (status === s ? ' on' : '')}
                tabIndex={status === s ? 0 : -1}
                onClick={() => set('status', s)}
              >
                {FEEDBACK_STATUS_LABELS[s]} ({counts?.[s] ?? 0})
              </button>
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
            {/* §5.4 lists five filters. World is how editorial work is divided in this product,
                and the drawer *sets* an assignee the queue then could not be filtered by, so
                "what is assigned to me" was unanswerable. */}
            <label className="small">
              עולם תוכן
              <select
                aria-label="עולם תוכן"
                value={world ?? ''}
                onChange={(e) => set('world', e.target.value || undefined)}
              >
                <option value="">הכל</option>
                {(worlds.data ?? []).map((w) => (
                  <option key={w.slug} value={w.slug}>
                    {w.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="small">
              סוג פריט
              <select
                aria-label="סוג פריט"
                value={docType ?? ''}
                onChange={(e) => set('docType', e.target.value || undefined)}
              >
                <option value="">הכל</option>
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t} · {DOC_TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </label>
            <label className="small">
              אחראי טיפול
              <select
                aria-label="אחראי טיפול"
                value={assigneeId ?? ''}
                onChange={(e) => set('assigneeId', e.target.value || undefined)}
              >
                <option value="">הכל</option>
                {(people.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.displayName}
                  </option>
                ))}
              </select>
            </label>
            {documentId ? (
              <Chip tone="chip-gray">
                פריט אחד ·{' '}
                <button
                  type="button"
                  className="linklike"
                  aria-label="בטל סינון לפריט"
                  onClick={() => set('documentId', undefined)}
                >
                  ✕
                </button>
              </Chip>
            ) : null}
          </div>
          {list.isError ? <LoadError what="את המשובים" error={list.error} /> : null}
          {list.data && !list.data.items.length ? <Empty title="אין משובים בתצוגה זו" /> : null}
          {list.data?.items.length ? (
            <table className="table feedback-table" id="feedback-queue">
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
