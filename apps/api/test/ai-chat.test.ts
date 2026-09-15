import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { AiSettingsSchema, DEFAULT_ROLES, PERMISSIONS, toolsFor } from '@wecom/shared';
import { integration } from './helpers/db.js';
import { makeUser, type TestUser } from './helpers/fixtures.js';
import { makeAiFixture, SECRET } from './helpers/ai/fixture.js';
import { chatResult, fakeChat } from './helpers/ai/fakeChat.js';
import { withTransaction } from '../src/lib/sql.js';
import type { ReqUser } from '../src/lib/user.js';
import * as repo from '../src/modules/ai/repo.js';
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
    for await (const row of repo.exportCursor(db.pool, { userId: user.id }))
      rows.push(row.conversation.id);
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
        blocks
          .map((b, i) => `§${b.ref}\n${i === 0 ? 'החלף את הסים ובדוק תקינות.' : b.text}`)
          .join('\n\n'),
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
    const src = await fx.db.pool.query(
      'select current_version from source_documents where document_id=$1',
      [fx.techDoc],
    );
    expect(src.rows[0].current_version).toBe(1); // untouched
  });

  it('propose_source_edit fails closed when the model ignores the format', async () => {
    const { admin } = users();
    const r = await runTool(
      mkCtx(admin, fakeChat(() => chatResult('בטח, שיניתי הכול!'))),
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
    expect(
      (ok as { refined?: { editedPayload: { type: string } } }).refined?.editedPayload.type,
    ).toBe('update-step');
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
