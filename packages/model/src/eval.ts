import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvalCaseSchema, type EvalCase, type EvalExpectation } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';

/**
 * Wave 6 (X1), spec §1.9. "Did the model get better" was unanswerable: the only feedback was
 * the review queue, which mixes a prompt change with whatever the sources happened to contain
 * that week. This is the fixed board — a committed set of Hebrew cases, scored the same way
 * every time, so a tier or a prompt version is a number rather than an impression.
 *
 * Three scores, each 0..1 over the case's `expected` entries:
 *
 * - `hitTarget`  — a suggestion pointed at the expected (document, step).
 * - `hitType`    — that suggestion was also of the expected type. Only a matched target can
 *                  score here: a `deprecate-step` aimed at the wrong step is not half right.
 * - `contentOverlap` — the share of the expectation's `mustContain` strings that appear
 *                  anywhere in the matched suggestion's title, rationale or payload. Searching
 *                  all three is deliberate: §1.6 asks the model to name the impact in the
 *                  *rationale*, so a case can assert on it.
 */
export interface CaseScore {
  hitTarget: number;
  hitType: number;
  contentOverlap: number;
}

const haystack = (s: ProposedSuggestion): string =>
  [s.title, s.rationale, JSON.stringify(s.payload)].join(' ').toLowerCase();

/** A suggestion matches an expectation's target when both named parts agree. */
const targets = (s: ProposedSuggestion, e: EvalExpectation): boolean =>
  (e.targetDocumentId === undefined || s.targetDocumentId === e.targetDocumentId) &&
  (e.targetStepKey === undefined || s.targetStepKey === e.targetStepKey);

export function scoreCase(c: EvalCase, items: ProposedSuggestion[]): CaseScore {
  if (!c.expected.length) return { hitTarget: 0, hitType: 0, contentOverlap: 0 };
  let target = 0;
  let type = 0;
  let overlap = 0;
  const share = (s: ProposedSuggestion, e: EvalExpectation): number => {
    if (!e.mustContain.length) return 1;
    const hay = haystack(s);
    return e.mustContain.filter((m) => hay.includes(m.toLowerCase())).length / e.mustContain.length;
  };
  for (const e of c.expected) {
    const matched = items.filter((s) => targets(s, e));
    if (!matched.length) continue;
    target++;
    /**
     * Prefer a match of the right type — a suggestion of another type aimed at the same step is
     * not the one the case was written about — and among those the one that actually contains
     * the expected content. A case whose expectations carry no target (the new-source path, where
     * every card has `targetDocumentId: null`) otherwise scores whichever card came out first.
     */
    const sameType = matched.filter((s) => s.type === e.type);
    if (sameType.length) type++;
    const pool = sameType.length ? sameType : matched;
    overlap += Math.max(...pool.map((s) => share(s, e)));
  }
  const n = c.expected.length;
  return { hitTarget: target / n, hitType: type / n, contentOverlap: overlap / n };
}

/** Mean of each score over the run; an empty run is three zeroes, not NaN. */
export function aggregate(scores: CaseScore[]): CaseScore {
  if (!scores.length) return { hitTarget: 0, hitType: 0, contentOverlap: 0 };
  const sum = (f: (s: CaseScore) => number) => scores.reduce((a, s) => a + f(s), 0) / scores.length;
  return {
    hitTarget: sum((s) => s.hitTarget),
    hitType: sum((s) => s.hitType),
    contentOverlap: sum((s) => s.contentOverlap),
  };
}

/** Every `*.json` under `dir`, parsed through `EvalCaseSchema`, ordered by filename. */
export function loadCases(dir: string): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => EvalCaseSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/** The committed case set's directory, resolved from this package rather than the cwd. */
export const EVAL_CASES_DIR = new URL('../eval/cases/', import.meta.url);

/**
 * One case as the pipeline would present it. `paragraphs` are synthesised from the diffs' own
 * text so `isNewSourcePath` behaves exactly as it does in production for a case with no linked
 * steps — a case must not accidentally test a path the pipeline never takes.
 *
 * A ref of the `h<level>-<n>` form (what `htmlToParagraphs` and the docx parser produce for a
 * heading) is rebuilt as a heading paragraph, because `groupSections` keys the whole new-source
 * path off `heading`/`level`: without it a three-section source would be scored as one section.
 */
const HEADING_REF = /^h(\d)-\d+$/;
export function contextForCase(c: EvalCase): ProposalContext {
  return {
    source: { id: c.id, title: c.source.title, singleDocument: c.source.singleDocument },
    diffs: c.diffs,
    paragraphs: c.diffs.map((d) => {
      const text = d.after ?? d.before ?? '';
      const h = HEADING_REF.exec(d.ref);
      return h
        ? { ref: d.ref, heading: text, level: Number(h[1]), runs: [{ t: text }] }
        : { ref: d.ref, runs: [{ t: text }] };
    }),
    linkedSteps: c.linkedSteps.map((s) => ({ ...s })),
    fields: c.fields,
    blocks: c.blocks,
    impact: c.impact,
  };
}
