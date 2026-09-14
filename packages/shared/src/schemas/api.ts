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
  CrmFieldStatusSchema,
  DocumentCardSchema,
  DocumentLinkSchema,
  DocumentSchema,
  NoteSchema,
  OutcomeSchema,
  PhaseSchema,
  ScriptSchema,
  VersionSchema,
} from './content.js';
import { DocTypeSchema, TaxonomyFilterSchema, WorldSlugSchema } from './wave4.js';
import { SuggestionPayloadSchema } from './pipeline.js';
import { PermissionSchema, PreferencesSchema } from './identity.js';

const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

export const ListDocumentsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(),
  category: CategorySchema.optional(),
  wave: z.coerce.number().pipe(WaveSchema).optional(),
  priority: PrioritySchema.optional(),
  status: DocumentStatusSchema.optional(),
  pinned: bool.optional(),
  recent: bool.optional(),
  drafts: bool.optional(),
  updatedSince: IsoDateSchema.optional(),
  sort: z.enum(['wave', 'updated', 'title', 'views']).default('wave'),
}).merge(TaxonomyFilterSchema);
export const ListDocumentsResponseSchema = paginated(DocumentCardSchema);

/** W1: taxonomy fields every write body carries. `worlds` are the EXTRA worlds; the primary is `category`. */
const TaxonomyWriteFields = z.object({
  docType: DocTypeSchema.optional(),
  tags: z.array(z.string().min(1).max(40)).max(30).default([]),
  worlds: z.array(WorldSlugSchema).max(20).default([]), // extra worlds; the primary is `category`
  topics: z.array(IdSchema).max(50).default([]),
  bodyHtml: z.string().max(200_000).optional(), // kind 'text' only
});
export const CreateDocumentBodySchema = DocumentSchema.pick({
  title: true,
  description: true,
  category: true,
  wave: true,
  priority: true,
  kind: true,
})
  .extend({
    slug: z.string().optional(),
    phases: z.array(PhaseSchema).optional(),
  })
  .merge(TaxonomyWriteFields);
export const PatchDocumentBodySchema = DocumentSchema.pick({
  title: true,
  description: true,
  category: true,
  wave: true,
  priority: true,
  code: true,
  sourceRef: true,
})
  .merge(TaxonomyWriteFields)
  .partial()
  .extend({
    ownerId: IdSchema.nullable().optional(), // W2
    editorId: IdSchema.nullable().optional(), // W2
  });
export const StructureBodySchema = z.object({
  phases: z.array(PhaseSchema).min(1),
  related: DocumentSchema.shape.related.optional(),
});
export const PublishBodySchema = z.object({
  label: z.string().min(1).max(200),
  markPartial: z.boolean().optional(),
  resolveFeedbackIds: z.array(IdSchema).max(50).optional(),
});
export const DiffQuerySchema = z.object({
  from: z.coerce.number().int().min(0),
  to: z.coerce.number().int().min(0).optional(),
});
export const RelatedDocSchema = z.object({
  documentId: IdSchema,
  title: z.string(),
  category: CategorySchema,
  why: z.string(),
});

export const SearchHitSchema = z.object({
  type: z.enum(['document', 'step', 'block', 'field', 'script', 'action']),
  id: z.string(),
  title: z.string(),
  snippet: z.string(),
  meta: z.string(),
  score: z.number(),
  documentId: IdSchema.optional(),
  stepKey: z.string().optional(),
  num: z.string().optional(),
  kbd: z.string().optional(),
});
export const SearchQuerySchema = z
  .object({
    q: z.string().default(''),
    types: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(40),
  })
  .merge(TaxonomyFilterSchema);
export const SearchResponseSchema = z.object({
  groups: z.array(
    z.object({
      type: z.enum(['documents', 'steps', 'blocks', 'fields', 'scripts', 'actions', 'tags']),
      hits: z.array(SearchHitSchema),
    }),
  ),
  total: z.number().int(),
  tookMs: z.number(),
  files: z.number().int(),
});

