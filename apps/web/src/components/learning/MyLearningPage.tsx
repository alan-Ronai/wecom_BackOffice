import type { Assignment } from '@wecom/shared';
import { useMyLearning } from '../../api/hooks/learning.js';
import { useCan } from '../../api/hooks/me.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { Empty, LoadError } from '../ui/index.js';
import { AssignmentCard } from './AssignmentCard.js';

function Section({ title, items }: { title: string; items: Assignment[] }) {
  if (!items.length) return null;
  return (
    <section className="learning-section" aria-label={title}>
      <h2>
        {title} <span className="chip chip-gray">{items.length}</span>
      </h2>
      <div className="grid">
        {items.map((a) => (
          <AssignmentCard key={a.id} a={a} />
        ))}
      </div>
    </section>
  );
}

/** PRD §13 — the agent's assignments: briefings to read, quizzes to pass, refreshes to redo. */
export function MyLearningPage() {
  const can = useCan();
  const mayRead = can('learning.read');
  const my = useMyLearning(mayRead);
  if (!mayRead)
    return (
      <div className="page">
        <Empty title="אין הרשאה ללמידה">פנה למנהל המערכת.</Empty>
      </div>
    );
  const d = my.data;
  const empty = d && !d.open.length && !d.overdue.length && !d.completed.length && !d.invalidated.length;
  return (
    <div className="page learning-page">
      <div className="lib-head">
        <Hamburger />
        <h1>הלמידה שלי</h1>
      </div>
      {my.isError ? <LoadError what="מטלות הלמידה" error={my.error} /> : null}
      {empty ? (
        <Empty title="אין לך מטלות למידה כרגע">כשיוקצה לך תדריך או שאלון, הוא יופיע כאן.</Empty>
      ) : null}
      {d ? (
        <>
          <Section title="באיחור" items={d.overdue} />
          <Section title="פתוחות" items={d.open} />
          <Section title="הושלמו" items={d.completed} />
          <Section title="בוטלו" items={d.invalidated} />
        </>
      ) : null}
    </div>
  );
}
