/**
 * Stage 5 collaboration surface: notifications, comments + mentions, the review workflow,
 * saved views, templates, presence, bulk document actions and telemetry.
 *
 * Transport and types are the generated client (`api`, from `docs/api/openapi.json`), like the
 * rest of the app. Each response is then parsed by `checked` against the `@wecom/shared` zod
 * schema the route validates with (`docs/api/CONTRACTS-stage4-5.md`), so the contract is enforced
 * at compile time *and* at runtime — see `src/api/stage45.ts`.
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
import { api, API_BASE } from '../client.js';
import { unwrap } from '../unwrap.js';
import { checked } from '../stage45.js';
import { beaconJson, useUnloadFlush } from '../../lib/unloadFlush.js';

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
    queryFn: async () =>
      checked(NotificationsResponseSchema, await api.GET('/notifications', { params: { query: q } })),
  });

export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: { ids?: string[]; all?: boolean }) =>
      checked(z.object({ unread: z.number().int() }), await api.POST('/notifications/read', { body })),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}

/* ── comments & mentions ────────────────────────────────────────────────── */

export const useComments = (documentId: string | undefined) =>
  useQuery({
    queryKey: keys.comments(documentId ?? ''),
    enabled: !!documentId,
    queryFn: async () =>
      checked(
        items(CommentSchema),
        await api.GET('/documents/{id}/comments', { params: { path: { id: documentId! } } }),
      ).items,
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
    queryFn: async () =>
      checked(
        items(MentionCandidateSchema),
        await api.GET('/users/mentionable', { params: { query: { q } } }),
      ).items,
  });

export function useAddComment(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CommentBody) =>
      checked(
        CommentSchema,
        await api.POST('/documents/{id}/comments', { params: { path: { id: documentId } }, body }),
      ),
    onSuccess: () => void qc.invalidateQueries({ queryKey: keys.comments(documentId) }),
  });
}

export function useCommentAction(documentId: string) {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.comments(documentId) });
  return {
    resolve: useMutation({
      mutationFn: async (id: string) =>
        checked(CommentSchema, await api.POST('/comments/{id}/resolve', { params: { path: { id } } })),
      onSuccess: invalidate,
    }),
    like: useMutation({
      mutationFn: async (id: string) =>
        checked(CommentSchema, await api.POST('/comments/{id}/like', { params: { path: { id } } })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        unwrap(await api.DELETE('/comments/{id}', { params: { path: { id } } }));
      },
      onSuccess: invalidate,
    }),
  };
}

/* ── review workflow ────────────────────────────────────────────────────── */

export function useRequestReview(documentId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: RequestReviewBody) =>
      checked(
        ReviewRequestSchema,
        await api.POST('/documents/{id}/request-review', { params: { path: { id: documentId } }, body }),
      ),
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
    mutationFn: async ({ documentId, ...body }: ReviewDecisionBody & { documentId: string }) =>
      checked(
        ReviewRequestSchema,
        await api.POST('/documents/{id}/review-decision', { params: { path: { id: documentId } }, body }),
      ),
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
    queryFn: async () =>
      checked(ReviewQueueResponseSchema, await api.GET('/reviews', { params: { query: q } })),
  });

/* ── saved views ────────────────────────────────────────────────────────── */

export const useViews = () =>
  useQuery({
    queryKey: keys.views,
    staleTime: 30_000,
    queryFn: async () => checked(items(SavedViewSchema), await api.GET('/views')).items,
  });

export function useSaveView() {
  const qc = useQueryClient();
  const invalidate = () => void qc.invalidateQueries({ queryKey: keys.views });
  return {
    create: useMutation({
      mutationFn: async (body: SavedViewBody) => checked(SavedViewSchema, await api.POST('/views', { body })),
      onSuccess: invalidate,
    }),
    update: useMutation({
      mutationFn: async ({ id, ...body }: Partial<SavedViewBody> & { id: string }) =>
        checked(SavedViewSchema, await api.PATCH('/views/{id}', { params: { path: { id } }, body })),
      onSuccess: invalidate,
    }),
    remove: useMutation({
      mutationFn: async (id: string) => {
        unwrap(await api.DELETE('/views/{id}', { params: { path: { id } } }));
      },
      onSuccess: invalidate,
    }),
  };
}

/* ── templates ──────────────────────────────────────────────────────────── */

export const useTemplates = () =>
  useQuery({
    queryKey: keys.templates,
    staleTime: 60_000,
    queryFn: async () => checked(items(TemplateSchema), await api.GET('/templates')).items,
  });

export function useSaveTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: TemplateBody) => checked(TemplateSchema, await api.POST('/templates', { body })),
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
    queryFn: async () =>
      checked(
        PresenceSchema,
        await api.GET('/documents/{id}/presence', { params: { path: { id: documentId! } } }),
      ),
  });

  const beat = useRef<() => void>(() => {});
  beat.current = () => {
    if (!documentId) return;
    void api.POST('/documents/{id}/presence', { params: { path: { id: documentId } } }).catch(() => {});
  };

  /**
   * The heartbeat stops while the tab is in the background, and resumes the moment it is not.
   *
   * The read above is a TanStack `refetchInterval`, which pauses on blur by default. The write
   * was a bare `setInterval`, which does not — so a tab left open in another window went on
   * claiming "currently editing this document" indefinitely while no longer being told about
   * anyone else, and the editor's conflict banner is downstream of exactly that. Gating the beat
   * on visibility makes the two halves agree; beating once on the way back means a returning tab
   * re-appears to everyone else immediately rather than up to `HEARTBEAT_MS` later.
   */
  useEffect(() => {
    if (!on) return;
    const visible = () => document.visibilityState === 'visible';
    const maybeBeat = () => {
      if (visible()) beat.current();
    };
    maybeBeat();
    const t = setInterval(maybeBeat, HEARTBEAT_MS);
    document.addEventListener('visibilitychange', maybeBeat);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', maybeBeat);
      if (documentId) qc.removeQueries({ queryKey: keys.presence(documentId) });
    };
  }, [on, documentId, qc]);

  return useMemo(() => q.data?.editors ?? [], [q.data]);
}

/* ── bulk document actions ──────────────────────────────────────────────── */

export function useBulkDocuments() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: BulkBody) =>
      checked(BulkResultSchema, await api.POST('/documents/bulk', { body })),
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
 * buffered and flushed every 10 s, on unmount, and when the page goes away; a failed flush is
 * dropped rather than retried — usage analytics must never be able to break the call the agent
 * is on.
 *
 * The going-away flush uses `sendBeacon` via `useUnloadFlush`, not `beforeunload` + `fetch`. The
 * batch at risk is the one covering the last ten seconds before a tab closes, which on a call is
 * the tail — the part carrying the outcome. See `lib/unloadFlush.ts` for why the obvious pairing
 * loses it.
 */
const FLUSH_MS = 10_000;

export function useTelemetry(): (e: TelemetryEvent) => void {
  const buffer = useRef<TelemetryEvent[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useRef<(unloading?: boolean) => void>(() => {});
  flush.current = (unloading = false) => {
    const events = buffer.current;
    if (!events.length) return;
    buffer.current = [];
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (unloading) beaconJson(`${API_BASE}/telemetry`, { events });
    else void api.POST('/telemetry', { body: { events } }).catch(() => {});
  };

  useUnloadFlush(() => flush.current(true));
  useEffect(() => () => flush.current(), []);

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
