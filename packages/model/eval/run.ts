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
import { aggregate, contextForCase, EVAL_CASES_DIR, loadCases, scoreCase } from '../src/eval.js';
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
  for (const c of cases) {
    const started = Date.now();
    let items: Awaited<ReturnType<ModelClient['proposeChanges']>> = [];
    let error = '';
    try {
      items = await model.proposeChanges(contextForCase(c));
    } catch (e) {
      error = (e as Error).message;
    }
    const s = scoreCase(c, items);
    scores.push(s);
    rows.push({
      case: c.id,
      hitTarget: Number(s.hitTarget.toFixed(2)),
      hitType: Number(s.hitType.toFixed(2)),
      overlap: Number(s.contentOverlap.toFixed(2)),
      items: items.length,
      ms: Date.now() - started,
      ...(error ? { error } : {}),
    });
  }
  const total = aggregate(scores);
  console.table(rows);
  const summary = {
    model: model.name,
    promptVersion: arg('prompt') ?? PROMPT_VERSION,
    schema: flag('flat') ? 'flat' : 'envelope',
    embedModel: embed ?? '',
    cases: cases.length,
    hitTarget: Number(total.hitTarget.toFixed(3)),
    hitType: Number(total.hitType.toFixed(3)),
    contentOverlap: Number(total.contentOverlap.toFixed(3)),
  };
  console.log(summary);
  if (out) {
    writeFileSync(out, JSON.stringify({ ...summary, rows }, null, 2));
    console.log('wrote ' + out);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
