import { Link, useParams } from 'react-router-dom';
import { usePlayerItem } from '../../api/hooks/learning.js';
import { KIND_LABEL } from '../../lib/learning.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Chip, Empty, LoadError } from '../ui/index.js';
import { BriefingReader } from './BriefingReader.js';
import { QuizPlayer } from './QuizPlayer.js';

/** `/learning/:assignmentId` — one route, two bodies: the reader for briefings, the player for quizzes. */
export function AssignmentPage() {
  const { assignmentId } = useParams<{ assignmentId: string }>();
  const q = usePlayerItem(assignmentId);
  if (q.isPending) return <div className="page" aria-busy="true" />;
  if (q.isError)
    return (
      <div className="page">
        {(q.error as { status?: number }).status === 404 ? (
          <Empty title="המטלה לא נמצאה">
            <Link to="/learning">חזרה ללמידה שלי</Link>
          </Empty>
        ) : (
          <LoadError what="המטלה" error={q.error} />
        )}
      </div>
    );
  const item = q.data;
  return (
    <div className="page learning-page">
      <div className="lib-head">
        <Hamburger />
        <Link to="/learning" className="linklike">
          ← הלמידה שלי
        </Link>
        <Chip tone={item.item.kind === 'quiz' ? 'chip-purple' : 'chip-blue'}>
          {KIND_LABEL[item.item.kind]}
        </Chip>
        <h1>{item.item.title}</h1>
      </div>
      {item.item.kind === 'briefing' ? <BriefingReader item={item} /> : <QuizPlayer item={item} />}
    </div>
  );
}
