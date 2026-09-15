/**
 * Wave 6 contracts — AI copilot: persisted chat, proposed source edits, the tool catalogue,
 * admin-editable AI settings (brief/style/models/limits), model tiers, and the offline
 * evaluation harness.
 *
 * Routes: docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md §4.
 * Contract table: docs/api/CONTRACTS-wave6.md. Lanes X1–X6 import these names verbatim.
 *
 * The additive suggestion fields (`affects`, `promptVersion`, `model`, `editDiff`,
 * `appliedParts`) and the structured per-type editors live in `pipeline.ts`, next to
 * `SuggestionSchema`, so nothing has to import two files to parse one suggestion.
 */
import { z } from 'zod';
import { IdSchema, IsoDateSchema, PaginationQuerySchema, paginated } from './common.js';
import { ParagraphDiffSchema } from './pipeline.js';

/* ── model tiers (spec §6) ───────────────────────────────────────────────── */

/**
 * A tier is *configuration*, not code: `MODEL_TIER=n` selects a row and every slot stays
 * individually overridable (`SUGGEST_MODEL`, `CHAT_MODEL`, `EMBED_MODEL`, `EMBED_DIMENSION`),
 * so moving the VM up a size is an env change and a reindex, never a deploy of new code.
 *
 * Tags are the Ollama library names X1 confirms against the VM at implementation time;
 * `POST /admin/ai/models/test` is what proves a tag exists before anyone selects the tier.
 */
export const ModelTierSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
]);
export type ModelTier = z.infer<typeof ModelTierSchema>;

export interface ModelTierPreset {
  tier: ModelTier;
  /** The VM shape the row is sized for; shown next to the selector on `/admin/ai`. */
  vm: string;
  suggestModel: string;
  chatModel: string;
  embedModel: string;
  embedDimension: number;
  /** Second choice for `suggestModel` when the first tag is not in the local library. */
  suggestFallback?: string;
  notes: string;
}

export const MODEL_TIER_PRESETS: Record<ModelTier, ModelTierPreset> = {
  0: {
    tier: 0,
    vm: '4 vCPU / 16 GB',
    suggestModel: 'qwen2.5:3b-instruct-q4_K_M',
    chatModel: 'qwen2.5:3b-instruct-q4_K_M',
    embedModel: 'nomic-embed-text',
    embedDimension: 768,
    notes: 'הבסיס הנוכחי — נשמר לצורכי השוואה בלבד',
  },
  1: {
    tier: 1,
    vm: '4 vCPU / 16 GB',
    suggestModel: 'dictalm2.0-instruct:7b-q4_K_M',
    chatModel: 'dictalm2.0-instruct:7b-q4_K_M',
    embedModel: 'bge-m3',
    embedDimension: 1024,
    suggestFallback: 'aya-expanse:8b-q4_K_M',
    notes: 'ברירת המחדל אחרי גל 6 — עברית מתמחה, ~6 GB זיכרון',
  },
  2: {
    tier: 2,
    vm: '8 vCPU / 32 GB',
    suggestModel: 'gemma3:12b-it-q4_K_M',
    chatModel: 'dictalm2.0-instruct:7b-q4_K_M',
    embedModel: 'bge-m3',
    embedDimension: 1024,
    suggestFallback: 'qwen2.5:14b-instruct-q4_K_M',
    notes: 'הסקת השפעה טובה יותר, ~10 GB זיכרון',
  },
  3: {
    tier: 3,
    vm: '16 vCPU / 64 GB',
    suggestModel: 'gemma3:27b-it-q4_K_M',
    chatModel: 'gemma3:12b-it-q4_K_M',
    embedModel: 'bge-m3',
    embedDimension: 1024,
    suggestFallback: 'aya-expanse:32b-q4_K_M',
    notes: 'העברית המקומית הטובה ביותר; צ׳אט איטי ללא GPU',
  },
  4: {
    tier: 4,
    vm: '16 vCPU / 64 GB + GPU 24 GB VRAM',
    suggestModel: 'gemma3:27b-it-q4_K_M',
    chatModel: 'gemma3:27b-it-q4_K_M',
    embedModel: 'bge-m3',
    embedDimension: 1024,
    notes: 'צ׳אט אינטראקטיבי (20–40 טוקן/שנייה)',
  },
};

/* ── conversations & messages (spec §3, §4.3) ────────────────────────────── */

