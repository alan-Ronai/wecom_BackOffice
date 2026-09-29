import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { MODEL_TIER_PRESETS, type ModelTier } from '@wecom/shared';
import {
  LEGACY_EMBED_DIMENSION,
  TIER_EMBED_DIMENSION,
  resolveEmbedDimension,
  resolveEmbedDimensionFromEnv,
} from '../../common/embedDimension.cjs';
import { ConfigSchema } from '../../src/config.js';
import { resolveModelSlots } from '../../src/lib/modelSlots.js';

/**
 * Wave Y · A-M5 (second half). Migration 0051 sizes `documents.embedding` from `process.env`; the
 * API's boot check compares that column against `resolveModelSlots(config).embedDimension`. Both
 * now call `common/embedDimension.cjs`, so the precedence (explicit `EMBED_DIMENSION` → tier
 * preset → 768) exists once. These tests pin the rule and prove the two callers agree.
 */
describe('embed-dimension resolver shared by 0051 and the API', () => {
  it('mirrors MODEL_TIER_PRESETS', () => {
    for (const t of [0, 1, 2, 3, 4] as ModelTier[])
      expect(TIER_EMBED_DIMENSION[t]).toBe(MODEL_TIER_PRESETS[t].embedDimension);
    expect(LEGACY_EMBED_DIMENSION).toBe(768);
  });

  it('explicit EMBED_DIMENSION > tier preset > 768', () => {
    expect(resolveEmbedDimension({})).toBe(768);
    expect(resolveEmbedDimension({ tier: 0 })).toBe(768);
    expect(resolveEmbedDimension({ tier: 1 })).toBe(1024);
    expect(resolveEmbedDimension({ embedDimension: 512, tier: 1 })).toBe(512);
    // 768 is the zod default, so it cannot be told apart from "unset": the tier wins.
    expect(resolveEmbedDimension({ embedDimension: 768, tier: 1 })).toBe(1024);
    expect(resolveEmbedDimension({ embedDimension: 768 })).toBe(768);
  });

  it('parses env strings the way the config does, and rejects nonsense', () => {
    expect(resolveEmbedDimensionFromEnv({ EMBED_DIMENSION: '', MODEL_TIER: '' })).toBe(768);
    expect(resolveEmbedDimensionFromEnv({ MODEL_TIER: '2' })).toBe(1024);
    expect(resolveEmbedDimensionFromEnv({ EMBED_DIMENSION: '384', MODEL_TIER: '2' })).toBe(384);
    expect(() => resolveEmbedDimensionFromEnv({ EMBED_DIMENSION: 'x' })).toThrow(/positive integer/);
    expect(() => resolveEmbedDimensionFromEnv({ EMBED_DIMENSION: '0' })).toThrow(/positive integer/);
  });

  it('0051 re-exports the same function (its existing tests read it from there)', () => {
    const require = createRequire(import.meta.url);
    const m = require('../../migrations/0051_wave6_embeddings_affects.js') as {
      resolveEmbedDimension: unknown;
    };
    // Both through `require`: vitest's ESM import of the `.cjs` is a separate module instance.
    const shared = require('../../common/embedDimension.cjs') as { resolveEmbedDimensionFromEnv: unknown };
    expect(m.resolveEmbedDimension).toBe(shared.resolveEmbedDimensionFromEnv);
  });

  // The drift test: for every env shape, the migration's answer is the boot check's answer.
  const envs: Record<string, string>[] = [
    {},
    { MODEL_TIER: '' },
    { EMBED_DIMENSION: '' },
    ...['0', '1', '2', '3', '4'].map((t) => ({ MODEL_TIER: t })),
    { EMBED_DIMENSION: '768', MODEL_TIER: '1' },
    { EMBED_DIMENSION: '1024' },
    { EMBED_DIMENSION: '384', MODEL_TIER: '3' },
    { EMBED_DIMENSION: '768', MODEL_TIER: '0' },
  ];
  for (const env of envs) {
    it(`migration and boot check agree for ${JSON.stringify(env)}`, () => {
      const config = ConfigSchema.parse({ NODE_ENV: 'test', DATABASE_URL: 'postgres://x/y', ...env });
      expect(resolveModelSlots(config).embedDimension).toBe(resolveEmbedDimensionFromEnv(env));
    });
  }
});
