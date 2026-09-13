import { describe, it, expect } from 'vitest';
import { checkScope } from '../../src/plugins/auth.js';

const u = (scopes: string[] | null) => ({
  id: 'u',
  displayName: 'u',
  roles: [],
  permissions: new Set<string>(),
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
