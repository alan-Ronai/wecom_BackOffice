import { fileURLToPath } from 'node:url';
import type { EvalCase, EvalRun } from '@wecom/shared';
import {
  aggregate,
  contextForCase,
  EVAL_CASES_DIR,
  failedCase,
  loadCases,
  RuleBasedModel,
  scoreCase,
  type CaseScore,
  type ModelClient,
} from '@wecom/model';
import type { Queryable } from '../../lib/sql.js';

/**
 * Wave 6 (X1), spec §1.9 — the api side of the offline harness. The CLI
 * (`pnpm --filter @wecom/model eval`) prints a table for a developer; this records a row an
 * admin can compare across tiers and prompt versions, which is the only way "the model got
 * worse after we changed the brief" ever becomes answerable.
 *
 * The case set is the committed one, read out of `@wecom/model` rather than the database: an
 * eval whose cases can be edited from the admin page is a benchmark that moves under you.
 */
export const evalCases = (): EvalCase[] => loadCases(fileURLToPath(EVAL_CASES_DIR));

export interface EvalRunResult extends CaseScore {
  cases: number;
  notes: string;
}

/**
 * Runs every case through `model` and scores it. A case the model fails outright is scored as a
 * zero and named in `notes`, rather than aborting the run — a tier that answers six of eight is
 * a result, not an error.
 *
 * That promise was not being kept. The failure branch used to score the case with
 * `scoreCase({ ...c, expected: [] }, [{} as never])`, and the language check reads `s.title` off
 * every suggestion before the negative-case branch is reached — so the placeholder threw, *out of
 * the `catch`*, and the whole job died with `ai_eval_runs.finished_at` still null. The job builds
 * its model with no fallback on purpose, so any timeout against a busy Ollama hit this. Now the
 * failure is a value (`failedCase`), and a thrown case cannot take the run with it.
 */
export async function runEvalCases(model: ModelClient, cases: EvalCase[]): Promise<EvalRunResult> {
  const scores: CaseScore[] = [];
  const failures: string[] = [];
  for (const c of cases) {
    try {
      scores.push(scoreCase(c, await model.proposeChanges(contextForCase(c))));
    } catch (e) {
      scores.push(failedCase());
      failures.push(`${c.id}: ${(e as Error).message}`);
    }
  }
  const total = aggregate(scores);
  /**
   * Precision and the language-failure count are columns of their own since wave Y (0058); they
   * used to be written into `notes` (C-I1/C-I8). The note now carries only the per-case failures.
   */
  return {
    ...total,
    cases: cases.length,
    notes: (failures.length ? `כשלו ${failures.length} מקרים — ${failures.join(' · ')}` : '').slice(0, 2000),
  };
}

/** The deterministic engine, for a run an admin asks for with no Ollama on the box. */
export const rulesModel = (): ModelClient => new RuleBasedModel();

const row = (r: Record<string, unknown>): EvalRun => ({
  id: r.id as string,
  model: r.model as string,
  promptVersion: r.prompt_version as string,
  embedModel: (r.embed_model as string) ?? '',
  startedAt: (r.started_at as Date).toISOString(),
  finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
  cases: r.cases as number,
  hitTarget: Number(r.hit_target),
  hitType: Number(r.hit_type),
  contentOverlap: Number(r.content_overlap),
  precision: r.precision == null ? null : Number(r.precision),
  languageFailures: r.language_failures == null ? null : Number(r.language_failures),
  notes: (r.notes as string) ?? '',
});

/** The pending row an admin's `POST /admin/ai/eval` creates, before the worker has anything. */
export async function startEvalRun(
  q: Queryable,
  v: { model: string; promptVersion: string; embedModel: string; startedBy: string | null },
): Promise<string> {
  const r = await q.query(
    `insert into ai_eval_runs(model, prompt_version, embed_model, started_by) values ($1,$2,$3,$4) returning id`,
    [v.model, v.promptVersion, v.embedModel, v.startedBy],
  );
  return r.rows[0].id as string;
}

/** Closes the row the worker was given. A run that never finishes keeps `finished_at` null. */
export async function recordEvalRun(q: Queryable, runId: string, res: EvalRunResult): Promise<void> {
  await q.query(
    `update ai_eval_runs set finished_at=now(), cases=$2, hit_target=$3, hit_type=$4, content_overlap=$5, notes=$6,
            precision=$7, language_failures=$8
      where id=$1`,
    [
      runId,
      res.cases,
      res.hitTarget,
      res.hitType,
      res.contentOverlap,
      res.notes,
      res.precision,
      res.languageFailures,
    ],
  );
}

export async function listEvalRuns(q: Queryable, limit = 50): Promise<EvalRun[]> {
  const r = await q.query(`select * from ai_eval_runs order by started_at desc limit $1`, [limit]);
  return r.rows.map(row);
}
