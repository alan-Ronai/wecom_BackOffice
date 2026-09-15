/**
 * Stage 4 (connected data) and stage 5 (collaboration, admin, connectors UI) contracts.
 * Routes are listed in docs/api/CONTRACTS-stage4-5.md; every request/response below is the
 * single source of truth for the API validation, the OpenAPI file and the web client.
 */
import { z } from 'zod';
import {
  CategorySchema,
  DocumentStatusSchema,
  IdSchema,
  IsoDateSchema,
  PaginationQuerySchema,
  PrioritySchema,
  WaveSchema,
  paginated,
} from './common.js';
import {
  ActionSchema,
  BlockSchema,
  CrmFieldSchema,
  DocumentCardSchema,
  DocumentLinkSchema,
  LinkTypeSchema,
  OutcomeSchema,
  PhaseSchema,
  ScriptSchema,
  VersionSchema,
} from './content.js';
import { GroupMapSchema, PermissionSchema, SessionSchema, UserSchema } from './identity.js';
import { SyncLinkStateSchema } from './api.js';

/* ── Stage 4: graph ─────────────────────────────────────────────────────── */
export const GraphNodeKindSchema = z.enum(['document', 'block', 'field', 'source', 'script']);
export const GraphNodeSchema = z.object({
  id: z.string(),
  kind: GraphNodeKindSchema,
  label: z.string(),
  category: CategorySchema.optional(),
  status: z.string().optional(),
  degree: z.number().int().nonnegative(),
  meta: z.record(z.unknown()).optional(),
});
export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: LinkTypeSchema,
  fromStepKey: z.string().nullable(),
  origin: z.enum(['explicit', 'detected']),
});
export const GraphQuerySchema = z.object({
  focus: z.string().optional(), // node id: doc:<uuid> | block:<uuid> | field:<name> | source:<uuid>
  depth: z.coerce.number().int().min(1).max(4).default(2),
  types: z.string().optional(), // comma list of LinkType
  category: CategorySchema.optional(),
  kinds: z.string().optional(), // comma list of GraphNodeKind
  limit: z.coerce.number().int().min(10).max(2000).default(400),
});
export const GraphResponseSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  truncated: z.boolean(),
});
/** "What breaks if I delete this": everything pointing at the node. */
export const ImpactResponseSchema = z.object({
  node: GraphNodeSchema,
  inbound: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      stepKey: z.string().nullable(),
      type: LinkTypeSchema,
    }),
  ),
  brokenLinks: z.number().int(),
  affectedDocuments: z.number().int(),
});

/* ── Stage 4: field & block pages ───────────────────────────────────────── */
export const FieldUsageRowSchema = z.object({
  documentId: IdSchema,
  title: z.string(),
  category: CategorySchema,
  stepKey: z.string(),
  stepNum: z.string(),
  stepTitle: z.string(),
  text: z.string(),
});
export const FieldPageSchema = z.object({
  field: CrmFieldSchema,
  usage: z.array(FieldUsageRowSchema),
  documents: z.number().int(),
  history: z.array(
    z.object({
      at: IsoDateSchema,
      actorName: z.string().nullable(),
      action: z.string(),
      before: z.unknown().nullable(),
      after: z.unknown().nullable(),
    }),
  ),
  alerts: z.array(z.object({ kind: z.enum(['renamed', 'unknown', 'retired', 'new']), message: z.string() })),
});
export const FieldRenameBodySchema = z.object({
  newName: z.string().min(1),
  updateReferences: z.boolean().default(true),
  label: z.string().min(1).max(200),
});
export const FieldRenameResultSchema = z.object({
  updatedDocuments: z.number().int(),
  versionsCreated: z.number().int(),
  field: CrmFieldSchema,
});

export const BlockUsageRowSchema = z.object({
  documentId: IdSchema,
  title: z.string(),
  category: CategorySchema,
  stepKey: z.string(),
  stepNum: z.string(),
  mode: z.enum(['embedded', 'reference']),
});
export const BlockPageSchema = z.object({
  block: BlockSchema,
  usage: z.array(BlockUsageRowSchema),
  versions: z.array(
    z.object({
      version: z.number().int(),
      label: z.string(),
      authorName: z.string(),
      createdAt: IsoDateSchema,
    }),
  ),
});

