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
      rows.rows.every((r) => r.kind === 'review' && r.entity_type === 'feedback' && r.href === '/feedback/x'),
    ).toBe(true);
  });

  it('repeat window: three reports in 7 days alert once', async () => {
    const { evaluateWindows } = await import('../src/modules/feedback/alerts.js');
    const deps = { db: db.pool, notifier: app.notifier, taxonomy: app.taxonomy, log: app.log };
    // 3 reports already exist on docId from the earlier tests (missing, process_fails, unclear)
    const first = await evaluateWindows(deps);
    expect(first.repeat).toBe(1);
    expect(sent.some((n) => n.title.includes('דיווחים חוזרים'))).toBe(true);
    sent.length = 0;
    const again = await evaluateWindows(deps);
    expect(again.repeat).toBe(0);
    expect(sent).toHaveLength(0);
    const rows = await db.pool.query(
      `select kind, count from feedback_alerts where document_id=$1 and kind='repeat'`,
      [docId],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0].count).toBe(3);
  });

  it('anomaly window: needs ≥5 in 24h and twice the 30-day daily mean', async () => {
    const { evaluateWindows } = await import('../src/modules/feedback/alerts.js');
    const deps = { db: db.pool, notifier: app.notifier, taxonomy: app.taxonomy, log: app.log };
    expect((await evaluateWindows(deps)).anomaly).toBe(0);
    for (let i = 0; i < 3; i++)
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${docId}/feedback`,
        headers: auth(agent),
        payload: { kind: 'other' },
      });
    sent.length = 0;
    const r = await evaluateWindows(deps); // 6 in 24h, 30d mean 0.2/day → anomaly
    expect(r.anomaly).toBe(1);
    expect(sent.some((n) => n.title.includes('כמות חריגה'))).toBe(true);
    expect((await evaluateWindows(deps)).anomaly).toBe(0);
  });

  it('digest notifies editors with open counts and skips when nothing is open', async () => {
    const { sendDigest } = await import('../src/modules/feedback/alerts.js');
    const deps = { db: db.pool, notifier: app.notifier, taxonomy: app.taxonomy, log: app.log };
    // grant feedback.manage to `lead` through a real role row so the digest query finds them
    await db.pool.query(
      `insert into user_roles(user_id, role_id) select $1, id from roles where name='editor' on conflict do nothing`,
      [lead.id],
    );
    sent.length = 0;
    const n = await sendDigest(deps);
    expect(n).toBeGreaterThanOrEqual(1);
    const mine = sent.find((x) => x.userIds.includes(lead.id));
    expect(mine?.title).toMatch(/משובים פתוחים/);
    expect(mine?.href).toBe('/feedback');
    await db.pool.query(
      `update feedback set status='no_change', decided_by=$1, decided_at=now() where status in ('new','in_review','needs_update')`,
      [lead.id],
    );
    sent.length = 0;
    expect(await sendDigest(deps)).toBe(0);
  });
});
