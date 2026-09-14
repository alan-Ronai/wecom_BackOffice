import { describe, it, expect } from 'vitest';
import { checkScope } from '../../src/plugins/auth.js';

const u = (scopes: string[] | null) => ({
  id: 'u',
  displayName: 'u',
  roles: [],
  permissions: new Set<string>(),
  worldScopes: scopes,
  categoryScopes: scopes,
  sessionId: null,
});
describe('checkScope', () => {
  it('allows everything when unscoped', () => {
    expect(checkScope(u(null), 'intl')).toBe(true);
  });
  it('allows listed categories only', () => {
    expect(checkScope(u(['intl', 'tech']), 'intl')).toBe(true);
    expect(checkScope(u(['intl']), 'billing')).toBe(false);
  });
});

const w = (scopes: string[] | null) => ({ ...u(scopes), worldScopes: scopes });
describe('checkScope (worlds)', () => {
  it('passes when any of the document worlds is in scope', () => {
    expect(checkScope(w(['sim']), ['tech', 'sim'])).toBe(true);
    expect(checkScope(w(['sim']), ['tech'])).toBe(false);
    expect(checkScope(w(null), ['tech'])).toBe(true);
    expect(checkScope(w(['sim']), [])).toBe(false);
  });
});
