import { stripFmt } from '@wecom/shared';
import type { ResolvedStep } from './steps.js';

/**
 * A-1 (acceptance review §3, §7 item 15) — "what happens after this step".
 *
 * The review drove `תקלת גלישה בחו"ל` and found that none of its four steps carries a rule, so
 * `1`/`2`/`3` did nothing and progress sat at 0% while the call aside kept telling the agent to
 * press them. The aside's hint was a constant; it has to be per step.
 *
 * Two things come out of that, and they are the two this module computes. `choices` is how many
 * outcome keys *this* step actually offers, which is what decides whether the aside advertises
 * `1-3` at all. `text` is the one-line `מה הלאה`: where the call goes from here — the next step,
 * the several steps the outcomes branch to, or `סיום` when the step ends the call.
 *
 * Derived from the document, never from call state: an agent reading a step before picking
 * anything should already be able to see where each answer leads.
 */

export interface NextHint {
  /** The `מה הלאה` line, ready to render. */
  text: string;
  /** Nothing follows: this step ends the call. */
  terminal: boolean;
  /** Outcome keys this step offers (0–3). Zero means `1-3` should not be advertised. */
  choices: number;
}

/**
 * How many outcomes get a digit (L1).
 *
 * `ArticlePage`'s key handler binds `1`–`3` and the keymap card advertises `1-3`, so a fourth
 * outcome has no key — which is why `choices` is capped here and why `StepView` stops drawing a
 * `<kbd>` past the third. Exported so the two cannot drift: a keycap the keyboard does not honour
 * is the same defect in the other direction.
 *
 * The *hint* below still names every destination, because every outcome is clickable — the cap is
 * on keys, not on where the call can go.
 */
export const MAX_OUTCOME_KEYS = 3;

const label = (s: ResolvedStep | undefined): string => (s ? `שלב ${s.num}: ${stripFmt(s.title)}` : 'סיום');

/**
 * Where one outcome (or branch option) leads.
 *
 * `useCall.pickOutcome` resolves `goto` against the step list and falls back to the next step in
 * order — including when `goto` names a step that is not there — so this has to resolve it the
 * same way, or the hint would promise a destination the call would not actually take.
 */
const destination = (goto: string | undefined, steps: ResolvedStep[], i: number): ResolvedStep | undefined =>
  (goto && steps.find((s) => s.key === goto)) || steps[i + 1];

export function nextHint(step: ResolvedStep, steps: ResolvedStep[]): NextHint {
  const i = steps.findIndex((s) => s.key === step.key);
  const inOrder = steps[i + 1];

  // A step carries outcomes or a branch, never both in the UI: `StepView` gives the digits to the
  // branch options when there is a branch, and to the outcomes otherwise.
  const gotos = step.branch ? step.branch.options.map((o) => o.goto) : step.outcomes.map((o) => o.goto);
  // Only the first three are reachable from the keyboard, which is what the aside advertises.
  const choices = Math.min(gotos.length, MAX_OUTCOME_KEYS);

  if (!choices) {
    return {
      text: inOrder ? `מה הלאה · ${label(inOrder)}` : 'מה הלאה · סיום השיחה',
      terminal: !inOrder,
      choices: 0,
    };
  }

  const dests = gotos.map((g) => destination(g, steps, i));
  const unique = [...new Map(dests.map((d) => [d?.key ?? '', d])).values()];

  if (unique.length === 1) {
    const only = unique[0];
    return {
      text: only ? `מה הלאה · ${label(only)}` : 'מה הלאה · סיום השיחה',
      terminal: !only,
      choices,
    };
  }

  // A branching step: naming every destination is the whole value of the hint, because this is
  // exactly where an agent cannot predict what pressing `2` will do. Every outcome is listed,
  // including a fourth that has no digit — it is one click away, and a hint that hid it would
  // describe a call the agent cannot make sense of when they take that branch.
  return {
    text: `מה הלאה · לפי התוצאה: ${unique.map((d) => label(d)).join(' · ')}`,
    terminal: unique.every((d) => !d),
    choices,
  };
}

/** Every step's hint, keyed by step key — computed once per render of a document body. */
export const nextHints = (steps: ResolvedStep[]): Record<string, NextHint> =>
  Object.fromEntries(steps.map((s) => [s.key, nextHint(s, steps)]));
