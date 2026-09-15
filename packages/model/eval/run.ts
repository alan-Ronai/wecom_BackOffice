/**
 * Wave 6 (X1), spec §1.9 — the offline evaluation CLI.
 *
 *   pnpm --filter @wecom/model eval --rules
 *   pnpm --filter @wecom/model eval --model aya-expanse:8b-q4_K_M --embed bge-m3 --out run.json
 *
 * Without `--rules` it talks to a real Ollama **without a fallback**: a model that cannot answer
 * has to show up as a failure, not as the rule engine quietly scoring in its place. `--embed` is
 * recorded with the run (the embedder is half of what a tier changes) but is not itself scored
 * here — the api's `ai.eval` job is what stores a row, this prints a table.
 */
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import type { EvalCase } from '@wecom/shared';
import { RuleBasedModel } from '../src/rules.js';
import { OllamaModel } from '../src/ollama.js';
import { PROMPT_VERSION } from '../src/prompt.js';
import {
  aggregate,
  contextForCase,
  EVAL_CASES_DIR,
  failedCase,
  languageOffences,
  latinAllowFor,
  loadCases,
  scoreCase,
} from '../src/eval.js';
import type { ModelClient } from '../src/contract.js';

const EVAL_TIMEOUT_MS = 180_000;

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string): boolean => process.argv.includes('--' + name);

async function main(): Promise<void> {
  const useRules = flag('rules');
  const tag = arg('model');
  const embed = arg('embed');
  const url = arg('url') ?? process.env.MODEL_URL ?? 'http://localhost:11434';
  const out = arg('out') ?? arg('json');
  const dir = arg('cases') ?? fileURLToPath(EVAL_CASES_DIR);

  const model: ModelClient =
    useRules || !tag
      ? new RuleBasedModel()
      : new OllamaModel({
          url,
          model: tag,
          embedModel: embed,
          timeoutMs: EVAL_TIMEOUT_MS,
          /**
           * The measured path is the default now; these two turn *off* halves of it, so a run
           * can still reproduce the wave-6-as-merged baseline (`--legacy-envelope --prompt
           * propose-v3 --no-guards`) or isolate the model's unaided classification.
           */
          legacyEnvelope: flag('legacy-envelope'),
          ...(flag('no-guards') ? { guards: false } : {}),
          ...(arg('prompt') ? { promptVersion: arg('prompt') } : {}),
          ...(arg('temp') ? { temperature: Number(arg('temp')) } : {}),
          ...(arg('num-predict') ? { numPredict: Number(arg('num-predict')) } : {}),
          ...(arg('num-ctx') ? { numCtx: Number(arg('num-ctx')) } : {}),
        });

  const cases: EvalCase[] = loadCases(dir);
  const rows: Record<string, string | number>[] = [];
  const scores = [];
  const latencies: number[] = [];
  const langWords: string[] = [];
  for (const c of cases) {
    const started = Date.now();
    let items: Awaited<ReturnType<ModelClient['proposeChanges']>> = [];
    let error = '';
    try {
      items = await model.proposeChanges(contextForCase(c));
    } catch (e) {
      error = (e as Error).message;
    }
    /**
     * A crashed case is a **failure**, not a silent answer. Scoring it with `scoreCase(c, [])`
     * gave the six negative cases a perfect 1.000 for timing out, which is the precise opposite
     * of what they are for: a tier that cannot reach Ollama would have reported that it correctly
     * declined to propose. `failedCase` scores zero on recall and is excluded from the precision
     * and language means, which grade an answer that exists.
     */
    const s = error ? failedCase() : scoreCase(c, items);
    scores.push(s);
    const ms = Date.now() - started;
    latencies.push(ms);
    /**
     * C-I8: the *count* goes in the table and the offending words go in the `--out` file. A
     * language failure is only actionable if you can see what the model said — "8 failures" is a
     * number, `champs`, `ubah`, `блок` is a reason to move a tier.
     */
    const offences = error
      ? []
      : [
          ...new Set(
            items.flatMap((x) => [
              ...languageOffences(x.title, latinAllowFor(c)),
              ...languageOffences(x.rationale, latinAllowFor(c)),
            ]),
          ),
        ];
    if (offences.length) langWords.push(`${c.id}: ${offences.join(', ')}`);
    rows.push({
      case: c.id,
      hitTarget: Number(s.hitTarget.toFixed(2)),
      hitType: Number(s.hitType.toFixed(2)),
      overlap: Number(s.contentOverlap.toFixed(2)),
      precision: Number(s.precision.toFixed(2)),
      lang: s.languageFailures,
      items: items.length,
      ms,
      /** Recorded, never asserted: a tier that scores well at 90 s/case is not shippable. */
      ...(c.latencyBudgetMs ? { budget: ms <= c.latencyBudgetMs ? 'ok' : 'over' } : {}),
      ...(error ? { error } : {}),
    });
  }
  const total = aggregate(scores);
  console.table(rows);
  const sorted = [...latencies].sort((a, b) => a - b);
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  const summary = {
    model: model.name,
    promptVersion: arg('prompt') ?? PROMPT_VERSION,
    schema: flag('legacy-envelope') ? 'envelope (legacy)' : 'flat',
    guards: !flag('no-guards'),
    embedModel: embed ?? '',
    cases: cases.length,
    hitTarget: Number(total.hitTarget.toFixed(3)),
    hitType: Number(total.hitType.toFixed(3)),
    contentOverlap: Number(total.contentOverlap.toFixed(3)),
    precision: Number(total.precision.toFixed(3)),
    languageFailures: total.languageFailures,
    schemaFailures: rows.filter((r) => 'error' in r).length,
    medianSecPerCase: Number((median / 1000).toFixed(2)),
  };
  console.log(summary);
  if (out) {
    writeFileSync(out, JSON.stringify({ ...summary, rows, languageOffences: langWords }, null, 2));
    console.log('wrote ' + out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
