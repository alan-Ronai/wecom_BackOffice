import { describe, it, expect } from 'vitest';
import { hasAllScopes, hasScope } from '../../src/lib/user.js';

const u = (scopes: string[] | null) => ({ worldScopes: scopes });

describe('hasScope (read: any overlap)', () => {
  it('allows everything when unscoped', () => {
    expect(hasScope(u(null), 'intl')).toBe(true);
    expect(hasScope(u(null), ['tech'])).toBe(true);
  });
  it('allows listed worlds only', () => {
    expect(hasScope(u(['intl', 'tech']), 'intl')).toBe(true);
    expect(hasScope(u(['intl']), 'billing')).toBe(false);
  });
  it('passes when any of the entity worlds is in scope', () => {
    expect(hasScope(u(['sim']), ['tech', 'sim'])).toBe(true);
    expect(hasScope(u(['sim']), ['tech'])).toBe(false);
    expect(hasScope(u(['sim']), [])).toBe(false);
  });
});

describe('hasAllScopes (write: every world — wave Y A-M6)', () => {
  it('allows everything when unscoped, including an entity with no world', () => {
    expect(hasAllScopes(u(null), ['tech', 'sim'])).toBe(true);
    expect(hasAllScopes(u(null), [])).toBe(true);
  });
  it('needs every world the entity spans', () => {
    expect(hasAllScopes(u(['sim']), ['tech', 'sim'])).toBe(false);
    expect(hasAllScopes(u(['sim', 'tech']), ['tech', 'sim'])).toBe(true);
    expect(hasAllScopes(u(['sim', 'tech', 'intl']), ['sim'])).toBe(true);
    expect(hasAllScopes(u(['sim']), 'sim')).toBe(true);
    expect(hasAllScopes(u(['sim']), 'tech')).toBe(false);
  });
  it('is never wider than the read rule: a scoped caller writes no world-less entity', () => {
    expect(hasAllScopes(u(['sim']), [])).toBe(false);
    for (const scopes of [['sim'], ['sim', 'tech'], ['intl']])
      for (const worlds of [['sim'], ['sim', 'tech'], ['tech'], []])
        if (hasAllScopes(u(scopes), worlds)) expect(hasScope(u(scopes), worlds)).toBe(true);
  });
});
