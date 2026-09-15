import { describe, it, expect } from 'vitest';
import type { EvalCase } from '@wecom/shared';
import type { ModelClient, ProposedSuggestion } from '@wecom/model';
import { evalCases, runEvalCases, rulesModel } from '../../src/modules/ai/eval.js';

/**
 * The admin eval job (`POST /admin/ai/eval` → `ai.eval`) builds its model **without a fallback**,
 * on purpose: a tier that cannot answer has to show up as a failure rather than as the rule
 * engine quietly scoring in its place. That makes `runEvalCases`' catch the only thing standing
 * between a busy Ollama and a run that never finishes.
 *
 * It was not standing. The failure branch scored the case with
 * `scoreCase({ ...c, expected: [] }, [{} as never])`, and `scoreCase` reads `title` and
 * `rationale` off every suggestion for the language check *before* it reaches the negative-case
 * branch — so the placeholder threw `Cannot read properties of undefined`, out of the `catch`,
 * out of `runEvalCases`, and the job died with `ai_eval_runs.finished_at` still null. One
 * timeout took the whole run with it and left a row that looks like it is still going.
 */
const throwingModel = (message: string): ModelClient => ({
  name: 'always-fails',
  available: async () => true,
  proposeChanges: async () => {
    throw new Error(message);
  },
});

/** Fails on one case and answers (badly, but legally) on the rest. */
const flakyModel = (failOn: string): ModelClient => ({
  name: 'flaky',
  available: async () => true,
  proposeChanges: async (ctx) => {
    if (ctx.source.id === failOn) throw new Error('timeout after 180000ms');
    return [] as ProposedSuggestion[];
  },
});

describe('runEvalCases survives a model that throws', () => {
  const cases: EvalCase[] = evalCases();

  it('finishes the run, counts every case, and names the failures in the notes', async () => {
    const res = await runEvalCases(throwingModel('fetch failed'), cases);
    expect(res.cases).toBe(cases.length);
    // Every case failed, so nothing was got right…
    expect(res.hitTarget).toBe(0);
    expect(res.hitType).toBe(0);
    expect(res.contentOverlap).toBe(0);
    // …and precision/language report 0 rather than a vacuous 1.000 from averaging crashes in.
    expect(res.precision).toBe(0);
    expect(res.languageFailures).toBe(0);
    expect(res.notes).toContain('fetch failed');
    expect(res.notes).toContain(`כשלו ${cases.length} מקרים`);
  });

  it('keeps the answered cases scoreable when only one case fails', async () => {
    const victim = cases[0];
    const res = await runEvalCases(flakyModel(victim.id), cases);
    expect(res.cases).toBe(cases.length);
    expect(res.notes).toContain(victim.id);
    expect(res.notes).toContain('כשלו 1 מקרים');
    /**
     * The other 21 answered with `[]`. The negative cases score 1 for that — silence is the
     * right answer to noise — and the positive ones score 0, so the aggregate is a real number
     * rather than a zero from the crash having poisoned it.
     */
    expect(res.hitTarget).toBeGreaterThan(0);
    expect(res.hitTarget).toBeLessThan(1);
  });

  it('a case that fails is not scored as a correct refusal to propose', async () => {
    const negative = cases.find((c) => c.expected.length === 0);
    expect(negative).toBeDefined();
    const onlyNegative = [negative!];
    // Answering it with nothing is perfect…
    expect((await runEvalCases(rulesModel(), onlyNegative)).hitTarget).toBe(1);
    // …but crashing on it is not the same thing, however identical the empty output looks.
    const crashed = await runEvalCases(throwingModel('boom'), onlyNegative);
    expect(crashed.hitTarget).toBe(0);
    expect(crashed.precision).toBe(0);
  });

  it('the rule engine finishes the committed set clean, which is the control', async () => {
    const res = await runEvalCases(rulesModel(), cases);
    expect(res.notes).not.toContain('כשלו');
    expect(res.hitTarget).toBeGreaterThanOrEqual(0.875);
    expect(res.precision).toBeGreaterThanOrEqual(0.9);
  });
});
