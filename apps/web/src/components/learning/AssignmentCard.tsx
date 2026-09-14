import { Link } from 'react-router-dom';
import type { Assignment } from '@wecom/shared';
import { fmtDate, inDays } from '../../lib/format.js';
import { KIND_LABEL, dueTone, scoreLabel } from '../../lib/learning.js';
import { Chip } from '../ui/index.js';

export function AssignmentCard({ a }: { a: Assignment }) {
  const due =
    a.status === 'completed' ? `הושלם ${fmtDate(a.completedAt ?? a.dueAt)}` : `יעד: ${inDays(a.dueAt)}`;
  return (
    <article className="tcard learning-card">
      <div className="learning-card-head">
        <Chip tone={a.kind === 'quiz' ? 'chip-purple' : 'chip-blue'}>{KIND_LABEL[a.kind]}</Chip>
        {a.reason === 'refresh' ? <Chip tone="chip-amber">רענון ידע</Chip> : null}
        <span className="grow" />
        <Chip tone={a.status === 'completed' ? 'chip-green' : dueTone(a)}>{due}</Chip>
      </div>
      <Link to={`/learning/${a.id}`} className="learning-card-title">
        {a.title}
      </Link>
      <div className="learning-card-meta">
        {a.estimatedMinutes ? <span>{a.estimatedMinutes} דק׳</span> : null}
        {a.refreshReason ? <span>סיבה: {a.refreshReason}</span> : null}
        {scoreLabel(a) ? <span>{scoreLabel(a)}</span> : null}
        {a.kind === 'quiz' && a.passMark ? <span>ציון עובר {a.passMark}</span> : null}
      </div>
    </article>
  );
}
