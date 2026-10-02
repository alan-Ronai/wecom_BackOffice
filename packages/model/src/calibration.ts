import type { SuggestionType } from '@wecom/shared';

/**
 * Wave 6 (X1), spec §1.9. Confidence used to be a literal typed into `rules.ts` next to each
 * `push`, and a language model's own number is not comparable with it at all — one says "the
 * heuristic that produced this is usually right", the other says whatever the sampler felt.
 *
 * A table makes the number *about the type*: `update-block` is inherently riskier to accept
 * than `field-alert`, and an editor filtering the queue by confidence is entitled to a scale
 * that means the same thing across models. A model's raw value still moves the number, but only
 * within a band around the type's prior — it cannot claim 0.99 on a shared-block rewrite.
 *
 * The defaults are today's rule constants, so nothing about the existing queue changes.
 */
export const CALIBRATION_DEFAULTS: Record<SuggestionType, number> = {
  'update-step': 0.7,
  'new-card': 0.6,
  'new-step': 0.65,
  'update-block': 0.75,
  'deprecate-step': 0.7,
  'field-alert': 0.8,
};

/** How far a model's own confidence may pull the type's prior, in either direction. */
export const CALIBRATION_BAND = 0.15;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The calibrated confidence for a suggestion of `type`. With no `raw` it is the type's prior;
 * with one it is that value clamped to `prior ± CALIBRATION_BAND`. An unknown type throws —
 * silently inventing a confidence for a type nobody calibrated is how a scale stops meaning
 * anything.
 */
export function confidenceFor(
  type: SuggestionType,
  raw?: number,
  table: Record<SuggestionType, number> = CALIBRATION_DEFAULTS,
): number {
  const prior = table[type];
  if (prior === undefined) throw new Error('no calibration for suggestion type: ' + type);
  if (raw === undefined || !Number.isFinite(raw)) return prior;
  return Number(clamp(raw, prior - CALIBRATION_BAND, prior + CALIBRATION_BAND).toFixed(3));
}