export const ConversationKindSchema = z.enum(['workspace', 'editor', 'article']);
export type ConversationKind = z.infer<typeof ConversationKindSchema>;

export const ConversationSchema = z.object({
  id: IdSchema,
  kind: ConversationKindSchema,
  documentId: IdSchema.nullable().default(null),
  sourceRevisionId: IdSchema.nullable().default(null),
  userId: IdSchema,
  title: z.string().default(''),
  model: z.string().nullable().default(null),
  promptVersion: z.string().nullable().default(null),
  messageCount: z.number().int().nonnegative().default(0),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
});
export type Conversation = z.infer<typeof ConversationSchema>;

export const CreateConversationBodySchema = z.object({
  kind: ConversationKindSchema,
  documentId: IdSchema.nullable().optional(),
  sourceRevisionId: IdSchema.nullable().optional(),
  title: z.string().max(200).optional(),
});
export type CreateConversationBody = z.infer<typeof CreateConversationBodySchema>;

export const ConversationsQuerySchema = PaginationQuerySchema.extend({
  documentId: IdSchema.optional(),
  kind: ConversationKindSchema.optional(),
  /** Own conversations only. Default for everyone; `ai.manage` may set it false to see all. */
  mine: z.coerce.boolean().optional(),
  /** Admin transcript browser (`ai.manage`): filter by author and date window. */
  userId: IdSchema.optional(),
  from: IsoDateSchema.optional(),
  to: IsoDateSchema.optional(),
});
export type ConversationsQuery = z.infer<typeof ConversationsQuerySchema>;
export const ConversationsResponseSchema = paginated(ConversationSchema);
export type ConversationsResponse = z.infer<typeof ConversationsResponseSchema>;

export const MessageRoleSchema = z.enum(['user', 'assistant', 'tool', 'system']);
export type MessageRole = z.infer<typeof MessageRoleSchema>;

/** One model-issued tool call, persisted verbatim so a transcript export can replay it. */
export const AiToolCallSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  args: z.record(z.unknown()).default({}),
});
export type AiToolCall = z.infer<typeof AiToolCallSchema>;

export const AiToolResultSchema = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  summary: z.string().default(''),
  data: z.unknown().optional(),
});
export type AiToolResult = z.infer<typeof AiToolResultSchema>;

export const MessageFeedbackRatingSchema = z.enum(['up', 'down']);
export type MessageFeedbackRating = z.infer<typeof MessageFeedbackRatingSchema>;

export const AiMessageSchema = z.object({
  id: IdSchema,
  conversationId: IdSchema,
  seq: z.number().int().nonnegative(),
  role: MessageRoleSchema,
  content: z.string().default(''),
  toolCalls: z.array(AiToolCallSchema).default([]),
  toolResults: z.array(AiToolResultSchema).default([]),
  proposedEditsId: IdSchema.nullable().default(null),
  refinedSuggestionId: IdSchema.nullable().default(null),
  tokensIn: z.number().int().nonnegative().default(0),
  tokensOut: z.number().int().nonnegative().default(0),
  latencyMs: z.number().int().nonnegative().default(0),
  model: z.string().nullable().default(null),
  promptVersion: z.string().nullable().default(null),
  /** The caller's own rating, when they left one. */
  feedback: MessageFeedbackRatingSchema.nullable().default(null),
  createdAt: IsoDateSchema,
});
export type AiMessage = z.infer<typeof AiMessageSchema>;

export const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(AiMessageSchema).default([]),
});
export type ConversationDetail = z.infer<typeof ConversationDetailSchema>;

/**
 * Context the pane already knows and the server must not have to guess: which step the
 * editor is standing on, which suggestion card is open, and the text the user highlighted.
 * `selection` is capped well under `ai.limits.maxContextChars` so one paste cannot eat the
 * whole prompt budget.
 */
export const SendMessageContextSchema = z.object({
  stepKey: z.string().max(200).optional(),
  suggestionId: IdSchema.optional(),
  selection: z.string().max(4000).optional(),
});
export type SendMessageContext = z.infer<typeof SendMessageContextSchema>;

export const SendMessageBodySchema = z.object({
  content: z.string().min(1).max(8000),
  context: SendMessageContextSchema.optional(),
});
export type SendMessageBody = z.infer<typeof SendMessageBodySchema>;

