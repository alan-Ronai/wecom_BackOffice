import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, seedUser, integration } from '../helpers/l3/db.js';
import { IdentityService, initials } from '../../src/modules/auth/identity.js';

const run = integration ? describe : describe.skip;
run('IdentityService', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let svc: IdentityService;
  const invalidated: string[] = [];
  beforeAll(async () => {
    db = await startTestDb();
    svc = new IdentityService(db.pool, (id) => invalidated.push(id));
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });

  it('computes initials', () => {
    expect(initials('ענבר ל.')).toBe('ע');
    expect(initials('')).toBe('?');
  });

  it('creates then updates a user by subject', async () => {
    const a = await svc.upsertUser({
      subject: 's1',
      source: 'entra',
      email: 'x@wecom.co.il',
      displayName: 'ענבר ל.',
    });
    const b = await svc.upsertUser({
      subject: 's1',
      source: 'entra',
      email: 'x@wecom.co.il',
      displayName: 'ענבר לוי',
    });
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.id).toBe(b.id);
    const r = await db.pool.query('select display_name, last_login_at from users where id=$1', [a.id]);
    expect(r.rows[0].display_name).toBe('ענבר לוי');
    expect(r.rows[0].last_login_at).not.toBeNull();
  });

  it('merges a paloalto user into an entra login by email', async () => {
    const pa = await seedUser(db.pool, {
      email: 'merge@wecom.co.il',
      displayName: 'דנה',
      source: 'paloalto',
      subject: 'WECOM\\dana',
    });
    const e = await svc.upsertUser({
      subject: 'entra-dana',
      source: 'entra',
      email: 'Merge@wecom.co.il',
      displayName: 'דנה ר.',
    });
    expect(e.id).toBe(pa);
    const r = await db.pool.query('select subject, source from users where id=$1', [pa]);
    expect(r.rows[0]).toEqual({ subject: 'entra-dana', source: 'entra' });
  });

  it('applies and removes mapped roles without touching manual roles', async () => {
    const id = await seedUser(db.pool, { email: 'g@wecom.co.il', displayName: 'ג', roles: ['agent'] });
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-editors','KB-Editors', id from roles where name='editor'`,
    );
    await db.pool.query(
      `insert into groups_map(idp_group_id, idp_group_name, role_id) select 'grp-leads','KB-Leads', id from roles where name='lead'`,
    );
    const first = await svc.applyGroupMap(id, ['grp-editors']);
    expect(first.added).toEqual(['editor']);
    expect(first.removed).toEqual([]);
    const second = await svc.applyGroupMap(id, ['grp-leads']);
    expect(second.added).toEqual(['lead']);
    expect(second.removed).toEqual(['editor']);
    const roles = (
      await db.pool.query(
        'select r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1 order by 1',
        [id],
      )
    ).rows.map((x) => x.name);
    expect(roles).toEqual(['agent', 'lead']);
    expect(invalidated).toContain(id);
  });

  it('deactivates and revokes', async () => {
    const id = await seedUser(db.pool, { email: 'd@wecom.co.il', displayName: 'ד' });
    await db.pool.query(
      `insert into sessions(user_id, token_hash, expires_at) values ($1,'h',now()+interval '1 hour')`,
      [id],
    );
    await svc.deactivate(id, null);
    const r = await db.pool.query(
      'select u.active, s.revoked_at from users u join sessions s on s.user_id=u.id where u.id=$1',
      [id],
    );
    expect(r.rows[0].active).toBe(false);
    expect(r.rows[0].revoked_at).not.toBeNull();
  });
});
