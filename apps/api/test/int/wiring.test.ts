import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import FormData from 'form-data';
import type pg from 'pg';
import type { Event } from '@wecom/shared';
import { startTestDb, integration } from '../helpers/db.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import { buildDocx } from '../sources/fixtures/docx-builder.js';
import { startWpStub, type WpStub } from '../../../../packages/connectors/test/helpers/wpStub.js';
import { buildApp } from '../../src/app.js';
import fakeAuth from '../helpers/fakeAuth.js';

const run = integration ? describe : describe.skip;

/**
 * Wiring tests: the seams between lanes, driven through the REAL `buildApp` with no
 * doubles at the seam under test. Every other L5/L6 test injects a stub at exactly
 * the place the branch was broken (`setContentApi`, a fake `DocumentsService`), so a
 * 148/148 green suite said nothing about whether the lanes were actually connected.
 * These tests fail if any of C1–C4 regresses.
 *
 * The only stand-in is the remote system itself (an in-process WordPress REST stub),
 * which is the one thing that cannot live in the test process for real.
 */
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The paragraph the seeded step is mapped onto, and the sentence tracked-changed into it. */
const BASE_TEXT = '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest ולדווח על התוצאה.';
const ADDED_TEXT = ' יש לבדוק גם את חוזק האות.';

