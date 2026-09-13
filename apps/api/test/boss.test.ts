import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { buildApp } from '../src/app.js';
import { QUEUES } from '../src/plugins/boss.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('pg-boss plugin', () => {
  let c: StartedPostgreSqlContainer;
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
  }, 120000);
  afterAll(async () => {
    await c?.stop();
  });
  it('starts boss and round-trips a job', async () => {
    const app = await buildApp({ config: { DATABASE_URL: c.getConnectionUri(), NODE_ENV: 'test' } });
    await app.ready();
    expect(app.boss).not.toBeNull();
    const got: string[] = [];
    // A dedicated queue: the catalogue queues (QUEUES.*) have real workers registered by
    // other modules, which would consume the job before this test's worker sees it.
    const queue = 'test.roundtrip';
    expect(Object.values(QUEUES)).not.toContain(queue);
    await app.boss!.createQueue(queue);
    await app.boss!.work(queue, async (jobs) => {
      for (const j of jobs) got.push((j.data as { x: string }).x);
    });
    await app.boss!.send(queue, { x: 'hello' });
    // pg-boss's default pollingInterval is 2000ms; wait comfortably past one
    // poll cycle instead of the plan's 1500ms, which was flaky against that default.
    await new Promise((r) => setTimeout(r, 3000));
    expect(got).toEqual(['hello']);
    await app.close();
  });
});
