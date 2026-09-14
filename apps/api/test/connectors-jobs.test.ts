import { describe, it, expect, vi } from 'vitest';
import { registerConnectorJobs } from '../src/modules/connectors/jobs.js';

function fakeBoss() {
  const handlers = new Map<string, (job: { id: string; data: unknown }) => Promise<void>>();
  const schedules: [string, string][] = [];
  return {
    handlers,
    schedules,
    work: vi.fn(async (n: string, h: (job: { id: string; data: unknown }) => Promise<void>) => {
      handlers.set(n, h);
    }),
    schedule: vi.fn(async (n: string, cron: string) => {
      schedules.push([n, cron]);
    }),
    unschedule: vi.fn(async () => undefined),
    send: vi.fn(async () => 'j1'),
  };
}

describe('connector jobs', () => {
  it('schedules enabled connectors and runs them', async () => {
    const boss = fakeBoss();
    const repo = {
      list: vi.fn(async () => [
        { id: 'c1', enabled: true, schedule: '*/5 * * * *' },
        { id: 'c2', enabled: false, schedule: '* * * * *' },
      ]),
      setRun: vi.fn(),
    };
    const sync = {
      runConnector: vi.fn(async () => ({ imported: 1, pushed: 0, conflicts: 0, linked: 0 })),
      handleRemoteChanges: vi.fn(),
    };
    const events = { publish: vi.fn() };
    await registerConnectorJobs(boss, {
      repo: repo as never,
      registry: {} as never,
      sync: sync as never,
      events,
      log: { info() {}, error() {} },
    });
    expect(boss.schedules).toEqual([['connector.run.c1', '*/5 * * * *']]);
    await boss.handlers.get('connector.run.c1')!({ id: 'j', data: { connectorId: 'c1' } });
    expect(sync.runConnector).toHaveBeenCalledWith('c1', null);
  });

  it('routes webhook jobs and reports failures', async () => {
    const boss = fakeBoss();
    const repo = { list: vi.fn(async () => []), setRun: vi.fn() };
    const sync = {
      runConnector: vi.fn(),
      handleRemoteChanges: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    const events = { publish: vi.fn() };
    await registerConnectorJobs(boss, {
      repo: repo as never,
      registry: {} as never,
      sync: sync as never,
      events,
      log: { info() {}, error() {} },
    });
    await expect(
      boss.handlers.get('connector.webhook')!({ id: 'j2', data: { connectorId: 'c1', changes: [] } }),
    ).rejects.toThrow('boom');
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'job.failed',
        payload: { jobName: 'connector.webhook', jobId: 'j2', error: 'boom' },
      }),
    );
    expect(repo.setRun).toHaveBeenCalledWith('c1', 'error', { lastError: 'boom' });
  });

  it('unschedules a connector that was disabled', async () => {
    const boss = fakeBoss();
    const rows = [{ id: 'c1', enabled: true, schedule: '*/5 * * * *' }];
    const repo = { list: vi.fn(async () => rows), setRun: vi.fn() };
    const deps = {
      repo: repo as never,
      registry: {} as never,
      sync: { runConnector: vi.fn(), handleRemoteChanges: vi.fn() } as never,
      events: { publish: vi.fn() },
      log: { info() {}, error() {} },
    };
    const refresh = await registerConnectorJobs(boss, deps);
    rows[0].enabled = false;
    await refresh();
    expect(boss.unschedule).toHaveBeenCalledWith('connector.run.c1');
  });

  // Backend ask #1: a cleared (`null`) schedule is "ללא תזמון" — the connector still
  // runs, but never on a cron, so its pg-boss schedule has to come off the same way a
  // disabled connector's does.
  it('unschedules a connector whose schedule was cleared to null', async () => {
    const boss = fakeBoss();
    const rows: { id: string; enabled: boolean; schedule: string | null }[] = [
      { id: 'c1', enabled: true, schedule: '*/5 * * * *' },
    ];
    const repo = { list: vi.fn(async () => rows), setRun: vi.fn() };
    const deps = {
      repo: repo as never,
      registry: {} as never,
      sync: { runConnector: vi.fn(), handleRemoteChanges: vi.fn() } as never,
      events: { publish: vi.fn() },
      log: { info() {}, error() {} },
    };
    const refresh = await registerConnectorJobs(boss, deps);
    expect(boss.schedules).toEqual([['connector.run.c1', '*/5 * * * *']]);
    rows[0].schedule = null;
    await refresh();
    expect(boss.unschedule).toHaveBeenCalledWith('connector.run.c1');
    // Still enabled — a later re-set schedule must be able to re-register it, so the
    // job handler stays; only the cron entry is removed.
    expect(rows[0].enabled).toBe(true);
  });
});
