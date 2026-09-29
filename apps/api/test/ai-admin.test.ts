import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { integration } from './helpers/db.js';
import { auth, type TestUser } from './helpers/fixtures.js';
import { makeAiFixture } from './helpers/ai/fixture.js';
import { chatResult, fakeChat } from './helpers/ai/fakeChat.js';
import { aiChatHolder } from '../src/modules/ai/chatModel.js';

const run = integration ? describe : describe.skip;

/** Feedback, the admin transcript browser, the JSONL export and the delete (spec §1.5). */
run('ai feedback, transcripts and export', () => {
  let fx: Awaited<ReturnType<typeof makeAiFixture>>;
  let conversationId: string;
  let assistantMessageId: string;

  beforeAll(async () => {
    fx = await makeAiFixture();
    aiChatHolder.swap(fakeChat(() => chatResult('לפי שלב 1, זו התשובה.')));
    const c = await fx.post(
      '/api/v1/ai/conversations',
      { kind: 'editor', documentId: fx.techDoc },
      fx.editor,
    );
    conversationId = c.json().id as string;
    await fx.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${conversationId}/messages`,
      headers: auth(fx.editor),
      payload: { content: 'מה עושים?' },
    });
    const detail = (await fx.get(`/api/v1/ai/conversations/${conversationId}`, fx.editor)).json();
    assistantMessageId = detail.messages.at(-1).id as string;
  }, 240_000);
  afterAll(async () => fx?.close());

  const feedback = (messageId: string, body: unknown, u: TestUser) =>
    fx.app.inject({
      method: 'POST',
      url: `/api/v1/ai/messages/${messageId}/feedback`,
      headers: auth(u),
      payload: body,
    });

  it('records the participant’s rating, upserts it, and 404s everyone else', async () => {
    expect(
      (await feedback(assistantMessageId, { rating: 'down', note: 'לא מדויק' }, fx.editor)).statusCode,
    ).toBe(204);
    let detail = (await fx.get(`/api/v1/ai/conversations/${conversationId}`, fx.editor)).json();
    expect(detail.messages.at(-1).feedback).toBe('down');

    expect((await feedback(assistantMessageId, { rating: 'up' }, fx.editor)).statusCode).toBe(204);
    detail = (await fx.get(`/api/v1/ai/conversations/${conversationId}`, fx.editor)).json();
    expect(detail.messages.at(-1).feedback).toBe('up');

    // Not a participant: the message does not exist for them, even for an admin.
    expect((await feedback(assistantMessageId, { rating: 'up' }, fx.otherEditor)).statusCode).toBe(404);
    expect((await feedback(assistantMessageId, { rating: 'up' }, fx.admin)).statusCode).toBe(404);
  });

  it('the admin transcript browser needs ai.manage and sees every author', async () => {
    expect((await fx.get('/api/v1/admin/ai/conversations?page=1&pageSize=50', fx.editor)).statusCode).toBe(
      403,
    );
    const r = await fx.get('/api/v1/admin/ai/conversations?page=1&pageSize=50', fx.admin);
    expect(r.statusCode).toBe(200);
    const items = r.json().items as { id: string; userName: string }[];
    expect(items.map((c) => c.id)).toContain(conversationId);
    expect(items.find((c) => c.id === conversationId)?.userName).toBe(fx.editor.name);
  });

  it('B-M12: `q` searches message bodies, `page` pages, and neither widens what a caller sees', async () => {
    const other = await fx.post(
      '/api/v1/ai/conversations',
      { kind: 'editor', documentId: fx.techDoc },
      fx.otherEditor,
    );
    const otherId = other.json().id as string;
    await fx.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${otherId}/messages`,
      headers: auth(fx.otherEditor),
      payload: { content: 'איך מאפסים נתב זברה_42%?' },
    });
    const list = async (qs: string, u: TestUser = fx.admin) => {
      const r = await fx.get(`/api/v1/admin/ai/conversations?${qs}`, u);
      expect(r.statusCode).toBe(200);
      return r.json() as { items: { id: string }[]; total: number; page: number; pageSize: number };
    };
    const ids = (b: { items: { id: string }[] }) => b.items.map((c) => c.id);

    // A word from a user message, and one from an assistant reply.
    expect(ids(await list(`q=${encodeURIComponent('זברה')}`))).toEqual([otherId]);
    const byReply = ids(await list(`q=${encodeURIComponent('זו התשובה')}`));
    expect(byReply).toEqual(expect.arrayContaining([conversationId, otherId]));
    // Case-insensitive, and the LIKE wildcards are literals, not wildcards.
    expect(ids(await list(`q=${encodeURIComponent('_42%')}`))).toEqual([otherId]);
    expect((await list(`q=${encodeURIComponent('%')}`)).items.map((c) => c.id)).toEqual([otherId]);
    expect((await list('q=' + encodeURIComponent('אין-כזה-דבר'))).total).toBe(0);
    // Blank is no filter.
    expect((await list('q=%20')).total).toBe((await list('')).total);
    // Composes with the other filters.
    expect((await list(`q=${encodeURIComponent('זברה')}&userId=${fx.editor.id}`)).total).toBe(0);

    // Paging: one row per page, disjoint pages, a stable total.
    const all = await list('pageSize=200');
    expect(all.total).toBeGreaterThanOrEqual(2);
    const p1 = await list('page=1&pageSize=1');
    const p2 = await list('page=2&pageSize=1');
    expect(p1).toMatchObject({ page: 1, pageSize: 1, total: all.total });
    expect(p2).toMatchObject({ page: 2, pageSize: 1, total: all.total });
    expect(ids(p1)).toHaveLength(1);
    expect(ids(p2)).toHaveLength(1);
    expect(ids(p1)[0]).not.toBe(ids(p2)[0]);

    // The export is what the browser shows: the same search, unpaged.
    const exported = await fx.get(
      `/api/v1/admin/ai/conversations/export.jsonl?q=${encodeURIComponent('זברה')}`,
      fx.admin,
    );
    expect(exported.statusCode).toBe(200);
    const lines = exported.body
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l).conversation.id as string);
    expect(lines).toEqual([otherId]);

    // The own-conversations route takes `q` too, and stays scoped to the caller.
    const own = await fx.get(`/api/v1/ai/conversations?q=${encodeURIComponent('זברה')}`, fx.editor);
    expect(own.statusCode).toBe(200);
    expect(own.json().total).toBe(0);
    const theirs = await fx.get(`/api/v1/ai/conversations?q=${encodeURIComponent('זברה')}`, fx.otherEditor);
    expect(theirs.json().items.map((c: { id: string }) => c.id)).toEqual([otherId]);
  });

  it('exports NDJSON with one line per conversation, carrying messages and feedback', async () => {
    expect((await fx.get('/api/v1/admin/ai/conversations/export.jsonl', fx.editor)).statusCode).toBe(403);
    const r = await fx.get('/api/v1/admin/ai/conversations/export.jsonl', fx.admin);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/application\/x-ndjson/);
    const lines = r.body
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const mine = lines.find((l) => l.conversation.id === conversationId);
    expect(mine).toBeTruthy();
    expect(mine.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(mine.feedback[0]).toMatchObject({ rating: 'up', userId: fx.editor.id });
  });

  it('a delete is a soft delete the owner can no longer read', async () => {
    expect(
      (
        await fx.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/ai/conversations/${conversationId}`,
          headers: auth(fx.editor),
        })
      ).statusCode,
    ).toBe(403);
    const del = await fx.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/ai/conversations/${conversationId}`,
      headers: auth(fx.admin),
    });
    expect(del.statusCode).toBe(204);
    expect((await fx.get(`/api/v1/ai/conversations/${conversationId}`, fx.editor)).statusCode).toBe(404);
    // Soft, not gone: the row and its messages are still there for an audit.
    const row = await fx.db.pool.query('select deleted_at from ai_conversations where id=$1', [
      conversationId,
    ]);
    expect(row.rows[0].deleted_at).not.toBeNull();
    const audit = await fx.db.pool.query(
      `select 1 from audit_log where action='ai.conversation.delete' and entity_id=$1`,
      [conversationId],
    );
    expect(audit.rowCount).toBe(1);
    // A second delete has nothing left to delete.
    expect(
      (
        await fx.app.inject({
          method: 'DELETE',
          url: `/api/v1/admin/ai/conversations/${conversationId}`,
          headers: auth(fx.admin),
        })
      ).statusCode,
    ).toBe(404);
  });
});
