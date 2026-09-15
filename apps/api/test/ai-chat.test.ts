import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AiSettingsSchema, DEFAULT_ROLES, PERMISSIONS, toolsFor, type ChatEvent } from '@wecom/shared';
import { integration } from './helpers/db.js';
import { auth, makeUser, type TestUser } from './helpers/fixtures.js';
import { makeAiFixture, SECRET } from './helpers/ai/fixture.js';
import { chatResult, fakeChat } from './helpers/ai/fakeChat.js';
import { putAiSettings } from '../src/lib/aiSettings.js';
import { withTransaction } from '../src/lib/sql.js';
import type { ReqUser } from '../src/lib/user.js';
import * as repo from '../src/modules/ai/repo.js';
import { MAX_TOOL_ROUNDS } from '../src/modules/ai/chat.js';
import { aiChatHolder, unavailableChatModel } from '../src/modules/ai/chatModel.js';
import { resetRateLimit } from '../src/modules/ai/rateLimit.js';
import { ScriptedChatModel } from '../src/modules/ai/scripted.js';
import { parseSseFrames } from '../src/modules/ai/sse.js';
import { runTool, specsFor, type ToolCtx } from '../src/modules/ai/tools/index.js';

const run = integration ? describe : describe.skip;

/** One app and one database for the whole file: a testcontainer per describe is a minute each. */
let fx: Awaited<ReturnType<typeof makeAiFixture>>;

run('ai chat', () => {
  beforeAll(async () => {
    fx = await makeAiFixture();
  }, 240_000);
  afterAll(async () => fx?.close());

  describe('repo', () => {
    runRepoTests();
  });

  describe('tools', () => {
    runToolTests();
  });

  describe('routes', () => {
    runRouteTests();
  });
});

function runRepoTests() {
  let db: { pool: import('pg').Pool };
  let user: TestUser;
  beforeAll(async () => {
    db = fx.db;
    user = await makeUser(db.pool, { name: 'עורכת רפו' });
  });

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
    for await (const row of repo.exportCursor(db.pool, { userId: user.id })) rows.push(row.conversation.id);
    expect(rows).toContain(c.id);

    expect(await withTransaction(db.pool, (tx) => repo.softDeleteConversation(tx, c.id))).toBe(true);
    expect(await repo.getConversation(db.pool, c.id)).toBeNull();
    expect(await withTransaction(db.pool, (tx) => repo.softDeleteConversation(tx, c.id))).toBe(false);
  });
}

