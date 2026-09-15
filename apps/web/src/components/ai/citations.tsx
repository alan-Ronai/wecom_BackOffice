import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * "שלב 3א", "שלב 12", "שלב 4ב'" — a step's *display* number, as the article prints it.
 *
 * Global, because a single answer cites several steps; `matchAll` needs the `g` flag and a fresh
 * `lastIndex` per call, which is why the regex is re-created rather than shared as one object.
 */
export const STEP_REF_RE = /שלב\s+(\d{1,3}[א-ת]?'?)/g;

/**
 * Turns step mentions in a model's answer into links to the step.
 *
 * The route is `/doc/:id/:step` and `:step` is the step **key**, not its printed number
 * (`ArticlePage` resolves it with `findStep(doc, key)`). The pane knows the numbers because they
 * are what the model quotes, so the caller passes `stepIndex` — number → key — and a number the
 * map does not know falls back to itself: a link that lands on the document rather than no link at
 * all, which is what an agent mid-call needs.
 */
export function renderWithStepLinks(
  text: string,
  documentId: string,
  stepIndex?: Record<string, string>,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(STEP_REF_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(<Fragment key={`t${last}`}>{text.slice(last, i)}</Fragment>);
    const num = m[1].replace(/'$/, '');
    out.push(
      <Link key={`l${i}`} to={`/doc/${documentId}/${stepIndex?.[num] ?? num}`} className="step-cite">
        {m[0]}
      </Link>,
    );
    last = i + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={`t${last}`}>{text.slice(last)}</Fragment>);
  return out;
}
