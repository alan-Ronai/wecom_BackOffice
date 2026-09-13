import type PgBoss from 'pg-boss';
import { makeEvent, type Event } from '@wecom/shared';
import type { RemoteChange } from '@wecom/connectors';
import { QUEUES } from '../../plugins/boss.js';
import type { ConnectorsRepo } from './repo.js';
import type { SyncService } from './sync.js';

/** The slice of pg-boss this module uses, so tests can supply a fake. */
export interface PgBossLike {
  work(name: string, handler: (job: { id: string; data: unknown }) => Promise<void>): Promise<unknown>;
  schedule(name: string, cron: string, data?: object, opts?: object): Promise<unknown>;
  unschedule(name: string): Promise<unknown>;
  send(name: string, data: object): Promise<string | null>;
  /** pg-boss 10 requires a queue row before work/schedule; absent on test fakes. */
  createQueue?(name: string, options?: object): Promise<unknown>;
}

/** pg-boss 10 hands `work` a batch of jobs; this module handles one at a time. */
export const bossAdapter = (boss: PgBoss): PgBossLike => ({
  work: (name, handler) =>
    boss.work(name, async (jobs) => {
      for (const j of jobs) await handler({ id: j.id, data: j.data });
    }),
  schedule: (name, cron, data, opts) => boss.schedule(name, cron, data, opts as PgBoss.ScheduleOptions),
  unschedule: (name) => boss.unschedule(name),
  send: (name, data) => boss.send(name, data),
  createQueue: (name) => boss.createQueue(name),
});

export interface JobDeps {
  repo: ConnectorsRepo;
  registry: unknown;
  sync: SyncService;
  events: { publish(e: Event): void };
  log: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void };
}

/** Per-connector cron queue name; pg-boss keys schedules by queue name. */
const runQueueOf = (connectorId: string) => `${QUEUES.connectorRun}.${connectorId}`;

function wrap(name: string, deps: JobDeps, fn: (data: unknown) => Promise<void>) {
  return async (job: { id: string; data: unknown }) => {
    try {
      await fn(job.data);
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.log.error({ job: name, id: job.id, error }, 'connector job failed');
      const connectorId = (job.data as { connectorId?: string })?.connectorId;
      if (connectorId) await deps.repo.setRun(connectorId, 'error', { lastError: error });
      deps.events.publish(makeEvent('job.failed', { jobName: name, jobId: job.id, error }));
      throw e;
    }
  };
}

/**
 * Bring pg-boss cron schedules in line with the enabled connectors. Routes call
 * the returned function after a connector is created, patched or deleted.
 */
export async function refreshSchedules(
  boss: PgBossLike,
  deps: JobDeps,
  scheduled: Set<string>,
): Promise<void> {
  const rows = await deps.repo.list();
  const wanted = new Map(rows.filter((r) => r.enabled).map((r) => [runQueueOf(r.id), r]));
  for (const name of [...scheduled])
    if (!wanted.has(name)) {
      await boss.unschedule(name);
      scheduled.delete(name);
    }
  for (const [name, r] of wanted) {
    if (!scheduled.has(name)) {
      await boss.createQueue?.(name);
      await boss.work(
        name,
        wrap(name, deps, async (data) => {
          await deps.sync.runConnector((data as { connectorId: string }).connectorId, null);
        }),
      );
    }
    // singletonKey keeps a slow connector from overlapping with its next tick.
    await boss.schedule(name, r.schedule, { connectorId: r.id }, { tz: 'Asia/Jerusalem', singletonKey: r.id });
    scheduled.add(name);
  }
}

export async function registerConnectorJobs(boss: PgBossLike, deps: JobDeps): Promise<() => Promise<void>> {
  await boss.work(
    QUEUES.connectorRun,
    wrap(QUEUES.connectorRun, deps, async (data) => {
      const d = data as { connectorId: string; actorId: string | null };
      await deps.sync.runConnector(d.connectorId, d.actorId ?? null);
    }),
  );
  await boss.work(
    QUEUES.connectorWebhook,
    wrap(QUEUES.connectorWebhook, deps, async (data) => {
      const d = data as { connectorId: string; changes: RemoteChange[] };
      await deps.sync.handleRemoteChanges(d.connectorId, d.changes);
    }),
  );
  const scheduled = new Set<string>();
  await refreshSchedules(boss, deps, scheduled);
  return () => refreshSchedules(boss, deps, scheduled);
}