/* ── Stage 4: data explorer (json/csv sources) ──────────────────────────── */
export const MappingFieldSchema = z.enum([
  'title',
  'description',
  'category',
  'wave',
  'priority',
  'code',
  'stepTitle',
  'stepAction',
  'stepOutcome',
  'ignore',
]);
export const ColumnMappingSchema = z.object({
  column: z.string(),
  field: MappingFieldSchema,
  sample: z.string().optional(),
});
export const DataFileSchema = z.object({
  sourceId: IdSchema,
  title: z.string(),
  kind: z.enum(['json', 'csv']),
  rows: z.number().int(),
  columns: z.array(z.string()),
  mapping: z.array(ColumnMappingSchema),
  syncState: z.enum(['synced', 'pending', 'processing', 'error']),
  lastSyncedAt: IsoDateSchema.nullable(),
  linkedDocuments: z.number().int(),
  pendingSuggestions: z.number().int(),
});
export const DataFilesResponseSchema = z.object({ items: z.array(DataFileSchema) });
export const DataPreviewQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
});
export const DataPreviewSchema = z.object({
  columns: z.array(z.string()),
  rows: z.array(z.record(z.string())),
  total: z.number().int(),
});
export const PutMappingBodySchema = z.object({ mapping: z.array(ColumnMappingSchema).min(1) });
export const ReimportResultSchema = z.object({
  revisionId: IdSchema,
  duplicate: z.boolean(),
  suggestionsQueued: z.boolean(),
});

/* ── Stage 4: dashboards ────────────────────────────────────────────────── */
export const DashboardSchema = z.object({
  generatedAt: IsoDateSchema,
  coverage: z.object({
    cards: z.number().int(),
    withDocument: z.number().int(),
    partial: z.number().int(),
    drafts: z.number().int(),
    byCategory: z.array(
      z.object({ category: CategorySchema, cards: z.number().int(), withDocument: z.number().int() }),
    ),
  }),
  freshness: z.object({
    updatedLast30d: z.number().int(),
    staleOver180d: z.number().int(),
    byCategory: z.array(
      z.object({
        category: CategorySchema,
        lastUpdatedAt: IsoDateSchema.nullable(),
        median_days: z.number(),
      }),
    ),
  }),
  usage: z.object({
    views7d: z.number().int(),
    views30d: z.number().int(),
    topDocuments: z.array(z.object({ documentId: IdSchema, title: z.string(), views: z.number().int() })),
    outcomesPicked7d: z.number().int(),
    callsCompleted7d: z.number().int(),
  }),
  pipeline: z.object({
    pending: z.number().int(),
    accepted: z.number().int(),
    rejected: z.number().int(),
    applied: z.number().int(),
    bySource: z.array(
      z.object({
        sourceId: IdSchema,
        title: z.string(),
        pending: z.number().int(),
        applied: z.number().int(),
      }),
    ),
  }),
  sync: z.object({
    links: z.number().int(),
    synced: z.number().int(),
    pendingImport: z.number().int(),
    pendingPush: z.number().int(),
    conflicts: z.number().int(),
    lastRunAt: IsoDateSchema.nullable(),
  }),
});
/** Telemetry the web sends so usage dashboards are real: outcome picks and completed calls. */
export const TelemetryEventSchema = z.object({
  // Wave 4 appends `view_topic` and `search_click`; the enum is append-only, never reordered,
  // and `0026_notification_kinds.js` widens the matching `telemetry_events.kind` check.
  //
  // Wave 5 appends `client_error`: the React error boundaries (`ui/ErrorBoundary.tsx`, review
  // §7 item 4) report a render-time crash here, so "the screen blanked on a call" is something
  // anyone can see in `telemetry_events` rather than only in whichever browser console was open.
  // `0043_telemetry_client_error.js` widens the check constraint to match; the row carries no
  // `documentId` when the crash is in the shell, which `recordTelemetry` already allows.
  kind: z.enum([
    'outcome',
    'call_completed',
    'palette',
    'jump',
    'view_topic',
    'search_click',
    'client_error',
  ]),
  documentId: IdSchema.optional(),
  stepKey: z.string().optional(),
  at: IsoDateSchema.optional(),
  /**
   * Post-pilot M2. Appended, never inserted: every field on this object is optional and every
   * existing emitter keeps sending exactly what it sent before.
   *
   * `path` is the route pathname the boundary was mounted at — `/doc/<id>`, `/library` — and only
   * the pathname: the query string and the hash are where a search term or a scroll anchor would
   * be, and neither belongs in a table anyone with `analytics.read` can read. 512 is far past any
   * route this app has, so the cap is a guard against a caller that is not the boundary, not a
   * limit the boundary will meet.
   *
   * `message` is `error.message` and nothing else — never the stack (it names a bundle and helps
   * nobody reading a dashboard), never anything the user typed. `ui/ErrorBoundary.tsx` redacts
   * what a thrown message tends to leak by accident (an email, a uuid that is not the
   * `documentId` already on the row) before it gets here; 1,000 is the cap the column is sized
   * for, and a longer message is truncated rather than rejected, because the one report that must
   * never be dropped is the one about the screen that just went blank.
   */
  path: z.string().max(512).optional(),
  message: z.string().max(1000).optional(),
});
export const TelemetryBatchSchema = z.object({ events: z.array(TelemetryEventSchema).min(1).max(200) });