export const TrashItemSchema = z.object({
  type: z.enum(['document', 'block', 'field', 'script']),
  id: z.string(),
  title: z.string(),
  meta: z.string(),
  deletedBy: z.string(),
  deletedAt: IsoDateSchema,
  purgeAt: IsoDateSchema,
  impact: z.object({
    brokenLinks: z.number().int(),
    documents: z.array(z.object({ id: IdSchema, title: z.string() })),
  }),
});
export const TrashListSchema = z.object({ items: z.array(TrashItemSchema) });

export const CreateNoteBodySchema = z.object({
  stepKey: z.string().nullable().default(null),
  text: z.string().min(1).max(2000),
});
export const DraftBodySchema = z.object({ payload: z.record(z.unknown()) });

export const UpsertBlockBodySchema = BlockSchema.pick({
  title: true,
  kind: true,
  description: true,
  script: true,
}).extend({
  actions: z.array(ActionSchema).default([]),
  outcomes: z.array(OutcomeSchema).default([]),
  slug: z.string().optional(),
  label: z.string().optional(),
});
export const UpsertFieldBodySchema = z.object({
  name: z.string().min(1),
  status: CrmFieldStatusSchema,
  renamedTo: z.string().optional(),
  path: z.string().default(''),
  note: z.string().optional(),
});
export const UpsertScriptBodySchema = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  tags: z.array(z.string()).default([]),
});

export const SuggestionDecisionBodySchema = z.object({ editedPayload: SuggestionPayloadSchema.optional() });
export const SuggestionsQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['pending', 'accepted', 'rejected', 'applied']).optional(),
  sourceId: IdSchema.optional(),
});

/**
 * O-2: `model: true` only ever meant "Ollama answered", so an operator who fat-fingers
 * `MODEL_NAME` got a green smoke test and discovered the mistake when the first suggestion job
 * failed. `modelStatus` separates the two facts; `model` stays as the boolean older clients read
 * and now means "reachable **and** the configured tag is pulled".
 */
export const ModelStatusSchema = z.object({
  /** `GET {MODEL_URL}/api/tags` answered. */
  reachable: z.boolean(),
  /** That listing contains `name` — i.e. the configured model is actually pulled. */
  tagPresent: z.boolean(),
  /** The configured `MODEL_NAME`, or `rules` when `MODEL_DISABLED=true`. */
  name: z.string(),
});

export const HealthResponseSchema = z.object({
  ok: z.boolean(),
  db: z.boolean(),
  model: z.boolean().nullable(),
  modelStatus: ModelStatusSchema,
  queue: z.number().int().nullable(),
  version: z.string(),
  uptimeSec: z.number(),
  /** The `system.backup-check` worker's last recorded result (see GET /admin/system). */
  lastBackupAt: IsoDateSchema.nullable(),
  lastBackupOk: z.boolean().nullable(),
});

