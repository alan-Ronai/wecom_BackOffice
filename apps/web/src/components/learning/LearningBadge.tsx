import { Link } from 'react-router-dom';
import { useDocumentLearning } from '../../api/hooks/learning.js';
import { useCan } from '../../api/hooks/me.js';

/** Editor-facing chip: how many published briefings/quizzes reference this document. */
export function LearningBadge({ documentId }: { documentId: string }) {
  const can = useCan();
  const dl = useDocumentLearning(documentId, can('learning.manage'));
  const n = dl.data?.items.length ?? 0;
  if (!n) return null;
  const label = n === 1 ? 'כלול בפריט למידה אחד' : `כלול ב-${n} פריטי למידה`;
  return (
    <Link
      to={`/learning/manage?documentId=${documentId}`}
      className="chip chip-blue"
      title="פריטי למידה המפנים למסמך"
    >
      {label}
    </Link>
  );
}