export const MessageFeedbackBodySchema = z.object({
  rating: MessageFeedbackRatingSchema,
  note: z.string().max(2000).optional(),
});
export type MessageFeedbackBody = z.infer<typeof MessageFeedbackBodySchema>;

/* ── proposed source edits (owner decision §1.3) ─────────────────────────── */

export const ProposedEditKindSchema = z.enum(['replace', 'insert', 'delete']);
export type ProposedEditKind = z.infer<typeof ProposedEditKindSchema>;

/**
 * One hunk. `anchor` is the same paragraph anchor the suggestion pipeline uses, so the
 * source editor can render the hunk where the text actually is; `before` is kept so the
 * editor can show a real diff and the apply path can refuse a hunk whose text moved.
 */
export const ProposedEditOpSchema = z.object({
  id: z.string().min(1),
  anchor: z.string(),
  kind: ProposedEditKindSchema,
  before: z.string(),
  after: z.string(),
});
export type ProposedEditOp = z.infer<typeof ProposedEditOpSchema>;

export const ProposedEditsStatusSchema = z.enum(['proposed', 'accepted', 'rejected', 'partially_accepted']);
export type ProposedEditsStatus = z.infer<typeof ProposedEditsStatusSchema>;

export const ProposedEditsSchema = z.object({
  id: IdSchema,
  messageId: IdSchema,
  documentId: IdSchema,
  /** The source version the model saw; the apply path sends it as `If-Match` (409 `SOURCE_MOVED`). */
  baseSourceVersion: z.number().int().nonnegative(),
  ops: z.array(ProposedEditOpSchema).default([]),
  status: ProposedEditsStatusSchema,
  decidedBy: IdSchema.nullable().optional(),
  decidedAt: IsoDateSchema.nullable().optional(),
  resultingSourceVersion: z.number().int().nullable().optional(),
});
export type ProposedEdits = z.infer<typeof ProposedEditsSchema>;

const opIdsOrAll = z.union([z.array(z.string().min(1)), z.literal('all')]);
export const DecideProposedEditsBodySchema = z.object({
  accept: opIdsOrAll.default([]),
  reject: opIdsOrAll.default([]),
});
export type DecideProposedEditsBody = z.infer<typeof DecideProposedEditsBodySchema>;

export const DecideProposedEditsResultSchema = z.object({
  status: ProposedEditsStatusSchema,
  /** `null` when nothing was accepted, so no source save happened. */
  resultingSourceVersion: z.number().int().nullable(),
});
export type DecideProposedEditsResult = z.infer<typeof DecideProposedEditsResultSchema>;

/* ── the SSE stream (spec §4.3) ──────────────────────────────────────────── */

/**
 * Every frame `POST /ai/conversations/:id/messages` writes. The stream is the only place
 * tokens appear; the message row is written as it streams, so a dropped connection loses
 * the rendering, never the transcript.
 */
export const ChatEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('token'), text: z.string() }),
  z.object({
    type: z.literal('tool_call'),
    id: z.string().min(1),
    name: z.string().min(1),
    args: z.record(z.unknown()).default({}),
  }),
  z.object({
    type: z.literal('tool_result'),
    id: z.string().min(1),
    ok: z.boolean(),
    summary: z.string().default(''),
  }),
  z.object({
    type: z.literal('proposed_edits'),
    proposedEditsId: IdSchema,
    ops: z.array(ProposedEditOpSchema),
  }),
  z.object({
    type: z.literal('refined_suggestion'),
    suggestionId: IdSchema,
    /** The suggestion payload the model rewrote; the user still has to accept it (§1.3). */
    editedPayload: z.unknown(),
  }),
  z.object({
    type: z.literal('done'),
    messageId: IdSchema,
    tokensIn: z.number().int().nonnegative(),
    tokensOut: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
  }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);
export type ChatEvent = z.infer<typeof ChatEventSchema>;
export type ChatEventType = ChatEvent['type'];

/* ── the tool catalogue (spec §4.3) ──────────────────────────────────────── */

/** Which permission a tool needs. The tiers nest: `chat` includes `ask`, `manage` includes both. */
export const AiToolTierSchema = z.enum(['ask', 'chat', 'manage']);
export type AiToolTier = z.infer<typeof AiToolTierSchema>;

export interface AiToolSpec {
  name: string;
  tier: AiToolTier;
  /** Hebrew, because it is shown in the chat pane's "מה המערכת עשתה" line. */
  label: string;
  /** Whether the tool can change anything. No `ask` tool may ever be `writes: true`. */
  writes: boolean;
}

