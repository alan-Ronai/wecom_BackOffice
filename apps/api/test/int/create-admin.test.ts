import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from '../helpers/l3/db.js';
import { createAdmin } from '../../src/cli/create-admin.js';
import { verifyPassword } from '../../src/modules/auth/local.js';

const run = integration ? describe : describe.skip;
run('create-admin', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });
  it('creates a local admin, then rotates the password on re-run', async () => {
    const a = await createAdmin(db.pool, 'root@wecom.co.il', 'first-password-1');
    const b = await createAdmin(db.pool, 'root@wecom.co.il', 'second-password-2');
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.id).toBe(b.id);
    const row = (await db.pool.query('select password_hash, source from users where id=$1', [a.id])).rows[0];
    expect(row.source).toBe('local');
    expect(await verifyPassword(row.password_hash, 'second-password-2')).toBe(true);
    const roles = (
      await db.pool.query(
        'select r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1',
        [a.id],
      )
    ).rows.map((r) => r.name);
    expect(roles).toEqual(['admin']);
  });
  it('rejects short passwords', async () => {
    await expect(createAdmin(db.pool, 'x@y.z', 'short')).rejects.toThrow(/12/);
  });
});
