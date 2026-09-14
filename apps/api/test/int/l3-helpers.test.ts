import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, seedUser, integration } from '../helpers/l3/db.js';
import { startOidcMock } from '../helpers/l3/oidc.js';
import { startPaloAltoStub } from '../helpers/l3/paloalto.js';

const run = integration ? describe : describe.skip;
run('test helpers', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  beforeAll(async () => {
    db = await startTestDb();
  }, 120000);
  afterAll(async () => {
    await db.stop();
  });

  it('seeds a user with roles', async () => {
    const id = await seedUser(db.pool, {
      email: 'a@wecom.co.il',
      displayName: 'ענבר ל.',
      roles: ['editor'],
      categoryScope: ['intl'],
    });
    const r = await db.pool.query(
      'select r.name, ur.world_scope from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1',
      [id],
    );
    expect(r.rows).toEqual([{ name: 'editor', world_scope: ['intl'] }]);
  });
  it('serves an OIDC discovery document', async () => {
    const m = await startOidcMock(8085);
    const res = await fetch(m.issuer + '/.well-known/openid-configuration');
    expect(((await res.json()) as { authorization_endpoint: string }).authorization_endpoint).toContain(
      '/authorize',
    );
    await m.stop();
  });
  it('answers the Palo Alto ip-user-mapping query', async () => {
    const s = await startPaloAltoStub(8086);
    s.setMapping('10.1.2.3', 'WECOM\\inbar');
    const res = await fetch(
      s.url +
        '/api/?type=op&key=k&cmd=' +
        encodeURIComponent('<show><user><ip-user-mapping><ip>10.1.2.3</ip></ip-user-mapping></user></show>'),
    );
    expect(await res.text()).toContain('<user>WECOM\\inbar</user>');
    await s.stop();
  });
});
