/** Types for `embedDimension.cjs` — see that file for the rule and why it is plain CommonJS. */
export declare const LEGACY_EMBED_DIMENSION: 768;
export declare const TIER_EMBED_DIMENSION: Readonly<Record<0 | 1 | 2 | 3 | 4, number>>;
export declare function resolveEmbedDimension(input?: {
  embedDimension?: number | undefined;
  tier?: number | undefined;
}): number;
export declare function resolveEmbedDimensionFromEnv(env: Record<string, string | undefined>): number;
