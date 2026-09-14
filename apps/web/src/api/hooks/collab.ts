/**
 * Stage 5 collaboration surface: notifications, comments + mentions, the review workflow,
 * saved views, templates, presence, bulk document actions and telemetry.
 *
 * Every call goes through `src/api/stage45.ts`, which validates the response against the
 * `@wecom/shared` zod contract these routes are being built to (`docs/api/CONTRACTS-stage4-5.md`).
 */
import { useEffect, useMemo, useRef } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  BulkResultSchema,
  CommentSchema,
  MentionCandidateSchema,
  NotificationsResponseSchema,
  PresenceSchema,
  ReviewQueueResponseSchema,
  ReviewRequestSchema,
  SavedViewSchema,
  TemplateSchema,
  type BulkDocumentsBodySchema,
  type CommentBodySchema,
  type RequestReviewBodySchema,
  type ReviewDecisionBodySchema,
  type SavedViewBodySchema,
  type TelemetryEventSchema,
  type TemplateBodySchema,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { stageJson, stageVoid } from '../stage45.js';

export type Notification = z.infer<typeof NotificationsResponseSchema>['items'][number];
export type MentionCandidate = z.infer<typeof MentionCandidateSchema>;
export type Comment = z.infer<typeof CommentSchema>;
export type ReviewRequest = z.infer<typeof ReviewRequestSchema>;
export type ReviewRow = z.infer<typeof ReviewQueueResponseSchema>['items'][number];
export type SavedView = z.infer<typeof SavedViewSchema>;
export type SavedViewBody = z.input<typeof SavedViewBodySchema>;
export type Template = z.infer<typeof TemplateSchema>;
export type TemplateBody = z.input<typeof TemplateBodySchema>;
export type Presence = z.infer<typeof PresenceSchema>;
export type BulkBody = z.input<typeof BulkDocumentsBodySchema>;
export type CommentBody = z.input<typeof CommentBodySchema>;
export type RequestReviewBody = z.input<typeof RequestReviewBodySchema>;
export type ReviewDecisionBody = z.input<typeof ReviewDecisionBodySchema>;
export type TelemetryEvent = z.input<typeof TelemetryEventSchema>;

const items = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

/* ── notifications ──────────────────────────────────────────────────────── */

export const useNotifications = (q: { unread?: boolean; page?: number; pageSize?: number } = {}) =>
  useQuery({
    queryKey: keys.notifications(q),
    placeholderData: keepPreviousData,
    queryFn: () => stageJson(NotificationsResponseSchema, '/notifications', { query: q }),
  });

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) =>
      stageJson(z.object({ unread: z.number().int() }), '/notifications/read', {
        method: 'POST',
        body,
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/* ── comments & mentions ────────────────────────────────────────────────── */

export const useComments = (documentId: string | undefined) =>
  useQuery({
    queryKey: keys.comments(documentId ?? ''),
    enabled: !!documentId,
    queryFn: () => stageJson(items(CommentSchema), `/documents/${documentId!}/comments`).then((r) => r.items),
  });

/**
 * `@` autocomplete. Idle until the user has typed something after the `@`, unless `always` is
 * set — the review-request dialog lists every candidate up front, with no `@` to trigger on.
 */
export const useMentionable = (q: string, always = false) =>
  useQuery({
    queryKey: keys.mentionable(q),
    enabled: always || q.length > 0,
    staleTime: 30_000,
    queryFn: () =>
      stageJson(items(MentionCandidateSchema), '/users/mentionable', { query: { q } }).then((r) => r.items),
  });

export function useAddComment(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CommentBody) =>
      stageJson(CommentSchema, `/documents/${documentId}/comments`, { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.comments(documentId) }),
  });
}

