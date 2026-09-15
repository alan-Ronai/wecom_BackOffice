import { describe, it, expect } from 'vitest';
import { PERMISSIONS, DEFAULT_ROLES, hasPermission, MeSchema } from '../src/index.js';

describe('permissions', () => {
  it('has exactly the catalogue from the spec', () => {
    expect([...PERMISSIONS]).toEqual([
      'docs.read',
      'docs.create',
      'docs.edit',
      'docs.publish',
      'docs.delete',
      'docs.restore',
      'blocks.edit',
      'fields.edit',
      'scripts.edit',
      'notes.write',
      'notes.moderate',
      'suggestions.review',
      'suggestions.apply',
      'sources.manage',
      'connectors.manage',
      'users.manage',
      'roles.manage',
      'audit.read',
      'system.admin',
      'taxonomy.manage',
      'docs.read_unpublished',
      'feedback.manage',
      'analytics.read',
      'learning.read',
      'learning.manage',
      'learning.publish',
      'gaps.read',
      'gaps.manage',
      'ai.ask',
      'ai.chat',
      'ai.manage',
    ]);
  });
  it('wave 6 grants: ai.ask from agent, ai.chat from editor, ai.manage admin only', () => {
    expect(DEFAULT_ROLES.agent).toContain('ai.ask');
    expect(DEFAULT_ROLES.agent).not.toContain('ai.chat');
    expect(DEFAULT_ROLES.editor).toEqual(expect.arrayContaining(['ai.ask', 'ai.chat']));
    expect(DEFAULT_ROLES.editor).not.toContain('ai.manage');
    expect(DEFAULT_ROLES.lead).toEqual(expect.arrayContaining(['ai.ask', 'ai.chat']));
    expect(DEFAULT_ROLES.lead).not.toContain('ai.manage');
    expect(DEFAULT_ROLES.admin).toEqual(expect.arrayContaining(['ai.ask', 'ai.chat', 'ai.manage']));
    // The approver signs off on content; it never talks to the copilot (spec §1.6 of wave 5).
    expect(DEFAULT_ROLES.approver).not.toContain('ai.ask');
  });
  it('wave 5 grants and the approver role', () => {
    expect(DEFAULT_ROLES.agent).toContain('learning.read');
    expect(DEFAULT_ROLES.editor).toEqual(expect.arrayContaining(['learning.manage', 'gaps.read']));
    expect(DEFAULT_ROLES.editor).not.toContain('learning.publish');
    expect(DEFAULT_ROLES.lead).toEqual(expect.arrayContaining(['learning.publish', 'gaps.manage']));
    expect([...DEFAULT_ROLES.approver]).toEqual([
      'docs.read',
      'docs.read_unpublished',
      'notes.write',
      'docs.publish',
      'suggestions.apply',
      'learning.publish',
    ]);
    expect(DEFAULT_ROLES.approver).not.toContain('docs.edit');
  });
  it('grants the wave 4 permissions to the right roles', () => {
    expect(DEFAULT_ROLES.agent).not.toContain('docs.read_unpublished');
    expect(DEFAULT_ROLES.editor).toEqual(
      expect.arrayContaining(['docs.read_unpublished', 'feedback.manage', 'analytics.read']),
    );
    expect(DEFAULT_ROLES.editor).not.toContain('taxonomy.manage');
    expect(DEFAULT_ROLES.lead).toContain('taxonomy.manage');
  });
  it('nests default roles', () => {
    expect(DEFAULT_ROLES.editor).toEqual(expect.arrayContaining(DEFAULT_ROLES.agent));
    expect(DEFAULT_ROLES.lead).toEqual(expect.arrayContaining(DEFAULT_ROLES.editor));
    expect(DEFAULT_ROLES.admin).toEqual([...PERMISSIONS]);
    expect(DEFAULT_ROLES.editor).not.toContain('docs.publish');
  });
  it('checks permissions', () => {
    expect(hasPermission(new Set(['docs.read']), 'docs.read')).toBe(true);
    expect(hasPermission(new Set(['docs.read']), 'docs.publish')).toBe(false);
  });
  it('validates /auth/me', () => {
    const me = MeSchema.parse({
      user: {
        id: '11111111-1111-4111-8111-111111111111',
        subject: 'x',
        source: 'entra',
        email: 'a@b.c',
        displayName: 'ענבר ל.',
        initials: 'ע',
        active: true,
        lastLoginAt: null,
      },
      roles: ['editor'],
      permissions: ['docs.read'],
      categoryScopes: null,
      worldScopes: null,
      preferences: { theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false },
    });
    expect(me.permissions).toContain('docs.read');
  });
});
