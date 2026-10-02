import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Fmt } from '../Fmt.js';

/**
 * "שלב 3א", "שלב 12", "שלב 4ב'" — a step's *display* number, as the article prints it.
 *
 * Global, because a single answer cites several steps. One shared module constant is safe here
 * precisely because the only consumer is `matchAll`, which iterates a *clone* and never advances
 * this object's `lastIndex`. `.test()` or `.exec()` on it would, and would then skip every other
 * match — reach for `matchAll`, or clone first.
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
 *
 * Everything that is *not* a citation goes through `<Fmt>` — the same bidi-safe treatment every
 * other stretch of model prose gets, with CRM chip substitution off (a model's sentence is not a
 * step body, so a field name inside it must not become a chip). That is the reconciliation the
 * X6 review asked for: `Fmt` owns the RTL rendering, this owns the links, and neither swallows
 * the other. `Fmt` escapes what it renders, so no model text reaches the DOM as markup.
 */
export function renderWithStepLinks(
  text: string,
  documentId: string,
  stepIndex?: Record<string, string>,
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  const prose = (from: number, to: number) => {
    if (to > from) out.push(<Fmt key={`t${from}`} text={text.slice(from, to)} fields={[]} docs={[]} noCrm />);
  };
  for (const m of text.matchAll(STEP_REF_RE)) {
    const i = m.index ?? 0;
    prose(last, i);
    const num = m[1].replace(/'$/, '');
    out.push(
      <Link key={`l${i}`} to={`/doc/${documentId}/${stepIndex?.[num] ?? num}`} className="step-cite">
        {m[0]}
      </Link>,
    );
    last = i + m[0].length;
  }
  prose(last, text.length);
  return out;
}
