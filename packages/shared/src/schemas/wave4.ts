import { z } from 'zod';
import {
  IdSchema,
  IsoDateSchema,
  PaginationQuerySchema,
  paginated,
  DocumentKindSchema,
  DocumentStatusSchema,
} from './common.js';

/* ── Taxonomy (W1) ─────────────────────────────────────────────────────── */
export const WorldSlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
export const DOC_TYPES = ['M', 'R', 'O', 'E', 'S', 'T', 'I'] as const;
export const DocTypeSchema = z.enum(DOC_TYPES);
export type DocType = z.infer<typeof DocTypeSchema>;
/** PRD §3 labels, in the order a topic page renders its groups. */
export const DOC_TYPE_LABELS: Record<DocType, string> = {
  M: 'אבחון',
  R: 'טיפול',
  O: 'תפעול',
  E: 'הסלמה',
  S: 'מומחה',
  T: 'תסריט',
  I: 'מידע',
};

export const WorldSchema = z.object({
  id: IdSchema,
  slug: WorldSlugSchema,
  name: z.string().min(1).max(80),
  description: z.string().default(''),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  topicCount: z.number().int().nonnegative(),
  itemCount: z.number().int().nonnegative(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type World = z.infer<typeof WorldSchema>;
export const WorldBodySchema = z.object({
  slug: WorldSlugSchema,
  name: z.string().min(1).max(80),
  description: z.string().max(500).default(''),
  active: z.boolean().default(true),
});
export const WorldPatchSchema = WorldBodySchema.omit({ slug: true }).partial();
export const WorldsResponseSchema = z.object({ items: z.array(WorldSchema) });
export const WorldsQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')])
    .optional(),
});

export const TopicSchema = z.object({
  id: IdSchema,
  worldSlug: WorldSlugSchema,
  slug: WorldSlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().default(''),
  position: z.number().int().nonnegative(),
  active: z.boolean(),
  itemCount: z.number().int().nonnegative(),
});
export type Topic = z.infer<typeof TopicSchema>;
export const TopicBodySchema = z.object({
  slug: WorldSlugSchema,
  name: z.string().min(1).max(120),
  description: z.string().max(500).default(''),
  active: z.boolean().default(true),
});
export const TopicPatchSchema = TopicBodySchema.omit({ slug: true }).partial().extend({
  worldSlug: WorldSlugSchema.optional(), // move a topic to another world
});
export const TopicsResponseSchema = z.object({ items: z.array(TopicSchema) });
export const ReorderBodySchema = z.object({ ids: z.array(IdSchema).min(1).max(500) });

export const TagCountSchema = z.object({
  tag: z.string().min(1),
  count: z.number().int().nonnegative(),
});
export const TagsResponseSchema = z.object({ items: z.array(TagCountSchema) });
export const TagsQuerySchema = z.object({
  q: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const TopicItemSchema = z.object({
  id: IdSchema,
  slug: z.string(),
  title: z.string(),
  docType: DocTypeSchema,
  kind: DocumentKindSchema,
  status: DocumentStatusSchema,
  worlds: z.array(WorldSlugSchema),
  description: z.string().default(''),
  tags: z.array(z.string()).default([]),
  updatedAt: IsoDateSchema,
});
export type TopicItem = z.infer<typeof TopicItemSchema>;
export const TopicViewSchema = z.object({
  topic: TopicSchema,
  world: WorldSchema,
  groups: z.array(z.object({ docType: DocTypeSchema, items: z.array(TopicItemSchema) })),
});
export type TopicView = z.infer<typeof TopicViewSchema>;

/* ── Governance (W2) ───────────────────────────────────────────────────── */
export const UNPUBLISHED_STATUSES = ['draft', 'review', 'invalid', 'archived'] as const;
/** Additive document fields. Everything optional/defaulted so pre-wave-4 rows still validate. */
export const DocumentWave4FieldsSchema = z.object({
  docType: DocTypeSchema.optional(),
  tags: z.array(z.string().min(1).max(40)).default([]),
  worlds: z.array(WorldSlugSchema).default([]), // primary first
  topics: z.array(IdSchema).default([]),
  ownerId: IdSchema.nullable().optional(),
  ownerName: z.string().nullable().optional(),
  editorId: IdSchema.nullable().optional(),
  editorName: z.string().nullable().optional(),
  approverId: IdSchema.nullable().optional(),
  approverName: z.string().nullable().optional(),
  publishedAt: IsoDateSchema.nullable().optional(),
  sourceReviewNeeded: z.boolean().default(false),
  sourceReviewReason: z.string().nullable().optional(),
  bodyHtml: z.string().optional(), // kind 'text' only
});
export const SetStatusBodySchema = z.object({
  status: z.enum(['invalid', 'archived', 'draft']),
  reason: z.string().min(1).max(500),
});
export const SourceReviewClearBodySchema = z.object({ note: z.string().min(1).max(500) });
const oneOrMany = z.union([z.string(), z.array(z.string())]).transform((v) => (Array.isArray(v) ? v : [v]));
export const TaxonomyFilterSchema = z.object({
  world: WorldSlugSchema.optional(),
  topic: IdSchema.optional(),
  docType: DocTypeSchema.optional(),
  tag: oneOrMany.optional(),
});
