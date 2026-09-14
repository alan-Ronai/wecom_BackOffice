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
import { PermissionSchema, UserSchema } from './identity.js';
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
  kind: z.enum(['outcome', 'call_completed', 'palette', 'jump']),
  documentId: IdSchema.optional(),
  stepKey: z.string().optional(),
  at: IsoDateSchema.optional(),
});
export const TelemetryBatchSchema = z.object({ events: z.array(TelemetryEventSchema).min(1).max(200) });

/* ── Stage 5: notifications & mentions ──────────────────────────────────── */
export const NotificationKindSchema = z.enum([
  'suggestion',
  'sync',
  'mention',
  'review',
  'publish',
  'system',
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
  ReviewRequestSchema.extend({ title: z.string(), category: CategorySchema }),
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
