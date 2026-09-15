import type pg from 'pg';
import type { ModelClient } from '@wecom/model';
import type { EmbedStatus } from '@wecom/shared';

/**
 * The embedding path is deliberately best-effort: `updateEmbedding` (modules/search/repo.ts)
 * catches everything, because a model outage must never fail a publish. That is the right
 * behaviour and it stays. What was wrong is that it was also *silent* — an `EMBED_MODEL` whose
 * vectors are the wrong width for `documents.embedding` stored nothing on every publish, logged
 * nothing, and left search ranking lexically with no symptom an operator could see.
 *
 * This module is the part that is allowed to notice. It wraps the model client's `embed` so the
 * returned width is measured against the configured `EMBED_DIMENSION` on every call, warns once
 * per attempt with the model name and both numbers, and keeps the verdict for
 * `GET /system/health`'s `embedStatus`. A mismatch still throws — into the same swallow, so the
 * publish is unaffected — rather than being handed to Postgres to reject with an opaque
 * `expected 768 dimensions, not 384` inside a caught block nobody reads.
 */

/** The migration that created `documents.embedding`, named in the boot-time error. */
export const EMBEDDING_COLUMN_MIGRATION = 'apps/api/migrations/0003_content.js';

/** Just enough of a pino logger to warn; keeps this unit testable without building an app. */
export interface WarnLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/** A model that answered, but with a vector the column cannot hold. */
export class EmbedDimensionMismatchError extends Error {
  constructor(
    readonly embedModel: string,
    readonly dimension: number,
    readonly expected: number,
  ) {
    super(
      `embedding model ${embedModel} returned ${dimension} dimensions, but documents.embedding is vector(${expected}) — no embedding was stored`,
    );
    this.name = 'EmbedDimensionMismatchError';
  }
}

/**
 * The last thing the embedding path did, as `GET /system/health` reports it.
 *
 * `lastOk` is about the *model*: true means the last call returned a vector of exactly
 * `expected` dimensions, which — because `assertEmbeddingDimension` has already held
 * `expected` to the column's own width at boot — is a vector the column accepts. Whether a
 * given row actually carries one is a different question, answered per document by
 * `GET /documents/:id/embedding-status`.
 */
export class EmbedStatusTracker {
  private dimension: number | null = null;
  private lastOk: boolean | null = null;
  private lastError: string | null = null;

  constructor(
    readonly model: string,
    readonly expected: number,
  ) {}

  recordOk(dimension: number): void {
    this.dimension = dimension;
    this.lastOk = true;
    this.lastError = null;
  }

  /** `dimension` is omitted when the model never answered at all (unreachable, timeout, 404). */
  recordError(message: string, dimension?: number): void {
    if (dimension !== undefined) this.dimension = dimension;
    this.lastOk = false;
    this.lastError = message;
  }

  /**
   * `updateEmbedding` returned false even though the model had just answered with a vector of
   * the right width — so it is the *write* that did not happen, and that is the one remaining
   * way for the path to fail with nothing said about it.
   *
   * Recorded **only** in that case: when the model itself failed, `recordError` has already
   * stored something more specific and this must not flatten it into a generic message.
   * Returns whether it recorded, so the caller logs exactly when the status changed.
   */
  recordWriteFailure(message: string): boolean {
    if (this.lastOk !== true) return false;
    this.lastOk = false;
    this.lastError = message;
    return true;
  }

  snapshot(): EmbedStatus {
    return {
      model: this.model,
      dimension: this.dimension,
      expected: this.expected,
      lastOk: this.lastOk,
      lastError: this.lastError,
    };
  }
}

/**
 * Returns a client that behaves exactly like `model` except that `embed` is measured.
 *
 * A `Proxy` rather than a subclass or a spread: `ModelClient` is an interface with several
 * implementations (`OllamaModel`, `RuleBasedModel`), their methods read instance state through
 * `this`, and an implementation that grows a method later must keep working here without this
 * file being touched. Everything but `embed` is forwarded to the original receiver untouched.
 *
 * A model with no `embed` (`RuleBasedModel`, i.e. `MODEL_DISABLED=true`) is returned as-is:
 * `updateEmbedding` checks for the method and no-ops, so there is nothing to measure and
 * `embedStatus.lastOk` stays null — "never attempted", which is the honest answer.
 */
export function instrumentEmbedding<T extends ModelClient>(
  model: T,
  tracker: EmbedStatusTracker,
  log: WarnLogger,
): T {
  if (!model.embed) return model;
  const embed = async (text: string): Promise<number[]> => {
    let vec: number[];
    try {
      vec = await model.embed!(text);
    } catch (err) {
      tracker.recordError(err instanceof Error ? err.message : String(err));
      throw err;
    }
    if (vec.length !== tracker.expected) {
      const mismatch = new EmbedDimensionMismatchError(tracker.model, vec.length, tracker.expected);
      // The one line the silent failure never had. `embedModel` and `dimension` are separate
      // fields so a log search can group by either without parsing the message.
      log.warn(
        {
          embedModel: tracker.model,
          dimension: vec.length,
          expected: tracker.expected,
          migration: EMBEDDING_COLUMN_MIGRATION,
        },
        mismatch.message,
      );
      tracker.recordError(mismatch.message, vec.length);
      throw mismatch;
    }
    tracker.recordOk(vec.length);
    return vec;
  };
  return new Proxy(model, {
    get(target, prop, receiver) {
      if (prop === 'embed') return embed;
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * The width `documents.embedding` was actually created with, read from the catalog.
 *
 * pgvector puts the declared dimension straight into `atttypmod` (unlike `varchar`, which
 * stores length + 4), and uses -1 for an unconstrained `vector`. Returns null when the column
 * cannot be read at all — the table not existing yet, or no database to ask: `src/openapi.ts`
 * builds the whole app against a deliberately unreachable DSN, and the schema dump must not
 * depend on Postgres being up.
 */
export async function readEmbeddingDimension(db: Pick<pg.Pool, 'query'>): Promise<number | null> {
  try {
    const r = await db.query<{ dim: number }>(
      `select a.atttypmod dim
         from pg_attribute a
        where a.attrelid = 'public.documents'::regclass
          and a.attname = 'embedding'
          and not a.attisdropped`,
    );
    const dim = r.rows[0]?.dim;
    return typeof dim === 'number' && dim > 0 ? dim : null;
  } catch {
    return null;
  }
}

/**
 * Boot-time guard: `EMBED_DIMENSION` must equal the column it is a promise about.
 *
 * Only a *disagreement* is fatal. A column that cannot be read is not evidence of a
 * misconfiguration — it is a database that has not migrated yet or is not there — and refusing
 * to boot on it would turn a slow `db` container into an unrecoverable API.
 */
export async function assertEmbeddingDimension(
  db: Pick<pg.Pool, 'query'>,
  expected: number,
): Promise<number | null> {
  const column = await readEmbeddingDimension(db);
  if (column !== null && column !== expected) {
    throw new Error(
      `EMBED_DIMENSION is ${expected} but documents.embedding is vector(${column}) ` +
        `(set by ${EMBEDDING_COLUMN_MIGRATION}). An embedding of ${expected} dimensions cannot be ` +
        `stored in a ${column}-dimension column, and the write is swallowed rather than raised, so ` +
        `the stack would run with search silently ranking lexically. Configure EMBED_DIMENSION=${column} ` +
        `together with an EMBED_MODEL of that width, or migrate the column to vector(${expected}).`,
    );
  }
  return column;
}