export const AdminUserPatchSchema = z.object({
  active: z.boolean().optional(),
  roles: z
    .array(z.object({ roleId: IdSchema, categoryScope: z.array(CategorySchema).nullable() }))
    .optional(),
});
/** Stage-1 §4 `POST /admin/users`: create (or reset) the local, non-federated login. */
export const AdminUserCreateSchema = z.object({
  email: z.string().min(3),
  password: z.string().min(12),
  displayName: z.string().min(1).max(80).optional(),
  roles: z
    .array(z.object({ roleId: IdSchema, categoryScope: z.array(CategorySchema).nullable() }))
    .optional(),
});
/** Stage-1 §4 `GET /admin/system`: the operator's single "is anything wrong" view. */
export const AdminSystemSchema = z.object({
  db: z.boolean(),
  model: z.boolean(),
  modelName: z.string(),
  queue: z.number().int().nullable(),
  queues: z.record(z.number().int()),
  backup: z.object({
    ok: z.boolean(),
    latestFile: z.string().nullable(),
    ageHours: z.number().nullable(),
    /** The last time the `system.backup-check` worker recorded a result, if ever. */
    checkedAt: IsoDateSchema.nullable(),
    lastBackupAt: IsoDateSchema.nullable(),
    lastBackupOk: z.boolean().nullable(),
  }),
  connectors: z.array(
    z.object({
      id: IdSchema,
      name: z.string(),
      type: z.string(),
      enabled: z.boolean(),
      lastStatus: z.string().nullable(),
      lastRunAt: IsoDateSchema.nullable(),
      conflicts: z.number().int(),
    }),
  ),
  sources: z.object({ pending: z.number().int(), error: z.number().int() }),
  suggestions: z.object({ pending: z.number().int() }),
  version: z.string(),
  uptimeSec: z.number(),
});
export const RoleUpsertSchema = z.object({
  name: z.string().min(1).max(40),
  description: z.string().default(''),
  permissions: z.array(PermissionSchema),
});
export const GroupMapPutSchema = z.object({
  entries: z.array(z.object({ idpGroupId: z.string(), idpGroupName: z.string(), roleId: IdSchema })),
});
// --- connectors & two-way sync (L6) ---
export const ConnectorCapabilitiesSchema = z.object({
  read: z.boolean(),
  write: z.boolean(),
  webhooks: z.boolean(),
  identity: z.boolean(),
});
export const ConnectorSchema = z.object({
  id: IdSchema,
  type: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  schedule: z.string(),
  lastRunAt: IsoDateSchema.nullable(),
  lastStatus: z.string().nullable(),
  health: z.record(z.unknown()),
  configMasked: z.record(z.unknown()),
  capabilities: ConnectorCapabilitiesSchema,
});
export const ConnectorCreateBodySchema = z.object({
  type: z.string().min(1),
  name: z.string().min(1).max(80),
  config: z.record(z.unknown()),
  // Omitted = leave the schedule alone on a PATCH (or default it on a POST); `null` is
  // the explicit "ללא תזמון" — stop running this connector on a timer.
  schedule: z
    .string()
    .regex(/^(\S+\s+){4}\S+$/)
    .nullable()
    .optional(),
  enabled: z.boolean().optional(),
});
export const ConnectorPatchBodySchema = ConnectorCreateBodySchema.partial();
export const SyncLinkStateSchema = z.enum(['synced', 'pending_import', 'pending_push', 'conflict']);
export const SyncLinkSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  documentTitle: z.string(),
  connectorId: IdSchema,
  externalId: z.string(),
  remoteUrl: z.string().nullable(),
  state: SyncLinkStateSchema,
  baseRemoteHash: z.string().nullable(),
  baseLocalVersion: z.number().int(),
  lastSyncedAt: IsoDateSchema.nullable(),
  conflict: z.unknown().nullable(),
  /**
   * W4/B-C2: images the last inbound sync could not bring across. The sanitizer drops an
   * `<img>` whose `src` is not a local asset, so without this the loss would be invisible —
   * and the next push would write the image-free body back to the remote.
   */
  mediaErrors: z
    .array(z.object({ url: z.string(), error: z.string() }))
    .nullable()
    .default(null),
});
export const SyncResolveBodySchema = z.object({
  resolution: z.enum(['ours', 'theirs', 'merged']),
  merged: DocumentSchema.optional(),
});

export const AuditQuerySchema = PaginationQuerySchema.extend({
  actorId: IdSchema.optional(),
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});

// ---------------------------------------------------------------------------
// L2 (API core) additive request/response contracts. Additive only, per ADR 0001.
// ---------------------------------------------------------------------------

