/**
 * Wave 5 contracts — learning & training (briefings, quizzes, assignments, completion,
 * knowledge refresh), approver workflow setting, knowledge-gap detection.
 * Routes: docs/superpowers/specs/2026-09-15-kb-wave5-learning-design.md §4.
 * Contract table: docs/api/CONTRACTS-wave5.md.
 */
import { z } from 'zod';
import { IdSchema, IsoDateSchema, PaginationQuerySchema, paginated } from './common.js';
import { PhaseSchema } from './content.js';

/** `app_settings.key` holding the wave 5 `WorkflowSettings` JSON. */
export const WORKFLOW_SETTINGS_KEY = 'workflow' as const;
/** A referenced document pinned at the version the learner saw (owner decision, spec §1.1). */
export const SourceVersionSchema = z.object({
  documentId: IdSchema,
  version: z.number().int().nonnegative(),
});
export type SourceVersion = z.infer<typeof SourceVersionSchema>;

/* ── learning items ─────────────────────────────────────────────────────── */
export const LearningKindSchema = z.enum(['briefing', 'quiz']);
export const LearningStatusSchema = z.enum(['draft', 'published', 'archived']);
export const BriefingEntrySchema = z.object({
  id: IdSchema.optional(),
  documentId: IdSchema,
  stepKey: z.string().nullable().default(null),
  note: z.string().default(''),
});
export const QuestionKindSchema = z.enum(['single', 'multi', 'order', 'free']);
export const QuestionOptionSchema = z.object({
  id: z.string().min(1),
  text: z.string().min(1),
  correct: z.boolean().default(false),
});
export const QuizQuestionSchema = z.object({
  id: IdSchema.optional(),
  documentId: IdSchema,
  stepKey: z.string().nullable().default(null),
  stem: z.string().min(1),
  kind: QuestionKindSchema,
  options: z.array(QuestionOptionSchema).default([]),
  explanation: z.string().default(''),
  generated: z.boolean().default(false),
  modelConf: z.number().min(0).max(1).nullable().default(null),
});
export const LearningItemSchema = z.object({
  id: IdSchema,
  kind: LearningKindSchema,
  title: z.string().min(1),
  description: z.string().default(''),
  worldSlug: z.string().nullable(),
  status: LearningStatusSchema,
  currentVersion: z.number().int().nonnegative(),
  passMark: z.number().int().min(1).max(100).nullable(),
  maxAttempts: z.number().int().min(1).max(10).nullable(),
  estimatedMinutes: z.number().int().min(1).nullable(),
  entries: z.array(BriefingEntrySchema).default([]),
  questions: z.array(QuizQuestionSchema).default([]),
  /** Document versions pinned by the last publish; empty while the item is still a draft. */
  sourceVersions: z.array(SourceVersionSchema).default([]),
  needsUpdate: z.boolean().default(false), // a referenced document is invalid/archived or changed significantly
  createdBy: IdSchema.nullable(),
  updatedAt: IsoDateSchema,
  publishedAt: IsoDateSchema.nullable(),
});
export const LearningItemCardSchema = LearningItemSchema.pick({
  id: true,
  kind: true,
  title: true,
  description: true,
  worldSlug: true,
  status: true,
  currentVersion: true,
  estimatedMinutes: true,
  needsUpdate: true,
  updatedAt: true,
  publishedAt: true,
}).extend({
  entryCount: z.number().int(),
  questionCount: z.number().int(),
  assignedUsers: z.number().int(),
  completionRate: z.number().min(0).max(1).nullable(),
});
export const LearningItemsQuerySchema = PaginationQuerySchema.extend({
  kind: LearningKindSchema.optional(),
  status: LearningStatusSchema.optional(),
  world: z.string().optional(),
  q: z.string().optional(),
});
export const LearningItemsResponseSchema = paginated(LearningItemCardSchema);
export const LearningItemCreateSchema = z.object({
  kind: LearningKindSchema,
  title: z.string().min(1),
  description: z.string().default(''),
  worldSlug: z.string().nullable().default(null),
  passMark: z.number().int().min(1).max(100).nullable().optional(),
  maxAttempts: z.number().int().min(1).max(10).nullable().optional(),
  estimatedMinutes: z.number().int().min(1).nullable().optional(),
});
export const LearningItemPatchSchema = LearningItemCreateSchema.omit({ kind: true }).partial();
export const PutEntriesBodySchema = z.object({ entries: z.array(BriefingEntrySchema).min(1) });
export const PutQuestionsBodySchema = z.object({ questions: z.array(QuizQuestionSchema).min(1) });
export const GenerateQuestionsBodySchema = z.object({
  documentIds: z.array(IdSchema).min(1).max(20),
  perDocument: z.number().int().min(1).max(10).default(3),
});
export const GenerateQuestionsResponseSchema = z.object({
  questions: z.array(QuizQuestionSchema),
  source: z.enum(['model', 'rules']),
  tookMs: z.number(),
});
export const LearningPublishBodySchema = z.object({ label: z.string().min(1).max(200) });
/** Response of `POST /learning/items/:id/assign` and of an audience's immediate resolution. */
export const AssignResultSchema = z.object({
  assigned: z.number().int(),
  /** Already assigned at this item version, so the call is idempotent for the caller. */
  skipped: z.number().int(),
});
export const LearningVersionSchema = z.object({
  version: z.number().int(),
  label: z.string(),
  authorName: z.string(),
  createdAt: IsoDateSchema,
  /** Snapshot of every referenced document's `current_version` at publish time (spec §3). */
  sourceVersions: z.array(SourceVersionSchema).default([]),
});
export const LearningVersionsResponseSchema = z.object({ items: z.array(LearningVersionSchema) });

