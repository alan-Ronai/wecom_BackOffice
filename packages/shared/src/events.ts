import { z } from 'zod';
import { IdSchema, IsoDateSchema } from './schemas/common.js';
import { NotificationKindSchema } from './schemas/stage45.js';

export const EVENTS = [
  'document.published',
  'document.updated',
  'document.deleted',
  'suggestion.created',
  'suggestion.decided',
  'sync.completed',
  'sync.conflict',
  'job.failed',
  'system.status',
  // Stage 5 — collaboration (additive; every earlier consumer ignores names it does not know).
  'notification.created',
  'comment.created',
  'review.requested',
  'review.decided',
  'presence.changed',
  // Wave 4 — feedback, source documents, taxonomy (additive; appended, never reordered).
  'feedback.created',
  'feedback.updated',
  'source_document.saved',
  'taxonomy.changed',
  // Wave 5 — learning & gaps (additive; appended, never reordered).
  'learning.assigned',
  'learning.completed',
  'learning.refresh_required',
  'gap.detected',
  // pipeline fan-out — a sync link that already points elsewhere is kept, never re-pointed.
  'sync.link_skipped',
  // Wave 6 — AI copilot. Appended, never reordered.
  'ai.message',
] as const;
export type EventName = (typeof EVENTS)[number];

const payloads = {
  'document.published': z.object({
    documentId: IdSchema,
    version: z.number().int(),
    actorId: IdSchema.nullable(),
  }),
  'document.updated': z.object({
    documentId: IdSchema,
    actorId: IdSchema.nullable(),
    etag: z.string().optional(),
  }),
  'document.deleted': z.object({
    documentId: IdSchema,
    actorId: IdSchema.nullable(),
    restoredUntil: IsoDateSchema,
  }),
  'suggestion.created': z.object({
    suggestionId: IdSchema,
    sourceId: IdSchema,
    targetDocumentId: IdSchema.nullable(),
    type: z.string(),
  }),
  'suggestion.decided': z.object({
    suggestionId: IdSchema,
    status: z.enum(['accepted', 'rejected', 'applied', 'pending']),
    actorId: IdSchema.nullable(),
  }),
  'sync.completed': z.object({
    connectorId: IdSchema,
    imported: z.number().int(),
    pushed: z.number().int(),
    conflicts: z.number().int(),
  }),
  'sync.conflict': z.object({ connectorId: IdSchema, documentId: IdSchema, externalId: z.string() }),
  'job.failed': z.object({ jobName: z.string(), jobId: z.string(), error: z.string() }),
  'system.status': z.object({
    db: z.boolean(),
    model: z.boolean(),
    queue: z.number().int(),
    connectors: z.record(z.boolean()),
  }),
  /* ── Stage 5: collaboration ──────────────────────────────────────────── */
  /** Fan-out is per recipient: the web filters on `userId` before it touches the bell. */
  'notification.created': z.object({
    notificationId: IdSchema,
    userId: IdSchema,
    // Referenced rather than repeated: the bell and the event have to widen together, and
    // this list had already drifted from `NotificationKindSchema` once.
    kind: NotificationKindSchema,
    title: z.string(),
  }),
  'comment.created': z.object({
    commentId: IdSchema,
    documentId: IdSchema,
    stepKey: z.string().nullable(),
    authorId: IdSchema,
  }),
  'review.requested': z.object({
    reviewRequestId: IdSchema,
    documentId: IdSchema,
    requestedBy: IdSchema,
  }),
  'review.decided': z.object({
    reviewRequestId: IdSchema,
    documentId: IdSchema,
    decision: z.enum(['approve', 'changes']),
    decidedBy: IdSchema,
  }),
  /** `editors` is the live count after the change, so a badge needs no extra fetch. */
  'presence.changed': z.object({
    documentId: IdSchema,
    userId: IdSchema,
    editors: z.number().int().nonnegative(),
  }),
  /* ── Wave 4: feedback, source documents, taxonomy ────────────────────── */
  'feedback.created': z.object({ feedbackId: IdSchema, documentId: IdSchema, kind: z.string() }),
  'feedback.updated': z.object({ feedbackId: IdSchema, documentId: IdSchema, status: z.string() }),
  'source_document.saved': z.object({
    documentId: IdSchema,
    version: z.number().int(),
    actorId: IdSchema.nullable(),
  }),
  'taxonomy.changed': z.object({ entity: z.enum(['world', 'topic']), id: IdSchema }),
  /* ── Wave 5: learning & knowledge gaps ───────────────────────────────── */
  'learning.assigned': z.object({ assignmentId: IdSchema, userId: IdSchema, itemId: IdSchema }),
  'learning.completed': z.object({
    assignmentId: IdSchema,
    userId: IdSchema,
    itemId: IdSchema,
    passed: z.boolean(),
  }),
  /** Raised once per significant publish; `affectedUsers` is the refresh-assignment count. */
  'learning.refresh_required': z.object({
    documentId: IdSchema,
    version: z.number().int(),
    affectedUsers: z.number().int(),
  }),
  'gap.detected': z.object({ gapId: IdSchema, kind: z.string() }),
  /**
   * `afterSuggestionsApplied` found a link for this (connector, external item) that already
   * points at another document and left it alone. `documentId` is the one the link keeps;
   * `skippedDocumentId` is the document that would silently have taken it over — and whose
   * predecessor would then have been orphaned from sync and from the source-document flow.
   */
  'sync.link_skipped': z.object({
    connectorId: IdSchema,
    externalId: z.string(),
    documentId: IdSchema,
    skippedDocumentId: IdSchema,
  }),
  /* ── Wave 6: AI copilot ──────────────────────────────────────────────── */
  /**
   * One assistant message finished streaming. Fan-out is **per user** (`userId`), like
   * `notification.created`: a transcript is the author's, and a chat pane open in another
   * tab is the only thing that needs to know a message landed.
   */
  'ai.message': z.object({ conversationId: IdSchema, messageId: IdSchema, userId: IdSchema }),
} as const;
export type EventPayloads = { [K in EventName]: z.infer<(typeof payloads)[K]> };

export const EventSchema = z.discriminatedUnion(
  'name',
  EVENTS.map((name) =>
    z.object({ name: z.literal(name), payload: payloads[name], at: IsoDateSchema }),
  ) as unknown as [
    z.ZodObject<{ name: z.ZodLiteral<EventName>; payload: z.ZodTypeAny; at: z.ZodString }>,
    ...z.ZodObject<{ name: z.ZodLiteral<EventName>; payload: z.ZodTypeAny; at: z.ZodString }>[],
  ],
);
export type Event = { [K in EventName]: { name: K; payload: EventPayloads[K]; at: string } }[EventName];

export const makeEvent = <K extends EventName>(
  name: K,
  payload: EventPayloads[K],
): Extract<Event, { name: K }> =>
  ({ name, payload, at: new Date().toISOString() }) as Extract<Event, { name: K }>;
export const eventPayloadSchema = <K extends EventName>(name: K) => payloads[name];
