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
  ref: z.string(),                 // "4.8" or "A12"
  heading: z.string().optional(),
  level: z.number().int().min(1).max(6).optional(),
  runs: z.array(RunSchema),
  isNew: z.boolean().optional(),
  isDeleted: z.boolean().optional(),
  comments: z.array(z.object({ author: z.string(), text: z.string(), date: IsoDateSchema.optional() })).optional(),
});
export type Paragraph = z.infer<typeof ParagraphSchema>;
export const paragraphText = (p: Paragraph): string => p.runs.filter((r) => !r.del).map((r) => r.t).join('');

export const SourceKindSchema = z.enum(['docx', 'wordpress', 'json', 'csv', 'text']);
export const SourceSyncStateSchema = z.enum(['synced', 'pending', 'processing', 'error']);
export const SourceSchema = z.object({
  id: IdSchema, kind: SourceKindSchema, connectorId: IdSchema.nullable(), externalId: z.string().nullable(),
  title: z.string(), ext: z.string().optional(), mapping: z.record(z.string()).optional(),
  syncState: SourceSyncStateSchema, lastHash: z.string().nullable(), lastSyncedAt: IsoDateSchema.nullable(),
  linkedDocuments: z.number().int().default(0), pendingSuggestions: z.number().int().default(0), updatedAt: IsoDateSchema,
});
export type Source = z.infer<typeof SourceSchema>;

export const SourceRevisionSchema = z.object({
  id: IdSchema, sourceId: IdSchema, hash: z.string(), paragraphs: z.array(ParagraphSchema),
  importedAt: IsoDateSchema, importedBy: IdSchema.nullable(), accepted: z.boolean(), meta: z.record(z.unknown()).optional(),
});
export type SourceRevision = z.infer<typeof SourceRevisionSchema>;

export const ParagraphDiffSchema = z.object({
  ref: z.string(), kind: z.enum(['added', 'removed', 'changed', 'same']),
  before: z.string().nullable(), after: z.string().nullable(), similarity: z.number().min(0).max(1),
});
export type ParagraphDiff = z.infer<typeof ParagraphDiffSchema>;

export const SuggestionTypeSchema = z.enum(['update-step', 'new-card', 'new-step', 'update-block', 'deprecate-step', 'field-alert']);
export type SuggestionType = z.infer<typeof SuggestionTypeSchema>;
export const SuggestionStatusSchema = z.enum(['pending', 'accepted', 'rejected', 'applied']);

export const SuggestionPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('update-step'), addActions: z.array(z.string()).default([]), replaceActions: z.array(ActionSchema).optional(), branch: BranchSchema.nullable().optional(), outcomes: z.array(OutcomeSchema).optional(), patch: z.record(z.unknown()).default({}) }),
  z.object({ type: z.literal('new-card'), title: z.string(), description: z.string().default(''), category: CategorySchema, wave: WaveSchema, priority: PrioritySchema, phases: z.array(PhaseSchema) }),
  z.object({ type: z.literal('new-step'), afterStepKey: z.string().nullable(), title: z.string(), actions: z.array(z.string()), outcomes: z.array(OutcomeSchema).default([]) }),
  z.object({ type: z.literal('update-block'), actions: z.array(ActionSchema), script: z.string().optional() }),
  z.object({ type: z.literal('deprecate-step'), reason: z.string() }),
  z.object({ type: z.literal('field-alert'), fieldName: z.string(), issue: z.enum(['unknown', 'renamed', 'retired']) }),
]);
export type SuggestionPayload = z.infer<typeof SuggestionPayloadSchema>;

export const SuggestionSchema = z.object({
  id: IdSchema, sourceRevisionId: IdSchema, anchor: z.string(), type: SuggestionTypeSchema, title: z.string(),
  targetDocumentId: IdSchema.nullable(), targetStepKey: z.string().nullable(), targetBlockId: IdSchema.nullable(),
  payload: SuggestionPayloadSchema, editedPayload: SuggestionPayloadSchema.nullable().optional(),
  confidence: z.number().min(0).max(1), rationale: z.string(), status: SuggestionStatusSchema,
  decidedBy: IdSchema.nullable().optional(), decidedAt: IsoDateSchema.nullable().optional(), appliedVersionId: IdSchema.nullable().optional(),
  createdAt: IsoDateSchema,
}).refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' });
export type Suggestion = z.infer<typeof SuggestionSchema>;