/**
 * Append-only, like `PERMISSIONS`: a transcript records tool names and an export replays
 * them, so a name that changes breaks stored history.
 */
export const AI_TOOLS = [
  { name: 'read_document', tier: 'ask', label: 'קריאת מסמך', writes: false },
  { name: 'read_topic', tier: 'ask', label: 'קריאת נושא', writes: false },
  { name: 'search_kb', tier: 'ask', label: 'חיפוש בבסיס הידע', writes: false },
  { name: 'explain_step', tier: 'ask', label: 'הסבר שלב', writes: false },
  { name: 'read_source', tier: 'chat', label: 'קריאת מסמך מקור', writes: false },
  { name: 'read_impact', tier: 'chat', label: 'בדיקת השפעה', writes: false },
  { name: 'list_suggestions', tier: 'chat', label: 'רשימת הצעות', writes: false },
  { name: 'propose_source_edit', tier: 'chat', label: 'הצעת עריכה למקור', writes: false },
  { name: 'refine_suggestion', tier: 'chat', label: 'חידוד הצעה', writes: false },
  { name: 'review_document', tier: 'chat', label: 'סקירת מסמך', writes: false },
  { name: 'draft_step', tier: 'chat', label: 'טיוטת שלב', writes: false },
  { name: 'read_eval', tier: 'manage', label: 'תוצאות הערכה', writes: false },
] as const satisfies readonly AiToolSpec[];

export type AiToolName = (typeof AI_TOOLS)[number]['name'];
export const AI_TOOL_NAMES = AI_TOOLS.map((t) => t.name) as readonly AiToolName[];
export const AiToolNameSchema = z.enum(AI_TOOL_NAMES as unknown as [AiToolName, ...AiToolName[]]);

/**
 * The tool set for a caller, in catalogue order. Nothing here is a write tool: even
 * `propose_source_edit` only *returns* hunks — applying them is a separate, human decision
 * (`POST /ai/proposed-edits/:id/decide`), which is owner decision §1.3.
 */
export const toolsFor = (permissions: ReadonlySet<string>): AiToolName[] => {
  const manage = permissions.has('ai.manage');
  const chat = manage || permissions.has('ai.chat');
  const ask = chat || permissions.has('ai.ask');
  const tiers = new Set<AiToolTier>();
  if (ask) tiers.add('ask');
  if (chat) tiers.add('chat');
  if (manage) tiers.add('manage');
  return AI_TOOLS.filter((t) => tiers.has(t.tier)).map((t) => t.name);
};

/* ── AI settings (spec §1.7, §3) ─────────────────────────────────────────── */

/** `app_settings.key`s this wave owns; 0050 seeds each with `{}` so defaults apply. */
export const AI_SETTINGS_KEYS = ['ai.brief', 'ai.style', 'ai.models', 'ai.limits'] as const;
export type AiSettingsKey = (typeof AI_SETTINGS_KEYS)[number];

/** A versioned free-text block (the company brief, the style rules). */
export const AiTextSettingSchema = z.object({
  text: z.string().default(''),
  /** Bumped by `putAiSettings` on every change; part of the prompt version. */
  version: z.number().int().nonnegative().default(0),
});
export type AiTextSetting = z.infer<typeof AiTextSettingSchema>;

export const AiModelsSettingsSchema = z.object({
  tier: ModelTierSchema.default(1),
  suggestModel: z.string().default(MODEL_TIER_PRESETS[1].suggestModel),
  chatModel: z.string().default(MODEL_TIER_PRESETS[1].chatModel),
  embedModel: z.string().default(MODEL_TIER_PRESETS[1].embedModel),
  embedDimension: z.number().int().min(1).default(MODEL_TIER_PRESETS[1].embedDimension),
});
export type AiModelsSettings = z.infer<typeof AiModelsSettingsSchema>;

export const AiLimitsSettingsSchema = z.object({
  chatPerUserPerHour: z.number().int().min(1).max(10000).default(60),
  maxContextChars: z.number().int().min(1000).max(1_000_000).default(24000),
});
export type AiLimitsSettings = z.infer<typeof AiLimitsSettingsSchema>;

export const AiSettingsSchema = z.object({
  brief: AiTextSettingSchema.default({}),
  style: AiTextSettingSchema.default({}),
  models: AiModelsSettingsSchema.default({}),
  limits: AiLimitsSettingsSchema.default({}),
});
export type AiSettings = z.infer<typeof AiSettingsSchema>;

