import { describe, expect, it } from 'vitest';
import { plural } from '../src/fmt.js';

/**
 * A-3 (acceptance review §3, §7 item 13). The topic page read `1 פריטים`, the library header
 * `50 נושאים`, `/pinned` `1 נושאים` — in Hebrew, the same mistake as "1 items" in English.
 */
const ITEMS = { one: 'פריט אחד', two: 'שני פריטים', many: '# פריטים' };

describe('plural', () => {
  it('spells the singular with the numeral trailing, not "1 פריטים"', () => {
    expect(plural(1, ITEMS)).toBe('פריט אחד');
  });

  it('uses the dual for two when the call site offers one', () => {
    expect(plural(2, ITEMS)).toBe('שני פריטים');
  });

  it('falls back to the numeral for two when the phrase cannot take a dual', () => {
    // "עד 2 פריטים" and "2 מתוך 5" want the digit; those call sites simply omit `two`.
    expect(plural(2, { one: 'פריט אחד', many: '# פריטים' })).toBe('2 פריטים');
  });

  it('substitutes the number into the plural form', () => {
    expect(plural(7, ITEMS)).toBe('7 פריטים');
    expect(plural(50, { one: 'נושא אחד', two: 'שני נושאים', many: '# נושאים' })).toBe('50 נושאים');
  });

  it('counts zero as a plural — "0 פריטים" is correct Hebrew', () => {
    expect(plural(0, ITEMS)).toBe('0 פריטים');
  });

  it('picks the form by magnitude, so a negative delta still reads correctly', () => {
    expect(plural(-1, ITEMS)).toBe('פריט אחד');
    expect(plural(-3, ITEMS)).toBe('-3 פריטים');
  });

  it('replaces every occurrence of the placeholder', () => {
    expect(plural(4, { one: 'פעם אחת', many: '# מתוך # פריטים' })).toBe('4 מתוך 4 פריטים');
  });
});
