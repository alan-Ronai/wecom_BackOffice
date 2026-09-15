import type { Assignment, Document } from '@wecom/shared';

export const KIND_LABEL: Record<Assignment['kind'], string> = { briefing: 'תדריך', quiz: 'שאלון' };

/**
 * Move one row of an ordered list by a step, or return it unchanged at the ends.
 *
 * The ↑/↓ buttons are the wave-4 ordering ruling (keyboard-reachable, no drag), and wave 5 orders
 * three lists with them — briefing entries, quiz questions, and the learner's own answer to an
 * `order` question. One implementation so the player and the builders cannot disagree.
 */
export const move = <T>(xs: readonly T[], i: number, dir: -1 | 1): T[] => {
  const j = i + dir;
  if (i < 0 || i >= xs.length || j < 0 || j >= xs.length) return [...xs];
  const n = [...xs];
  [n[i], n[j]] = [n[j]!, n[i]!];
  return n;
};
export const STATUS_LABEL: Record<Assignment['status'], string> = {
  open: 'פתוחה',
  overdue: 'באיחור',
  completed: 'הושלמה',
  invalidated: 'בוטלה',
};

/** Chip tone for the due date: red when overdue, amber inside 3 days, gray otherwise. */
export function dueTone(a: Assignment, now = Date.now()): 'chip-red' | 'chip-amber' | 'chip-gray' {
  if (a.status === 'overdue') return 'chip-red';
  const days = (new Date(a.dueAt).getTime() - now) / 864e5;
  return days < 0 ? 'chip-red' : days <= 3 ? 'chip-amber' : 'chip-gray';
}

/** "ציון 90" for a scored quiz, "" for briefings and unscored quizzes. */
export const scoreLabel = (a: Assignment): string =>
  a.kind === 'quiz' && a.lastScore !== null ? `ציון ${a.lastScore}` : '';

/**
 * A briefing entry arrives with its title and phases pinned at the version the learner was
 * assigned; `DocBody` wants a `Document`, so build a neutral one instead of casting.
 */
export function entryDoc(entry: {
  documentId: string;
  documentTitle: string;
  phases: Document['phases'];
}): Document {
  const now = new Date(0).toISOString();
  return {
    id: entry.documentId,
    slug: 'learning-entry',
    title: entry.documentTitle,
    description: '',
    category: 'ops',
    wave: 1,
    priority: 'm',
    kind: 'steps',
    status: 'published',
    currentVersion: 0,
    phases: entry.phases,
    related: [],
    tags: [],
    worlds: [],
    topics: [],
    sourceReviewNeeded: false,
    createdAt: now,
    updatedAt: now,
  };
}
