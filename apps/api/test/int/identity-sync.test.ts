import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, seedUser, integration } from '../helpers/l3/db.js';
import { IdentityService } from '../../src/modules/auth/identity.js';
import { runIdentitySync } from '../../src/jobs/identity-sync.js';

const run = integration ? describe : describe.skip;
run('identity.sync', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });

  it('refreshes roles from groups and deactivates disabled users', async () => {
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-leads','KB-Leads', id from roles where name='lead'`,
    );
    const keep = await seedUser(db.pool, {
      email: 'keep@wecom.co.il',
      displayName: 'K',
      subject: 'sub-keep',
      roles: ['editor'],
    });
    const gone = await seedUser(db.pool, {
      email: 'gone@wecom.co.il',
      displayName: 'G',
      subject: 'sub-gone',
      roles: ['agent'],
    });
    await db.pool.query(
      `insert into sessions(user_id, token_hash, expires_at) values ($1,'x',now()+interval '1 hour')`,
      [gone],
    );
    const oidc = {
      listDisabledUsers: async (subs: string[]) => new Set(subs.filter((s) => s === 'sub-gone')),
      listUserGroups: async (s: string) => (s === 'sub-keep' ? ['grp-leads'] : []),
    };
    const identity = new IdentityService(db.pool, () => undefined);
    const res = await runIdentitySync({ db: db.pool, oidc, identity, log: { info: () => undefined } });
    expect(res).toEqual({ checked: 2, deactivated: 1, roleChanges: 1, groups: 1 });
    expect((await db.pool.query('select active from users where id=$1', [gone])).rows[0].active).toBe(false);
    expect(
      (await db.pool.query('select revoked_at from sessions where user_id=$1', [gone])).rows[0].revoked_at,
    ).not.toBeNull();
    const roles = (
      await db.pool.query(
        'select r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1 order by 1',
        [keep],
      )
    ).rows.map((r) => r.name);
    expect(roles).toEqual(['editor', 'lead']);
    expect(
      (await db.pool.query(`select count(*)::int as n from audit_log where action='identity.sync'`)).rows[0]
        .n,
    ).toBe(1);
  });
});
