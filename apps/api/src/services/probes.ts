import type PgBoss from 'pg-boss';
import { QUEUES } from '../plugins/boss.js';

/**
 * Ollama stores an untagged pull as `<name>:latest`, so `nomic-embed-text` in the environment and
 * `nomic-embed-text:latest` in `/api/tags` are the same model. Everything else must match
 * exactly: the old comparison fell back to `name.split(':')[0]`, which reported `hasModel` for
 * `qwen2.5:3b` when only `qwen2.5:7b` was pulled — precisely the fat-fingered-`MODEL_NAME` case
 * O-2 is about.
 */
const normalizeTag = (name: string): string => (name.includes(':') ? name : `${name}:latest`);

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
    const want = normalizeTag(modelName);
    const hasModel = (body.models ?? []).some((m) => normalizeTag(m.name) === want);
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