function runToolTests() {
  const settings = AiSettingsSchema.parse({ brief: {}, style: {}, models: {}, limits: {} });

  const reqUser = (u: TestUser, perms: readonly string[], scopes: string[] | null): ReqUser =>
    ({
      id: u.id,
      displayName: u.name,
      sessionId: null,
      roles: [],
      permissions: new Set(perms),
      worldScopes: scopes,
      categoryScopes: scopes,
    }) as ReqUser;

  const users = () => ({
    admin: reqUser(fx.admin, PERMISSIONS, null),
    agent: reqUser(fx.agent, DEFAULT_ROLES.agent, null),
    editor: reqUser(fx.editor, DEFAULT_ROLES.editor, ['tech']),
  });

  const mkCtx = (user: ReqUser, model: ToolCtx['model'] = null): ToolCtx => ({
    db: fx.db.pool,
    user,
    conversation: {
      id: '00000000-0000-4000-8000-000000000001',
      kind: 'editor',
      documentId: fx.techDoc,
      documentTitle: null,
      sourceRevisionId: null,
      userId: user.id,
      userName: user.displayName,
      title: '',
      model: 'fake',
      promptVersion: 'v3.0.0',
      messageCount: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    document: null,
    model,
    settings,
    log: fx.app.log,
  });

  const allowed = (u: ReqUser) => new Set(toolsFor(u.permissions));

  it('read_document respects visibility and scope', async () => {
    const { agent } = users();
    const ok = await runTool(mkCtx(agent), allowed(agent), {
      id: 'c1',
      name: 'read_document',
      args: { documentId: fx.techDoc },
    });
    expect(ok.ok).toBe(true);
    const hidden = await runTool(mkCtx(agent), allowed(agent), {
      id: 'c2',
      name: 'read_document',
      args: { documentId: fx.billingDraft },
    });
    expect(hidden.ok).toBe(false);
    expect(JSON.stringify(hidden)).not.toContain(SECRET);
  });

  it('search_kb and list_suggestions never return an out-of-scope document', async () => {
    const { editor } = users();
    const hits = await runTool(mkCtx(editor), allowed(editor), {
      id: 'c1',
      name: 'search_kb',
      args: { q: SECRET.slice(0, 10) },
    });
    expect(JSON.stringify(hits)).not.toContain(SECRET);
    const list = await runTool(mkCtx(editor), allowed(editor), {
      id: 'c2',
      name: 'list_suggestions',
      args: { documentId: fx.billingDraft },
    });
    expect(list).toMatchObject({ ok: false });
  });

  it('refuses a tool outside the caller’s tier even when asked', async () => {
    const { agent } = users();
    const r = await runTool(mkCtx(agent), allowed(agent), {
      id: 'c3',
      name: 'propose_source_edit',
      args: { documentId: fx.techDoc, instruction: 'x' },
    });
    expect(r).toMatchObject({ ok: false, summary: expect.stringContaining('אין הרשאה') });
  });

  it('refuses a tool nobody defined', async () => {
    const { admin } = users();
    const r = await runTool(mkCtx(admin), allowed(admin), {
      id: 'c0',
      name: 'delete_everything',
      args: {},
    });
    expect(r).toMatchObject({ ok: false, summary: expect.stringContaining('כלי לא מוכר') });
  });

  it('rejects malformed arguments with a summary, not an exception', async () => {
    const { admin } = users();
    const r = await runTool(mkCtx(admin), allowed(admin), {
      id: 'c4',
      name: 'search_kb',
      args: { q: 'a' },
    });
    expect(r.ok).toBe(false);
  });

  it('propose_source_edit turns the model’s rewrite into anchored ops and writes nothing', async () => {
    const { admin } = users();
    const model = fakeChat(({ lastUser }) => {
      // Echo the paragraphs the tool sent, with the first one shortened.
      const blocks = [...lastUser.matchAll(/§(\S+)\n([^\n]+)/g)].map((m) => ({
        ref: m[1],
        text: m[2],
      }));
      return chatResult(
        blocks.map((b, i) => `§${b.ref}\n${i === 0 ? 'החלף את הסים ובדוק תקינות.' : b.text}`).join('\n\n'),
      );
    });
    const r = await runTool(mkCtx(admin, model), allowed(admin), {
      id: 'c5',
      name: 'propose_source_edit',
      args: { documentId: fx.techDoc, instruction: 'קצר את הפסקה הראשונה' },
    });
    expect(r.ok).toBe(true);
    expect((r as { proposedEdits?: unknown[] }).proposedEdits).toEqual([
      expect.objectContaining({ kind: 'replace', after: 'החלף את הסים ובדוק תקינות.' }),
    ]);
    const src = await fx.db.pool.query('select current_version from source_documents where document_id=$1', [
      fx.techDoc,
    ]);
    expect(src.rows[0].current_version).toBe(1); // untouched
  });

  it('propose_source_edit fails closed when the model ignores the format', async () => {
    const { admin } = users();
    const r = await runTool(
      mkCtx(
        admin,
        fakeChat(() => chatResult('בטח, שיניתי הכול!')),
      ),
      allowed(admin),
      { id: 'c6', name: 'propose_source_edit', args: { documentId: fx.techDoc, instruction: 'תקן' } },
    );
    expect(r.ok).toBe(false);
  });

  it('refine_suggestion returns a payload of the same type or fails closed', async () => {
    const { admin } = users();
    const bad = fakeChat(() =>
      chatResult(JSON.stringify({ type: 'new-step', afterStepKey: null, title: 'x', actions: [] })),
    );
    const r = await runTool(mkCtx(admin, bad), allowed(admin), {
      id: 'c7',
      name: 'refine_suggestion',
      args: { suggestionId: fx.suggestionId, instruction: 'x' },
    });
    expect(r.ok).toBe(false); // the suggestion is update-step

    const good = fakeChat(() =>
      chatResult(JSON.stringify({ type: 'update-step', addActions: ['בדוק APN'], patch: {} })),
    );
    const ok = await runTool(mkCtx(admin, good), allowed(admin), {
      id: 'c8',
      name: 'refine_suggestion',
      args: { suggestionId: fx.suggestionId, instruction: 'x' },
    });
    expect(ok.ok).toBe(true);
    expect((ok as { refined?: { editedPayload: { type: string } } }).refined?.editedPayload.type).toBe(
      'update-step',
    );
    // A refinement is a proposal: the stored row is untouched.
    const row = await fx.db.pool.query('select edited_payload from suggestions where id=$1', [
      fx.suggestionId,
    ]);
    expect(row.rows[0].edited_payload).toBeNull();
  });

  it('draft_step keys the draft itself and validates the model’s step', async () => {
    const { admin } = users();
    const model = fakeChat(() =>
      chatResult(
        JSON.stringify({
          key: 's1',
          num: '3',
          title: 'שלב חדש',
          actions: [{ id: 'a1', text: 'בדוק' }],
          outcomes: [{ kind: 'ok', text: '✓ סיום' }],
        }),
      ),
    );
    const r = await runTool(mkCtx(admin, model), allowed(admin), {
      id: 'c9',
      name: 'draft_step',
      args: { documentId: fx.techDoc, afterStepKey: 's1', instruction: 'הוסף שלב' },
    });
    expect(r.ok).toBe(true);
    expect((r as { data: { step: { key: string } } }).data.step.key).toBe('draft-1');
  });

  it('read_source, read_impact, explain_step and read_eval answer for the editor', async () => {
    const { editor, admin } = users();
    const src = await runTool(mkCtx(editor), allowed(editor), {
      id: 'd1',
      name: 'read_source',
      args: { documentId: fx.techDoc },
    });
    expect(src.ok).toBe(true);
    expect((src as { data: { paragraphs: unknown[] } }).data.paragraphs.length).toBeGreaterThan(0);

    const impact = await runTool(mkCtx(editor), allowed(editor), {
      id: 'd2',
      name: 'read_impact',
      args: { documentId: fx.techDoc },
    });
    expect(impact.ok).toBe(true);

    const step = await runTool(mkCtx(editor), allowed(editor), {
      id: 'd3',
      name: 'explain_step',
      args: { documentId: fx.techDoc, stepKey: 's2' },
    });
    expect(step.ok).toBe(true);
    expect((step as { data: { comesFrom: { key: string }[] } }).data.comesFrom[0].key).toBe('s1');

    // X1's 0051 is not on this branch: the tool reports "no runs" rather than failing.
    const evals = await runTool(mkCtx(admin), allowed(admin), {
      id: 'd4',
      name: 'read_eval',
      args: {},
    });
    expect(evals.ok).toBe(true);
  });

  it('offers the model only the tools the caller holds', () => {
    const { agent, editor, admin } = users();
    expect(specsFor(toolsFor(agent.permissions)).map((s) => s.name)).toEqual([
      'read_document',
      'read_topic',
      'search_kb',
      'explain_step',
    ]);
    expect(specsFor(toolsFor(editor.permissions)).map((s) => s.name)).not.toContain('read_eval');
    expect(specsFor(toolsFor(admin.permissions)).map((s) => s.name)).toContain('read_eval');
    const spec = specsFor(['search_kb'])[0];
    expect(spec.parameters).toMatchObject({
      type: 'object',
      properties: { q: { type: 'string', minLength: 2, maxLength: 120 } },
      required: ['q'],
    });
  });
}

function runRouteTests() {
  const send = (cid: string, content: string, u: TestUser) =>
    fx.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${cid}/messages`,
      headers: auth(u),
      payload: { content },
    });

  const newConversation = async (kind: string, u: TestUser, documentId: string | null = fx.techDoc) =>
    fx.post('/api/v1/ai/conversations', { kind, documentId }, u);

  it('streams tool_call → tool_result → token → done and persists them in order', async () => {
    aiChatHolder.swap(
      fakeChat(({ messages }) =>
        messages.some((m) => m.role === 'tool')
          ? chatResult('לפי שלב 2, יש לאפס APN.')
          : chatResult('', [{ id: 'c1', name: 'read_document', args: { documentId: fx.techDoc } }]),
      ),
    );
    const c = await newConversation('editor', fx.editor);
    expect(c.statusCode).toBe(201);
    const cid = c.json().id as string;
    const r = await send(cid, 'מה עושים כשאין גלישה?', fx.editor);
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-type']).toMatch(/text\/event-stream/);

    const ev = parseSseFrames(r.body);
    const kinds = ev.map((e) => e.type);
    expect(kinds[0]).toBe('tool_call');
    expect(kinds[1]).toBe('tool_result');
    expect(kinds.at(-1)).toBe('done');
    expect(kinds.filter((k) => k === 'token').length).toBeGreaterThan(0);
    const done = ev.at(-1) as Extract<ChatEvent, { type: 'done' }>;
    expect(done.tokensOut).toBeGreaterThan(0);
    // Contract: a tool_result carries the tool's name.
    expect(ev[1]).toMatchObject({ type: 'tool_result', name: 'read_document', ok: true });

    const detail = (await fx.get(`/api/v1/ai/conversations/${cid}`, fx.editor)).json();
    expect(detail.messages.map((m: { role: string }) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'assistant',
    ]);
    expect(detail.messages.at(-1).id).toBe(done.messageId);
    expect(detail.messages.at(-1).content).toContain('שלב 2');
    expect(detail.messages[2].toolResults[0].ok).toBe(true);
    expect(detail.conversation.title).toBe('מה עושים כשאין גלישה?');
  });

  it('an agent gets only the ask tools and cannot make the model run a write tool', async () => {
    const seen: string[][] = [];
    aiChatHolder.swap(
      fakeChat(({ tools, messages }) => {
        seen.push(tools);
        return messages.some((m) => m.role === 'tool')
          ? chatResult('לא אוכל לערוך.')
          : chatResult('', [
              { id: 'x', name: 'propose_source_edit', args: { documentId: fx.techDoc, instruction: 'x' } },
            ]);
      }),
    );
    const before = await fx.db.pool.query('select count(*)::int n from ai_proposed_edits');
    const c = await newConversation('article', fx.agent);
    expect(c.statusCode).toBe(201);
    const r = await send(c.json().id, 'שנה את המסמך', fx.agent);
    const ev = parseSseFrames(r.body);
    expect([...seen[0]].sort()).toEqual(['explain_step', 'read_document', 'read_topic', 'search_kb']);
    expect(ev.find((e) => e.type === 'tool_result')).toMatchObject({ ok: false });
    const after = await fx.db.pool.query('select count(*)::int n from ai_proposed_edits');
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });

  /**
   * The e2e stack's model, driven through the real route. The refusal is the orchestrator's
   * permission gate, not the script's: the script asks for `propose_source_edit` on behalf of an
   * `ai.ask` caller precisely so the gate can be seen turning it down.
   */
  it('the scripted model answers, cites a step and is refused the write tool', async () => {
    aiChatHolder.swap(new ScriptedChatModel());

    const ask = await newConversation('article', fx.agent);
    const answered = parseSseFrames((await send(ask.json().id, 'מה עושים כשאין גלישה?', fx.agent)).body);
    expect(answered.find((e) => e.type === 'tool_call')).toMatchObject({ name: 'read_document' });
    expect(
      answered
        .filter((e) => e.type === 'token')
        .map((e) => (e as Extract<ChatEvent, { type: 'token' }>).text)
        .join(''),
    ).toContain('שלב 1');

    const edit = await newConversation('article', fx.agent);
    const refused = parseSseFrames((await send(edit.json().id, 'שנה את "הישן" ל"החדש"', fx.agent)).body);
    expect(refused.find((e) => e.type === 'tool_result')).toMatchObject({
      name: 'propose_source_edit',
      ok: false,
    });
    expect(
      refused
        .filter((e) => e.type === 'token')
        .map((e) => (e as Extract<ChatEvent, { type: 'token' }>).text)
        .join(''),
    ).toBe('אין לי הרשאה לשנות תוכן');

    const small = await newConversation('editor', fx.editor);
    const chat = parseSseFrames((await send(small.json().id, 'תודה רבה', fx.editor)).body);
    expect(chat.map((e) => e.type)).toEqual(['token', 'done']);
  });

  it('caps an article conversation at the ask tools even for an editor', async () => {
    const seen: string[][] = [];
    aiChatHolder.swap(
      fakeChat(({ tools }) => {
        seen.push(tools);
        return chatResult('הבנתי.');
      }),
    );
    const c = await newConversation('article', fx.editor);
    await send(c.json().id, 'שאלה', fx.editor);
    expect(seen[0]).not.toContain('propose_source_edit');
    expect(seen[0]).not.toContain('read_source');
  });

  it('stops after MAX_TOOL_ROUNDS and still ends with done', async () => {
    aiChatHolder.swap(fakeChat(() => chatResult('', [{ id: 'l', name: 'search_kb', args: { q: 'APN' } }])));
    const c = await newConversation('editor', fx.editor);
    const ev = parseSseFrames((await send(c.json().id, 'לולאה', fx.editor)).body);
    expect(ev.filter((e) => e.type === 'tool_call').length).toBe(MAX_TOOL_ROUNDS);
    expect(ev.at(-1)?.type).toBe('done');
  });

  it('turns a model failure into an error frame followed by done', async () => {
    aiChatHolder.swap({
      name: 'broken',
      available: async () => true,
      proposeChanges: async () => [],
      chat: async () => {
        throw new Error('boom');
      },
    });
    const c = await newConversation('editor', fx.editor);
    const ev = parseSseFrames((await send(c.json().id, 'שלום', fx.editor)).body);
    expect(ev.map((e) => e.type)).toEqual(['error', 'done']);
    expect(ev[0]).toMatchObject({ code: 'AI_FAILED' });
  });

  it('503s when the chat model is unavailable', async () => {
    aiChatHolder.swap(unavailableChatModel('disabled'));
    const c = await newConversation('editor', fx.editor);
    const r = await send(c.json().id, 'שלום', fx.editor);
    expect(r.statusCode).toBe(503);
    expect(r.json().code).toBe('AI_UNAVAILABLE');
    aiChatHolder.swap(fakeChat(() => chatResult('הבנתי.')));
  });

  it('403s an agent opening an editor conversation and 404s a conversation of another user', async () => {
    expect((await newConversation('editor', fx.agent)).statusCode).toBe(403);
    const mine = await newConversation('editor', fx.editor);
    expect((await fx.get(`/api/v1/ai/conversations/${mine.json().id}`, fx.otherEditor)).statusCode).toBe(404);
    expect((await send(mine.json().id, 'שלום', fx.otherEditor)).statusCode).toBe(404);
  });

  it('404s a conversation on a document the caller may not see', async () => {
    const r = await fx.post(
      '/api/v1/ai/conversations',
      { kind: 'article', documentId: fx.billingDraft },
      fx.editor,
    );
    expect(r.statusCode).toBe(404);
  });

  it('lists only the caller’s own conversations', async () => {
    await newConversation('editor', fx.otherEditor);
    const mine = await fx.get('/api/v1/ai/conversations?page=1&pageSize=50', fx.editor);
    expect(mine.statusCode).toBe(200);
    expect((mine.json().items as { userId: string }[]).every((c) => c.userId === fx.editor.id)).toBe(true);
  });

  it('429s past ai.limits.chatPerUserPerHour', async () => {
    aiChatHolder.swap(fakeChat(() => chatResult('הבנתי.')));
    resetRateLimit(fx.editor.id);
    await withTransaction(fx.db.pool, (tx) =>
      putAiSettings(tx, { limits: { chatPerUserPerHour: 1 } }, fx.admin.id),
    );
    try {
      const c = await newConversation('editor', fx.editor);
      const cid = c.json().id as string;
      expect((await send(cid, '1', fx.editor)).statusCode).toBe(200);
      const r = await send(cid, '2', fx.editor);
      expect(r.statusCode).toBe(429);
      expect(r.json().code).toBe('AI_RATE_LIMITED');
      expect(r.headers['retry-after']).toBeDefined();
    } finally {
      await withTransaction(fx.db.pool, (tx) =>
        putAiSettings(tx, { limits: { chatPerUserPerHour: 60 } }, fx.admin.id),
      );
      resetRateLimit(fx.editor.id);
    }
  });
}
