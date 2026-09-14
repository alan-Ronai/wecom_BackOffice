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

/* ── Feedback (W3) ─────────────────────────────────────────────────────── */
export const FEEDBACK_KINDS = [
  'outdated',
  'error',
  'unclear',
  'missing',
  'process_fails',
  'no_answer',
  'other',
] as const;
export const FeedbackKindSchema = z.enum(FEEDBACK_KINDS);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  outdated: 'המידע לא מעודכן',
  error: 'מצאתי טעות',
  unclear: 'ההנחיה לא ברורה',
  missing: 'חסר מידע',
  process_fails: 'התהליך לא עובד בפועל',
  no_answer: 'לא מצאתי תשובה למקרה שלי',
  other: 'אחר',
};
export const FEEDBACK_STATUSES = ['new', 'in_review', 'needs_update', 'no_change', 'done'] as const;
export const FeedbackStatusSchema = z.enum(FEEDBACK_STATUSES);
export type FeedbackStatus = z.infer<typeof FeedbackStatusSchema>;
export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  new: 'חדש',
  in_review: 'בבדיקה',
  needs_update: 'דורש עדכון',
  no_change: 'לא נדרש שינוי',
  done: 'טופל',
};
export const FeedbackSchema = z.object({
  id: IdSchema,
  documentId: IdSchema,
  documentVersion: z.number().int().nonnegative(),
  docType: DocTypeSchema.nullable(),
  worldSlug: WorldSlugSchema,
  stepKey: z.string().nullable(),
  kind: FeedbackKindSchema,
  text: z.string().default(''),
  status: FeedbackStatusSchema,
  userId: IdSchema,
  userName: z.string(),
  createdAt: IsoDateSchema,
  assigneeId: IdSchema.nullable(),
  decisionNote: z.string().nullable(),
  decidedBy: IdSchema.nullable(),
  decidedAt: IsoDateSchema.nullable(),
  resolvedVersion: z.number().int().nullable(),
});
export type Feedback = z.infer<typeof FeedbackSchema>;
export const CreateFeedbackBodySchema = z.object({
  kind: FeedbackKindSchema,
  text: z.string().max(1000).default(''),
  stepKey: z.string().max(40).optional(),
});
export const FeedbackRowSchema = FeedbackSchema.extend({
  documentTitle: z.string(),
  assigneeName: z.string().nullable(),
});
export type FeedbackRow = z.infer<typeof FeedbackRowSchema>;
export const FeedbackQuerySchema = PaginationQuerySchema.extend({
  status: FeedbackStatusSchema.optional(),
  world: WorldSlugSchema.optional(),
  kind: FeedbackKindSchema.optional(),
  documentId: IdSchema.optional(),
  assigneeId: IdSchema.optional(),
  docType: DocTypeSchema.optional(),
});
export const FeedbackListResponseSchema = paginated(FeedbackRowSchema).extend({
  counts: z.record(FeedbackStatusSchema, z.number().int()), // tab badges
});
export const FeedbackPatchBodySchema = z.object({
  status: FeedbackStatusSchema.optional(),
  assigneeId: IdSchema.nullable().optional(),
  decisionNote: z.string().max(2000).optional(),
});
export const FeedbackResolveBodySchema = z.object({
  version: z.number().int().positive(),
  decisionNote: z.string().max(2000).optional(),
});
export const FeedbackDetailSchema = FeedbackRowSchema.extend({
  versionLabel: z.string().nullable(),
  href: z.string(), // "/doc/<id>/<stepKey>" the queue deep-links to
  laterVersions: z.array(
    z.object({ version: z.number().int(), label: z.string(), createdAt: IsoDateSchema }),
  ),
});
export const DocumentFeedbackResponseSchema = z.object({ items: z.array(FeedbackRowSchema) });
export const FeedbackAnalyticsQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  world: WorldSlugSchema.optional(),
});
export const FeedbackAnalyticsSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  total: z.number().int(),
  perItem: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      docType: DocTypeSchema.nullable(),
      count: z.number().int(),
      open: z.number().int(),
    }),
  ),
  byKind: z.array(z.object({ kind: FeedbackKindSchema, count: z.number().int() })),
  topItems: z.array(z.object({ documentId: IdSchema, title: z.string(), count: z.number().int() })),
  meanHoursToClose: z.number().nullable(),
  changeRate: z.number().min(0).max(1), // share of closed feedback with resolvedVersion set
  recurringByTopic: z.array(
    z.object({
      topicId: IdSchema,
      topicName: z.string(),
      kind: FeedbackKindSchema,
      count: z.number().int(),
    }),
  ),
});
export type FeedbackAnalytics = z.infer<typeof FeedbackAnalyticsSchema>;

