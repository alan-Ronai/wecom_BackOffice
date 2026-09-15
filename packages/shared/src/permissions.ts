export const PERMISSIONS = [
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
  // Wave 4 — appended, never reordered.
  'taxonomy.manage',
  'docs.read_unpublished',
  'feedback.manage',
  'analytics.read',
  // Wave 5 — appended, never reordered.
  'learning.read',
  'learning.manage',
  'learning.publish',
  'gaps.read',
  'gaps.manage',
  // Wave 6 — AI copilot. Appended, never reordered.
  'ai.ask',
  'ai.chat',
  'ai.manage',
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const agent: Permission[] = ['docs.read', 'notes.write', 'learning.read', 'ai.ask'];
const editor: Permission[] = [
  ...agent,
  'docs.create',
  'docs.edit',
  'suggestions.review',
  'scripts.edit',
  'docs.read_unpublished',
  'feedback.manage',
  'analytics.read',
  'learning.manage',
  'gaps.read',
  // Wave 6: the editor tool set — read the source and the impact, propose edits, refine a
  // suggestion. Nothing here writes; `ai.manage` (admin only) is the brief, models and evals.
  'ai.chat',
];
const lead: Permission[] = [
  ...editor,
  'docs.publish',
  'docs.delete',
  'docs.restore',
  'blocks.edit',
  'fields.edit',
  'suggestions.apply',
  'sources.manage',
  'notes.moderate',
  'taxonomy.manage',
  'learning.publish',
  'gaps.manage',
];
/**
 * System role switched on by `workflow.requireApprover` (spec §1.6); no editing rights.
 * Deliberately not nested in the agent→editor→lead chain: an approver publishes and
 * applies suggestions without ever being able to edit the content it signs off on.
 */
const approver: Permission[] = [
  'docs.read',
  'docs.read_unpublished',
  'notes.write',
  'docs.publish',
  'suggestions.apply',
  'learning.publish',
];
export const DEFAULT_ROLES = {
  agent,
  editor,
  lead,
  approver,
  admin: [...PERMISSIONS],
} as const satisfies Record<string, readonly Permission[]>;
export type DefaultRoleName = keyof typeof DEFAULT_ROLES;

/** Permissions the admin role can never lose. */
export const ADMIN_LOCKED: Permission[] = ['roles.manage', 'users.manage'];

export const hasPermission = (perms: ReadonlySet<string>, p: Permission): boolean => perms.has(p);
