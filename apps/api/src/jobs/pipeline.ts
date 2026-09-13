import type { FastifyInstance } from 'fastify';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelClient } from '@wecom/model';
import { QUEUES } from '../plugins/boss.js';
import { paragraphDiff } from '../modules/sources/diff.js';
import { parseDocx } from '../modules/sources/docx.js';
import type { SourceRevisionService } from '../modules/sources/revisions.js';
import type { MappingService } from '../modules/sources/mapping.js';
import type { ProposalService } from '../modules/sources/proposal.js';
import type { SuggestionService } from '../modules/sources/suggestions.js';

export interface PipelineDeps {
  revisions: SourceRevisionService;
  mapping: MappingService;
  proposal: ProposalService;
  suggestions: SuggestionService;
}

/** A watched file is skipped while it may still be being written. */
const SETTLE_MS = 5000;

/**
 * Diffs a revision against the last accepted one, asks the model for proposals and
 * replaces the revision's pending suggestions with the result. Pure enough to be
 * called straight from the route as well as from the job handler.
 */
export async function processRevision(
  deps: PipelineDeps,
  model: ModelClient,
  revisionId: string,
): Promise<{ created: number; used: string }> {
  const rev = await deps.revisions.getRevision(revisionId);
  if (!rev) throw Object.assign(new Error('revision not found: ' + revisionId), { statusCode: 404 });
  const pool = deps.revisions.pool;
  await pool.query(`update sources set sync_state='processing' where id=$1`, [rev.sourceId]);
  try {
    const prev = await deps.revisions.latestAccepted(rev.sourceId);
    const diffs = paragraphDiff(prev?.paragraphs ?? null, rev.paragraphs);
    if (!prev) {
      const props = await deps.mapping.proposeInitialMapping(rev.sourceId, rev.paragraphs);
      if (props.length) await deps.mapping.confirmMapping(rev.sourceId, props);
    }
    const ctx = await deps.proposal.buildContext(rev, diffs);
    const items = diffs.some((d) => d.kind !== 'same') ? await model.proposeChanges(ctx) : [];
    await pool.query(`delete from suggestions where source_revision_id=$1 and status='pending'`, [
      revisionId,
    ]);
    const created = await deps.suggestions.createFromProposals(revisionId, items);
    await pool.query(`update sources set sync_state=$2 where id=$1`, [
      rev.sourceId,
      created.length ? 'pending' : 'synced',
    ]);
    if (!created.length)
      await pool.query(`update source_revisions set accepted=true where id=$1`, [revisionId]);
    const used = (model as { lastRun?: { used: string } }).lastRun?.used ?? model.name;
    return { created: created.length, used };
  } catch (e) {
    await pool.query(`update sources set sync_state='error' where id=$1`, [rev.sourceId]);
    throw e;
  }
}

/** Imports every settled .docx in WATCH_DIR, one source per filename. */
export async function scanWatchDir(app: FastifyInstance, deps: PipelineDeps, dir: string): Promise<number> {
  let imported = 0;
  for (const name of await readdir(dir)) {
    if (!/\.docx$/i.test(name)) continue;
    const path = join(dir, name);
    const st = await stat(path);
    if (Date.now() - st.mtimeMs < SETTLE_MS) continue;
    const buf = await readFile(path);
    const content = await parseDocx(buf);
    const existing = (await deps.revisions.listSources()).find(
      (s) => s.kind === 'docx' && s.externalId === name,
    );
    const sourceId = existing
      ? existing.id
      : (
          await deps.revisions.createSource(
            { kind: 'docx', title: content.title, ext: '.docx', externalId: name },
            null,
          )
        ).id;
    const r = await deps.revisions.ingest(sourceId, content, null, buf);
    if (!r.duplicate) {
      imported++;
      app.log.info({ name, revisionId: r.revisionId }, 'watched docx ingested');
    }
  }
  return imported;
}

export async function registerPipelineJobs(app: FastifyInstance, deps: PipelineDeps): Promise<void> {
  if (!app.boss) return;
  // CPU-only inference: fetch a single job at a time so revisions are processed serially.
  await app.boss.work<{ revisionId: string }>(
    QUEUES.pipelineProcess,
    { batchSize: 1 },
    async (job) => {
      for (const j of Array.isArray(job) ? job : [job]) {
        app.log.info({ revisionId: j.data.revisionId }, 'pipeline.process start');
        const r = await processRevision(deps, app.model, j.data.revisionId);
        app.log.info({ ...r, revisionId: j.data.revisionId }, 'pipeline.process done');
      }
    },
  );
  await app.boss.work(QUEUES.sourcesWatch, async () => {
    const dir = app.config.WATCH_DIR;
    if (!dir) return;
    await scanWatchDir(app, deps, dir);
  });
  if (app.config.WATCH_DIR) {
    try {
      await app.boss.schedule(QUEUES.sourcesWatch, '*/2 * * * *');
    } catch (err) {
      app.log.warn({ err }, 'could not schedule sources.watch');
    }
  }
}
