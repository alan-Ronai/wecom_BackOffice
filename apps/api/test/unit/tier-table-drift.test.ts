import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODEL_TIER_PRESETS, type ModelTier } from '@wecom/shared';

/**
 * X6 seam. The tier table (spec §6) is written down three times: `MODEL_TIER_PRESETS` in
 * `packages/shared`, a `tier_slot()` case in `deploy/ollama-pull.sh`, and a second one in
 * `deploy/smoke.sh`. The API resolves a slot from the first; the pull script decides which tags
 * the VM actually has; the smoke check decides whether the deploy is called healthy.
 *
 * A tier edit that reaches only one of them is a deploy that boots configured for a model Ollama
 * was never told to pull — `/api/chat` 404s per request and nothing at boot says why. Rather than
 * fold the shell scripts into one generated file (they must run with no Node on the box), this
 * asserts the three agree, so the drift is a red test instead of a silent outage.
 */
const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8');

/** The `tier_slot()` case block from a shell script, as `{ "<tier>:<slot>": tag }`. */
function shellTierTable(source: string): Record<string, string> {
  const fn = /tier_slot\(\)[\s\S]*?\n\}/.exec(source)?.[0];
  if (!fn) throw new Error('no tier_slot() in the script');
  const out: Record<string, string> = {};
  for (const m of fn.matchAll(/^\s*([0-9[\]|:a-z-]+)\)\s*echo\s*'([^']*)'/gm)) {
    const [, pattern, tag] = m;
    if (!tag) continue;
    // `0:suggest|0:chat` is two keys; `[1-4]:embed` is four.
    for (const alt of pattern!.split('|')) {
      const range = /^\[(\d)-(\d)\]:(\w+)$/.exec(alt);
      if (range) {
        for (let t = Number(range[1]); t <= Number(range[2]); t++) out[`${t}:${range[3]}`] = tag;
      } else out[alt] = tag;
    }
  }
  return out;
}

const expected = (): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const t of [0, 1, 2, 3, 4] as ModelTier[]) {
    const p = MODEL_TIER_PRESETS[t];
    out[`${t}:suggest`] = p.suggestModel;
    out[`${t}:chat`] = p.chatModel;
    out[`${t}:embed`] = p.embedModel;
  }
  return out;
};

describe('the tier table agrees in all three places', () => {
  for (const script of ['ollama-pull.sh', 'smoke.sh']) {
    it(`deploy/${script} mirrors MODEL_TIER_PRESETS`, () => {
      expect(shellTierTable(read(`../../../../deploy/${script}`))).toEqual(expected());
    });
  }

  /** The dimension that goes with each embedder, so a tier switch cannot half-happen. */
  it('every tier on bge-m3 declares 1024 and tier 0 declares 768', () => {
    expect(MODEL_TIER_PRESETS[0].embedDimension).toBe(768);
    for (const t of [1, 2, 3, 4] as ModelTier[]) {
      expect(MODEL_TIER_PRESETS[t].embedModel).toBe('bge-m3');
      expect(MODEL_TIER_PRESETS[t].embedDimension).toBe(1024);
    }
  });
});
