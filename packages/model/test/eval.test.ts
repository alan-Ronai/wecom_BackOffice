import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  aggregate,
  contextForCase,
  EVAL_CASES_DIR,
  loadCases,
  RuleBasedModel,
  scoreCase,
} from '../src/index.js';
import type { ProposedSuggestion } from '../src/index.js';
import type { EvalCase } from '@wecom/shared';

/**
 * Wave 6 (X1), spec §1.9. Two things are pinned here: the scoring is the scoring the admin page
 * reports, and the committed case set parses and is answerable — the rule engine's floor is what
 * stops a "the model is better now" claim that is really "the fallback got worse".
 */
const target = '11111111-1111-4111-8111-111111111111';
const suggestion = (over: Partial<ProposedSuggestion> = {}): ProposedSuggestion =>
  ({
    anchor: '§4.8',
    type: 'update-step',
    title: 'סף 5 → 6 מגה',
    targetDocumentId: target,
    targetStepKey: 's8',
    targetBlockId: null,
    payload: { type: 'update-step', addActions: ['ודא מעל 6 מגה'], patch: {} },
    confidence: 0.8,
    rationale: 'הסף שונה',
    ...over,
  }) as ProposedSuggestion;

const caseOf = (mustContain: string[] = ['6']): EvalCase =>
  ({
    id: 'c',
    title: 'c',
    source: { title: 's' },
    diffs: [],
    linkedSteps: [],
    blocks: [],
    fields: [],
    expected: [{ type: 'update-step', targetDocumentId: target, targetStepKey: 's8', mustContain }],
  }) as EvalCase;

describe('eval scoring', () => {
  it('scores a perfect answer 1/1/1', () => {
    expect(scoreCase(caseOf(), [suggestion()])).toEqual({
      hitTarget: 1,
      hitType: 1,
      contentOverlap: 1,
    });
  });

  it('scores nothing at all when the target is wrong — type is not partial credit', () => {
    expect(scoreCase(caseOf(), [suggestion({ targetStepKey: 's9' })])).toEqual({
      hitTarget: 0,
      hitType: 0,
      contentOverlap: 0,
    });
  });

  it('counts the right place with the wrong type as a target hit only', () => {
    const s = scoreCase(caseOf(['נמחק']), [
      suggestion({ type: 'deprecate-step', payload: { type: 'deprecate-step', reason: 'x' } }),
    ]);
    expect(s.hitTarget).toBe(1);
    expect(s.hitType).toBe(0);
    expect(s.contentOverlap).toBe(0);
  });

  it('measures content over the title, the rationale and the payload together', () => {
    // §1.6 asks the model to name the impact in the *rationale*, so a case may assert on it.
    const s = scoreCase(caseOf(['6', 'ניתוקים חוזרים']), [
      suggestion({ rationale: 'משפיע גם על "ניתוקים חוזרים"' }),
    ]);
    expect(s.contentOverlap).toBe(1);
    expect(scoreCase(caseOf(['6', 'לא קיים']), [suggestion()]).contentOverlap).toBe(0.5);
  });

  it('aggregates to a mean, and an empty run is zeroes rather than NaN', () => {
    expect(aggregate([])).toEqual({ hitTarget: 0, hitType: 0, contentOverlap: 0 });
    expect(
      aggregate([
        { hitTarget: 1, hitType: 1, contentOverlap: 1 },
        { hitTarget: 0, hitType: 0, contentOverlap: 0 },
      ]),
    ).toEqual({ hitTarget: 0.5, hitType: 0.5, contentOverlap: 0.5 });
  });
});

describe('the committed case set', () => {
  const cases = loadCases(fileURLToPath(EVAL_CASES_DIR));

  it('parses at least eight Hebrew cases through EvalCaseSchema', () => {
    expect(cases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) {
      expect(c.expected.length).toBeGreaterThan(0);
      expect(c.title).toMatch(/[֐-׿]/);
    }
  });

  it('holds the rule engine to its floor — the fallback must stay answerable', async () => {
    const model = new RuleBasedModel();
    const scores = [];
    for (const c of cases) scores.push(scoreCase(c, await model.proposeChanges(contextForCase(c))));
    const total = aggregate(scores);
    expect(total.hitTarget).toBeGreaterThanOrEqual(0.6);
  });
});
