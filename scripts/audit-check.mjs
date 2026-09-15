#!/usr/bin/env node
/**
 * The dependency-advisory gate.
 *
 * `docs/security-advisories.md` opens with "The gate is `pnpm audit --prod` … An advisory that is
 * neither [fixed nor listed] is a release blocker." Nothing ran it. A standing decision that no
 * machine checks is a decision about the day it was written, not about the branch in front of you,
 * so this turns the document into a job.
 *
 * `pnpm audit --prod` reports advisories in the production dependency tree — what actually ships on
 * the VM. Every one it reports must appear in `.github/audit-allowlist.json`, which is the
 * machine-readable half of that document's "Accepted, with reasons" table. This fails on:
 *
 *   • an advisory that is not in the allowlist              — the release blocker the doc promises
 *   • an allowlist entry past its `reviewBy` date           — an acceptance is a decision with a
 *                                                             shelf life, and the doc demands one
 *   • an allowlist entry no advisory matches any more       — the list cannot outlive the thing it
 *                                                             excuses, so a fixed advisory forces
 *                                                             its own row to be deleted
 *   • an entry whose `voidIf.sourceMatches` now appears     — "not reachable" stops being taken on
 *                                                             trust the moment the code changes
 *
 * `--json` because the human output is a paragraph per advisory and this needs ids. pnpm exits
 * non-zero when it finds anything, which is not itself a failure here: the allowlist decides.
 *
 * Usage: node scripts/audit-check.mjs   (pnpm audit:check)
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOWLIST_FILE = join(ROOT, '.github', 'audit-allowlist.json');
const DOC = 'docs/security-advisories.md';

function fail(lines) {
  console.error(`\n✗ audit-check failed:\n${lines.map((l) => `  ${l}`).join('\n')}\n`);
  process.exit(1);
}

/** `pnpm audit --prod --json`, tolerating its non-zero exit (that only means "found something"). */
function runAudit() {
  const r = spawnSync('pnpm', ['audit', '--prod', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) fail([`could not run pnpm audit: ${r.error.message}`]);
  const out = (r.stdout ?? '').trim();
  // A registry outage prints a message and no JSON. Never treat that as "no advisories": an audit
  // that could not run is not a clean audit.
  if (!out.startsWith('{'))
    fail([
      'pnpm audit produced no JSON — it could not reach the advisory registry.',
      'An audit that did not run is not a clean audit; re-run it rather than merging past it.',
      `pnpm said: ${(r.stderr || out || '(nothing)').trim().split('\n').slice(0, 4).join(' / ')}`,
    ]);
  try {
    return JSON.parse(out);
  } catch (e) {
    return fail([`pnpm audit --json did not parse: ${e.message}`]);
  }
}

/** Does `needle` appear in the tracked sources under `dirs`? Uses git, so build output is excluded. */
function sourceContains(needle, dirs) {
  const r = spawnSync('git', ['grep', '-l', '--fixed-strings', needle, '--', ...dirs], {
    cwd: ROOT,
    encoding: 'utf8',
  });
  // 0 = found, 1 = not found, anything else = git could not look, which must not read as "clean".
  if (r.status === 1) return [];
  if (r.status !== 0) fail([`git grep for '${needle}' failed: ${(r.stderr ?? '').trim()}`]);
  return (r.stdout ?? '').trim().split('\n').filter(Boolean);
}

const allowlist = JSON.parse(readFileSync(ALLOWLIST_FILE, 'utf8')).allow ?? [];
const report = runAudit();
const advisories = Object.values(report.advisories ?? {});
const today = new Date().toISOString().slice(0, 10);
const problems = [];

// 1. every reported advisory must be excused by name.
const allowed = new Map(allowlist.map((a) => [a.ghsa, a]));
const seen = new Set();
for (const adv of advisories) {
  const ghsa = adv.github_advisory_id;
  seen.add(ghsa);
  if (allowed.has(ghsa)) continue;
  problems.push(
    `${adv.severity}: ${ghsa} in ${adv.module_name} — ${adv.title}`,
    `    paths: ${(adv.findings ?? []).flatMap((f) => f.paths ?? []).join(', ') || '(none reported)'}`,
    `    fix it, or add it to .github/audit-allowlist.json with a reason and a review date and`,
    `    write the row in ${DOC} that explains the decision.`,
  );
}

// 2. …and every excuse must still be about something, still be in date, and still be true.
for (const entry of allowlist) {
  if (!seen.has(entry.ghsa))
    problems.push(
      `${entry.ghsa} (${entry.package}) is allowlisted, but pnpm audit --prod no longer reports it.`,
      `    It has been fixed or has dropped out of the tree — remove the entry from`,
      `    .github/audit-allowlist.json and move its row in ${DOC} to "Fixed".`,
    );
  if (entry.reviewBy && entry.reviewBy < today)
    problems.push(
      `${entry.ghsa} (${entry.package}) was accepted until ${entry.reviewBy}; today is ${today}.`,
      `    Re-decide it: fix the advisory, or re-read the reason in ${DOC} and set a new date.`,
    );
  const needle = entry.voidIf?.sourceMatches;
  if (needle) {
    const hits = sourceContains(needle, entry.voidIf.in ?? ['apps', 'packages']);
    if (hits.length)
      problems.push(
        `${entry.ghsa} (${entry.package}) is accepted because '${needle}' appears nowhere — it now does:`,
        ...hits.map((h) => `      ${h}`),
        `    ${entry.voidIf.because ?? 'the stated reason no longer holds.'}`,
        `    The acceptance is void: fix the advisory or write a new decision in ${DOC}.`,
      );
  }
}

if (problems.length) fail(problems);

const counts = report.metadata?.vulnerabilities ?? {};
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(
  `✓ audit-check: ${total} production advisory/advisories, all ${allowlist.length} accounted for by ` +
    `.github/audit-allowlist.json (${DOC}).`,
);
for (const entry of allowlist)
  console.log(`  ${entry.ghsa}  ${entry.package}  accepted until ${entry.reviewBy}`);