/* ── Stage 5: notifications & mentions ──────────────────────────────────── */
// Append-only, same as above: wave 4's feedback and source-document flows raise a bell of their
// own, and `0026_notification_kinds.js` widens the `notifications.kind` check to match.
export const NotificationKindSchema = z.enum([
  'suggestion',
  'sync',
  'mention',
  'review',
  'publish',
  'system',
  'feedback',
  'source',
  // Wave 5 — `0038_wave5_permissions_settings.js` widens the notifications.kind check to match.
  'learning',
  'gap',
]);
export const NotificationSchema = z.object({
  id: IdSchema,
  kind: NotificationKindSchema,
  title: z.string(),
  body: z.string().default(''),
  href: z.string().nullable(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  createdAt: IsoDateSchema,
  readAt: IsoDateSchema.nullable(),
});
export const NotificationsQuerySchema = PaginationQuerySchema.extend({
  unread: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
});
export const NotificationsResponseSchema = paginated(NotificationSchema).extend({ unread: z.number().int() });
export const MentionCandidateSchema = z.object({
  id: IdSchema,
  displayName: z.string(),
  initials: z.string(),
  email: z.string().nullable(),
});

/* ── Stage 5: review workflow ───────────────────────────────────────────── */
export const RequestReviewBodySchema = z.object({
  note: z.string().max(1000).optional(),
  reviewerIds: z.array(IdSchema).max(10).optional(),
});
export const ReviewDecisionBodySchema = z.object({
  decision: z.enum(['approve', 'changes']),
  note: z.string().max(1000).optional(),
  label: z.string().max(200).optional(),
});
export const ReviewRequestSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  requestedBy: IdSchema,
  requestedByName: z.string(),
  note: z.string().nullable(),
  status: z.enum(['open', 'approved', 'changes']),
  decidedBy: IdSchema.nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdAt: IsoDateSchema,
  decidedAt: IsoDateSchema.nullable(),
});
export const ReviewQueueResponseSchema = paginated(
  // `canApprove` is wave 5 V3's additive field: whether *the caller* may decide this request
  // under `workflow.requireApprover`. Optional so a pre-wave-5 client keeps parsing the row.
  ReviewRequestSchema.extend({
    title: z.string(),
    category: CategorySchema,
    canApprove: z.boolean().optional(),
  }),
);

/* ── Stage 5: saved views, templates, presence ──────────────────────────── */
export const SavedViewSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(60),
  query: z.record(z.unknown()),
  shared: z.boolean().default(false),
  ownerId: IdSchema,
  ownerName: z.string(),
  createdAt: IsoDateSchema,
});
export const SavedViewBodySchema = SavedViewSchema.pick({ name: true, query: true, shared: true });
export const TemplateSchema = z.object({
  id: IdSchema,
  name: z.string().min(1).max(80),
  description: z.string().default(''),
  category: CategorySchema.nullable(),
  kind: z.enum(['steps', 'retention']),
  phases: z.array(PhaseSchema),
  builtIn: z.boolean(),
  updatedAt: IsoDateSchema,
});
export const TemplateBodySchema = TemplateSchema.pick({
  name: true,
  description: true,
  category: true,
  kind: true,
  phases: true,
});
export const PresenceSchema = z.object({
  documentId: IdSchema,
  editors: z.array(
    z.object({
      userId: IdSchema,
      displayName: z.string(),
      initials: z.string(),
      since: IsoDateSchema,
      lastSeenAt: IsoDateSchema,
    }),
  ),
});
export const BulkDocumentsBodySchema = z.object({
  ids: z.array(IdSchema).min(1).max(200),
  action: z.enum(['pin', 'unpin', 'delete', 'set-wave', 'set-priority', 'set-category', 'request-review']),
  wave: WaveSchema.optional(),
  priority: PrioritySchema.optional(),
  category: CategorySchema.optional(),
});
export const BulkResultSchema = z.object({
  affected: z.number().int(),
  skipped: z.array(z.object({ id: IdSchema, reason: z.string() })),
});