/* ── Source documents (W4) ─────────────────────────────────────────────── */
export const SourceDocumentSchema = z.object({
  documentId: IdSchema,
  html: z.string(),
  text: z.string(),
  version: z.number().int().nonnegative(),
  etag: z.string(),
  updatedById: IdSchema.nullable(),
  updatedByName: z.string().nullable(),
  updatedAt: IsoDateSchema,
});
export type SourceDocument = z.infer<typeof SourceDocumentSchema>;
export const PutSourceDocumentBodySchema = z.object({
  html: z.string().max(2_000_000),
  label: z.string().min(1).max(200).optional(),
});
export const SourceDocumentVersionSchema = z.object({
  documentId: IdSchema,
  version: z.number().int(),
  label: z.string(),
  authorId: IdSchema.nullable(),
  authorName: z.string(),
  createdAt: IsoDateSchema,
  sourceRevisionId: IdSchema.nullable(),
});
export type SourceDocumentVersion = z.infer<typeof SourceDocumentVersionSchema>;
export const SourceDocumentVersionsResponseSchema = z.object({
  items: z.array(SourceDocumentVersionSchema),
});
export const ASSET_MIMES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'] as const; // no SVG: script/foreignObject risk
export const ASSET_MAX_BYTES = 10 * 1024 * 1024;
export const AssetSchema = z.object({
  id: IdSchema,
  url: z.string(),
  mime: z.enum(ASSET_MIMES),
  size: z.number().int().positive(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type Asset = z.infer<typeof AssetSchema>;

/* ── Usage (W5) ────────────────────────────────────────────────────────── */
export const SearchLogRowSchema = z.object({
  id: IdSchema,
  userId: IdSchema.nullable(),
  userName: z.string().nullable(),
  q: z.string(),
  filters: z.record(z.unknown()),
  results: z.number().int().nonnegative(),
  tookMs: z.number().int().nonnegative(),
  at: IsoDateSchema,
});
export const SearchLogQuerySchema = PaginationQuerySchema.extend({
  zeroOnly: z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]).optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});
export const SearchLogResponseSchema = paginated(SearchLogRowSchema);
export const UsageAnalyticsQuerySchema = z.object({
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
  world: WorldSlugSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const UsageAnalyticsSchema = z.object({
  from: IsoDateSchema,
  to: IsoDateSchema,
  itemViews: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      docType: DocTypeSchema.nullable(),
      views: z.number().int(),
      viewers: z.number().int(),
      lastViewedAt: IsoDateSchema.nullable(),
    }),
  ),
  topItems: z.array(z.object({ documentId: IdSchema, title: z.string(), views: z.number().int() })),
  topTopics: z.array(
    z.object({
      topicId: IdSchema,
      name: z.string(),
      worldSlug: WorldSlugSchema,
      views: z.number().int(),
    }),
  ),
  viewers: z.array(z.object({ userId: IdSchema, displayName: z.string(), views: z.number().int() })),
  zeroResultTerms: z.array(z.object({ q: z.string(), count: z.number().int(), lastAt: IsoDateSchema })),
  staleness: z.array(
    z.object({
      documentId: IdSchema,
      title: z.string(),
      ownerName: z.string().nullable(),
      updatedAt: IsoDateSchema,
      publishedAt: IsoDateSchema.nullable(),
      daysSinceUpdate: z.number().int(),
    }),
  ),
});
export type UsageAnalytics = z.infer<typeof UsageAnalyticsSchema>;

/* ── Source autosave (W4 contract addition) ────────────────────────────── */
export const SourceDraftSchema = z.object({ html: z.string(), updatedAt: IsoDateSchema });
export const PutSourceDraftBodySchema = z.object({ html: z.string().max(2_000_000) });
