import { z } from 'zod';
import { IdSchema, IsoDateSchema, CategorySchema } from './common.js';
import { PERMISSIONS } from '../permissions.js';

export const PermissionSchema = z.enum(PERMISSIONS);
export const UserSourceSchema = z.enum(['entra', 'paloalto', 'local']);
// zod's built-in .email() (3.25+) enforces a stricter RFC5322-ish pattern that rejects short
// test-fixture TLDs like "a@b.c"; a permissive pattern matches the plan's fixtures and stage-1 needs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UserSchema = z.object({
  id: IdSchema, subject: z.string(), source: UserSourceSchema, email: z.string().regex(EMAIL_RE).nullable(), displayName: z.string(),
  initials: z.string().max(2), active: z.boolean(), lastLoginAt: IsoDateSchema.nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const RoleSchema = z.object({ id: IdSchema, name: z.string().min(1), description: z.string().default(''), system: z.boolean(), permissions: z.array(PermissionSchema) });
export type Role = z.infer<typeof RoleSchema>;
export const UserRoleSchema = z.object({ userId: IdSchema, roleId: IdSchema, roleName: z.string(), categoryScope: z.array(CategorySchema).nullable(), grantedBy: IdSchema.nullable(), grantedAt: IsoDateSchema });
export const GroupMapSchema = z.object({ idpGroupId: z.string(), idpGroupName: z.string(), roleId: IdSchema });

export const SessionSchema = z.object({ id: IdSchema, userId: IdSchema, ip: z.string().nullable(), userAgent: z.string().nullable(), createdAt: IsoDateSchema, lastSeenAt: IsoDateSchema, expiresAt: IsoDateSchema, revokedAt: IsoDateSchema.nullable() });

export const AuditEntrySchema = z.object({
  id: IdSchema, actorId: IdSchema.nullable(), actorName: z.string().nullable(), action: z.string(), entityType: z.string(), entityId: z.string().nullable(),
  before: z.unknown().nullable(), after: z.unknown().nullable(), ip: z.string().nullable(), requestId: z.string().nullable(), at: IsoDateSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const PreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).nullable().default(null),
  font: z.enum(['plex', 'rubik']).default('plex'),
  panel: z.boolean().default(true),
  callMode: z.boolean().default(true),
  sidebarExpanded: z.boolean().default(false),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const MeSchema = z.object({
  user: UserSchema, roles: z.array(z.string()), permissions: z.array(PermissionSchema),
  categoryScopes: z.array(CategorySchema).nullable(), preferences: PreferencesSchema,
});
export type Me = z.infer<typeof MeSchema>;
