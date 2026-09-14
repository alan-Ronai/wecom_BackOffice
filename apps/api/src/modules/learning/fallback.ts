/**
 * Wave 5 (V1) — deterministic question generation from a document's structure (spec §1.2).
 *
 * Pure and without randomness on purpose: the same document always yields the same questions,
 * so the generator is unit-testable by exact output and an editor who regenerates twice sees
 * no churn. The local model (Task 3) rewrites and extends these; when it is absent or fails,
 * this is the answer and the route reports `source: 'rules'`.
 */
import type { Document, QuizQuestion, Step } from '@wecom/shared';

export const optionId = (i: number) => 'o' + (i + 1);
export const allSteps = (doc: Document): Step[] => doc.phases.flatMap((p) => p.steps);
const FIELD_RE = /↗\s*שדה\s*"([^"]+)"/;

const opts = (texts: string[], correctIdx: number[]) =>
  texts.map((text, i) => ({ id: optionId(i), text, correct: correctIdx.includes(i) }));
const base = (doc: Document, stepKey: string | null, stem: string, kind: QuizQuestion['kind']) => ({
  documentId: doc.id,
  stepKey,
  stem,
  kind,
  explanation: '',
  generated: true,
  modelConf: null as number | null,
});

const fieldOf = (s: Step): string | null => {
  for (const a of s.actions) {
    const m = FIELD_RE.exec(a.text);
    if (m) return m[1];
  }
  return null;
};

/** Deterministic questions from a document's structure (spec §1.2). Priority: branch → goto → field → order. */
export function generateFromDocument(
  doc: Document,
  perDocument: number,
  fieldNames: readonly string[] = [],
): QuizQuestion[] {
  if (doc.kind === 'text') return [];
  const steps = allSteps(doc);
  const titleOf = new Map(steps.map((s) => [s.key, s.title]));
  const branch: QuizQuestion[] = [];
  const gotos: QuizQuestion[] = [];
  const fields: QuizQuestion[] = [];
  const docFields = steps.map(fieldOf).filter((f): f is string => !!f);

  steps.forEach((s, idx) => {
    if (s.branch && s.branch.options.length >= 2) {
      const texts = s.branch.options.map((o) => o.text);
      s.branch.options.forEach((o, i) =>
        branch.push({
          ...base(doc, s.key, `בשלב "${s.title}", אם ${o.label} — מה עושים?`, 'single'),
          options: opts(texts, [i]),
          explanation: s.branch!.q,
        }),
      );
    }
    if (steps.length >= 2)
      for (const o of s.outcomes) {
        if (!o.goto || !titleOf.has(o.goto)) continue;
        const others: string[] = [];
        // Wraps all the way back to the asking step itself: it is a plausible distractor and a
        // three-step document would otherwise produce a two-option question.
        for (let k = 1; k <= steps.length && others.length < 3; k++) {
          const cand = steps[(idx + k) % steps.length];
          if (cand.key !== o.goto) others.push(cand.title);
        }
        gotos.push({
          ...base(doc, s.key, `מה השלב הבא לאחר "${o.text}" בשלב "${s.title}"?`, 'single'),
          options: opts([titleOf.get(o.goto)!, ...others], [0]),
        });
      }
    const f = fieldOf(s) ?? fieldNames.find((n) => s.actions.some((a) => a.text.includes(n))) ?? null;
    if (f) {
      const distractors = [...new Set([...fieldNames, ...docFields])].filter((n) => n !== f).slice(0, 3);
      if (distractors.length >= 1)
        fields.push({
          ...base(doc, s.key, `באיזה שדה CRM בודקים בשלב "${s.title}"?`, 'single'),
          options: opts([f, ...distractors], [0]),
        });
    }
  });

  const order: QuizQuestion[] = [];
  if (steps.length >= 3) {
    const first = steps.slice(0, 4).map((s) => s.title);
    order.push({
      ...base(doc, null, `סדר את השלבים הבאים לפי סדר הביצוע ב"${doc.title}"`, 'order'),
      options: opts(
        first,
        first.map((_, i) => i),
      ),
    });
  }
  return [...branch, ...gotos, ...fields, ...order].slice(0, perDocument);
}
