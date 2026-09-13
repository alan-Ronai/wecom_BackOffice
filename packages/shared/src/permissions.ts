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
] as const;
export type Permission = (typeof PERMISSIONS)[number];

const agent: Permission[] = ['docs.read', 'notes.write'];
const editor: Permission[] = [...agent, 'docs.create', 'docs.edit', 'suggestions.review', 'scripts.edit'];
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
];
export const DEFAULT_ROLES = { agent, editor, lead, admin: [...PERMISSIONS] } as const satisfies Record<
  string,
  readonly Permission[]
>;
export type DefaultRoleName = keyof typeof DEFAULT_ROLES;

/** Permissions the admin role can never lose. */
export const ADMIN_LOCKED: Permission[] = ['roles.manage', 'users.manage'];

export const hasPermission = (perms: ReadonlySet<string>, p: Permission): boolean => perms.has(p);
