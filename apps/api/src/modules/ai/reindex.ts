import type pg from 'pg';
import type { ModelClient } from '@wecom/model';
import { documentEmbeddingText } from '../search/repo.js';
import { embedMany, refreshStepEmbeddings } from '../sources/embeddings.js';

/**
 * Wave 6 (X1), spec §1.2. Changing the embedder invalidates every vector in the database:
 * 0051 rebuilds `documents.embedding` at the new width and the old contents are gone, so search
 * ranks lexically until something re-embeds the corpus. This is that something.
 *
 * Three properties matter more than speed:
 *
 * 1. **It refuses on a width mismatch.** A probe embed is measured against the column before
 *    anything is written; a job that wrote 5,000 unstorable vectors into a caught `catch` is the
 *    silent failure `lib/embedStatus.ts` exists to end, and it must not be re-created here.
 * 2. **It is resumable.** Documents are walked in `(updated_at, id)` order and `since` starts the
 *    walk part-way, so an interrupted run is re-run with the last watermark rather than from zero.
 * 3. **It is idempotent.** Documents are a single `update`; steps are skipped by their text hash.
 */
export interface ReindexDeps {
  db: pg.Pool;
  model: ModelClient;
  /** The column's own width, as `plugins/model.ts` resolved and asserted it at boot. */
  expectedDim: number;
  log: {
    info(o: Record<string, unknown>, m: string): void;
    warn(o: Record<string, unknown>, m: string): void;
  };
}

export interface ReindexResult {
  documents: number;
  steps: number;
  /** `-1` means the run refused before touching anything; otherwise documents it skipped. */
  skipped: number;
  dimension: number;
}

const DEFAULT_BATCH = 32;

export async function reindexEmbeddings(
  deps: ReindexDeps,
  opts: { batch?: number; since?: string | null } = {},
): Promise<ReindexResult> {
  const batch = opts.batch ?? DEFAULT_BATCH;
  if (!deps.model.embed) {
    deps.log.warn({ model: deps.model.name }, 'ai.reindex: the model cannot embed — nothing to do');
    return { documents: 0, steps: 0, skipped: -1, dimension: 0 };
  }
  // The probe is the whole guard: one embed, measured, before a single row is written.
  let dimension = 0;
  try {
    dimension = (await deps.model.embed('בדיקת רוחב וקטור')).length;
  } catch (err) {
    deps.log.warn(
      { err: err instanceof Error ? err.message : String(err), model: deps.model.name },
      'ai.reindex: the embedder did not answer',
    );
    return { documents: 0, steps: 0, skipped: -1, dimension: 0 };
  }
  if (dimension !== deps.expectedDim) {
    deps.log.warn(
      { dimension, expected: deps.expectedDim, model: deps.model.name },
      'ai.reindex: refusing — the embedder returns a width documents.embedding cannot hold',
    );
    return { documents: 0, steps: 0, skipped: -1, dimension };
  }

  const ids = (
    await deps.db.query<{ id: string }>(
      `select id from documents
        where deleted_at is null ${opts.since ? 'and updated_at >= $1' : ''}
        order by updated_at, id`,
      opts.since ? [opts.since] : [],
    )
  ).rows.map((r) => r.id);

  let documents = 0;
  let steps = 0;
  let skipped = 0;
  for (let i = 0; i < ids.length; i += batch) {
    const slice = ids.slice(i, i + batch);
    const texts: { id: string; text: string }[] = [];
    for (const id of slice) {
      const text = await documentEmbeddingText(deps.db, id);
      if (text) texts.push({ id, text });
      else skipped++;
    }
    if (texts.length) {
      try {
        const vecs = await embedMany(
          deps.model,
          texts.map((t) => t.text),
          batch,
        );
        for (let k = 0; k < texts.length; k++) {
          await deps.db.query('update documents set embedding=$2::vector where id=$1', [
            texts[k].id,
            JSON.stringify(vecs[k]),
          ]);
          documents++;
        }
      } catch (err) {
        // Best-effort per batch, like the publish path: a transient outage costs this batch,
        // not the run, and the watermark lets the operator resume where it stopped.
        deps.log.warn(
          { err: err instanceof Error ? err.message : String(err), from: texts[0].id },
          'ai.reindex: a document batch failed',
        );
        skipped += texts.length;
      }
    }
    for (const id of slice) steps += await refreshStepEmbeddings(deps.db, id, deps.model);
  }
  return { documents, steps, skipped, dimension };
}