/* ── Stage 5: identity settings & admin polish ──────────────────────────── */
export const IdentitySettingsSchema = z.object({
  oidc: z.object({
    enabled: z.boolean(),
    issuer: z.string().nullable(),
    clientId: z.string().nullable(),
    hasSecret: z.boolean(),
    redirectUri: z.string().nullable(),
    groupsClaim: z.boolean(),
  }),
  paloalto: z.object({
    enabled: z.boolean(),
    host: z.string().nullable(),
    hasApiKey: z.boolean(),
    subnets: z.array(z.string()),
  }),
  local: z.object({ breakGlassEnabled: z.boolean() }),
  sessionHours: z.number().int().min(1).max(72),
});
export const IdentitySettingsPutSchema = z.object({
  oidc: z
    .object({
      enabled: z.boolean(),
      issuer: z.string().url().nullable(),
      clientId: z.string().nullable(),
      clientSecret: z.string().nullable().optional(),
      redirectUri: z.string().url().nullable(),
    })
    .partial()
    .optional(),
  paloalto: z
    .object({
      enabled: z.boolean(),
      host: z.string().nullable(),
      apiKey: z.string().nullable().optional(),
      subnets: z.array(z.string()),
    })
    .partial()
    .optional(),
  sessionHours: z.number().int().min(1).max(72).optional(),
});
export const IdentityTestResultSchema = z.object({
  provider: z.enum(['oidc', 'paloalto']),
  ok: z.boolean(),
  message: z.string(),
  details: z.record(z.unknown()).optional(),
});
export const AdminUserRowSchema = UserSchema.extend({
  roles: z.array(
    z.object({ roleId: IdSchema, roleName: z.string(), categoryScope: z.array(CategorySchema).nullable() }),
  ),
  groups: z.array(z.string()).default([]),
  sessions: z.number().int(),
  createdAt: IsoDateSchema,
});
export const AdminUsersQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(),
  source: z.enum(['entra', 'paloalto', 'local']).optional(),
  role: z.string().optional(),
  active: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
});
/**
 * `GET /admin/sessions` row: the stage-1 `SessionSchema` plus a flag the server sets on the
 * caller's own session so the UI can show "מכשיר זה" / offer "נתק את כל האחרים" without
 * guessing from IP or recency.
 */
export const AdminSessionRowSchema = SessionSchema.extend({
  isCurrent: z.boolean().optional(),
});
export const AuditDiffRowSchema = z.object({
  path: z.string(),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export const AuditEntryDetailSchema = z.object({
  id: IdSchema,
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  actorName: z.string().nullable(),
  ip: z.string().nullable(),
  requestId: z.string().nullable(),
  at: IsoDateSchema,
  diff: z.array(AuditDiffRowSchema),
  before: z.unknown().nullable(),
  after: z.unknown().nullable(),
});
export const RoleMatrixSchema = z.object({
  permissions: z.array(z.object({ name: PermissionSchema, resource: z.string(), description: z.string() })),
  roles: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      system: z.boolean(),
      permissions: z.array(PermissionSchema),
      users: z.number().int(),
    }),
  ),
});

