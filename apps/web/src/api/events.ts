import { useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { EVENTS, EventSchema, type Event } from '@wecom/shared';
import { API_BASE } from './client.js';
import { keys } from './keys.js';

/**
 * Live updates over one SSE connection.
 *
 * The events module is registered inside the `/api/v1` scope, so the stream lives at
 * `<API_BASE>/events` — not `/events`, which 404s. `deploy/nginx.conf` proxies it with the
 * SSE-safe settings (no buffering, long read timeout).
 *
 * The connection is a module-level singleton with a subscriber count: `Shell` and the system page
 * both call `useEvents()`, and a second `EventSource` would double every invalidation and hold a
 * second long-lived request open against the API.
 */

interface StreamState {
  connected: boolean;
  last?: Event;
}

type Listener = (s: StreamState) => void;

let source: EventSource | null = null;
let subscribers = 0;
let state: StreamState = { connected: false };
const listeners = new Set<Listener>();

const publish = (next: StreamState) => {
  state = next;
  for (const l of listeners) l(state);
};

/**
 * Stage-5 event names (`docs/api/CONTRACTS-stage4-5.md`).
 *
 * They are an **additive** change to `packages/shared/src/events.ts` that backend lane B owns, so
 * `EVENTS` and `EventSchema` do not know them yet. Subscribing to them here means the notification
 * bell, the comment threads and the review queue go live the moment the backend starts emitting —
 * and, because the payload is read defensively rather than parsed by a schema this app does not
 * have, an unknown shape invalidates a query instead of throwing.
 *
 * When the shared union gains them, delete this list: the generic `EVENTS` loop will cover them.
 */
const STAGE5_EVENTS = [
  'notification.created',
  'comment.created',
  'review.requested',
  'review.decided',
  'presence.changed',
] as const;

function invalidateStage5(qc: QueryClient, name: string, payload: Record<string, unknown>): void {
  const documentId = typeof payload.documentId === 'string' ? payload.documentId : undefined;
  if (name === 'notification.created') {
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  } else if (name === 'comment.created') {
    if (documentId) void qc.invalidateQueries({ queryKey: keys.comments(documentId) });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
  } else if (name.startsWith('review.')) {
    void qc.invalidateQueries({ queryKey: ['reviews'] });
    void qc.invalidateQueries({ queryKey: ['notifications'] });
    if (documentId) void qc.invalidateQueries({ queryKey: keys.doc(documentId) });
    void qc.invalidateQueries({ queryKey: ['documents'] });
  } else if (name === 'presence.changed') {
    if (documentId) void qc.invalidateQueries({ queryKey: keys.presence(documentId) });
  }
}

function invalidate(qc: QueryClient, ev: Event): void {
  if (ev.name.startsWith('document.')) {
    const id = (ev.payload as { documentId: string }).documentId;
    void qc.invalidateQueries({ queryKey: keys.doc(id) });
    void qc.invalidateQueries({ queryKey: ['documents'] });
    void qc.invalidateQueries({ queryKey: keys.versions(id) });
    void qc.invalidateQueries({ queryKey: keys.trash });
  } else if (ev.name.startsWith('suggestion.')) {
    void qc.invalidateQueries({ queryKey: ['suggestions'] });
    void qc.invalidateQueries({ queryKey: keys.sources });
  } else if (ev.name.startsWith('sync.')) {
    void qc.invalidateQueries({ queryKey: keys.sources });
  } else if (ev.name === 'system.status' || ev.name === 'job.failed') {
    void qc.invalidateQueries({ queryKey: keys.admin.system });
    void qc.invalidateQueries({ queryKey: keys.health });
  }
}

/** Reconnect backoff: 1s, 2s, 4s, 8s, 16s, then every 30s, with jitter. */
const BACKOFF_MS = [1_000, 2_000, 4_000, 8_000, 16_000, 30_000];
let attempt = 0;
let retry: ReturnType<typeof setTimeout> | null = null;

/**
 * The `QueryClient` the stream invalidates through, read at dispatch time rather than captured.
 *
 * The stream is a module-level singleton shared by every `useEvents()` caller, but its handlers
 * used to close over whichever client the *first* subscriber happened to bring. One client exists
 * today (`main.tsx`), so nothing was wrong — but a second subscriber with its own client (a test
 * rendering two providers, a future embedded view) would have had its cache silently never
 * invalidated, which looks like "SSE is broken" and is not.
 */
let client: QueryClient | null = null;
const qcRef = (): QueryClient => {
  if (!client) throw new Error('event stream used before a QueryClient was registered');
  return client;
};

function scheduleReconnect(): void {
  if (retry || subscribers === 0) return;
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  // Jitter so 200 agents refused at once do not all come back in the same instant.
  const wait = base + Math.floor(Math.random() * base * 0.3);
  attempt += 1;
  retry = setTimeout(() => {
    retry = null;
    if (subscribers === 0) return;
    source?.close();
    source = null;
    open();
  }, wait);
}

function open(): void {
  const es = new EventSource(`${API_BASE}/events`, { withCredentials: true });
  source = es;
  es.addEventListener('open', () => {
    attempt = 0;
    publish({ ...state, connected: true });
  });
  /**
   * The API caps concurrent streams and answers 503 TOO_MANY_STREAMS beyond it. A non-2xx
   * response makes `EventSource` fire `error` and close *permanently* — it only auto-retries a
   * stream that opened and then dropped — so reconnection has to be driven from here, with
   * backoff, or a refused client stays dead for the rest of the session.
   */
  es.addEventListener('error', () => {
    publish({ ...state, connected: false });
    if (es.readyState === EventSource.CLOSED) scheduleReconnect();
  });

  const handle = (raw: MessageEvent) => {
    let json: unknown;
    try {
      json = JSON.parse(raw.data as string);
    } catch {
      return;
    }
    const parsed = EventSchema.safeParse(json);
    if (!parsed.success) return;
    const ev = parsed.data as Event;
    publish({ ...state, last: ev });
    invalidate(qcRef(), ev);
  };

  for (const name of EVENTS) es.addEventListener(name, handle as EventListener);

  const handleStage5 = (name: string) => (raw: MessageEvent) => {
    let payload: Record<string, unknown> = {};
    try {
      const json = JSON.parse(raw.data as string) as { payload?: unknown };
      if (json && typeof json === 'object' && json.payload && typeof json.payload === 'object')
        payload = json.payload as Record<string, unknown>;
    } catch {
      /* an unparseable frame still means "something changed"; fall through to invalidation */
    }
    invalidateStage5(qcRef(), name, payload);
  };
  for (const name of STAGE5_EVENTS) es.addEventListener(name, handleStage5(name) as EventListener);
}

function close(): void {
  if (retry) clearTimeout(retry);
  retry = null;
  attempt = 0;
  source?.close();
  source = null;
  state = { connected: false };
  client = null;
}

export function useEvents(): StreamState {
  const qc = useQueryClient();
  const [local, setLocal] = useState<StreamState>(state);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    subscribers += 1;
    // The most recent subscriber's client wins, and the handlers read it through `qcRef` on every
    // frame — so a second client is invalidated too, instead of being quietly ignored.
    client = qc;
    if (!source) open();
    listeners.add(setLocal);
    setLocal(state);
    return () => {
      listeners.delete(setLocal);
      subscribers -= 1;
      if (subscribers === 0) close();
    };
  }, [qc]);

  return local;
}

/** Test seam: drops the shared connection so each test starts from a clean stream. */
export function __resetEventStream(): void {
  close();
  subscribers = 0;
  listeners.clear();
}
