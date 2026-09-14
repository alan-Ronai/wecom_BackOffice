import { z } from 'zod';
import { IdSchema, IsoDateSchema } from './schemas/common.js';

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
    kind: z.enum(['suggestion', 'sync', 'mention', 'review', 'publish', 'system']),
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
