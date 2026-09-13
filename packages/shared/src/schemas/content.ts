import { z } from 'zod';
import { CategorySchema, DocumentKindSchema, DocumentStatusSchema, IdSchema, IsoDateSchema, PrioritySchema, SlugSchema, WaveSchema } from './common.js';

export const ActionSchema = z.object({ id: z.string().min(1), text: z.string() });
export type Action = z.infer<typeof ActionSchema>;

export const OutcomeKindSchema = z.enum(['ok', 'next', 'alert']);
export const OutcomeSchema = z.object({ kind: OutcomeKindSchema, text: z.string(), goto: z.string().optional() });
export type Outcome = z.infer<typeof OutcomeSchema>;

export const BranchOptionSchema = z.object({ kind: z.enum(['if', 'then']), label: z.string(), text: z.string(), goto: z.string().optional() });
export const BranchSchema = z.object({ q: z.string(), options: z.array(BranchOptionSchema).min(1) });
export type Branch = z.infer<typeof BranchSchema>;

/** Retention-document extras (signals, pillars, conversation stages, objection, principles). */
export const StepExtrasSchema = z.object({
  signals: z.array(z.object({ label: z.string(), tone: z.enum(['red', 'blue']).optional(), items: z.array(z.string()) })).optional(),
  pillars: z.array(z.object({ label: z.string(), text: z.string(), tone: z.enum(['ok', 'warn', 'red', 'gray']).optional() })).optional(),
  stages: z.array(z.object({ label: z.string(), script: z.string().optional(), actions: z.array(z.string()).optional() })).optional(),
  objection: z.object({ q: z.string(), a: z.string() }).optional(),
  principles: z.array(z.string()).optional(),
  icon: z.string().optional(),
});

export const StepSchema = z.object({
  key: z.string().min(1),          // stable within a document, e.g. "s11"
  num: z.string().min(1),          // display number, e.g. "1א"
  title: z.string(),
  description: z.string().optional(),
  hint: z.string().optional(),
  tone: z.enum(['alert']).optional(),
  blockId: IdSchema.optional(),
  blockRefs: z.array(IdSchema).default([]),
  script: z.string().optional(),
  sourceRef: z.string().optional(),   // "§4.11"
  deps: z.array(z.string()).default([]),
  actions: z.array(ActionSchema).default([]),
  outcomes: z.array(OutcomeSchema).default([]),
  branch: BranchSchema.optional(),
  extras: StepExtrasSchema.optional(),
});
export type Step = z.infer<typeof StepSchema>;

export const PhaseSchema = z.object({
  id: z.string().min(1),
  label: z.string().default(''),
  note: z.string().optional(),
  route: z.string().optional(),
  steps: z.array(StepSchema).default([]),
});
export type Phase = z.infer<typeof PhaseSchema>;

export const DocumentSchema = z.object({
  id: IdSchema,
  slug: SlugSchema,
  code: z.string().optional(),
  title: z.string().min(1),
  description: z.string().default(''),
  category: CategorySchema,
  wave: WaveSchema,
  priority: PrioritySchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  currentVersion: z.number().int().nonnegative(),
  sourceId: IdSchema.nullable().optional(),
  sourceRef: z.string().optional(),
  phases: z.array(PhaseSchema),
  related: z.array(z.object({ documentId: IdSchema, why: z.string() })).default([]),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  createdBy: IdSchema.optional(),
  updatedBy: IdSchema.optional(),
  etag: z.string().optional(),
});
export type Document = z.infer<typeof DocumentSchema>;

/** Library card: what the list endpoint returns. */
export const DocumentCardSchema = DocumentSchema.pick({
  id: true, slug: true, title: true, description: true, category: true, wave: true, priority: true, kind: true, status: true, currentVersion: true, updatedAt: true,
}).extend({
  stepCount: z.number().int(),
  linksOut: z.number().int(),
  linksIn: z.number().int(),
  views: z.number().int(),
  crmFields: z.array(z.string()),
  hasSharedBlocks: z.boolean(),
  pinned: z.boolean(),
  authorName: z.string().optional(),
});
export type DocumentCard = z.infer<typeof DocumentCardSchema>;

export const BlockSchema = z.object({
  id: IdSchema,
  slug: SlugSchema,
  title: z.string().min(1),
  kind: z.enum(['step', 'script']),
  description: z.string().optional(),
  script: z.string().optional(),
  actions: z.array(ActionSchema).default([]),
  outcomes: z.array(OutcomeSchema).default([]),
  currentVersion: z.number().int().nonnegative(),
  updatedAt: IsoDateSchema,
  updatedBy: IdSchema.optional(),
});
export type Block = z.infer<typeof BlockSchema>;

export const CrmFieldStatusSchema = z.enum(['ok', 'renamed', 'new', 'retired']);
export const CrmFieldSchema = z.object({
  name: z.string().min(1),
  status: CrmFieldStatusSchema,
  renamedTo: z.string().optional(),
  path: z.string().default(''),
  effectiveFrom: IsoDateSchema.optional(),
  note: z.string().optional(),
  updatedAt: IsoDateSchema,
});
export type CrmField = z.infer<typeof CrmFieldSchema>;

export const ScriptSchema = z.object({ id: IdSchema, title: z.string().min(1), text: z.string(), tags: z.array(z.string()).default([]), updatedAt: IsoDateSchema });
export type Script = z.infer<typeof ScriptSchema>;

export const NoteSchema = z.object({
  id: IdSchema, documentId: IdSchema, stepKey: z.string().nullable(), authorId: IdSchema, authorName: z.string(),
  text: z.string().min(1), likes: z.number().int().nonnegative(), likedByMe: z.boolean().default(false), createdAt: IsoDateSchema,
});
export type Note = z.infer<typeof NoteSchema>;

export const VersionKindSchema = z.enum(['published', 'restore', 'system', 'sync']);
export const VersionSchema = z.object({
  documentId: IdSchema, version: z.number().int(), kind: VersionKindSchema, label: z.string(),
  authorId: IdSchema.nullable(), authorName: z.string(), createdAt: IsoDateSchema, suggestionId: IdSchema.nullable().optional(),
});
export type Version = z.infer<typeof VersionSchema>;

export const LinkTypeSchema = z.enum(['next', 'prerequisite', 'shares_block', 'same_field', 'derived_from_source', 'related', 'link']);
export const DocumentLinkSchema = z.object({
  fromDocumentId: IdSchema, fromStepKey: z.string().nullable(),
  toDocumentId: IdSchema.nullable(), toBlockId: IdSchema.nullable(), toFieldName: z.string().nullable(), toSourceId: IdSchema.nullable(),
  type: LinkTypeSchema, origin: z.enum(['explicit', 'detected']),
});
export type DocumentLink = z.infer<typeof DocumentLinkSchema>;
