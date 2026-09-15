/**
 * Wave 6 (X2) — the per-user chat rate limit (`ai.limits.chatPerUserPerHour`, default 60).
 *
 * In-process and per-instance on purpose. The limit exists because the VM has **one** CPU-only
 * inference slot: it is a queue-depth guard, not a billing control, and the thing that must not
 * happen is one person's open tab starving everyone else on this box. A cross-instance limit
 * would need a shared store and would not protect the slot any better — the slot is local too.
 *
 * `@fastify/rate-limit` is registered on the auth routes with a fixed policy; this one is
 * admin-editable at runtime, which is why it is a function of the current settings rather than
 * a plugin option fixed at boot.
 */
const WINDOW_MS = 60 * 60 * 1000;

const hits = new Map<string, number[]>();

export type RateVerdict = { ok: true } | { ok: false; retryAfterSec: number };

export function checkRate(userId: string, limitPerHour: number, now = Date.now()): RateVerdict {
  const window = (hits.get(userId) ?? []).filter((t) => now - t < WINDOW_MS);
  if (window.length >= limitPerHour) {
    hits.set(userId, window);
    const oldest = window[0];
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((WINDOW_MS - (now - oldest)) / 1000)) };
  }
  window.push(now);
  hits.set(userId, window);
  return { ok: true };
}

/** Tests and the admin "reset" path; never called by a route. */
export const resetRateLimit = (userId?: string): void => {
  if (userId) hits.delete(userId);
  else hits.clear();
};
