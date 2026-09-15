/**
 * Wave 6 (X0) — the one place that turns configuration into the four model names the rest
 * of the platform uses. Spec §6: a *tier* is a row of `MODEL_TIER_PRESETS`, and every slot
 * stays individually overridable, so a VM upgrade is `MODEL_TIER=n` plus a reindex rather
 * than a code change.
 *
 * Precedence, highest first:
 *
 * 1. **an explicit env value** — `SUGGEST_MODEL`, `CHAT_MODEL`, `EMBED_MODEL`, `EMBED_DIMENSION`
 * 2. **the tier preset** — `MODEL_TIER_PRESETS[MODEL_TIER]`, when `MODEL_TIER` is set
 * 3. **today's defaults** — `MODEL_NAME` for both generation slots, `nomic-embed-text`/768
 *
 * `MODEL_TIER` is unset by default, so on main every slot resolves exactly as it did before
 * this wave and `plugins/model.ts` passes the same tag it always passed.
 *
 * One wrinkle worth naming: `EMBED_MODEL` and `EMBED_DIMENSION` have *zod* defaults, so a
 * parsed config cannot tell "operator wrote `nomic-embed-text`" from "nobody set it". They
 * are therefore treated as explicit only when they differ from the legacy pair below — an
 * install that really wants `nomic-embed-text` at a tier uses `MODEL_TIER=0`. Nothing here
 * touches `config.EMBED_DIMENSION`: `plugins/model.ts` still holds *that* number against
 * `documents.embedding`'s own width at boot, and X1's 0051 is what moves both together.
 */
import { MODEL_TIER_PRESETS, type ModelTier } from '@wecom/shared';

/** Today's embedder, from `0003_content.js`'s `vector(768)` and `deploy/.env.example`. */
export const LEGACY_EMBED_MODEL = 'nomic-embed-text';
export const LEGACY_EMBED_DIMENSION = 768;

/** The slice of `Config` this reads — structural, so a unit test needs no whole config. */
export interface ModelSlotsConfig {
  MODEL_NAME: string;
  MODEL_TIER?: number | undefined;
  SUGGEST_MODEL?: string | undefined;
  CHAT_MODEL?: string | undefined;
  EMBED_MODEL: string;
  EMBED_DIMENSION: number;
}

export interface ModelSlots {
  /** `null` when no tier is configured — the "nothing changed on main" case. */
  tier: ModelTier | null;
  suggestModel: string;
  chatModel: string;
  embedModel: string;
  embedDimension: number;
}

const isTier = (n: number | undefined): n is ModelTier =>
  n !== undefined && Number.isInteger(n) && n >= 0 && n <= 4;

export function resolveModelSlots(config: ModelSlotsConfig): ModelSlots {
  const tier = isTier(config.MODEL_TIER) ? config.MODEL_TIER : null;
  const preset = tier === null ? null : MODEL_TIER_PRESETS[tier];
  return {
    tier,
    suggestModel: config.SUGGEST_MODEL ?? preset?.suggestModel ?? config.MODEL_NAME,
    chatModel: config.CHAT_MODEL ?? preset?.chatModel ?? config.MODEL_NAME,
    embedModel:
      config.EMBED_MODEL !== LEGACY_EMBED_MODEL
        ? config.EMBED_MODEL
        : (preset?.embedModel ?? config.EMBED_MODEL),
    embedDimension:
      config.EMBED_DIMENSION !== LEGACY_EMBED_DIMENSION
        ? config.EMBED_DIMENSION
        : (preset?.embedDimension ?? config.EMBED_DIMENSION),
  };
}
