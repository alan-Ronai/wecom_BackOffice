import { describe, it, expect } from 'vitest';
import { mergeRoleRows } from '../../src/modules/auth/permissions.js';

describe('mergeRoleRows', () => {
  it('unions permissions across roles', () => {
    const r = mergeRoleRows([
      { role_name: 'agent', permission: 'docs.read', world_scope: null },
      { role_name: 'agent', permission: 'notes.write', world_scope: null },
      { role_name: 'editor', permission: 'docs.edit', world_scope: null },
    ]);
    expect(r.roles).toEqual(['agent', 'editor']);
    expect([...r.permissions].sort()).toEqual(['docs.edit', 'docs.read', 'notes.write']);
    expect(r.worldScopes).toBeNull();
  });
  it('unions world scopes when every role is scoped', () => {
    const r = mergeRoleRows([
      { role_name: 'lead', permission: 'docs.publish', world_scope: ['intl'] },
      { role_name: 'lead2', permission: 'docs.publish', world_scope: ['tech', 'intl'] },
    ]);
    expect(r.worldScopes).toEqual(['intl', 'tech']);
  });
  it('an unscoped role removes all restrictions', () => {
    const r = mergeRoleRows([
      { role_name: 'lead', permission: 'docs.publish', world_scope: ['intl'] },
      { role_name: 'admin', permission: 'system.admin', world_scope: null },
    ]);
    expect(r.worldScopes).toBeNull();
  });
  it('handles a role with no permissions', () => {
    const r = mergeRoleRows([{ role_name: 'empty', permission: null, world_scope: null }]);
    expect(r.roles).toEqual(['empty']);
    expect(r.permissions.size).toBe(0);
  });
});