/** A patch: everything omitted keeps its stored value (deep merge in `putAiSettings`). */
export const AiSettingsPutSchema = z.object({
  brief: z.object({ text: z.string() }).partial().optional(),
  style: z.object({ text: z.string() }).partial().optional(),
  models: AiModelsSettingsSchema.partial().optional(),
  limits: AiLimitsSettingsSchema.partial().optional(),
});
export type AiSettingsPut = z.infer<typeof AiSettingsPutSchema>;

export const AiSettingVersionSchema = z.object({
  key: z.enum(AI_SETTINGS_KEYS),
  version: z.number().int().nonnegative(),
  value: z.unknown(),
  updatedBy: IdSchema.nullable(),
  updatedAt: IsoDateSchema,
});
export type AiSettingVersion = z.infer<typeof AiSettingVersionSchema>;
export const AiSettingVersionsResponseSchema = z.object({
  items: z.array(AiSettingVersionSchema),
});
export type AiSettingVersionsResponse = z.infer<typeof AiSettingVersionsResponseSchema>;

export const ModelSlotSchema = z.enum(['suggest', 'chat', 'embed']);
export type ModelSlot = z.infer<typeof ModelSlotSchema>;
export const ModelTestBodySchema = z.object({ slot: ModelSlotSchema });
export type ModelTestBody = z.infer<typeof ModelTestBodySchema>;
export const ModelTestResultSchema = z.object({
  slot: ModelSlotSchema,
  tag: z.string(),
  reachable: z.boolean(),
  sizeBytes: z.number().int().nonnegative().optional(),
  /** Embedding slot only: the width the model actually returns. */
  dims: z.number().int().positive().optional(),
  tokensPerSec: z.number().nonnegative().optional(),
  error: z.string().optional(),
});
export type ModelTestResult = z.infer<typeof ModelTestResultSchema>;

/* ── offline evaluation (spec §1.9) ──────────────────────────────────────── */

export const EvalLinkedStepSchema = z.object({
  documentId: IdSchema,
  documentTitle: z.string(),
  stepKey: z.string(),
  stepNum: z.string(),
  stepTitle: z.string(),
  anchor: z.string(),
  actions: z.array(z.string()).default([]),
  blockId: IdSchema.optional(),
});
export type EvalLinkedStep = z.infer<typeof EvalLinkedStepSchema>;

export const EvalExpectationSchema = z.object({
  type: z.string(),
  targetDocumentId: IdSchema.optional(),
  targetStepKey: z.string().optional(),
  mustContain: z.array(z.string()).default([]),
});
export type EvalExpectation = z.infer<typeof EvalExpectationSchema>;

/**
 * A committed fixture (`packages/model/eval/cases/*.json`), not a database row: the eval set
 * is reviewed like code and scored across model tiers and prompt versions.
 */
export const EvalCaseSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  source: z.object({ title: z.string(), singleDocument: z.boolean().optional() }),
  diffs: z.array(ParagraphDiffSchema).default([]),
  linkedSteps: z.array(EvalLinkedStepSchema).default([]),
  blocks: z
    .array(z.object({ id: IdSchema, title: z.string(), actions: z.array(z.string()).default([]) }))
    .default([]),
  fields: z.array(z.object({ name: z.string(), status: z.string() })).default([]),
  expected: z.array(EvalExpectationSchema).default([]),
});
export type EvalCase = z.infer<typeof EvalCaseSchema>;

export const EvalRunSchema = z.object({
  id: IdSchema,
  model: z.string(),
  promptVersion: z.string(),
  embedModel: z.string(),
  startedAt: IsoDateSchema,
  finishedAt: IsoDateSchema.nullable().default(null),
  cases: z.number().int().nonnegative().default(0),
  /** Share of cases whose suggestion pointed at the expected step. */
  hitTarget: z.number().min(0).max(1).default(0),
  hitType: z.number().min(0).max(1).default(0),
  contentOverlap: z.number().min(0).max(1).default(0),
  notes: z.string().default(''),
});
export type EvalRun = z.infer<typeof EvalRunSchema>;
export const EvalRunsResponseSchema = z.object({ items: z.array(EvalRunSchema) });
export type EvalRunsResponse = z.infer<typeof EvalRunsResponseSchema>;