export function useCommentAction(documentId: string) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.comments(documentId) });
  return {
    resolve: useMutation({
      mutationFn: (id: string) => stageJson(CommentSchema, `/comments/${id}/resolve`, { method: 'POST' }),
      onSuccess: invalidate,
    }),
    like: useMutation({
      mutationFn: (id: string) => stageJson(CommentSchema, `/comments/${id}/like`, { method: 'POST' }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => stageVoid(`/comments/${id}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

/* ── review workflow ────────────────────────────────────────────────────── */

export function useRequestReview(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RequestReviewBody) =>
      stageJson(ReviewRequestSchema, `/documents/${documentId}/request-review`, { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: keys.doc(documentId) });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

export function useReviewDecision() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ documentId, ...body }: ReviewDecisionBody & { documentId: string }) =>
      stageJson(ReviewRequestSchema, `/documents/${documentId}/review-decision`, { method: 'POST', body }),
    onSuccess: (_r, { documentId }) => {
      void qc.invalidateQueries({ queryKey: keys.doc(documentId) });
      void qc.invalidateQueries({ queryKey: keys.versions(documentId) });
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: ['reviews'] });
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}

export const useReviews = (q: { status?: 'open' | 'approved' | 'changes'; page?: number } = {}) =>
  useQuery({
    queryKey: keys.reviews(q),
    placeholderData: keepPreviousData,
    queryFn: () => stageJson(ReviewQueueResponseSchema, '/reviews', { query: q }),
  });

/* ── saved views ────────────────────────────────────────────────────────── */

export const useViews = () =>
  useQuery({
    queryKey: keys.views,
    staleTime: 30_000,
    queryFn: () => stageJson(items(SavedViewSchema), '/views').then((r) => r.items),
  });

export function useSaveView() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.views });
  return {
    create: useMutation({
      mutationFn: (body: SavedViewBody) => stageJson(SavedViewSchema, '/views', { method: 'POST', body }),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: ({ id, ...body }: Partial<SavedViewBody> & { id: string }) =>
        stageJson(SavedViewSchema, `/views/${id}`, { method: 'PATCH', body }),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: (id: string) => stageVoid(`/views/${id}`, { method: 'DELETE' }),
      onSuccess: invalidate,
    }),
  };
}

/* ── templates ──────────────────────────────────────────────────────────── */

export const useTemplates = () =>
  useQuery({
    queryKey: keys.templates,
    staleTime: 60_000,
    queryFn: () => stageJson(items(TemplateSchema), '/templates').then((r) => r.items),
  });

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TemplateBody) => stageJson(TemplateSchema, '/templates', { method: 'POST', body }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.templates }),
  });
}

/* ── presence ───────────────────────────────────────────────────────────── */

const HEARTBEAT_MS = 20_000;

/**
 * Who else has this document open. The heartbeat is every 20 s against a 30 s server TTL, so a
 * closed tab drops out of the list within one interval instead of lingering as a phantom editor.
 */
export function usePresence(documentId: string | undefined, enabled = true): Presence['editors'] {
  const qc = useQueryClient();
  const on = !!documentId && enabled;
  const q = useQuery({
    queryKey: keys.presence(documentId ?? ''),
    enabled: on,
    refetchInterval: on ? HEARTBEAT_MS : false,
    queryFn: () => stageJson(PresenceSchema, `/documents/${documentId!}/presence`),
  });

  const beat = useRef<() => void>(() => {});
  beat.current = () => {
    if (!documentId) return;
    void stageVoid(`/documents/${documentId}/presence`, { method: 'POST' }).catch(() => {});
  };

  useEffect(() => {
    if (!on) return;
    beat.current();
    const t = setInterval(() => beat.current(), HEARTBEAT_MS);
    return () => {
      clearInterval(t);
      if (documentId) qc.removeQueries({ queryKey: keys.presence(documentId) });
    };
  }, [on, documentId, qc]);

  return useMemo(() => q.data?.editors ?? [], [q.data]);
}

/* ── bulk document actions ──────────────────────────────────────────────── */

export function useBulkDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: BulkBody) => stageJson(BulkResultSchema, '/documents/bulk', { method: 'POST', body }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['documents'] });
      void qc.invalidateQueries({ queryKey: keys.trash });
      void qc.invalidateQueries({ queryKey: ['reviews'] });
    },
  });
}

/* ── telemetry ──────────────────────────────────────────────────────────── */

/**
 * Batched: outcome picks fire once per keypress during a call, and one request per keypress on a
 * LAN VM that also runs the model is exactly the traffic this app should not generate. Events are
 * buffered and flushed every 10 s, on unmount, and on `beforeunload`; a failed flush is dropped
 * rather than retried — usage analytics must never be able to break the call the agent is on.
 */
const FLUSH_MS = 10_000;

export function useTelemetry(): (e: TelemetryEvent) => void {
  const buffer = useRef<TelemetryEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef<() => void>(() => {});
  flush.current = () => {
    const events = buffer.current;
    if (!events.length) return;
    buffer.current = [];
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    void stageVoid('/telemetry', { method: 'POST', body: { events } }).catch(() => {});
  };

  useEffect(() => {
    const onUnload = () => flush.current();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      window.removeEventListener('beforeunload', onUnload);
      flush.current();
    };
  }, []);

  return useMemo(
    () => (e: TelemetryEvent) => {
      buffer.current.push({ at: new Date().toISOString(), ...e });
      // 200 is the contract's per-batch maximum; flush early rather than drop.
      if (buffer.current.length >= 200) {
        flush.current();
        return;
      }
      if (!timer.current) timer.current = setTimeout(() => flush.current(), FLUSH_MS);
    },
    [],
  );
}