/* ── audiences & assignments ────────────────────────────────────────────── */
export const AudienceSchema = z.object({
  id: IdSchema,
  itemId: IdSchema,
  roleNames: z.array(z.string()).default([]),
  worldSlugs: z.array(z.string()).default([]),
  userIds: z.array(IdSchema).default([]),
  dueDays: z.number().int().min(1).max(365).default(14),
  resolvedUsers: z.number().int().default(0),
  createdAt: IsoDateSchema,
});
export const AudienceCreateSchema = AudienceSchema.pick({
  roleNames: true,
  worldSlugs: true,
  userIds: true,
  dueDays: true,
});
export const AssignBodySchema = z.object({
  userIds: z.array(IdSchema).min(1).max(500),
  dueDays: z.number().int().min(1).max(365).optional(),
});
export const AssignmentStatusSchema = z.enum(['open', 'completed', 'overdue', 'invalidated']);
export const AssignmentReasonSchema = z.enum(['audience', 'manual', 'refresh']);
export const AssignmentSchema = z.object({
  id: IdSchema,
  itemId: IdSchema,
  itemVersion: z.number().int(),
  kind: LearningKindSchema,
  title: z.string(),
  worldSlug: z.string().nullable(),
  estimatedMinutes: z.number().int().nullable(),
  reason: AssignmentReasonSchema,
  status: AssignmentStatusSchema,
  assignedAt: IsoDateSchema,
  dueAt: IsoDateSchema,
  completedAt: IsoDateSchema.nullable(),
  attemptsUsed: z.number().int().default(0),
  maxAttempts: z.number().int().nullable(),
  lastScore: z.number().int().nullable(),
  passMark: z.number().int().nullable(),
  refreshReason: z.string().nullable().default(null),
});
export const MyLearningResponseSchema = z.object({
  open: z.array(AssignmentSchema),
  overdue: z.array(AssignmentSchema),
  completed: z.array(AssignmentSchema),
  invalidated: z.array(AssignmentSchema),
});
/**
 * Player payload: the item as the agent sees it (no correct flags on options).
 * `id` is required here even though it is optional on `QuizQuestionSchema` (drafts have
 * unsaved questions): the player keys its answer map by it.
 */
