import { createHash } from 'node:crypto';
import type { ModelClient } from '@wecom/model';
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
    for (let i = 0; i < todo.length; i++)
      await q.query(
        `insert into step_embeddings(step_id, document_id, embedding, text_hash) values ($1,$2,$3::vector,$4)
         on conflict (step_id) do update set embedding=excluded.embedding, text_hash=excluded.text_hash, updated_at=now()`,
        [todo[i].id, documentId, JSON.stringify(vecs[i]), todo[i].hash],
      );
    return todo.length;
  } catch {
    return 0;
  }
}
