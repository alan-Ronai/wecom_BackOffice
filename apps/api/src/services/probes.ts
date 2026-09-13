import type PgBoss from 'pg-boss';
import { QUEUES } from '../plugins/boss.js';

export async function probeModel(
  modelUrl: string,
  modelName: string,
  timeoutMs = 1500,
): Promise<{ up: boolean; hasModel: boolean; latencyMs: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(new URL('/api/tags', modelUrl), { signal: ctrl.signal });
    if (!res.ok) return { up: false, hasModel: false, latencyMs: Date.now() - t0 };
    const body = (await res.json()) as { models?: { name: string }[] };
    const hasModel = (body.models ?? []).some(
      (m) => m.name === modelName || m.name.split(':')[0] === modelName.split(':')[0],
    );
    return { up: true, hasModel, latencyMs: Date.now() - t0 };
  } catch {
    return { up: false, hasModel: false, latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * One `getQueueSize` per queue (8) per call, and the Dockerfile HEALTHCHECK hits
 * `/system/health` every 30 s. A short cache keeps the depth useful without making
 * the liveness probe eight round-trips.
 */
const QUEUE_CACHE_MS = 5_000;
let queueCache: { at: number; value: number | null } | null = null;

export async function probeQueue(boss: PgBoss | null): Promise<number | null> {
  if (!boss) return null;
  if (queueCache && Date.now() - queueCache.at < QUEUE_CACHE_MS) return queueCache.value;
  let value: number | null;
  try {
    let pending = 0;
    for (const q of Object.values(QUEUES)) pending += await boss.getQueueSize(q);
    value = pending;
  } catch {
    value = null;
  }
  queueCache = { at: Date.now(), value };
  return value;
}

/** Test hook: the cache is process-global, so a test that changes queue depth must clear it. */
export const resetQueueProbeCache = (): void => {
  queueCache = null;
};