export type ListDocumentsQuery = z.infer<typeof ListDocumentsQuerySchema>;
export type CreateDocumentBody = z.infer<typeof CreateDocumentBodySchema>;
export type PatchDocumentBody = z.infer<typeof PatchDocumentBodySchema>;
export type StructureBody = z.infer<typeof StructureBodySchema>;
export type PublishBody = z.infer<typeof PublishBodySchema>;
export type DiffQuery = z.infer<typeof DiffQuerySchema>;
export type RelatedDoc = z.infer<typeof RelatedDocSchema>;
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
export type SearchHit = z.infer<typeof SearchHitSchema>;
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
export type TrashItem = z.infer<typeof TrashItemSchema>;
export type CreateNoteBody = z.infer<typeof CreateNoteBodySchema>;
export type DraftBody = z.infer<typeof DraftBodySchema>;
export type UpsertBlockBody = z.infer<typeof UpsertBlockBodySchema>;
export type UpsertFieldBody = z.infer<typeof UpsertFieldBodySchema>;
export type UpsertScriptBody = z.infer<typeof UpsertScriptBodySchema>;

/** Side-by-side step diff (`GET /documents/:id/diff`). */
export const DiffSideSchema = z.object({
  key: z.string(),
  num: z.string(),
  titleHtml: z.string(),
  lines: z.array(z.string()),
});
export const DiffRowSchema = z.object({
  kind: z.enum(['same', 'changed', 'added', 'removed']),
  oldStep: DiffSideSchema.nullable(),
  newStep: DiffSideSchema.nullable(),
  blame: z.object({ version: z.number().int(), author: z.string() }).optional(),
});
export const DiffResponseSchema = z.object({
  from: z.number().int(),
  to: z.number().int(),
  rows: z.array(DiffRowSchema),
  stats: z.object({
    changed: z.number().int(),
    added: z.number().int(),
    removed: z.number().int(),
  }),
});
export type DiffSide = z.infer<typeof DiffSideSchema>;
export type DiffRow = z.infer<typeof DiffRowSchema>;
export type DiffResponse = z.infer<typeof DiffResponseSchema>;

export const VersionListSchema = z.object({ items: z.array(VersionSchema) });
export const PublishResponseSchema = z.object({
  document: DocumentSchema,
  version: z.number().int(),
  auditId: z.string(),
});
export const DeleteResponseSchema = z.object({ auditId: z.string(), restoreUntil: IsoDateSchema });
export const LinksResponseSchema = z.object({
  out: z.array(DocumentLinkSchema),
  in: z.array(DocumentLinkSchema),
});
export const RelatedResponseSchema = z.object({ items: z.array(RelatedDocSchema) });

export const BlockListSchema = z.object({ items: z.array(BlockSchema) });
export const BlockUsageSchema = z.object({
  items: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      stepKey: z.string(),
      stepNum: z.string(),
      mode: z.enum(['embedded', 'reference']),
    }),
  ),
});
export const BlockVersionListSchema = z.object({
  items: z.array(
    z.object({
      version: z.number().int(),
      label: z.string(),
      authorName: z.string(),
      createdAt: IsoDateSchema,
    }),
  ),
});

export const FieldListSchema = z.object({
  items: z.array(CrmFieldSchema.extend({ usedIn: z.number().int() })),
});
export const FieldUsageSchema = z.object({
  items: z.array(z.object({ documentId: IdSchema, title: z.string(), stepKeys: z.array(z.string()) })),
});
export const ScriptListSchema = z.object({
  items: z.array(
    ScriptSchema.extend({ usedIn: z.array(z.object({ documentId: IdSchema, title: z.string() })) }),
  ),
});

export const NoteListSchema = z.object({ items: z.array(NoteSchema) });
export const NoteLikeResponseSchema = z.object({
  likes: z.number().int().nonnegative(),
  likedByMe: z.boolean(),
});
export const DraftResponseSchema = z.object({
  draftKey: z.string(),
  documentId: IdSchema.nullable(),
  payload: z.record(z.unknown()),
  updatedAt: IsoDateSchema,
  otherEditors: z.array(z.object({ userId: IdSchema, name: z.string(), updatedAt: IsoDateSchema })),
});
export const DraftListSchema = z.object({
  items: z.array(
    z.object({
      draftKey: z.string(),
      documentId: IdSchema.nullable(),
      title: z.string(),
      updatedAt: IsoDateSchema,
    }),
  ),
});
export const PreferencesPutSchema = PreferencesSchema.partial();