export const PlayerQuestionSchema = QuizQuestionSchema.omit({
  options: true,
  generated: true,
  modelConf: true,
}).extend({ id: IdSchema, options: z.array(QuestionOptionSchema.omit({ correct: true })) });
export const PlayerItemSchema = z.object({
  assignment: AssignmentSchema,
  item: LearningItemSchema.pick({
    id: true,
    kind: true,
    title: true,
    description: true,
    worldSlug: true,
    currentVersion: true,
    passMark: true,
    maxAttempts: true,
    estimatedMinutes: true,
  }),
  entries: z
    .array(
      BriefingEntrySchema.extend({
        documentTitle: z.string(),
        phases: z.array(PhaseSchema),
        changedSinceAssigned: z.boolean().default(false),
      }),
    )
    .default([]),
  questions: z.array(PlayerQuestionSchema).default([]),
});
export const AttemptAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionId: IdSchema,
      optionIds: z.array(z.string()).default([]),
      text: z.string().optional(),
    }),
  ),
});
/** 201 of `POST /learning/my/:assignmentId/attempts`; the answers then go to `PUT /learning/attempts/:id`. */
export const StartAttemptResponseSchema = z.object({
  attemptId: IdSchema,
  attemptNo: z.number().int(),
});
export const AttemptResultSchema = z.object({
  attemptId: IdSchema,
  score: z.number().int().min(0).max(100),
  passed: z.boolean(),
  attemptsLeft: z.number().int().nullable(),
  perQuestion: z.array(
    z.object({
      questionId: IdSchema,
      correct: z.boolean(),
      correctOptionIds: z.array(z.string()),
      explanation: z.string(),
    }),
  ),
});
export const CompletionRowSchema = z.object({
  userId: IdSchema,
  displayName: z.string(),
  worldSlugs: z.array(z.string()),
  status: AssignmentStatusSchema,
  dueAt: IsoDateSchema,
  completedAt: IsoDateSchema.nullable(),
  score: z.number().int().nullable(),
  attempts: z.number().int(),
});
export const CompletionResponseSchema = z.object({
  item: LearningItemCardSchema,
  rows: z.array(CompletionRowSchema),
  byWorld: z.array(
    z.object({
      worldSlug: z.string(),
      assigned: z.number().int(),
      completed: z.number().int(),
      overdue: z.number().int(),
    }),
  ),
});
export const LearningDashboardSchema = z.object({
  generatedAt: IsoDateSchema,
  totals: z.object({
    items: z.number().int(),
    assigned: z.number().int(),
    completed: z.number().int(),
    overdue: z.number().int(),
    refreshPending: z.number().int(),
  }),
  byWorld: z.array(
    z.object({
      worldSlug: z.string(),
      assigned: z.number().int(),
      completed: z.number().int(),
      overdue: z.number().int(),
      rate: z.number(),
    }),
  ),
  failedQuestions: z.array(
    z.object({
      questionId: IdSchema,
      itemId: IdSchema,
      itemTitle: z.string(),
      stem: z.string(),
      failRate: z.number(),
      attempts: z.number().int(),
    }),
  ),
  recentCompletions: z.array(
    z.object({
      userId: IdSchema,
      displayName: z.string(),
      itemTitle: z.string(),
      completedAt: IsoDateSchema,
      passed: z.boolean().nullable(),
    }),
  ),
});
export const DocumentLearningSchema = z.object({
  items: z.array(LearningItemCardSchema),
  refreshRequired: z.boolean(),
  /** The calling user's open refresh assignment for this document, so the banner links exactly. */
  refreshAssignmentId: IdSchema.nullable(),
  lastSignificantChange: z
    .object({ version: z.number().int(), at: IsoDateSchema, reasons: z.array(z.string()) })
    .nullable(),
});
export const ChangeFlagSchema = z.object({
  significant: z.boolean(),
  reasons: z.array(z.string()),
  affectedItems: z.number().int(),
  refreshAssignments: z.number().int(),
});

/* ── workflow settings, approver ────────────────────────────────────────── */
export const WorkflowSettingsSchema = z.object({
  requireApprover: z.boolean().default(false),
  learning: z.object({
    defaultPassMark: z.number().int().min(1).max(100).default(80),
    /** `null` = unlimited retakes, the owner's decision (spec §1.4); a cap needs no migration. */
    defaultMaxAttempts: z.number().int().min(1).max(10).nullable().default(null),
    refreshDueDays: z.number().int().min(1).max(90).default(7),
    reminderDaysBefore: z.number().int().min(0).max(30).default(2),
  }),
  gaps: z.object({
    zeroResultMin: z.number().int().min(1).default(3),
    feedbackClusterMin: z.number().int().min(1).default(3),
    staleDays: z.number().int().min(30).default(180),
    failedQuestionRate: z.number().min(0.1).max(1).default(0.5),
  }),
});
export const WorkflowSettingsPutSchema = WorkflowSettingsSchema.deepPartial();

/* ── knowledge gaps ─────────────────────────────────────────────────────── */
export const GapKindSchema = z.enum([
  'zero_results',
  'feedback_cluster',
  'stale_high_traffic',
  'topic_without_procedure',
  'failed_question',
]);
export const GapStatusSchema = z.enum(['open', 'dismissed', 'resolved']);
export const GapSchema = z.object({
  id: IdSchema,
  kind: GapKindSchema,
  key: z.string(),
  title: z.string(),
  score: z.number(),
  status: GapStatusSchema,
  evidence: z.record(z.unknown()),
  suggestedAction: z.enum(['create', 'update', 'add_question', 'review']),
  documentId: IdSchema.nullable(),
  topicId: IdSchema.nullable(),
  worldSlug: z.string().nullable(),
  firstSeenAt: IsoDateSchema,
  lastSeenAt: IsoDateSchema,
  dismissedReason: z.string().nullable(),
  resolvedDocumentId: IdSchema.nullable(),
});
export const GapsQuerySchema = PaginationQuerySchema.extend({
  kind: GapKindSchema.optional(),
  status: GapStatusSchema.default('open'),
  world: z.string().optional(),
});
export const GapsResponseSchema = paginated(GapSchema).extend({ lastRunAt: IsoDateSchema.nullable() });
export const GapDismissBodySchema = z.object({ reason: z.string().min(1).max(500) });
export const GapResolveBodySchema = z.object({ documentId: IdSchema });
export const GapDetectResultSchema = z.object({
  detected: z.number().int(),
  updated: z.number().int(),
  resolvedAutomatically: z.number().int(),
  tookMs: z.number(),
});

