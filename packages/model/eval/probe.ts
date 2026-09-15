/**
 * review/wave6-ai-quality — diagnostic probe (NOT part of the shipped harness).
 *
 * Runs the *exact* production request (`buildMessages` + `RESPONSE_FORMAT`) against a real
 * Ollama tag for the committed cases and writes, per case: the rendered prompt, its character
 * and token counts, the raw model content, and the parse verdict. `eval/run.ts` only reports a
 * score; this reports what the model actually said, which is the thing nobody had looked at.
 *
 *   tsx eval/probe.ts --model qwen2.5:3b-instruct-q4_K_M --out /tmp/probe --cases 01,04,06
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildMessages, parseProposals, RESPONSE_FORMAT } from '../src/prompt.js';
import { contextForCase, EVAL_CASES_DIR, loadCases, scoreCase } from '../src/eval.js';

const arg = (n: string) => {
  const i = process.argv.indexOf('--' + n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const url = arg('url') ?? 'http://localhost:11434';
const tag = arg('model') ?? 'qwen2.5:3b-instruct-q4_K_M';
const outDir = arg('out') ?? '/tmp/probe';
const only = (arg('cases') ?? '').split(',').filter(Boolean);
const numCtx = Number(arg('num_ctx') ?? 8192);
const temp = Number(arg('temp') ?? 0.1);

mkdirSync(outDir, { recursive: true });
const cases = loadCases(fileURLToPath(EVAL_CASES_DIR)).filter(
  (c) => !only.length || only.some((p) => c.id.startsWith(p)),
);

for (const c of cases) {
  const ctx = contextForCase(c);
  const messages = buildMessages(ctx);
  const started = Date.now();
  const r = await fetch(url + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: tag,
      stream: false,
      format: RESPONSE_FORMAT,
      options: { temperature: temp, num_ctx: numCtx },
      messages,
    }),
  });
  const data = (await r.json()) as {
    message?: { content?: string };
    prompt_eval_count?: number;
    eval_count?: number;
  };
  const raw = data.message?.content ?? '';
  const parsed = parseProposals(raw);
  const report = {
    case: c.id,
    tag,
    systemChars: messages[0].content.length,
    userChars: messages[1].content.length,
    promptTokens: data.prompt_eval_count,
    outputTokens: data.eval_count,
    ms: Date.now() - started,
    parseOk: parsed.ok,
    parseError: parsed.ok ? null : parsed.error,
    score: parsed.ok ? scoreCase(c, parsed.items) : { hitTarget: 0, hitType: 0, contentOverlap: 0 },
    raw,
  };
  writeFileSync(`${outDir}/${c.id}.json`, JSON.stringify(report, null, 2));
  writeFileSync(`${outDir}/${c.id}.prompt.txt`, messages.map((m) => `### ${m.role}\n${m.content}`).join('\n\n'));
  console.log(
    `${c.id}  sys=${report.systemChars} user=${report.userChars} ptok=${report.promptTokens} otok=${report.outputTokens} ${report.ms}ms  parse=${parsed.ok ? 'OK' : 'FAIL'}  ${report.parseError ?? ''}`,
  );
}
