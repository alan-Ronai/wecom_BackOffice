import { describe, it, expect } from 'vitest';
import type { ModelClient } from '@wecom/model';
import {
  EMBEDDING_COLUMN_MIGRATION,
  EmbedDimensionMismatchError,
  EmbedStatusTracker,
  assertEmbeddingDimension,
  instrumentEmbedding,
  readEmbeddingDimension,
  type WarnLogger,
} from '../../src/lib/embedStatus.js';

/**
 * The embedding write is best-effort and swallows everything, which is correct — a model outage
 * must never fail a publish — and which is exactly why an `EMBED_MODEL` of the wrong width was
 * invisible: no vector, no log line, no failing check, search silently lexical.
 *
 * These are the two halves of making it visible, tested without a database or an app: the
 * per-call measurement (`instrumentEmbedding`) and the boot-time guard
 * (`assertEmbeddingDimension`). `test/int/embed-dimension.test.ts` proves the same behaviour
 * through a real publish against a real Postgres.
 */

/** A pino-shaped logger that keeps what it was told. */
const recorder = () => {
  const warnings: { obj: Record<string, unknown>; msg: string }[] = [];
  const log: WarnLogger = { warn: (obj, msg) => warnings.push({ obj, msg }) };
  return { log, warnings };
};

/** A minimal ModelClient whose `embed` returns a vector of whatever width it is told. */
const modelOf = (width: number | null): ModelClient => ({
  name: 'stub',
  available: async () => true,
  proposeChanges: async () => [],
  ...(width === null ? {} : { embed: async () => new Array(width).fill(0.1) }),
});

/** A `pg.Pool`-shaped stub: `query` answers with these rows, or throws. */
const dbOf = (rows: { dim: number }[] | Error) => ({
  query: async () => {
    if (rows instanceof Error) throw rows;
    return { rows, rowCount: rows.length } as never;
  },
});

describe('embedStatus: the embedding path stops being silent', () => {
  it('reports "never attempted" before anything asks for an embedding', () => {
    expect(new EmbedStatusTracker('nomic-embed-text', 768).snapshot()).toEqual({
      model: 'nomic-embed-text',
      dimension: null,
      expected: 768,
      lastOk: null,
      lastError: null,
    });
  });

  it('records the returned width and clears the error when the model matches the column', async () => {
    const tracker = new EmbedStatusTracker('nomic-embed-text', 768);
    const { log, warnings } = recorder();
    const model = instrumentEmbedding(modelOf(768), tracker, log);
    await expect(model.embed!('hello')).resolves.toHaveLength(768);
    expect(warnings).toEqual([]);
    expect(tracker.snapshot()).toMatchObject({ dimension: 768, lastOk: true, lastError: null });
  });

  it('warns with the model name and the returned dimension on a mismatch, and refuses the vector', async () => {
    const tracker = new EmbedStatusTracker('all-minilm:latest', 768);
    const { log, warnings } = recorder();
    const model = instrumentEmbedding(modelOf(384), tracker, log);

    // Thrown, not returned: `updateEmbedding`'s own catch is what swallows it, so publishing is
    // unaffected — but Postgres is never handed a vector it will reject inside that catch.
    await expect(model.embed!('hello')).rejects.toBeInstanceOf(EmbedDimensionMismatchError);

    expect(warnings).toHaveLength(1);
    // The two facts the walkthrough had to read a migration to discover.
    expect(warnings[0].obj).toMatchObject({
      embedModel: 'all-minilm:latest',
      dimension: 384,
      expected: 768,
      migration: EMBEDDING_COLUMN_MIGRATION,
    });
    expect(warnings[0].msg).toContain('all-minilm:latest');
    expect(warnings[0].msg).toContain('384');
    expect(warnings[0].msg).toContain('768');

    const snap = tracker.snapshot();
    expect(snap).toMatchObject({ dimension: 384, lastOk: false });
    expect(snap.lastError).toContain('384');
    expect(snap.lastError).toContain('768');
  });

  it('records an unreachable model without inventing a dimension for it', async () => {
    const tracker = new EmbedStatusTracker('nomic-embed-text', 768);
    const { log, warnings } = recorder();
    const model = instrumentEmbedding(
      { ...modelOf(768), embed: async () => Promise.reject(new Error('embeddings http 500')) },
      tracker,
      log,
    );
    await expect(model.embed!('hello')).rejects.toThrow('embeddings http 500');
    // No warning here: an unreachable model is the failure `modelStatus` already reports, and
    // one line per publish for an outage that lasts hours is noise. The status still carries it.
    expect(warnings).toEqual([]);
    expect(tracker.snapshot()).toMatchObject({
      dimension: null,
      lastOk: false,
      lastError: 'embeddings http 500',
    });
  });

  it('leaves a model with no embed() untouched, so MODEL_DISABLED stays "never attempted"', () => {
    const tracker = new EmbedStatusTracker('nomic-embed-text', 768);
    const rules = modelOf(null);
    expect(instrumentEmbedding(rules, tracker, recorder().log)).toBe(rules);
    expect(tracker.snapshot().lastOk).toBeNull();
  });

  it('forwards every other member of the client through the wrapper', async () => {
    const tracker = new EmbedStatusTracker('nomic-embed-text', 768);
    const model = instrumentEmbedding(modelOf(768), tracker, recorder().log);
    expect(model.name).toBe('stub');
    await expect(model.available()).resolves.toBe(true);
  });

  describe('recordWriteFailure', () => {
    it('reports a write that did not happen after the model answered correctly', () => {
      const tracker = new EmbedStatusTracker('nomic-embed-text', 768);
      tracker.recordOk(768);
      expect(tracker.recordWriteFailure('nothing was stored')).toBe(true);
      expect(tracker.snapshot()).toMatchObject({ lastOk: false, lastError: 'nothing was stored' });
    });

    it('does not flatten a more specific model-side error', () => {
      const tracker = new EmbedStatusTracker('all-minilm:latest', 768);
      tracker.recordError('returned 384 dimensions, expected 768', 384);
      expect(tracker.recordWriteFailure('nothing was stored')).toBe(false);
      expect(tracker.snapshot().lastError).toContain('384');
    });
  });

  describe('the boot-time guard', () => {
    it('accepts a column that agrees with EMBED_DIMENSION', async () => {
      await expect(assertEmbeddingDimension(dbOf([{ dim: 768 }]), 768)).resolves.toBe(768);
    });

    it('refuses to boot on a disagreement, naming both numbers and the migration', async () => {
      await expect(assertEmbeddingDimension(dbOf([{ dim: 768 }]), 384)).rejects.toThrow(
        /EMBED_DIMENSION is 384 but documents\.embedding is vector\(768\).*0003_content\.js/s,
      );
    });

    /**
     * `src/openapi.ts` builds the entire app against a deliberately unreachable DSN, and a slow
     * `db` container must not turn into an API that refuses to start. A column that cannot be
     * read is not evidence of a misconfiguration.
     */
    it('is silent when the column cannot be read at all', async () => {
      await expect(assertEmbeddingDimension(dbOf(new Error('ECONNREFUSED')), 768)).resolves.toBeNull();
      await expect(assertEmbeddingDimension(dbOf([]), 768)).resolves.toBeNull();
      await expect(readEmbeddingDimension(dbOf([{ dim: -1 }]))).resolves.toBeNull();
    });
  });
});
