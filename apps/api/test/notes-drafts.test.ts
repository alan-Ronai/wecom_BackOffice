import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;
run('notes, drafts and preferences', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    u = await makeUser(db.pool);
  }, 120000);
  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('notes with likes and moderation', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'n', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    const agent = await makeUser(db.pool, { perms: ['docs.read', 'notes.write'], name: 'דנה ר.' });
    const n = (
      await app.inject({
        method: 'POST',
        url: `/api/v1/documents/${c.id}/notes`,
        headers: auth(agent),
        payload: { stepKey: 's8', text: 'Speedtest חוסם ב-Wi-Fi' },
      })
    ).json();
    expect(n.authorName).toBe('דנה ר.');
    expect(n.likes).toBe(0);
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/notes/${n.id}/like`, headers: auth(u) })).json(),
    ).toEqual({ likes: 1, likedByMe: true });
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/notes/${n.id}/like`, headers: auth(u) })).json(),
    ).toEqual({ likes: 0, likedByMe: false });
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${c.id}/notes`, headers: auth(u) })).json()
        .items,
    ).toHaveLength(1);
    const other = await makeUser(db.pool, { perms: ['docs.read', 'notes.write'] });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/notes/${n.id}`, headers: auth(other) })).statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/notes/${n.id}`, headers: auth(agent) })).statusCode,
    ).toBe(204);
  });

  it('drafts show other editors', async () => {
    const c = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(u),
        payload: { title: 'd', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    const other = await makeUser(db.pool, { name: 'אלון ר.' });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${c.id}/draft`,
      headers: auth(other),
      payload: { payload: { title: 'x' } },
    });
    const mine = (
      await app.inject({
        method: 'PUT',
        url: `/api/v1/documents/${c.id}/draft`,
        headers: auth(u),
        payload: { payload: { title: 'y' } },
      })
    ).json();
    expect(mine.otherEditors.map((e: { name: string }) => e.name)).toEqual(['אלון ר.']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/drafts', headers: auth(u) })).json().items).toHaveLength(
      1,
    );
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/documents/${c.id}/draft`, headers: auth(u) }))
        .statusCode,
    ).toBe(204);
  });

  it('keeps new-document drafts under their own key', async () => {
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/drafts/new/abc123',
      headers: auth(u),
      payload: { payload: { title: 'מסמך חדש' } },
    });
    expect(put.json().draftKey).toBe('new:abc123');
    expect(put.json().documentId).toBeNull();
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/drafts/new/abc123', headers: auth(u) })).json()
        .payload.title,
    ).toBe('מסמך חדש');
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/drafts/new/abc123', headers: auth(u) }))
        .statusCode,
    ).toBe(204);
  });

  it('preferences round-trip', async () => {
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/v1/me/preferences',
          headers: auth(u),
          payload: { theme: 'dark' },
        })
      ).json().theme,
    ).toBe('dark');
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/me/preferences', headers: auth(u) })).json(),
    ).toMatchObject({ theme: 'dark', font: 'plex' });
  });
});
