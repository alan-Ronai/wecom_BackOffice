import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('fake auth', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });
  it('rejects unauthenticated list and accepts a user', async () => {
    const app = await buildTestApp(db.pool, db.url);
    expect((await app.inject({ method: 'GET', url: '/api/v1/documents' })).statusCode).toBe(401);
    const u = await makeUser(db.pool, { perms: ['docs.read'] });
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/documents', headers: auth(u) })).statusCode,
    ).toBe(200);
    await app.close();
  });
});
