import { describe, it, expect } from 'vitest';
import { CALIBRATION_BAND, CALIBRATION_DEFAULTS, confidenceFor } from '../src/index.js';
import { SuggestionTypeSchema } from '@wecom/shared';

/**
 * Wave 6 (X1), spec §1.9. Confidence has to mean the same thing across models, or the editor's
 * "show me everything above 0.7" filter is a different filter on every tier.
 */
describe('calibration', () => {
  it('has a prior for every suggestion type', () => {
    expect(Object.keys(CALIBRATION_DEFAULTS).sort()).toEqual([...SuggestionTypeSchema.options].sort());
  });

  it('returns the type prior when the caller has no number of its own', () => {
    expect(confidenceFor('update-step')).toBe(CALIBRATION_DEFAULTS['update-step']);
    expect(confidenceFor('field-alert')).toBe(0.8);
  });

  it('clamps a raw confidence to the type band in both directions', () => {
    const prior = CALIBRATION_DEFAULTS['update-step'];
    expect(confidenceFor('update-step', 0.99)).toBeCloseTo(prior + CALIBRATION_BAND, 3);
    expect(confidenceFor('update-step', 0)).toBeCloseTo(prior - CALIBRATION_BAND, 3);
    // Inside the band the model's own number survives untouched.
    expect(confidenceFor('update-step', prior + 0.05)).toBeCloseTo(prior + 0.05, 3);
  });

  it('accepts a caller-supplied table', () => {
    expect(confidenceFor('new-card', undefined, { ...CALIBRATION_DEFAULTS, 'new-card': 0.4 })).toBe(0.4);
  });

  it('throws on a type nobody calibrated rather than inventing a number', () => {
    expect(() => confidenceFor('made-up' as never)).toThrow(/no calibration/);
    // A non-finite raw value is treated as "no opinion", not as NaN confidence.
    expect(confidenceFor('new-card', Number.NaN)).toBe(CALIBRATION_DEFAULTS['new-card']);
  });
});
