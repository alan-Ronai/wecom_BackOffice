import { describe, it, expect } from 'vitest';
import { wordDiff, similarity } from '../src/format/index.js';

describe('wordDiff', () => {
  it('marks changed words', () => {
    const d = wordDiff('מעל 5 מגה → תקין', 'מעל 6 מגה → תקין');
    expect(d.changed).toBe(true);
    expect(d.a).toContain('<del class="d">5</del>');
    expect(d.b).toContain('<ins class="d">6</ins>');
  });
  it('reports no change', () => {
    expect(wordDiff('a b', 'a b').changed).toBe(false);
  });
  it('escapes html', () => {
    expect(wordDiff('<b>', '<b>').a).toBe('&lt;b&gt;');
  });
});
describe('similarity', () => {
  it('is 1 for identical, low for unrelated', () => {
    expect(similarity('בקש מהלקוח להריץ Speedtest', 'בקש מהלקוח להריץ Speedtest')).toBe(1);
    expect(similarity('בקש מהלקוח להריץ Speedtest', 'החלפת SIM פיזי')).toBeLessThan(0.2);
  });
});
