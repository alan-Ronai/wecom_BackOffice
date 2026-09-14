import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  FEEDBACK_STATUS_LABELS,
  type FeedbackStatus,
} from '@wecom/shared';
import { useFeedbackDetail, usePatchFeedback, useResolveFeedback } from '../../api/hooks/feedback.js';
import { useMentionable } from '../../api/hooks/collab.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { fmtDate } from '../../lib/format.js';

/**
 * One report: where it came from, what was decided, and which published version closes it.
 *
 * Assignee candidates come from the collab mentionable list — "people who can be @-ed" is exactly
 * the set that can be made responsible for a report, so this needs no second directory route.
 */
export function FeedbackDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = useFeedbackDetail(id);
  const patch = usePatchFeedback();
  const resolve = useResolveFeedback();
  const toast = useToast();
  const people = useMentionable('', true);
  const [status, setStatus] = useState<FeedbackStatus>('new');
  const [assignee, setAssignee] = useState<string>('');
  const [note, setNote] = useState('');
  const [version, setVersion] = useState<string>('');

  useEffect(() => {
    if (!detail.data) return;
    setStatus(detail.data.status);
    setAssignee(detail.data.assigneeId ?? '');
    setNote(detail.data.decisionNote ?? '');
    // Prefill with the newest version published after the report (spec §5.4).
    const latest = detail.data.laterVersions.at(-1);
    setVersion(latest ? String(latest.version) : '');
  }, [detail.data]);

  if (detail.isPending)
    return (
      <aside className="drawer feedback-drawer" aria-label="פרטי משוב">
        טוען…
      </aside>
    );
  if (detail.isError || !detail.data)
    return (
      <aside className="drawer feedback-drawer" aria-label="פרטי משוב">
        <LoadError what="את המשוב" error={detail.error} />
      </aside>
    );
  const f = detail.data;

  const save = async () => {
    await patch.mutateAsync({ id, status, assigneeId: assignee || null, decisionNote: note });
    toast('ההחלטה נשמרה', 'ok');
  };
  const close = async () => {
    if (!version) return;
    await resolve.mutateAsync({ id, version: Number(version), decisionNote: note || undefined });
    toast('המשוב נסגר', 'ok');
  };

  return (
    <aside className="drawer feedback-drawer" aria-label="פרטי משוב">
      <div className="hd">
        <b>{FEEDBACK_KIND_LABELS[f.kind]}</b>
        <span className="x" role="button" tabIndex={0} title="סגור" onClick={onClose}>
          ✕
        </span>
      </div>
      <div className="small muted">
        {f.documentTitle} · ניתן על גרסה v{f.documentVersion}
        {f.versionLabel && f.versionLabel !== `v${f.documentVersion}` ? ` (${f.versionLabel})` : ''}
        {f.stepKey ? ` · שלב ${f.stepKey}` : ''}
      </div>
      <div className="small muted">
        {f.userName} · {fmtDate(f.createdAt)} · עולם תוכן {f.worldSlug}
        {f.docType ? ` · סוג ${f.docType}` : ''}
      </div>
      {f.text ? (
        <blockquote className="feedback-text">{f.text}</blockquote>
      ) : (
        <div className="small muted">ללא הסבר</div>
      )}
      <Link className="btn navy sm" to={f.href}>
        פתח מסמך
      </Link>
      <div className="form">
        <label>
          סטטוס
          <select
            aria-label="סטטוס"
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackStatus)}
          >
            {FEEDBACK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {FEEDBACK_STATUS_LABELS[s]}
              </option>
            ))}
          </select>
        </label>
        <label>
          אחראי טיפול
          <select aria-label="אחראי טיפול" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">— ללא —</option>
            {(people.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          תיעוד החלטה
          <textarea
            aria-label="תיעוד החלטה"
            rows={3}
            maxLength={2000}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn primary sm"
          disabled={patch.isPending}
          onClick={() => void save()}
        >
          שמור
        </button>
      </div>
      <div className="form feedback-resolve">
        <label>
          נסגר בגרסה
          <select aria-label="נסגר בגרסה" value={version} onChange={(e) => setVersion(e.target.value)}>
            <option value="">— בחר גרסה —</option>
            {f.laterVersions.map((v) => (
              <option key={v.version} value={v.version}>
                v{v.version} · {v.label || 'ללא תיאור'} · {fmtDate(v.createdAt)}
              </option>
            ))}
          </select>
        </label>
        {!f.laterVersions.length ? (
          <div className="small muted">
            עדיין לא פורסמה גרסה חדשה אחרי המשוב — פרסמו עדכון ואז סגרו כאן, או סמנו "לא נדרש שינוי"
          </div>
        ) : null}
        <button
          type="button"
          className="btn sm"
          disabled={!version || resolve.isPending || f.status === 'done'}
          onClick={() => void close()}
        >
          סגור משוב
        </button>
        {f.resolvedVersion ? <div className="small ok">נסגר בגרסה v{f.resolvedVersion}</div> : null}
      </div>
    </aside>
  );
}
