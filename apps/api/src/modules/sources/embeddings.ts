import { createHash } from 'node:crypto';
import type { ModelClient } from '@wecom/model';
import { EmbedDimensionMismatchError, type WarnLogger } from '../../lib/embedStatus.js';
import type { Queryable } from '../../lib/sql.js';

/**
 * Wave 6 (X1), spec §1.10. Step-level embeddings: the document vector is too coarse to say
 * *which step* a changed paragraph belongs to, which is why paragraph→step mapping was a
 * trigram guess. `step_embeddings` (0051) is one vector per step, refreshed only when the
 * step's text actually moved — an embedder round trip per unchanged step on every save would
 * dominate a publish.
 */
export const stepText = (s: { title: string; actions: string[] }): string =>
  [s.title, ...s.actions].filter(Boolean).join('. ').slice(0, 2000);

/** Short content hash; collisions would only cost a skipped re-embed, not correctness of a read. */
export const textHash = (t: string): string => createHash('sha256').update(t).digest('hex').slice(0, 32);

/** One round trip per `batch` texts when the client supports it, else one per text. */
export async function embedMany(model: ModelClient, texts: string[], batch = 32): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    out.push(
      ...(model.embedBatch
        ? await model.embedBatch(slice)
        : await Promise.all(slice.map((t) => model.embed!(t)))),
    );
  }
  return out;
}

/**
 * Re-embeds the document's steps whose text changed. Best-effort like `updateEmbedding`: never
 * throws, because a model outage must not fail a publish or a reindex pass — it just means the
 * mapping falls back to trigram until the embedder is back.
 */
export async function refreshStepEmbeddings(
  q: Queryable,
  documentId: string,
  model: ModelClient | null | undefined,
  log?: WarnLogger,
): Promise<number> {
  if (!model?.embed) return 0;
  const r = await q.query(
    `select s.id, s.title,
            coalesce((select array_agg(a.text order by a.position) from step_actions a where a.step_id=s.id),'{}') actions,
            e.text_hash
       from steps s left join step_embeddings e on e.step_id = s.id where s.document_id=$1`,
    [documentId],
  );
  const todo = r.rows
    .map((x) => ({
      id: x.id as string,
      text: stepText({ title: x.title as string, actions: x.actions as string[] }),
      old: (x.text_hash as string | null) ?? null,
    }))
    .map((x) => ({ ...x, hash: textHash(x.text) }))
    .filter((x) => x.hash !== x.old && x.text);
  if (!todo.length) return 0;
  try {
    const vecs = await embedMany(
      model,
      todo.map((t) => t.text),
    );
    let written = 0;
    for (let i = 0; i < todo.length; i++) {
      /**
       * Lock order. This runs in the background after a publish, so the editor's next
       * `saveStructure` can overlap it — and that transaction locks the `documents` row
       * `for update` and *then* deletes the steps. A bare `insert … values` took the locks the
       * other way round: its FK checks key-share the step first and the document second, so the
       * writer could hold the step while waiting for the document the save held while waiting to
       * delete the step (40P01, seen as a 500 on `PUT /documents/:id/structure`).
       *
       * So the document is key-shared first — the uncorrelated `exists` is an init-plan and runs
       * before any step row is touched — and only then the step, in the `LockRows` above it. If
       * the save got there first, the writer waits on the document, and by the time it reaches
       * the step the step is deleted: `for key share` skips it and nothing is written, where the
       * FK check would have thrown.
       */
      const r = await q.query(
        `insert into step_embeddings(step_id, document_id, embedding, text_hash)
         select s.id, $2, $3::vector, $4
           from steps s
          where s.id = $1
            and exists (select 1 from documents d where d.id = $2 for key share)
            for key share of s
         on conflict (step_id) do update set embedding=excluded.embedding, text_hash=excluded.text_hash, updated_at=now()`,
        [todo[i].id, documentId, JSON.stringify(vecs[i]), todo[i].hash],
      );
      written += r.rowCount ?? 0;
    }
    return written;
  } catch (e) {
    /**
     * A-M6: still best-effort — a model outage must not fail a publish — but no longer silent.
     * The bare `catch { return 0 }` swallowed `EmbedDimensionMismatchError` along with
     * everything else, which is exactly the class of failure `lib/embedStatus.ts` exists to
     * stop being invisible for `documents.embedding`. Step embeddings get the same treatment:
     * a width mismatch is its own warning, because it never recovers on its own.
     */
    const mismatch = e instanceof EmbedDimensionMismatchError;
    log?.warn(
      {
        documentId,
        steps: todo.length,
        err: (e as Error).message,
        ...(mismatch
          ? {
              embedModel: (e as EmbedDimensionMismatchError).embedModel,
              dimension: (e as EmbedDimensionMismatchError).dimension,
              expected: (e as EmbedDimensionMismatchError).expected,
            }
          : {}),
      },
      mismatch ? 'step embeddings skipped: the embedder returned the wrong width' : 'step embeddings skipped',
    );
    return 0;
  }
}
