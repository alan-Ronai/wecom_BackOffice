import { z } from 'zod';
import { CategorySchema, IdSchema, IsoDateSchema, PrioritySchema, WaveSchema } from './common.js';
import { ActionSchema, BranchSchema, OutcomeSchema, PhaseSchema } from './content.js';

export const RunSchema = z.object({
  t: z.string(),
  add: z.boolean().optional(),
  del: z.boolean().optional(),
  chg: z.boolean().optional(),
  code: z.boolean().optional(),
  author: z.string().optional(),
  date: IsoDateSchema.optional(),
});
export type Run = z.infer<typeof RunSchema>;

export const ParagraphSchema = z.object({
  ref: z.string(), // "4.8" or "A12"
  heading: z.string().optional(),
  level: z.number().int().min(1).max(6).optional(),
  runs: z.array(RunSchema),
  isNew: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  comments: z
    .array(z.object({ author: z.string(), text: z.string(), date: IsoDateSchema.optional() }))
    .optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;
export const paragraphText = (p: Paragraph): string =>
  p.runs
    .filter((r) => !r.del)
    .map((r) => r.t)
    .join('');

export const SourceKindSchema = z.enum(['docx', 'wordpress', 'json', 'csv', 'text']);
export const SourceSyncStateSchema = z.enum(['synced', 'pending', 'processing', 'error']);
export const SourceSchema = z.object({
  id: IdSchema,
  kind: SourceKindSchema,
  connectorId: IdSchema.nullable(),
  externalId: z.string().nullable(),
  title: z.string(),
  ext: z.string().optional(),
  mapping: z.record(z.string()).optional(),
  syncState: SourceSyncStateSchema,
  lastHash: z.string().nullable(),
  lastSyncedAt: IsoDateSchema.nullable(),
  linkedDocuments: z.number().int().default(0),
  pendingSuggestions: z.number().int().default(0),
  updatedAt: IsoDateSchema,
});
export type Source = z.infer<typeof SourceSchema>;

export const SourceRevisionSchema = z.object({
  id: IdSchema,
  sourceId: IdSchema,
  hash: z.string(),
  paragraphs: z.array(ParagraphSchema),
  importedAt: IsoDateSchema,
  importedBy: IdSchema.nullable(),
  accepted: z.boolean(),
  meta: z.record(z.unknown()).optional(),
});
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;

export const ParagraphDiffSchema = z.object({
  ref: z.string(),
  kind: z.enum(['added', 'removed', 'changed', 'same']),
  before: z.string().nullable(),
  after: z.string().nullable(),
  similarity: z.number().min(0).max(1),
});
export type ParagraphDiff = z.infer<typeof ParagraphDiffSchema>;

export const SuggestionTypeSchema = z.enum([
  'update-step',
  'new-card',
  'new-step',
  'update-block',
  'deprecate-step',
  'field-alert',
]);
export type SuggestionType = z.infer<typeof SuggestionTypeSchema>;
export const SuggestionStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'applied']);

export const SuggestionPayloadSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('update-step'),
    addActions: z.array(z.string()).default([]),
    replaceActions: z.array(ActionSchema).optional(),
    branch: BranchSchema.nullable().optional(),
    outcomes: z.array(OutcomeSchema).optional(),
    patch: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('new-card'),
    title: z.string(),
    description: z.string().default(''),
    category: CategorySchema,
    wave: WaveSchema,
    priority: PrioritySchema,
    phases: z.array(PhaseSchema),
  }),
  z.object({
    type: z.literal('new-step'),
    afterStepKey: z.string().nullable(),
    title: z.string(),
    actions: z.array(z.string()),
    outcomes: z.array(OutcomeSchema).default([]),
  }),
  z.object({
    type: z.literal('update-block'),
    actions: z.array(ActionSchema),
    script: z.string().optional(),
  }),
  z.object({ type: z.literal('deprecate-step'), reason: z.string() }),
  z.object({
    type: z.literal('field-alert'),
    fieldName: z.string(),
    issue: z.enum(['unknown', 'renamed', 'retired']),
  }),
]);
export type SuggestionPayload = z.infer<typeof SuggestionPayloadSchema>;

