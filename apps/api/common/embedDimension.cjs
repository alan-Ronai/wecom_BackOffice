'use strict';
/**
 * Wave Y · A-M5 (second half) — the one embed-dimension rule.
 *
 * Two callers need the width of `documents.embedding`: migration 0051, which *creates* the column
 * from `process.env` (a migration runs before any `Config` exists), and the API's boot check
 * (`lib/modelSlots.ts` → `plugins/model.ts`), which refuses to start when the configured width and
 * the column disagree. They used to carry two copies of the same precedence; now both call this
 * file, so they cannot drift. Plain CommonJS on purpose: node-pg-migrate `require`s migrations,
 * and the ESM API imports a `.cjs` file's named exports just as well (types in
 * `embedDimension.d.cts`).
 *
 * Precedence, highest first:
 * 1. an explicit `EMBED_DIMENSION` — but only when it is not 768, because the config gives it a
 *    zod default of 768 and so cannot tell "operator wrote 768" from "nobody set it";
 * 2. the `MODEL_TIER` preset (`MODEL_TIER_PRESETS[n].embedDimension` in `@wecom/shared`, mirrored
 *    below and pinned by `test/unit/embed-dimension-resolver.test.ts`);
 * 3. 768, `nomic-embed-text`'s width since 0003.
 */

const LEGACY_EMBED_DIMENSION = 768;

/** `MODEL_TIER_PRESETS[n].embedDimension`. */
const TIER_EMBED_DIMENSION = Object.freeze({ 0: 768, 1: 1024, 2: 1024, 3: 1024, 4: 1024 });

const isTier = (n) => n !== undefined && Number.isInteger(n) && n >= 0 && n <= 4;

/** The rule over already-parsed numbers — what the API calls with its `Config`. */
function resolveEmbedDimension({ embedDimension, tier } = {}) {
  if (embedDimension !== undefined && embedDimension !== LEGACY_EMBED_DIMENSION) return embedDimension;
  if (isTier(tier)) return TIER_EMBED_DIMENSION[tier];
  return embedDimension ?? LEGACY_EMBED_DIMENSION;
}

/**
 * The same rule over raw env strings — what the migration calls. An empty value is "unset", as
 * `z.preprocess` treats it in `config.ts`; a non-positive or non-integer `EMBED_DIMENSION` throws
 * rather than building a column nothing can boot against.
 */
function resolveEmbedDimensionFromEnv(env) {
  const rawDim = env.EMBED_DIMENSION;
  const embedDimension = rawDim === undefined || rawDim === '' ? undefined : Number(rawDim);
  if (embedDimension !== undefined && (!Number.isInteger(embedDimension) || embedDimension < 1))
    throw new Error(`EMBED_DIMENSION must be a positive integer, got ${rawDim}`);
  const rawTier = env.MODEL_TIER;
  const tier = rawTier === undefined || rawTier === '' ? undefined : Number(rawTier);
  return resolveEmbedDimension({ embedDimension, tier });
}

exports.LEGACY_EMBED_DIMENSION = LEGACY_EMBED_DIMENSION;
exports.TIER_EMBED_DIMENSION = TIER_EMBED_DIMENSION;
exports.resolveEmbedDimension = resolveEmbedDimension;
exports.resolveEmbedDimensionFromEnv = resolveEmbedDimensionFromEnv;
