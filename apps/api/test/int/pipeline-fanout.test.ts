import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type pg from 'pg';
import type { Event } from '@wecom/shared';
import { startTestDb, integration } from '../helpers/db.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import { startWpStub, type WpStub } from '../../../../packages/connectors/test/helpers/wpStub.js';
import { buildApp } from '../../src/app.js';
import fakeAuth from '../helpers/fakeAuth.js';

const run = integration ? describe : describe.skip;

/**
 * Pipeline fan-out — the defect this suite pins:
 *
 * a first import of a connector item produced one `new-card` suggestion per paragraph (a card
 * for the `<h2>`, a card for the `<p>`, a card per `<li>`), and `afterSuggestionsApplied`
 * upserted the single `(connector, external_id)` sync link once per applied card. The last
 * document won the link; its siblings were orphaned from sync and from the source-document
 * (`putSourceFromRemote`) flow, so the remote HTML landed on a document nobody was looking at.
 *
 * Driven through the real `buildApp` — the only stand-in is WordPress itself.
 */

const WP_TITLE = 'נוהל WordPress לבדיקה';
const WP_BODY = '<h2>מבוא</h2><p>סף מהירות: 5 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>';
const WP_BODY_EDITED =
  '<h2>מבוא</h2><p>סף מהירות: 6 מגה.</p><ul><li>בדיקת APN</li><li>ניתוק מ-Wi-Fi</li></ul>';

run('pipeline fan-out: one remote item is one document', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let stub: WpStub;
  let connectorId: string;
  let sourceId: string;
  let documentId: string;
  const events: Event[] = [];

  beforeAll(async () => {
    db = await startTestDb();
    stub = await startWpStub([
      {
        id: 101,
        title: { rendered: WP_TITLE },
        content: { rendered: WP_BODY },
        modified_gmt: '2026-06-12T10:00:00',
        link: 'http://wp/101',
        status: 'publish',
      },
    ]);
    app = await buildApp({
      config: {
        DATABASE_URL: db.url,
        NODE_ENV: 'test',
        // The deterministic RuleBasedModel, through the real ModelClient contract.
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

  it('one WordPress post becomes ONE suggestion, ONE document and ONE sync link', async () => {
    const conn = (
      await inject('POST', '/api/v1/connectors', {
        type: 'wordpress',
        name: 'wp-fanout',
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
    connectorId = conn.id;

    expect((await app.connectors.sync.runConnector(connectorId, u.id)).linked).toBe(1);
    sourceId = (
      await db.pool.query('select id from sources where connector_id=$1 and external_id=$2', [
        connectorId,
        'posts:101',
      ])
    ).rows[0].id;

    expect((await inject('POST', `/api/v1/sources/${sourceId}/process`)).statusCode).toBe(200);
    const pending = (await inject('GET', `/api/v1/suggestions?status=pending&sourceId=${sourceId}`)).json();
    // The defect: four paragraphs (h2, p, and a card per li) produced four suggestions here.
    expect(pending.total, 'one section of one post = one suggestion').toBe(1);
    const card = pending.items[0];
    expect(card.type).toBe('new-card');
    // The card is named after the POST, not after the first sentence of a paragraph.
    expect(card.title).toBe(WP_TITLE);

    await inject('POST', `/api/v1/suggestions/${card.id}/accept`);
    const applied = await inject('POST', '/api/v1/suggestions/publish', { sourceId });
    expect(applied.statusCode).toBe(200);
    expect(applied.json().applied).toBe(1);

    const links = (
      await db.pool.query('select id, document_id, state from sync_links where connector_id=$1', [
        connectorId,
      ])
    ).rows;
    expect(links, 'exactly one sync link for one remote item').toHaveLength(1);
    expect(links[0].state).toBe('synced');
    documentId = links[0].document_id;

    const fed = await db.pool.query('select id from documents where source_id=$1 and deleted_at is null', [
      sourceId,
    ]);
    expect(fed.rows.map((r) => r.id)).toEqual([documentId]);

    const doc = (await inject('GET', `/api/v1/documents/${documentId}`)).json();
    expect(doc.title).toBe(WP_TITLE);
    expect(doc.phases).toHaveLength(1);
    expect(doc.phases[0].label).toBe('מבוא');
    expect(
      doc.phases[0].steps.map((s: { title: string; sourceRef?: string }) => [s.title, s.sourceRef]),
    ).toEqual([
      ['סף מהירות: 5 מגה', '§h2-1.p-1'],
      ['בדיקת APN', '§h2-1.ul-2'],
      ['ניתוק מ-Wi-Fi', '§h2-1.ul-2'],
    ]);
  }, 240000);

  it('a remote edit lands as the source HTML of that same document', async () => {
    const post = stub.posts.get('posts:101')!;
    stub.posts.set('posts:101', {
      ...post,
      content: { rendered: WP_BODY_EDITED },
      modified_gmt: new Date().toISOString().slice(0, 19),
    });
    expect((await app.connectors.sync.runConnector(connectorId, u.id)).imported).toBe(1);

    const src = await inject('GET', `/api/v1/documents/${documentId}/source`);
    expect(src.statusCode, 'the linked document has a source document').toBe(200);
    expect(src.json().html).toContain('6 מגה');
  }, 240000);

  it('afterSuggestionsApplied keeps a link that already points at another document', async () => {
    const other = (
      await inject('POST', '/api/v1/documents', {
        title: 'מסמך אחר לגמרי',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'm',
        kind: 'steps',
      })
    ).json();
    events.length = 0;

    await app.connectors.sync.afterSuggestionsApplied(sourceId, other.id, 1);

    const links = (
      await db.pool.query('select document_id from sync_links where connector_id=$1', [connectorId])
    ).rows;
    expect(links).toHaveLength(1);
    expect(links[0].document_id, 'the existing link was kept, not re-pointed').toBe(documentId);
    const skipped = events.find((e) => e.name === 'sync.link_skipped');
    expect(skipped, 'the skip is reported rather than silent').toBeTruthy();
    expect(skipped!.payload).toMatchObject({
      connectorId,
      externalId: 'posts:101',
      documentId,
      skippedDocumentId: other.id,
    });
  }, 240000);
});