/* ── wave 6: impact, structured editing, analytics (additive) ───────────── */

/**
 * One thing a suggestion touches beyond its own target, computed by X1 from the graph and
 * the embeddings (spec §1.6). `why` is the Hebrew one-liner the card shows in its chip, so
 * an editor can see "this block is used by four other documents" before accepting anything.
 */
export const AffectsItemSchema = z.object({
  kind: z.enum(['document', 'block', 'field', 'topic']),
  id: z.string().min(1),
  title: z.string(),
  why: z.string().default(''),
});
export type AffectsItem = z.infer<typeof AffectsItemSchema>;

/** Per-row verdict in the structured editor: keep it as proposed, rewrite it, or drop it. */
export const StructuredEditOpSchema = z.enum(['keep', 'edit', 'remove']);
export type StructuredEditOp = z.infer<typeof StructuredEditOpSchema>;

export const StructuredEditRowSchema = z
  .object({
    /** `<group>-<index>` or `<group>:<key>`; the groups a type allows are below. */
    rowId: z.string().min(1),
    op: StructuredEditOpSchema,
    /** Required for `edit`; the replacement for that row (a string, or the row's object). */
    value: z.unknown().optional(),
  })
  .refine((r) => r.op !== 'edit' || r.value !== undefined, {
    message: 'op "edit" needs a value',
  });
export type StructuredEditRow = z.infer<typeof StructuredEditRowSchema>;

/**
 * The row groups each suggestion type exposes — the field-level editor of spec §1.8, and
 * what `POST /suggestions/:id/accept { parts }` selects from. A `rowId`'s group is the text
 * before its first `-` or `:`, so `add-0`, `patch:priority` and `reason` are all well formed.
 */
export const STRUCTURED_EDIT_ROW_GROUPS = {
  'update-step': ['add', 'replace', 'patch', 'branch', 'outcome'],
  'new-card': ['phase', 'step', 'patch'],
  'new-step': ['step', 'action', 'outcome', 'patch'],
  'update-block': ['action', 'script'],
  'deprecate-step': ['reason'],
  'field-alert': ['alert'],
} as const satisfies Record<SuggestionType, readonly string[]>;

export const structuredEditRowGroup = (rowId: string): string => rowId.split(/[-:]/, 1)[0] ?? '';
const editVariant = <T extends SuggestionType>(type: T) =>
  z.object({ type: z.literal(type), rows: z.array(StructuredEditRowSchema).default([]) });

/**
 * `PATCH /suggestions/:id/edit` — one variant per suggestion type (X3 owns the route), so a
 * row group belonging to another type is a 400 rather than a silently ignored edit.
 */
export const StructuredEditSchema = z
  .discriminatedUnion('type', [
    editVariant('update-step'),
    editVariant('new-card'),
    editVariant('new-step'),
    editVariant('update-block'),
    editVariant('deprecate-step'),
    editVariant('field-alert'),
  ])
  .superRefine((v, ctx) => {
    const groups: readonly string[] = STRUCTURED_EDIT_ROW_GROUPS[v.type];
    v.rows.forEach((r, i) => {
      if (!groups.includes(structuredEditRowGroup(r.rowId)))
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['rows', i, 'rowId'],
          message: `rowId must name a row group of ${v.type} (${groups.join(', ')})`,
        });
    });
  });
export type StructuredEdit = z.infer<typeof StructuredEditSchema>;

/** Original → edited, stored on the suggestion so analytics can measure what editors change. */
export const StructuredEditDiffSchema = z.object({
  rows: z
    .array(
      z.object({
        rowId: z.string().min(1),
        op: StructuredEditOpSchema,
        before: z.string().optional(),
        after: z.string().optional(),
      }),
    )
    .default([]),
});
export type StructuredEditDiff = z.infer<typeof StructuredEditDiffSchema>;

