import { similarity, paragraphText, type Paragraph, type ParagraphDiff } from '@wecom/shared';

const beforeText = (p: Paragraph) =>
  p.runs
    .filter((r) => !r.add)
    .map((r) => r.t)
    .join('')
    .trim();
const afterText = (p: Paragraph) => paragraphText(p).trim();
const tracked = (p: Paragraph) => p.runs.some((r) => r.add || r.del);

/** Minimum bigram similarity for two differently-numbered paragraphs to count as the same one. */
export const SIM_THRESHOLD = 0.6;

/**
 * Aligns the previous accepted revision with the incoming one:
 * 1. paragraphs carrying tracked changes are diffed from their own runs,
 * 2. remaining paragraphs are paired on identical `ref`,
 * 3. leftovers are paired greedily by similarity (catches renumbering),
 * 4. unmatched previous paragraphs are reported as removed, after the next-order ones.
 */
export function paragraphDiff(prev: Paragraph[] | null, next: Paragraph[]): ParagraphDiff[] {
  const out: ParagraphDiff[] = [];
  const prevList = prev ?? [];
  const usedPrev = new Set<number>();
  const byRef = new Map<string, number>();
  prevList.forEach((p, i) => byRef.set(p.ref, i));
  const pending: Paragraph[] = [];

  for (const p of next) {
    if (tracked(p)) {
      out.push({
        ref: p.ref,
        kind: p.isDeleted ? 'removed' : p.isNew ? 'added' : 'changed',
        before: p.isNew ? null : beforeText(p),
        after: p.isDeleted ? null : afterText(p),
        similarity: similarity(beforeText(p), afterText(p)),
      });
      const j = byRef.get(p.ref);
      if (j != null) usedPrev.add(j);
      continue;
    }
    const j = byRef.get(p.ref);
    if (j != null && !usedPrev.has(j)) {
      usedPrev.add(j);
      const b = afterText(prevList[j]);
      const a = afterText(p);
      out.push({
        ref: p.ref,
        kind: a === b ? 'same' : 'changed',
        before: b,
        after: a,
        similarity: a === b ? 1 : similarity(b, a),
      });
      continue;
    }
    pending.push(p);
  }

  const candidates = pending
    .flatMap((p) =>
      prevList
        .map((q, j) => ({ p, j, s: usedPrev.has(j) ? -1 : similarity(afterText(q), afterText(p)) }))
        .filter((c) => c.s >= SIM_THRESHOLD),
    )
    .sort((a, b) => b.s - a.s);
  const matched = new Map<Paragraph, number>();
  for (const c of candidates) {
    if (matched.has(c.p) || usedPrev.has(c.j)) continue;
    matched.set(c.p, c.j);
    usedPrev.add(c.j);
  }
  for (const p of pending) {
    const j = matched.get(p);
    if (j == null) out.push({ ref: p.ref, kind: 'added', before: null, after: afterText(p), similarity: 0 });
    else {
      const b = afterText(prevList[j]);
      const a = afterText(p);
      out.push({ ref: p.ref, kind: 'changed', before: b, after: a, similarity: similarity(b, a) });
    }
  }
  prevList.forEach((q, j) => {
    if (!usedPrev.has(j))
      out.push({ ref: q.ref, kind: 'removed', before: afterText(q), after: null, similarity: 0 });
  });

  const order = new Map(next.map((p, i) => [p.ref, i]));
  return out.sort(
    (a, b) =>
      (a.kind === 'removed' ? 1 : 0) - (b.kind === 'removed' ? 1 : 0) ||
      (order.get(a.ref) ?? 0) - (order.get(b.ref) ?? 0),
  );
}
