import { describe, it, expect } from 'vitest';
import { TtlCache } from '../../src/modules/usage/cache.js';

describe('TtlCache', () => {
  it('returns a value inside the ttl and forgets it after', () => {
    let t = 1000;
    const c = new TtlCache<number>(60_000, () => t);
    c.set('a', 1);
    expect(c.get('a')).toBe(1);
    t += 59_999;
    expect(c.get('a')).toBe(1);
    t += 2;
    expect(c.get('a')).toBeUndefined();
    expect(c.size).toBe(0);
  });
  it('keys are independent and clear() empties everything', () => {
    const c = new TtlCache<string>(1000, () => 0);
    c.set('x', 'X');
    c.set('y', 'Y');
    expect(c.get('y')).toBe('Y');
    c.clear();
    expect(c.get('x')).toBeUndefined();
  });
});
