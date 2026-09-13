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

export async function probeQueue(boss: PgBoss | null): Promise<number | null> {
  if (!boss) return null;
  try {
    let pending = 0;
    for (const q of Object.values(QUEUES)) pending += await boss.getQueueSize(q);
    return pending;
  } catch {
    return null;
  }
}