/* ── Stage 5: connectors & sync UI ──────────────────────────────────────── */
export const ConnectorTypeInfoSchema = z.object({
  id: z.string(),
  name: z.string(),
  capabilities: z.object({
    read: z.boolean(),
    write: z.boolean(),
    webhooks: z.boolean(),
    identity: z.boolean(),
  }),
  configSchema: z.record(z.unknown()),
});
export const ConnectorRowSchema = z.object({
  id: IdSchema,
  type: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  schedule: z.string().nullable(),
  lastRunAt: IsoDateSchema.nullable(),
  lastStatus: z.enum(['ok', 'error', 'never']).default('never'),
  health: z.record(z.unknown()).nullable(),
  config: z.record(z.unknown()), // secrets masked as '••••'
  links: z.number().int().default(0),
  conflicts: z.number().int().default(0),
});
export const SyncLinkRowSchema = z.object({
  id: IdSchema,
  connectorId: IdSchema,
  connectorName: z.string(),
  documentId: IdSchema,
  title: z.string(),
  externalId: z.string(),
  remoteUrl: z.string().nullable(),
  state: SyncLinkStateSchema,
  baseLocalVersion: z.number().int().nullable(),
  currentLocalVersion: z.number().int(),
  remoteChanged: z.boolean(),
  localChanged: z.boolean(),
  lastSyncedAt: IsoDateSchema.nullable(),
});
export const SyncLinksQuerySchema = PaginationQuerySchema.extend({
  state: SyncLinkStateSchema.optional(),
  connectorId: IdSchema.optional(),
  q: z.string().optional(),
});
export const SyncQueueResponseSchema = paginated(SyncLinkRowSchema).extend({
  counts: z.object({
    synced: z.number().int(),
    pendingImport: z.number().int(),
    pendingPush: z.number().int(),
    conflict: z.number().int(),
  }),
});
export const ConflictViewSchema = z.object({
  link: SyncLinkRowSchema,
  base: z.object({ version: z.number().int().nullable(), phases: z.array(PhaseSchema).nullable() }),
  ours: z.object({ version: z.number().int(), phases: z.array(PhaseSchema) }),
  theirs: z.object({
    hash: z.string(),
    updatedAt: IsoDateSchema.nullable(),
    paragraphs: z.array(z.object({ ref: z.string(), heading: z.string().optional(), text: z.string() })),
  }),
});
export const ResolveConflictBodySchema = z.object({
  resolution: z.enum(['ours', 'theirs', 'merged']),
  merged: z.object({ phases: z.array(PhaseSchema) }).optional(),
  label: z.string().max(200).optional(),
});
export const SyncRunResultSchema = z.object({
  imported: z.number().int(),
  pushed: z.number().int(),
  conflicts: z.number().int(),
  errors: z.array(z.string()),
});
/**
 * `POST /connectors/test` — the wizard's step-3 dry run for a connector that has not been
 * saved yet and so has no id to test `POST /connectors/:id/test` against.
 */
export const ConnectorTestBodySchema = z.object({
  type: z.string().min(1),
  config: z.record(z.unknown()),
});
/** `POST /sync/links/:id/sync` — the per-row "ייבא עכשיו" / "דחוף עכשיו". */
export const SyncLinkSyncBodySchema = z.object({
  direction: z.enum(['import', 'push']),
});

/* ── Stage 5: comments (inline step comments with mentions) ─────────────── */
export const CommentSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  stepKey: z.string().nullable(),
  authorId: IdSchema,
  authorName: z.string(),
  authorInitials: z.string(),
  text: z.string(),
  mentions: z.array(z.object({ userId: IdSchema, displayName: z.string() })),
  resolvedAt: IsoDateSchema.nullable(),
  resolvedByName: z.string().nullable(),
  createdAt: IsoDateSchema,
  likes: z.number().int(),
  likedByMe: z.boolean(),
});
export const CommentBodySchema = z.object({
  stepKey: z.string().nullable().default(null),
  text: z.string().min(1).max(4000),
});

