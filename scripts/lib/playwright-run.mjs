/**
 * Runs Playwright and, when it fails, prints the failing **spec names** in a grep-friendly block.
 *
 * `list`'s output is streamed live but scrolls past hundreds of lines of API and browser log, and
 * the coordinator reading these runs wants one thing: which specs are red. The `json` reporter
 * writes a report beside it; this reads that report rather than the terminal, so a spec whose own
 * output happens to contain the word "failed" cannot confuse the summary.
 *
 * Shared by `scripts/e2e-real.mjs` and `scripts/e2e-compose.mjs`: both gates bring a stack up
 * around the same reporter, and the summary is the part a caller reads.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';

/** `file:line › [project] title path` for every spec the JSON report marks not-ok. */
export function readFailingSpecs(jsonReport) {
  let report;
  try {
    report = JSON.parse(readFileSync(jsonReport, 'utf8'));
  } catch {
    return []; // playwright died before writing one; the thrown error says so
  }
  const out = [];
  const walk = (suite, titles) => {
    const next = suite.title && suite.title !== suite.file ? [...titles, suite.title] : titles;
    for (const spec of suite.specs ?? []) {
      if (spec.ok) continue;
      const project = spec.tests?.[0]?.projectName;
      const where = `${spec.file ?? suite.file ?? '?'}:${spec.line ?? '?'}`;
      out.push(`${where} › ${project ? `[${project}] ` : ''}${[...next, spec.title].join(' › ')}`);
    }
    for (const child of suite.suites ?? []) walk(child, next);
  };
  for (const suite of report.suites ?? []) walk(suite, []);
  return out;
}

export function runPlaywright(args, jsonReport, opts) {
  rmSync(jsonReport, { force: true });
  const r = spawnSync('pnpm', args, { stdio: 'inherit', ...opts });
  const failures = readFailingSpecs(jsonReport);
  rmSync(jsonReport, { force: true });
  if (failures.length) {
    console.error(`\n── failing specs (${failures.length}) ──────────────`);
    for (const f of failures) console.error(`FAILED SPEC: ${f}`);
    console.error('');
  }
  if (r.status !== 0) {
    throw new Error(
      failures.length
        ? `playwright: ${failures.length} spec(s) failed:\n  ${failures.join('\n  ')}`
        : `playwright exited ${r.status ?? r.signal} with no failing spec in the report (a crash, a timeout before the first test, or a config error — see the output above)`,
    );
  }
  return r;
}
