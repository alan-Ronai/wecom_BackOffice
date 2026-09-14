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
import { docTypeLabel, worldLabel } from '../taxonomy/TypeBadge.js';

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

  /**
   * Seed the form from the report — keyed on its **id**, not on `detail.data`'s identity. Keyed on
   * the object, an ordinary window-focus refetch produced a new identity and silently wiped a
   * half-typed decision note; the save path re-seeds explicitly below instead.
   */
  const loaded = detail.data;
  useEffect(() => {
    if (!loaded) return;
    setStatus(loaded.status);
    setAssignee(loaded.assigneeId ?? '');
    setNote(loaded.decisionNote ?? '');
    // Prefill with the newest version published after the report (spec §5.4).
    const latest = loaded.laterVersions.at(-1);
    setVersion(latest ? String(latest.version) : '');
    // Intentionally only the id: see the note above. (No react-hooks plugin in this repo's
    // eslint config, so there is no rule to silence — the reason is the comment.)
  }, [loaded?.id]);

  // A drawer that traps attention has to be dismissible from the keyboard (wave 3's `Modal` bar).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

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
    const saved = await patch.mutateAsync({ id, status, assigneeId: assignee || null, decisionNote: note });
    setStatus(saved.status);
    setAssignee(saved.assigneeId ?? '');
    setNote(saved.decisionNote ?? '');
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
        <button type="button" className="x" title="סגור" aria-label="סגור" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="small muted">
        {f.documentTitle} · ניתן על גרסה v{f.documentVersion}
        {f.versionLabel && f.versionLabel !== `v${f.documentVersion}` ? ` (${f.versionLabel})` : ''}
        {f.stepKey ? ` · שלב ${f.stepKey}` : ''}
      </div>
      <div className="small muted">
        {f.userName} · {fmtDate(f.createdAt)} · עולם תוכן {worldLabel(f.worldSlug)}
        {/* A-4: `T · תסריט`, the spelling every other surface uses — not the bare storage code. */}
        {f.docType ? ` · סוג ${docTypeLabel(f.docType)}` : ''}
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