/** `POST /suggestions/:id/accept` — row ids to apply; omitted means the whole suggestion. */
export const AcceptSuggestionBodySchema = z.object({
  parts: z.array(z.string().min(1)).optional(),
});
export type AcceptSuggestionBody = z.infer<typeof AcceptSuggestionBodySchema>;

export const SuggestionSchema = z
  .object({
    id: IdSchema,
    sourceRevisionId: IdSchema,
    anchor: z.string(),
    type: SuggestionTypeSchema,
    title: z.string(),
    targetDocumentId: IdSchema.nullable(),
    targetStepKey: z.string().nullable(),
    targetBlockId: IdSchema.nullable(),
    payload: SuggestionPayloadSchema,
    editedPayload: SuggestionPayloadSchema.nullable().optional(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
    status: SuggestionStatusSchema,
    decidedBy: IdSchema.nullable().optional(),
    decidedAt: IsoDateSchema.nullable().optional(),
    appliedVersionId: IdSchema.nullable().optional(),
    createdAt: IsoDateSchema,
    /* ── wave 6 (X1/X3), additive: a suggestion stored before them still parses ── */
    /** Everything else the change touches (spec §1.6); `[]` on every pre-wave-6 row. */
    affects: z.array(AffectsItemSchema).default([]),
    /** `v3.<briefVersion>.<styleVersion>` — which briefing produced this. */
    promptVersion: z.string().nullable().optional(),
    /** The model tag that produced it, so analytics can compare tiers. */
    model: z.string().nullable().optional(),
    /** Original → edited, filled by the structured editor. */
    editDiff: StructuredEditDiffSchema.nullable().optional(),
    /** Row ids applied by a partial accept; null/absent means the whole payload. */
    appliedParts: z.array(z.string()).nullable().optional(),
  })
  .refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' });
export type Suggestion = z.infer<typeof SuggestionSchema>;

/* ── wave 6: acceptance analytics (X3 owns `GET /suggestions/analytics`) ── */

export const SuggestionAnalyticsQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  sourceId: IdSchema.optional(),
  type: SuggestionTypeSchema.optional(),
});
export type SuggestionAnalyticsQuery = z.infer<typeof SuggestionAnalyticsQuerySchema>;

/** One breakdown row. `key` is the type / source id / model tag / prompt version. */
export const SuggestionAnalyticsBucketSchema = z.object({
  key: z.string(),
  total: z.number().int().nonnegative(),
  accepted: z.number().int().nonnegative().default(0),
  /** Accepted after the editor changed the payload — the number that drives prompt work. */
  edited: z.number().int().nonnegative().default(0),
  rejected: z.number().int().nonnegative().default(0),
  pending: z.number().int().nonnegative().default(0),
});
export type SuggestionAnalyticsBucket = z.infer<typeof SuggestionAnalyticsBucketSchema>;

export const SuggestionAnalyticsSchema = z.object({
  total: z.number().int().nonnegative(),
  byType: z.array(SuggestionAnalyticsBucketSchema).default([]),
  bySource: z.array(SuggestionAnalyticsBucketSchema).default([]),
  byModel: z.array(SuggestionAnalyticsBucketSchema).default([]),
  byPromptVersion: z.array(SuggestionAnalyticsBucketSchema).default([]),
  /** Shares of the decided suggestions, each 0–1. */
  rates: z.object({
    accepted: z.number().min(0).max(1).default(0),
    edited: z.number().min(0).max(1).default(0),
    rejected: z.number().min(0).max(1).default(0),
  }),
  /** `null` when nothing in the window has been decided yet. */
  meanMinutesToDecision: z.number().nonnegative().nullable().default(null),
});
export type SuggestionAnalytics = z.infer<typeof SuggestionAnalyticsSchema>;
