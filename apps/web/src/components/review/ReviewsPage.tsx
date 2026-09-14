import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useReviewDecision, useReviews, type ReviewRow } from '../../api/hooks/collab.js';
import { useCan } from '../../api/hooks/me.js';
import { useDocument } from '../../api/hooks/documents.js';
import { cat } from '../../lib/constants.js';
import { ago, fmtDate } from '../../lib/format.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';

type Tab = 'open' | 'approved' | 'changes';
const TABS: [Tab, string][] = [
  ['open', 'ממתין להחלטה'],
  ['approved', 'אושרו'],
  ['changes', 'הוחזרו לתיקון'],
];

/**
 * The lead's side of the review workflow: what is waiting for me, and the two decisions.
 *
 * Approving **publishes** (the API creates the version with the label given here), so the label
 * is asked for rather than defaulted — it is what the next reader sees in the version history.
 * "דרוש שינויים" sends the document back to `draft` and its note is the only thing the author
 * gets, so it is required.
 */
function ReviewCard({
  row,
  onDecide,
}: {
  row: ReviewRow;
  onDecide: (r: ReviewRow, d: 'approve' | 'changes') => void;
}) {
  const go = useNavigate();
  const can = useCan();
  const doc = useDocument(row.status === 'open' ? row.documentId : undefined);
  const mayDecide = can('docs.publish', { category: row.category });

  return (
    <div className="tcard review-card">
      <div className="chips">
        <span className="chip chip-gray">{cat(row.category).label}</span>
        <span
          className={
            'chip ' +
            (row.status === 'open' ? 'chip-amber' : row.status === 'approved' ? 'chip-green' : 'chip-red')
          }
        >
          {row.status === 'open' ? 'ממתין' : row.status === 'approved' ? 'אושר' : 'הוחזר לתיקון'}
        </span>
        {doc.data ? <span className="chip chip-gray">v{doc.data.currentVersion}</span> : null}
      </div>
      <div className="title" role="button" tabIndex={0} onClick={() => go(`/doc/${row.documentId}`)}>
        {row.title}
      </div>
      {row.note ? <div className="desc">“{row.note}”</div> : null}
      {row.decisionNote ? (
        <div className="desc" style={{ color: 'var(--red-dark)' }}>
          {row.decidedByName}: “{row.decisionNote}”
        </div>
      ) : null}
      <div className="meta">
        <span>{row.requestedByName}</span>
        <span>·</span>
        <span title={fmtDate(row.createdAt)}>{ago(Date.parse(row.createdAt))}</span>
        <button className="btn xs" onClick={() => go(`/history/${row.documentId}`)}>
          🕓 מה השתנה
        </button>
        {row.status === 'open' && mayDecide ? (
          <>
            <button
              className="btn xs primary"
              aria-label={`אשר ופרסם את ${row.title}`}
              onClick={() => onDecide(row, 'approve')}
            >
              ✓ אשר ופרסם
            </button>
            <button
              className="btn xs danger"
              aria-label={`דרוש שינויים ב-${row.title}`}
              onClick={() => onDecide(row, 'changes')}
            >
              ↩ דרוש שינויים
            </button>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function ReviewsPage() {
  const go = useNavigate();
  const [tab, setTab] = useState<Tab>('open');
  const reviews = useReviews({ status: tab });
  const decide = useReviewDecision();
  const modal = useModal();
  const toast = useToast();

  const rows = reviews.data?.items ?? [];

  const onDecide = async (row: ReviewRow, decision: 'approve' | 'changes') => {
    if (decision === 'approve') {
      const label = await modal.prompt(
        `אישור ופרסום · ${row.title}`,
        'מה השתנה? (מופיע בהיסטוריית הגרסאות)',
        row.note ?? '',
      );
      if (label == null) return;
      await decide.mutateAsync({ documentId: row.documentId, decision, label: label || 'אושר בסקירה' });
      toast('אושר ופורסם', 'ok');
      return;
    }
    const note = await modal.prompt(`החזרה לתיקון · ${row.title}`, 'מה צריך לשנות? (נשלח לכותב/ת)', '', true);
    if (note == null) return;
    if (!note.trim()) {
      toast('צריך לכתוב מה לתקן', 'warn');
      return;
    }
    await decide.mutateAsync({ documentId: row.documentId, decision, note: note.trim() });
    toast('הוחזר לתיקון · הכותב/ת קיבל/ה התראה', 'ok');
  };

  return (
    <>
      <div className="topbar">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <b>סקירות</b>
        </div>
      </div>
      <div className="scroll-area">
        <div className="lib-body">
          <div className="lib-head">
            <div>
              <h1>
                סקירות<span>{rows.length} פריטים</span>
              </h1>
              <p>פריטי ידע שנשלחו לאישור. אישור מפרסם גרסה חדשה; החזרה לתיקון מחזירה לטיוטה.</p>
            </div>
            <div className="tabs" role="tablist" aria-label="סינון סקירות">
              {TABS.map(([k, label]) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={'tab' + (tab === k ? ' on' : '')}
                  onClick={() => setTab(k)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {reviews.isError ? <LoadError what="סקירות" error={reviews.error} /> : null}
          <div className="grid">
            {reviews.isPending ? <div className="route-loading">טוען…</div> : null}
            {!rows.length && !reviews.isError && !reviews.isPending ? (
              <div className="empty" style={{ gridColumn: '1/-1' }}>
                <b>{tab === 'open' ? 'אין פריטים שממתינים לסקירה' : 'אין פריטים בסטטוס הזה'}</b>
                {tab === 'open' ? 'כותבים שולחים לסקירה מתוך העורך' : ''}
              </div>
            ) : null}
            {rows.map((r) => (
              <ReviewCard key={r.id} row={r} onDecide={(row, d) => void onDecide(row, d)} />
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