/* ── Shared helper types for the web ────────────────────────────────────── */
export type GraphNode = z.infer<typeof GraphNodeSchema>;
export type GraphEdge = z.infer<typeof GraphEdgeSchema>;
export type GraphResponse = z.infer<typeof GraphResponseSchema>;
export type ImpactResponse = z.infer<typeof ImpactResponseSchema>;
export type FieldPage = z.infer<typeof FieldPageSchema>;
export type BlockPage = z.infer<typeof BlockPageSchema>;
export type DataFile = z.infer<typeof DataFileSchema>;
export type DataPreview = z.infer<typeof DataPreviewSchema>;
export type Dashboard = z.infer<typeof DashboardSchema>;
export type Notification = z.infer<typeof NotificationSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type SavedView = z.infer<typeof SavedViewSchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type Presence = z.infer<typeof PresenceSchema>;
export type IdentitySettings = z.infer<typeof IdentitySettingsSchema>;
export type AdminUserRow = z.infer<typeof AdminUserRowSchema>;
export type AdminSessionRow = z.infer<typeof AdminSessionRowSchema>;
export type AuditEntryDetail = z.infer<typeof AuditEntryDetailSchema>;
export type RoleMatrix = z.infer<typeof RoleMatrixSchema>;
export type ConnectorRow = z.infer<typeof ConnectorRowSchema>;
export type SyncLinkRow = z.infer<typeof SyncLinkRowSchema>;
export type ConflictView = z.infer<typeof ConflictViewSchema>;
export type Comment = z.infer<typeof CommentSchema>;
// referenced to keep tree-shaking honest for consumers that only need enums
export {
  DocumentStatusSchema,
  DocumentCardSchema,
  DocumentLinkSchema,
  ActionSchema,
  OutcomeSchema,
  ScriptSchema,
  VersionSchema,
};

/* ── Wave 3 closure: Entra group search, group-map sync bookkeeping ───────── */

/**
 * `GET /admin/groups/search?q=` — the design's "⌕ חפש קבוצה ב-Entra…" box (3d).
 *
 * The search is a prefix match, because that is what Graph's `startswith(displayName,…)` filter
 * can answer against a directory of any size without a full scan; a "contains" box would have had
 * to page the whole tenant to be honest about its results.
 */
export const GroupSearchQuerySchema = z.object({ q: z.string().trim().min(1).max(100) });
export const GroupSearchItemSchema = z.object({
  /** The Entra object id — what `groups_map.idp_group_id` stores and what the `groups` claim carries. */
  id: z.string(),
  displayName: z.string(),
  description: z.string().optional(),
});
export const GroupSearchResponseSchema = z.object({ items: z.array(GroupSearchItemSchema) });

/**
 * A group-map row as `GET /admin/groups-map` now answers it: the mapping plus when the nightly
 * `identity.sync` job last reconciled that group.
 *
 * `null` is "never synced since this mapping was added", which is a real and useful state — a
 * mapping saved an hour ago genuinely has not been applied to anyone's roles yet, and the screen
 * must not imply it has.
 */
export const GroupMapRowSchema = GroupMapSchema.extend({ lastSyncedAt: IsoDateSchema.nullable() });
export const GroupsMapResponseSchema = z.object({ entries: z.array(GroupMapRowSchema) });

/* ── Wave 3 closure: the parity report (design 4d) ────────────────────────── */

/**
 * Why a row's two sides could not be compared. Absent when both hashes are real.
 *
 * - `remote_missing` — the link names an `externalId` the connector no longer lists (deleted or
 *   unpublished on the remote). The link is not broken, but nothing on the other side answers to it.
 * - `remote_unavailable` — `listRemote` failed for the whole connector, so every row's remote side
 *   is unknown. Distinct from `remote_missing`: one is a fact about the item, the other about the
 *   connection, and conflating them would have the report announce a mass deletion during an outage.
 */
export const ParityUnlinkedReasonSchema = z.enum(['remote_missing', 'remote_unavailable']);

/**
 * `GET /sync/parity` — one row per sync link, with the *content fingerprint of each side* rather
 * than only the state pill the queue already shows.
 *
 * The three hashes are what make the row readable: `baseRemoteHash` is the remote content both
 * sides last agreed on, `remoteHash` is the remote content now, and `localHash` is the published
 * library document now. `remoteHash !== baseRemoteHash` means the remote moved; `localHash` is
 * compared against nothing on the server (the two sides hash different content in different
 * formats) — it is the library's own fingerprint, shown so an operator can tell two runs apart.
 */