run('cross-lane wiring', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let stub: WpStub;
  const events: Event[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    stub = await startWpStub([
      {
        id: 7,
        title: { rendered: 'איטיות גלישה' },
        content: { rendered: '<h2>שלב ראשון</h2><p>פתח CRM ובדוק את שדה גלישה בארץ.</p>' },
        modified_gmt: '2025-06-12T10:00:00',
        link: 'http://wp/7',
        status: 'publish',
      },
    ]);
    app = await buildApp({
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        // The deterministic model: no Ollama, but the real ModelClient contract.
        MODEL_DISABLED: true,
      },
      pool: db.pool as pg.Pool,
      boss: false,
      plugins: [fakeAuth],
    });
    await app.ready();
    await app.events.start(db.url);
    app.events.subscribe((e) => events.push(e));
    u = await makeUser(db.pool);
  }, 240000);

  afterAll(async () => {
    await app?.close();
    await stub?.close();
    await db?.stop();
  });

  const inject = (method: string, url: string, payload?: unknown, headers: Record<string, string> = {}) =>
    app.inject({
      method: method as 'GET',
      url,
      payload: payload as object,
      headers: { ...auth(u), ...headers },
    });

  // ---------------------------------------------------------------- (a) L5 -> L2

  it('upload → process → accept → publish reaches L2 and writes an attributed version (C1)', async () => {
    // A card whose only step is close enough to the docx paragraph for the
    // first-import mapping to anchor it (similarity >= MAP_THRESHOLD).
    const doc = (
      await inject('POST', '/api/v1/documents', {
        title: 'בדיקת מהירות גלישה',
        description: 'נוהל',
        category: 'tech',
        wave: 1,
        priority: 'hh',
        kind: 'steps',
      })
    ).json();
    const structured = (
      await inject(
        'PUT',
        `/api/v1/documents/${doc.id}/structure`,
        {
          phases: [
            {
              id: 'p1',
              label: 'שלב 1',
              steps: [
                {
                  key: 's1',
                  num: '1',
                  // `proposeInitialMapping` scores `title + ' ' + actions` against the
                  // paragraph text; this pair lands at ~0.72, above MAP_THRESHOLD.
                  title: 'בדיקת מהירות גלישה.',
                  actions: [{ id: 'a1', text: 'בקש מהלקוח להריץ Speedtest ולדווח על התוצאה.' }],
                  outcomes: [{ kind: 'ok', text: '✓ תקין' }],
                },
              ],
            },
          ],
        },
        { 'if-match': doc.etag },
      )
    ).json();
    const published = await inject('POST', `/api/v1/documents/${doc.id}/publish`, { label: 'v1' });
    expect(published.statusCode).toBe(200);
    expect(structured.phases[0].steps[0].actions).toHaveLength(1);

    // A .docx whose paragraph carries a real tracked insertion.
    const buf = await buildDocx({
      title: 'נהלי תמיכה טכנית',
      paragraphs: [
        {
          runs: [
            { t: BASE_TEXT },
            { t: ADDED_TEXT, ins: { author: 'ענבר ל.', date: '2025-06-12T12:48:00Z' } },
          ],
        },
      ],
    });
    const fd = new FormData();
    fd.append('file', buf, {
      filename: 'nohalim.docx',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });
    const up = await app.inject({
      method: 'POST',
      url: '/api/v1/sources/upload',
      payload: fd.getBuffer(),
      headers: { ...fd.getHeaders(), ...auth(u) },
    });
    expect(up.statusCode).toBe(200);
    const { sourceId } = up.json();

    // The pipeline. With C1 broken this 503s: buildContext calls listBlocks/listFields.
    const proc = await inject('POST', `/api/v1/sources/${sourceId}/process`);
    expect(proc.statusCode).toBe(200);
    expect(proc.json().used).toBe('rules');

    // The mapping anchored the step, so the tracked change is an update-step
    // on that step rather than a new card.
    const pending = (await inject('GET', '/api/v1/suggestions?status=pending')).json().items;
    const sug = pending.find(
      (s: { type: string; targetDocumentId: string }) =>
        s.type === 'update-step' && s.targetDocumentId === doc.id,
    );
    expect(
      sug,
      `no update-step for the mapped step; got ${JSON.stringify(pending.map((s: { type: string }) => s.type))}`,
    ).toBeTruthy();
    expect(sug.targetStepKey).toBe('s1');

    expect((await inject('POST', `/api/v1/suggestions/${sug.id}/accept`)).json().status).toBe('accepted');

    const pub = await inject('POST', '/api/v1/suggestions/publish', { sourceId });
    expect(pub.statusCode).toBe(200);
    expect(pub.json().applied).toBe(1);

    // A real `document_versions` row, attributed to the suggestion...
    const version = await db.pool.query(
      'select id, version, suggestion_id, kind from document_versions where document_id=$1 order by version desc limit 1',
      [doc.id],
    );
    expect(version.rows[0].version).toBe(2);
    expect(version.rows[0].suggestion_id).toBe(sug.id);
    expect(pub.json().versions).toContain(version.rows[0].id);

    // ...and the step text really changed in L2's normalised tables.
    const after = (await inject('GET', `/api/v1/documents/${doc.id}`)).json();
    const actions = after.phases[0].steps[0].actions.map((a: { text: string }) => a.text);
    expect(actions.length).toBe(2);
    expect(actions.join(' ')).toContain('חוזק האות');

    // I2: the apply is audited, inside the same transaction.
    const audited = await db.pool.query(
      `select action from audit_log where entity_id=$1 and action='suggestions.apply'`,
      [sug.id],
    );
    expect(audited.rowCount).toBe(1);
  }, 240000);

  // ---------------------------------------------------------------- (b) L6 <-> L2/L5

  it('connector run → suggestion → publish → sync link → push → import → conflict (C2, C3, C4)', async () => {
    const conn = (
      await inject('POST', '/api/v1/connectors', {
        type: 'wordpress',
        name: 'wp',
        config: {
          baseUrl: stub.url,
          username: 'u',
          applicationPassword: 'p',
          postTypes: ['posts'],
          categoryMap: {},
          webhookSecret: 'topsecret1',
        },
      })
    ).json();
    expect(conn.id).toBeTruthy();

    // 1. Import: linkNew needs L2's ensureSourceForConnector (the stub threw here).
    const first = await app.connectors.sync.runConnector(conn.id, u.id);
    expect(first.linked).toBe(1);
    const source = (
      await db.pool.query('select id from sources where connector_id=$1 and external_id=$2', [
        conn.id,
        'posts:7',
      ])
    ).rows[0];
    expect(source).toBeTruthy();

    // 2. The imported revision becomes a new-card suggestion...
    expect((await inject('POST', `/api/v1/sources/${source.id}/process`)).statusCode).toBe(200);
    const newCard = (await inject('GET', `/api/v1/suggestions?status=pending&sourceId=${source.id}`))
      .json()
      .items.find((s: { type: string }) => s.type === 'new-card');
    expect(newCard).toBeTruthy();
    await inject('POST', `/api/v1/suggestions/${newCard.id}/accept`);
    // Reject the rest so the revision can be marked accepted.
    for (const s of (await inject('GET', `/api/v1/suggestions?status=pending&sourceId=${source.id}`)).json()
      .items)
      await inject('POST', `/api/v1/suggestions/${s.id}/reject`);

    const applied = await inject('POST', '/api/v1/suggestions/publish', { sourceId: source.id });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(1);

    // 3. ...and `afterSuggestionsApplied` created the sync link (C4: this was dead).
    const link = (
      await db.pool.query(
        'select id, document_id, state, base_local_version, base_remote_hash from sync_links where connector_id=$1',
        [conn.id],
      )
    ).rows[0];
    expect(link, 'afterSuggestionsApplied did not create a sync_links row').toBeTruthy();
    expect(link.state).toBe('synced');
    const documentId = link.document_id as string;

    // 4. Push on publish (C3: pushOnPublish was never called).
    const putsBefore = stub.puts.length;
    const pubRes = await inject('POST', `/api/v1/documents/${documentId}/publish`, {
      label: 'עדכון מקומי',
    });
    expect(pubRes.statusCode).toBe(200);
    expect(stub.puts.length).toBeGreaterThan(putsBefore);
    expect(stub.puts.at(-1)!.id).toBe(7);
    expect(String((stub.puts.at(-1)!.body as { content?: string }).content)).toContain('<');
    const pushed = (
      await db.pool.query('select state, base_local_version from sync_links where id=$1', [link.id])
    ).rows[0];
    expect(pushed.state).toBe('synced');
    expect(pushed.base_local_version).toBe(pubRes.json().version);

    // 5. Remote-only change → import path.
    const post = stub.posts.get('posts:7')!;
    stub.posts.set('posts:7', {
      ...post,
      content: { rendered: post.content.rendered + '<p>סעיף חדש שנוסף בוורדפרס.</p>' },
      modified_gmt: new Date().toISOString().slice(0, 19),
    });
    const second = await app.connectors.sync.runConnector(conn.id, u.id);
    expect(second.imported).toBe(1);
    expect((await db.pool.query('select state from sync_links where id=$1', [link.id])).rows[0].state).toBe(
      'pending_import',
    );
    const revisions = await db.pool.query('select count(*)::int n from source_revisions where source_id=$1', [
      source.id,
    ]);
    expect(revisions.rows[0].n).toBe(2);
    expect((await inject('POST', `/api/v1/sources/${source.id}/process`)).statusCode).toBe(200);
    const imported = (await inject('GET', `/api/v1/suggestions?status=pending&sourceId=${source.id}`)).json();
    expect(imported.total).toBeGreaterThan(0);

    // 6. Both sides changed → conflict, and a sync.conflict event.
    events.length = 0;
    await inject('POST', `/api/v1/documents/${documentId}/publish`, { label: 'שינוי מקומי נוסף' });
    const post2 = stub.posts.get('posts:7')!;
    stub.posts.set('posts:7', {
      ...post2,
      content: { rendered: post2.content.rendered + '<p>ושינוי נוסף מרחוק.</p>' },
      modified_gmt: new Date().toISOString().slice(0, 19),
    });
    const third = await app.connectors.sync.runConnector(conn.id, u.id);
    expect(third.conflicts).toBe(1);
    const conflicted = (await db.pool.query('select state, conflict from sync_links where id=$1', [link.id]))
      .rows[0];
    expect(conflicted.state).toBe('conflict');
    expect(conflicted.conflict).toBeTruthy();

    for (let i = 0; i < 40 && !events.some((e) => e.name === 'sync.conflict'); i++) await wait(50);
    const conflictEvent = events.find((e) => e.name === 'sync.conflict');
    expect(conflictEvent, 'no sync.conflict event was delivered').toBeTruthy();
    expect(conflictEvent!.payload).toMatchObject({ connectorId: conn.id, documentId, externalId: 'posts:7' });

    // The remote is never overwritten while a link is in conflict.
    const putsAtConflict = stub.puts.length;
    await inject('POST', `/api/v1/documents/${documentId}/publish`, { label: 'לא אמור להידחף' });
    expect(stub.puts.length).toBe(putsAtConflict);
  }, 240000);
});
