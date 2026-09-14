import { z } from 'zod';
import { IdSchema, IsoDateSchema, CategorySchema } from './common.js';
import { PERMISSIONS } from '../permissions.js';

export const PermissionSchema = z.enum(PERMISSIONS);
export const UserSourceSchema = z.enum(['entra', 'paloalto', 'local']);
// zod's built-in .email() (3.25+) enforces a stricter RFC5322-ish pattern that rejects short
// test-fixture TLDs like "a@b.c"; a permissive pattern matches the plan's fixtures and stage-1 needs.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UserSchema = z.object({
  id: IdSchema,
  subject: z.string(),
  source: UserSourceSchema,
  email: z.string().regex(EMAIL_RE).nullable(),
  displayName: z.string(),
  initials: z.string().max(2),
  active: z.boolean(),
  lastLoginAt: IsoDateSchema.nullable(),
});
export type User = z.infer<typeof UserSchema>;

export const RoleSchema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  description: z.string().default(''),
  system: z.boolean(),
  permissions: z.array(PermissionSchema),
});
export type Role = z.infer<typeof RoleSchema>;
export const UserRoleSchema = z.object({
  userId: IdSchema,
  roleId: IdSchema,
  roleName: z.string(),
  categoryScope: z.array(CategorySchema).nullable(),
  grantedBy: IdSchema.nullable(),
  grantedAt: IsoDateSchema,
});
export const GroupMapSchema = z.object({
  idpGroupId: z.string(),
  idpGroupName: z.string(),
  roleId: IdSchema,
});

export const SessionSchema = z.object({
  id: IdSchema,
  userId: IdSchema,
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  createdAt: IsoDateSchema,
  lastSeenAt: IsoDateSchema,
  expiresAt: IsoDateSchema,
  revokedAt: IsoDateSchema.nullable(),
});

export const AuditEntrySchema = z.object({
  id: IdSchema,
  actorId: IdSchema.nullable(),
  actorName: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  at: IsoDateSchema,
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const PreferencesSchema = z.object({
  theme: z.enum(['light', 'dark']).nullable().default(null),
  font: z.enum(['plex', 'rubik']).default('plex'),
  panel: z.boolean().default(true),
  callMode: z.boolean().default(true),
  sidebarExpanded: z.boolean().default(false),

  /* ── the QOL round's per-user state (wave 3, lane C) ─────────────────────
   *
   * Preferences follow the user across machines; `localStorage` does not. These five keys were
   * already being written to `PUT /me/preferences` by the web, and zod strips unknown keys, so
   * until now the route accepted them and threw them away — the web kept a `localStorage` mirror
   * to cover the gap (`apps/web/src/api/hooks/uiPrefs.ts`). Declaring them here is what makes the
   * server the authority again.
   *
   * They are `.optional()` rather than `.default()` on purpose: the five fields above are what
   * every existing consumer destructures, and a preferences row stored before this change carries
   * none of these keys. Optional means such a row still parses and no consumer's type changes
   * shape — the widening is additive in both directions. The web supplies its own defaults in
   * `UiPrefsSchema`, which extends this schema.
   */
  /** Library row height — `נוח` / `דחוס`. */
  density: z.enum(['comfortable', 'compact']).optional(),
  /** Library presentation: the card grid, or the keyboard-first list. */
  libraryView: z.enum(['cards', 'list']).optional(),
  /** Id of the `/views` saved view currently applied, if any. */
  savedViewId: z.string().nullable().optional(),
  /** documentId → ISO timestamp of the last time this user opened it, for "changed since". */
  lastSeen: z.record(z.string()).optional(),
  /** The first-login tour has been completed or skipped. */
  tourDone: z.boolean().optional(),
  /**
   * W4: which pane the article page opens in — working view, source document, or both.
   *
   * Additive and *optional* (ADR 0001): preference rows written before wave 4 validate unchanged,
   * and the object literals across the app that build a `Preferences` keep compiling. The
   * effective default lives in `apps/web/src/lib/prefs.ts` (`DEFAULT_PREFERENCES.paneMode`), so
   * read it as `preferences.paneMode ?? 'work'`.
   */
  paneMode: z.enum(['work', 'source', 'split']).optional(),
});
export type Preferences = z.infer<typeof PreferencesSchema>;

export const MeSchema = z.object({
  user: UserSchema,
  roles: z.array(z.string()),
  permissions: z.array(PermissionSchema),
  /**
   * @deprecated W1 renamed this to `worldScopes`; read that instead. Still emitted for one
   * release (`auth/routes.ts`, `auth/permissions.ts` and `plugins/testUser.ts` all derive both
   * from one `resolvedScopes`), removed after wave 4.
   */
  categoryScopes: z.array(CategorySchema).nullable().optional(),
  /**
   * The caller's world scope: `null` means unscoped — every world — and an array is the
   * intersection set. Required-and-nullable rather than optional, so there are two states to
   * handle and not three; the API has always emitted it, and the optionality only pointed new
   * consumers at the deprecated spelling (C-I2).
   */
  worldScopes: z.array(CategorySchema).nullable(),
  preferences: PreferencesSchema,
});
export type Me = z.infer<typeof MeSchema>;
