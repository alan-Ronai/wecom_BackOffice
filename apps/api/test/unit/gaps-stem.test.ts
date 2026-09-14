import { describe, it, expect } from 'vitest';
import { normalizeStem } from '../../src/modules/gaps/stem.js';

describe('normalizeStem', () => {
  it('lowercases, trims and collapses whitespace', () => {
    expect(normalizeStem('  APN   Settings ')).toBe('apn settings');
  });
  it('strips the Hebrew prefix letters while three characters remain', () => {
    expect(normalizeStem('והחשבונית')).toBe('חשבונית');
    expect(normalizeStem('בחו"ל')).toBe('חול'); // the gershayim is intra-word, so the prefix is reachable
    expect(normalizeStem('של')).toBe('של'); // short words untouched
    expect(normalizeStem('לנדידה בחול')).toBe('נדידה חול');
  });
  it('drops punctuation and niqqud', () => {
    expect(normalizeStem('eSIM?!')).toBe('esim');
    // The niqqud is what this asserts, so it is compared against the bare spelling rather than a
    // literal: "שלום" opens with a prefix letter and folds like any other word (see stem.ts).
    expect(normalizeStem('שָׁלוֹם')).toBe(normalizeStem('שלום'));
    expect(normalizeStem('שָׁלוֹם')).not.toBe('');
  });
  it('is idempotent', () => {
    const once = normalizeStem('ולהפעלת eSIM!!');
    expect(normalizeStem(once)).toBe(once);
    expect(once).toContain('esim');
  });
});
