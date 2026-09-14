import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { NotifyInput } from '@wecom/shared';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';
import { setNotifier, setTaxonomy } from '../src/plugins/wave4.js';
import { PgNotifier } from '../src/modules/feedback/notifier.js';
import { resetColumnCache } from '../src/modules/feedback/repo.js';

const run = integration ? describe : describe.skip;

run('feedback alerts', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;
  let publisher: Awaited<ReturnType<typeof makeUser>>;
  let agent: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;
  const sent: NotifyInput[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    lead = await makeUser(db.pool, { name: 'ענבר ל.' });
    publisher = await makeUser(db.pool, { name: 'מאשר' });
    agent = await makeUser(db.pool, { perms: ['docs.read'], name: 'דנה ר.' });
    setNotifier(app, {
      notify: async (n) => {
        sent.push(n);
      },
    });
    setTaxonomy(app, {
      worldsOf: async () => ['tech'],
      usersWithPermissionInWorld: async (perm) => (perm === 'docs.publish' ? [publisher.id] : []),
    });
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(lead),
        payload: { title: 'התראות', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/structure`,
      headers: { ...auth(lead), 'if-match': c.etag },
      payload: minimalStructure,
    });
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${c.id}/publish`,
      headers: auth(lead),
      payload: { label: 'v1' },
    });
    docId = c.id;
  }, 120000);
  beforeEach(() => {
    sent.length = 0;
    resetColumnCache();
  });
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('a new report alerts the responsible people (updated_by fallback before W2), never the reporter', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/feedback`,
      headers: auth(agent),
      payload: { kind: 'missing', stepKey: 's1' },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: 'feedback', entityType: 'feedback', userIds: [lead.id] });
    expect(sent[0].title).toContain('חסר מידע');
    expect(sent[0].href).toMatch(/^\/feedback\//);
  });

  it('"process_fails" also reaches everyone who may publish in the world', async () => {
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/feedback`,
      headers: auth(agent),
      payload: { kind: 'process_fails' },
    });
    expect(sent).toHaveLength(1);
    expect([...sent[0].userIds].sort()).toEqual([lead.id, publisher.id].sort());
  });

  it('uses owner_id / editor_id once W2 adds them', async () => {
    const owner = await makeUser(db.pool, { name: 'בעלת תחום' });
    await db.pool.query(
      'alter table documents add column if not exists owner_id uuid, add column if not exists editor_id uuid',
    );
    await db.pool.query('update documents set owner_id=$2, editor_id=$3 where id=$1', [
      docId,
      owner.id,
      lead.id,
    ]);
    resetColumnCache();
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${docId}/feedback`,
      headers: auth(agent),
      payload: { kind: 'unclear' },
    });
    expect([...sent[0].userIds].sort()).toEqual([lead.id, owner.id].sort());
    await db.pool.query('alter table documents drop column owner_id, drop column editor_id');
    resetColumnCache();
  });

  it('PgNotifier writes wave 3 notifications rows with the mapped kind and dedupes recipients', async () => {
    const real = new PgNotifier(db.pool, app.events, app.log);
    await real.notify({
      userIds: [lead.id, lead.id, publisher.id],
      kind: 'feedback',
      title: 'בדיקה',
      body: 'גוף',
      href: '/feedback/x',
      entityType: 'feedback',
      entityId: 'x',
    });
    const rows = await db.pool.query(
      'select user_id, kind, title, entity_type, href from notifications where title=$1 order by user_id',
      ['בדיקה'],
    );
    expect(rows.rowCount).toBe(2);
    expect(
      rows.rows.every(
        (r) => r.kind === 'review' && r.entity_type === 'feedback' && r.href === '/feedback/x',
      ),
    ).toBe(true);
  });
});