export const ParityLinkRowSchema = SyncLinkRowSchema.extend({
  localHash: z.string(),
  remoteHash: z.string().nullable(),
  baseRemoteHash: z.string().nullable(),
  remoteUpdatedAt: IsoDateSchema.nullable(),
  unlinkedReason: ParityUnlinkedReasonSchema.optional(),
});
/** A published library document in one of the connector's categories that no link points at. */
export const ParityUnlinkedDocumentSchema = z.object({
  documentId: IdSchema,
  title: z.string(),
  category: CategorySchema,
  currentVersion: z.number().int(),
  updatedAt: IsoDateSchema.nullable(),
});
/** A remote item the connector lists that no link points at. */
export const ParityUnlinkedRemoteSchema = z.object({
  externalId: z.string(),
  title: z.string(),
  hash: z.string(),
  kind: z.string(),
  url: z.string().nullable(),
  updatedAt: IsoDateSchema.nullable(),
});
export const ParityConnectorSchema = z.object({
  connectorId: IdSchema,
  connectorName: z.string(),
  /** False when `listRemote` failed: every row's `remoteHash` is then null, not "deleted". */
  remoteAvailable: z.boolean(),
  items: z.array(ParityLinkRowSchema),
  unlinked: z.object({
    documents: z.array(ParityUnlinkedDocumentSchema),
    remote: z.array(ParityUnlinkedRemoteSchema),
  }),
});
export const ParityQuerySchema = z.object({ connectorId: IdSchema.optional() });
export const ParityResponseSchema = z.object({ connectors: z.array(ParityConnectorSchema) });

/** `POST /sync/links` — the parity report's "קשר" action on an unlinked document or remote item. */
export const SyncLinkCreateBodySchema = z.object({
  connectorId: IdSchema,
  documentId: IdSchema,
  externalId: z.string().min(1).max(500),
});

export type GroupSearchItem = z.infer<typeof GroupSearchItemSchema>;
export type GroupMapRow = z.infer<typeof GroupMapRowSchema>;
export type ParityLinkRow = z.infer<typeof ParityLinkRowSchema>;
export type ParityConnector = z.infer<typeof ParityConnectorSchema>;
export type ParityResponse = z.infer<typeof ParityResponseSchema>;
export type ParityUnlinkedDocument = z.infer<typeof ParityUnlinkedDocumentSchema>;
export type ParityUnlinkedRemote = z.infer<typeof ParityUnlinkedRemoteSchema>;

// ---------------------------------------------------------------------------
// Pilot fix E-1 — `GET /documents/:id/sync-state` (docs.read, scope: document).
// One row per sync link that points at the document (a document may be linked
// from several connectors). `flagReason` is the Hebrew text the source-review
// flag keeps while a link is `conflict` / `pending_push`; null when nothing
// blocks. `overall` collapses the links for badges: 'unlinked' when `links` is
// empty, else the "worst" state in the order conflict > pending_push >
// pending_import > synced.
// ---------------------------------------------------------------------------
export const DocumentSyncLinkStateSchema = z.object({
  linkId: IdSchema,
  connectorId: IdSchema,
  /**
   * The connector-operations half. `GET /documents/:id/sync-state` answers to `docs.read` —
   * every agent in the building — because the article header needs a badge; it does not follow
   * that every agent needs the connector's name, its type, the remote URL and how its last run
   * went. Those are `sources.manage`'s business, and they are `null` for a caller without it
   * (post-pilot L4). The badge itself — `state`, `overall`, the version numbers — is unchanged.
   */
  connectorName: z.string().nullable(),
  connectorType: z.string().nullable(),
  externalId: z.string(),
  remoteUrl: z.string().nullable(),
  state: SyncLinkStateSchema,
  localChanged: z.boolean(),
  remoteChanged: z.boolean(),
  currentLocalVersion: z.number().int(),
  baseLocalVersion: z.number().int().nullable(),
  lastSyncedAt: IsoDateSchema.nullable(),
  // From the connector row: the last run's status/time is the closest thing the queue keeps to
  // "why is this still pending" — sync_links itself records no per-link error.
  connectorLastStatus: z.string().nullable(),
  connectorLastRunAt: IsoDateSchema.nullable(),
});
export const DocumentSyncStateSchema = z.object({
  documentId: IdSchema,
  overall: z.enum(['unlinked', 'synced', 'pending_import', 'pending_push', 'conflict']),
  flagReason: z.string().nullable(),
  links: z.array(DocumentSyncLinkStateSchema),
});
export type DocumentSyncLinkState = z.infer<typeof DocumentSyncLinkStateSchema>;
export type DocumentSyncState = z.infer<typeof DocumentSyncStateSchema>;
