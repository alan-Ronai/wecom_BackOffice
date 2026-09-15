import { describe, it, expect } from 'vitest';
import { MODEL_TIER_PRESETS } from '@wecom/shared';
import {
  LEGACY_EMBED_DIMENSION,
  LEGACY_EMBED_MODEL,
  resolveModelSlots,
  type ModelSlotsConfig,
} from '../../src/lib/modelSlots.js';

/** Exactly what `loadConfig()` produces today with nothing wave-6 set. */
const today: ModelSlotsConfig = {
  MODEL_NAME: 'qwen2.5:3b-instruct-q4_K_M',
  EMBED_MODEL: LEGACY_EMBED_MODEL,
  EMBED_DIMENSION: LEGACY_EMBED_DIMENSION,
};

describe('resolveModelSlots', () => {
  it('changes nothing when no tier is configured', () => {
    expect(resolveModelSlots(today)).toEqual({
      tier: null,
      suggestModel: 'qwen2.5:3b-instruct-q4_K_M',
      chatModel: 'qwen2.5:3b-instruct-q4_K_M',
      embedModel: 'nomic-embed-text',
      embedDimension: 768,
    });
  });
  it('tier 1 selects the Hebrew model and the multilingual embedder', () => {
    const s = resolveModelSlots({ ...today, MODEL_TIER: 1 });
    expect(s).toEqual({
      tier: 1,
      suggestModel: MODEL_TIER_PRESETS[1].suggestModel,
      chatModel: MODEL_TIER_PRESETS[1].chatModel,
      embedModel: 'bge-m3',
      embedDimension: 1024,
    });
    expect(s.suggestModel).toMatch(/dictalm/i);
  });
  it('an explicit slot beats the preset', () => {
    const s = resolveModelSlots({ ...today, MODEL_TIER: 1, CHAT_MODEL: 'x' });
    expect(s.chatModel).toBe('x');
    expect(s.suggestModel).toBe(MODEL_TIER_PRESETS[1].suggestModel); // untouched
    expect(resolveModelSlots({ ...today, MODEL_TIER: 1, SUGGEST_MODEL: 'y' }).suggestModel).toBe('y');
  });
  it('an explicit embedder and width beat the preset', () => {
    const s = resolveModelSlots({
      ...today,
      MODEL_TIER: 2,
      EMBED_MODEL: 'all-minilm',
      EMBED_DIMENSION: 384,
    });
    expect([s.embedModel, s.embedDimension]).toEqual(['all-minilm', 384]);
  });
  it('an explicit slot without a tier beats MODEL_NAME', () => {
    const s = resolveModelSlots({ ...today, SUGGEST_MODEL: 'a', CHAT_MODEL: 'b' });
    expect([s.tier, s.suggestModel, s.chatModel]).toEqual([null, 'a', 'b']);
  });
  it('tier 0 is today, spelled out', () => {
    const s = resolveModelSlots({ ...today, MODEL_TIER: 0 });
    expect(s).toMatchObject({ tier: 0, embedModel: 'nomic-embed-text', embedDimension: 768 });
  });
  it('tiers 2–4 keep bge-m3 at 1024 and split the two generation slots where the spec does', () => {
    for (const tier of [2, 3, 4] as const) {
      const s = resolveModelSlots({ ...today, MODEL_TIER: tier });
      expect([s.embedModel, s.embedDimension], String(tier)).toEqual(['bge-m3', 1024]);
    }
    expect(resolveModelSlots({ ...today, MODEL_TIER: 2 }).chatModel).not.toBe(
      resolveModelSlots({ ...today, MODEL_TIER: 2 }).suggestModel,
    );
    // Tier 4 has the GPU, so chat runs the big model too.
    const four = resolveModelSlots({ ...today, MODEL_TIER: 4 });
    expect(four.chatModel).toBe(four.suggestModel);
  });
  it('an out-of-range tier is no tier rather than a crash', () => {
    expect(resolveModelSlots({ ...today, MODEL_TIER: 9 }).tier).toBeNull();
    expect(resolveModelSlots({ ...today, MODEL_TIER: 9 }).suggestModel).toBe(today.MODEL_NAME);
  });
});
