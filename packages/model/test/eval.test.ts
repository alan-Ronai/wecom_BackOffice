import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import {
  aggregate,
  contextForCase,
  EVAL_CASES_DIR,
  languageOffences,
  LATIN_ALLOW_LIST,
  loadCases,
  normaliseHebrew,
  RuleBasedModel,
  scoreCase,
} from '../src/index.js';
import type { CaseScore, ProposedSuggestion } from '../src/index.js';
import type { EvalCase } from '@wecom/shared';

/**
 * Wave 6 (X1), spec §1.9. Two things are pinned here: the scoring is the scoring the admin page
 * reports, and the committed case set parses and is answerable — the rule engine's floor is what
 * stops a "the model is better now" claim that is really "the fallback got worse".
 *
 * Fix wave (C-I1): the harness now has a counterweight. Before precision, a verified "shotgun"
 * client that emitted one suggestion per (type × candidate target) with a keyword-stuffed title
 * scored a perfect 1.000/1.000/1.000, so every number the harness ever produced was an upper
 * bound. The shotgun test below is that demonstration, kept as a regression.
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

const caseOf = (over: Partial<EvalCase> = {}, mustContain: string[] = ['6']): EvalCase =>
  ({
    id: 'c',
    title: 'c',
    source: { title: 's' },
    diffs: [],
    linkedSteps: [],
    blocks: [],
    fields: [],
    notes: '',
    allowLatin: [],
    examples: [],
    expected: [
      { type: 'update-step', targetDocumentId: target, targetStepKey: 's8', mustContain, mustContainAny: [] },
    ],
    ...over,
  }) as EvalCase;

const perfect: CaseScore = {
  hitTarget: 1,
  hitType: 1,
  contentOverlap: 1,
  precision: 1,
  languageOk: 1,
  languageFailures: 0,
};

describe('eval scoring', () => {
  it('scores a perfect answer 1 on every axis', () => {
    expect(scoreCase(caseOf(), [suggestion()])).toEqual(perfect);
  });

  it('scores nothing at all when the target is wrong — type is not partial credit', () => {
    const s = scoreCase(caseOf(), [suggestion({ targetStepKey: 's9' })]);
    expect([s.hitTarget, s.hitType, s.contentOverlap]).toEqual([0, 0, 0]);
    // …and the suggestion that missed is also an extra, so precision sees it.
    expect(s.precision).toBe(0);
  });

  it('counts the right place with the wrong type as a target hit only', () => {
    const s = scoreCase(caseOf({}, ['נמחק']), [
      suggestion({ type: 'deprecate-step', payload: { type: 'deprecate-step', reason: 'x' } }),
    ]);
    expect(s.hitTarget).toBe(1);
    expect(s.hitType).toBe(0);
    expect(s.contentOverlap).toBe(0);
  });

  it('measures content over the title, the rationale and the payload together', () => {
    // §1.6 asks the model to name the impact in the *rationale*, so a case may assert on it.
    const s = scoreCase(caseOf({}, ['6', 'ניתוקים חוזרים']), [
      suggestion({ rationale: 'משפיע גם על "ניתוקים חוזרים"' }),
    ]);
    expect(s.contentOverlap).toBe(1);
    expect(scoreCase(caseOf({}, ['6', 'לא קיים']), [suggestion()]).contentOverlap).toBe(0.5);
  });

  it('matches a Hebrew phrase across its prefix clitics (mustContainAny)', () => {
    expect(normaliseHebrew('הניתוקים ובמסמך')).toBe('ניתוקים מסמך');
    const c = caseOf(
      {
        expected: [
          { type: 'update-step', targetStepKey: 's8', mustContain: [], mustContainAny: [['ניתוקים חוזרים']] },
        ] as never,
      },
      [],
    );
    // "בניתוקים החוזרים" is the same phrase; a plain substring test scored it zero.
    expect(scoreCase(c, [suggestion({ rationale: 'משפיע בניתוקים החוזרים' })]).contentOverlap).toBe(1);
    expect(scoreCase(c, [suggestion({ rationale: 'משפיע על החיוב' })]).contentOverlap).toBe(0);
  });

  it('penalises a shotgun answer, which used to score a perfect run (C-I1)', () => {
    const shotgun = [
      suggestion(),
      suggestion({ type: 'deprecate-step', payload: { type: 'deprecate-step', reason: 'x' } }),
      suggestion({ targetStepKey: 's9' }),
      suggestion({ targetStepKey: 's10' }),
    ];
    const s = scoreCase(caseOf(), shotgun);
    expect(s.hitTarget).toBe(1);
    expect(s.precision).toBe(0.25);
  });

  it('honours maxItems even when every suggestion is the right one', () => {
    const s = scoreCase(caseOf({ maxItems: 1 }), [suggestion(), suggestion(), suggestion()]);
    expect(s.precision).toBeCloseTo(1 / 3, 5);
  });

  it('scores a negative case 1 for silence and 0 for anything at all', () => {
    const negative = caseOf({ expected: [], maxItems: 0 });
    expect(scoreCase(negative, [])).toEqual(perfect);
    expect(scoreCase(negative, [suggestion()])).toMatchObject({ hitTarget: 0, precision: 0 });
  });

  it('flags CJK, Cyrillic and unexpected latin words in the editor-visible text (C-I8)', () => {
    const allow = new Set<string>(LATIN_ALLOW_LIST);
    expect(languageOffences('הרץ Speedtest ובדוק את ה-SIM', allow)).toEqual([]);
    expect(languageOffences('שלב s8 בגרסה 4G', allow)).toEqual([]);
    expect(languageOffences('הadir את champs', allow)).toEqual(['adir', 'champs']);
    expect(languageOffences('鉴于变更 הבלוк', allow).length).toBeGreaterThan(0);
    const s = scoreCase(caseOf(), [suggestion({ rationale: 'ערך שונה, его блок' })]);
    expect(s.languageOk).toBe(0);
    expect(s.languageFailures).toBe(1);
  });

  it('aggregates rates to a mean and language failures to a sum', () => {
    expect(aggregate([])).toEqual({
      hitTarget: 0,
      hitType: 0,
      contentOverlap: 0,
      precision: 0,
      languageOk: 0,
      languageFailures: 0,
    });
    const zero: CaseScore = {
      hitTarget: 0,
      hitType: 0,
      contentOverlap: 0,
      precision: 0,
      languageOk: 0,
      languageFailures: 3,
    };
    expect(aggregate([perfect, zero])).toEqual({
      hitTarget: 0.5,
      hitType: 0.5,
      contentOverlap: 0.5,
      precision: 0.5,
      languageOk: 0.5,
      languageFailures: 3,
    });
  });
});

describe('the committed case set', () => {
  const cases = loadCases(fileURLToPath(EVAL_CASES_DIR));

  it('parses at least twenty Hebrew cases through EvalCaseSchema', () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    for (const c of cases) expect(c.title).toMatch(/[֐-׿]/);
  });

  it('carries a negative half, every suggestion type, and the wave-6 features', () => {
    expect(cases.filter((c) => !c.expected.length).length).toBeGreaterThanOrEqual(6);
    const types = new Set(cases.flatMap((c) => c.expected.map((e) => e.type)));
    for (const t of ['update-step', 'update-block', 'deprecate-step', 'new-step', 'new-card', 'field-alert'])
      expect(types).toContain(t);
    expect(cases.filter((c) => c.expected.length > 1).length).toBeGreaterThanOrEqual(2);
    expect(cases.filter((c) => c.impact).length).toBeGreaterThanOrEqual(2);
    expect(cases.some((c) => c.brief && c.style && c.examples.length)).toBe(true);
    expect(cases.some((c) => c.source.singleDocument)).toBe(true);
  });

  it('holds the rule engine to its floor — the fallback must stay answerable', async () => {
    const model = new RuleBasedModel();
    const scores = [];
    const latencies: number[] = [];
    for (const c of cases) {
      const started = Date.now();
      scores.push(scoreCase(c, await model.proposeChanges(contextForCase(c))));
      latencies.push(Date.now() - started);
    }
    const total = aggregate(scores);
    expect(total.hitTarget).toBeGreaterThanOrEqual(0.875);
    expect(total.precision).toBeGreaterThanOrEqual(0.9);
    expect(total.languageFailures).toBe(0);
    /**
     * Latency is recorded, not asserted: a tier that scores well by taking 90 s/case is visibly
     * not shippable, and that judgement belongs in `docs/wave6-acceptance.md` rather than in a
     * test that would go red on a loaded CI box. The engine itself has no excuse, so this only
     * catches an accidental O(n²).
     */
    const median = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
    expect(median).toBeLessThan(1000);
  });
});