/* ── type aliases (one per exported schema; lanes V1–V6 import these) ────── */
export type LearningKind = z.infer<typeof LearningKindSchema>;
export type LearningStatus = z.infer<typeof LearningStatusSchema>;
export type BriefingEntry = z.infer<typeof BriefingEntrySchema>;
export type QuestionKind = z.infer<typeof QuestionKindSchema>;
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;
export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;
export type LearningItem = z.infer<typeof LearningItemSchema>;
export type LearningItemCard = z.infer<typeof LearningItemCardSchema>;
export type LearningItemsQuery = z.infer<typeof LearningItemsQuerySchema>;
export type LearningItemsResponse = z.infer<typeof LearningItemsResponseSchema>;
export type LearningItemCreate = z.infer<typeof LearningItemCreateSchema>;
export type LearningItemPatch = z.infer<typeof LearningItemPatchSchema>;
export type PutEntriesBody = z.infer<typeof PutEntriesBodySchema>;
export type PutQuestionsBody = z.infer<typeof PutQuestionsBodySchema>;
export type GenerateQuestionsBody = z.infer<typeof GenerateQuestionsBodySchema>;
export type GenerateQuestionsResponse = z.infer<typeof GenerateQuestionsResponseSchema>;
export type LearningPublishBody = z.infer<typeof LearningPublishBodySchema>;
export type AssignResult = z.infer<typeof AssignResultSchema>;
export type LearningVersion = z.infer<typeof LearningVersionSchema>;
export type LearningVersionsResponse = z.infer<typeof LearningVersionsResponseSchema>;
export type Audience = z.infer<typeof AudienceSchema>;
export type AudienceCreate = z.infer<typeof AudienceCreateSchema>;
export type AssignBody = z.infer<typeof AssignBodySchema>;
export type AssignmentStatus = z.infer<typeof AssignmentStatusSchema>;
export type AssignmentReason = z.infer<typeof AssignmentReasonSchema>;
export type Assignment = z.infer<typeof AssignmentSchema>;
export type MyLearningResponse = z.infer<typeof MyLearningResponseSchema>;
export type PlayerQuestion = z.infer<typeof PlayerQuestionSchema>;
export type PlayerItem = z.infer<typeof PlayerItemSchema>;
export type AttemptAnswers = z.infer<typeof AttemptAnswersSchema>;
export type StartAttemptResponse = z.infer<typeof StartAttemptResponseSchema>;
export type AttemptResult = z.infer<typeof AttemptResultSchema>;
export type CompletionRow = z.infer<typeof CompletionRowSchema>;
export type CompletionResponse = z.infer<typeof CompletionResponseSchema>;
export type LearningDashboard = z.infer<typeof LearningDashboardSchema>;
export type DocumentLearning = z.infer<typeof DocumentLearningSchema>;
export type ChangeFlag = z.infer<typeof ChangeFlagSchema>;
export type WorkflowSettings = z.infer<typeof WorkflowSettingsSchema>;
export type WorkflowSettingsPut = z.infer<typeof WorkflowSettingsPutSchema>;
export type GapKind = z.infer<typeof GapKindSchema>;
export type GapStatus = z.infer<typeof GapStatusSchema>;
export type Gap = z.infer<typeof GapSchema>;
export type GapsQuery = z.infer<typeof GapsQuerySchema>;
export type GapsResponse = z.infer<typeof GapsResponseSchema>;
export type GapDismissBody = z.infer<typeof GapDismissBodySchema>;
export type GapResolveBody = z.infer<typeof GapResolveBodySchema>;
export type GapDetectResult = z.infer<typeof GapDetectResultSchema>;

/* ── V1 additions (append-only) ─────────────────────────────────────────── */
/** V1 preview: the player payload without an assignment (managers previewing a draft or published item). */
export const LearningPreviewSchema = PlayerItemSchema.omit({ assignment: true });
export type LearningPreview = z.infer<typeof LearningPreviewSchema>;
/**
 * Response of `POST /learning/items/:id/publish`. The item itself is returned alongside the new
 * version number: the builder re-renders the item it just published (status, pinned
 * `sourceVersions`, the effective `passMark` the workflow settings filled in) without a second GET.
 */
export const LearningPublishResponseSchema = z.object({
  item: LearningItemSchema,
  version: z.number().int(),
});
export type LearningPublishResponse = z.infer<typeof LearningPublishResponseSchema>;
