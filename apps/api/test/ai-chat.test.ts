import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { makeUser } from './helpers/fixtures.js';
import { withTransaction } from '../src/lib/sql.js';
import * as repo from '../src/modules/ai/repo.js';

const run = integration ? describe : describe.skip;

run('ai repo', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let user: Awaited<ReturnType<typeof makeUser>>;
  beforeAll(async () => {
    db = await startTestDb();
    user = await makeUser(db.pool, { name: 'עורכת' });
  }, 120_000);
  afterAll(async () => db?.stop());

  const blank = {
    toolCalls: [],
    toolResults: [],
    proposedEditsId: null,
    refinedSuggestionId: null,
    tokensIn: 0,
    tokensOut: 0,
    latencyMs: 0,
    model: 'fake',
    promptVersion: 'v3.0.0',
  };

  it('numbers messages per conversation and keeps tool payloads', async () => {
    const c = await withTransaction(db.pool, (tx) =>
      repo.createConversation(tx, {
        kind: 'editor',
        documentId: null,
        sourceRevisionId: null,
        userId: user.id,
        title: '',
        model: 'fake',
        promptVersion: 'v3.0.0',
      }),
    );
    const [m1, m2] = await withTransaction(db.pool, async (tx) => {
      const a = await repo.insertMessage(tx, {
        ...blank,
        conversationId: c.id,
        seq: await repo.nextSeq(tx, c.id),
        role: 'user',
        content: 'שלום',
      });
      const b = await repo.insertMessage(tx, {
        ...blank,
        conversationId: c.id,
        seq: await repo.nextSeq(tx, c.id),
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 't1', name: 'read_document', args: { documentId: 'x' } }],
        tokensIn: 3,
      });
      return [a, b];
    });
    expect([m1.seq, m2.seq]).toEqual([1, 2]);
    const list = await repo.listMessages(db.pool, c.id);
    expect(list.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(list[1].toolCalls?.[0].name).toBe('read_document');
    expect((await repo.getConversation(db.pool, c.id))?.messageCount).toBe(2);
  });

  it('lists only the caller’s live conversations unless userId is null', async () => {
    const other = await makeUser(db.pool, { name: 'אחר' });
    await withTransaction(db.pool, (tx) =>
      repo.createConversation(tx, {
        kind: 'article',
        documentId: null,
        sourceRevisionId: null,
        userId: other.id,
        title: 'x',
        model: 'fake',
        promptVersion: 'v',
      }),
    );
    const mine = await repo.listConversations(db.pool, { page: 1, pageSize: 50, userId: user.id });
    expect(mine.items.every((c) => c.userId === user.id)).toBe(true);
    const all = await repo.listConversations(db.pool, { page: 1, pageSize: 50, userId: null });
    expect(all.total).toBeGreaterThan(mine.total);
  });

  it('records the caller’s own feedback and hides everyone else’s, and soft delete hides the row', async () => {
    const c = await withTransaction(db.pool, (tx) =>
      repo.createConversation(tx, {
        kind: 'workspace',
        documentId: null,
        sourceRevisionId: null,
        userId: user.id,
        title: '',
        model: 'fake',
        promptVersion: 'v',
      }),
    );
    const other = await makeUser(db.pool, { name: 'שני' });
    const m = await withTransaction(db.pool, async (tx) =>
      repo.insertMessage(tx, {
        ...blank,
        conversationId: c.id,
        seq: await repo.nextSeq(tx, c.id),
        role: 'assistant',
        content: 'תשובה',
      }),
    );
    await withTransaction(db.pool, (tx) => repo.setFeedback(tx, m.id, other.id, 'down', 'לא מדויק'));
    expect((await repo.listMessages(db.pool, c.id, user.id))[0].feedback).toBeNull();
    expect((await repo.listMessages(db.pool, c.id, other.id))[0].feedback).toBe('down');
    // Upsert, not a second row.
    await withTransaction(db.pool, (tx) => repo.setFeedback(tx, m.id, other.id, 'up', ''));
    expect((await repo.listMessages(db.pool, c.id, other.id))[0].feedback).toBe('up');

    const rows: string[] = [];
    for await (const row of repo.exportCursor(db.pool, { userId: user.id }))
      rows.push(row.conversation.id);
    expect(rows).toContain(c.id);

    expect(await withTransaction(db.pool, (tx) => repo.softDeleteConversation(tx, c.id))).toBe(true);
    expect(await repo.getConversation(db.pool, c.id)).toBeNull();
    expect(await withTransaction(db.pool, (tx) => repo.softDeleteConversation(tx, c.id))).toBe(false);
  });
});
