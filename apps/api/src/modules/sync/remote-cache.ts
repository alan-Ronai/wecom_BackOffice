import type { RemoteItem } from '@wecom/connectors';

export type RemoteListing = { ok: true; items: RemoteItem[] } | { ok: false; error: string };

export interface RemoteCache {
  get(connectorId: string, load: () => Promise<RemoteItem[]>): Promise<RemoteListing>;
  clear(): void;
}

/**
 * A short TTL over `Connector.listRemote`, keyed by connector.
 *
 * The parity report is a *report*: an operator opens it, reads it, reloads it after a sync, and
 * often has it open on a second screen. Each render needs the connector's whole remote listing —
 * for WordPress that is a paged REST walk over every post, which takes seconds and which the remote
 * has every right to rate-limit. Without a cache, one operator with the page open turns into a
 * steady poll of somebody else's CMS.
 *
 * Sixty seconds is chosen against what the page is *for*: it is a standing view of drift, not a
 * live monitor, and drift that appeared in the last minute is not drift anybody can act on yet.
 * The "sync now" actions do not read through this cache — they go to the engine, which always
 * fetches fresh — so a stale listing can never be the basis of a write.
 *
 * Failures are cached too, for the same window. A connector whose remote is down would otherwise
 * be retried on every render, turning an outage into a tight retry loop against a host that is
 * already struggling.
 */
export function createRemoteCache(ttlMs = 60_000, now: () => number = Date.now): RemoteCache {
  const entries = new Map<string, { at: number; pending: Promise<RemoteListing> }>();
  return {
    async get(connectorId, load) {
      const hit = entries.get(connectorId);
      if (hit && now() - hit.at < ttlMs) return hit.pending;
      // The promise, not the resolved value, is what is stored: two renders a millisecond apart
      // then share one round trip instead of both missing and both fetching.
      const pending = load().then(
        (items): RemoteListing => ({ ok: true, items }),
        (err): RemoteListing => ({ ok: false, error: err instanceof Error ? err.message : String(err) }),
      );
      entries.set(connectorId, { at: now(), pending });
      return pending;
    },
    clear() {
      entries.clear();
    },
  };
}
