import { useEffect, useRef } from 'react';

/**
 * Runs a flush when the page is actually going away — which `beforeunload` is not a reliable
 * signal for.
 *
 * Two things go wrong with the obvious `beforeunload` + `fetch` pairing, and they compound:
 *
 * 1. **The event does not always fire.** Mobile Safari never fires it, and neither does any
 *    browser when a page enters the bfcache (back/forward navigation) or the tab is discarded
 *    under memory pressure. `pagehide` fires in all of those, and `visibilitychange → hidden`
 *    fires before it on every path a user can take away from the tab — switching apps, locking
 *    the phone, closing the tab. Listening to both, with the flush itself idempotent-by-emptying,
 *    is the combination that actually covers the real exits.
 * 2. **The request is cancelled.** An ordinary `fetch` started during unload is routinely killed
 *    the moment unload proceeds. `navigator.sendBeacon` exists for exactly this: the browser owns
 *    the request and keeps it alive past the page. `fetch(..., { keepalive: true })` is the
 *    fallback where `sendBeacon` is absent or has hit its queue limit.
 *
 * Between them that is the difference between keeping and losing the last ten seconds of a call —
 * which is the tail, the part with the outcome in it.
 */
export function useUnloadFlush(flush: () => void): void {
  const ref = useRef(flush);
  ref.current = flush;

  useEffect(() => {
    const run = () => ref.current();
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') run();
    };
    window.addEventListener('pagehide', run);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', run);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
}

/** Sends JSON with `keepalive`, so the request outlives the document that started it. */
export function keepaliveJson(method: 'POST' | 'PUT', url: string, body: unknown): void {
  void fetch(url, {
    method,
    credentials: 'include',
    keepalive: true,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

/**
 * Posts JSON in a way that survives the page being torn down.
 *
 * Returns `true` when the payload was handed to `sendBeacon`, `false` when it fell through to
 * `keepalive` — the caller does not generally care, but the distinction is what the tests assert.
 *
 * `sendBeacon` is POST-only, which is why the draft autosave (a `PUT`) goes straight to
 * `keepaliveJson` instead of through here.
 */
export function beaconJson(url: string, body: unknown): boolean {
  try {
    // The type matters: `sendBeacon` sends a Blob's type as the Content-Type, and a route that
    // parses JSON will reject the default `text/plain`.
    const blob = new Blob([JSON.stringify(body)], { type: 'application/json' });
    if (navigator.sendBeacon?.(url, blob)) return true;
  } catch {
    /* sendBeacon absent, or over its queue limit — fall through */
  }
  keepaliveJson('POST', url, body);
  return false;
}
