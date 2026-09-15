import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { integration } from '../helpers/db.js';
import { auth } from '../helpers/fixtures.js';
import { makeAiFixture, type AiFixture } from '../helpers/ai/fixture.js';
import { aiChatHolder } from '../../src/modules/ai/chatModel.js';
import { ScriptedChatModel } from '../../src/modules/ai/scripted.js';
import { parseSseFrames } from '../../src/modules/ai/sse.js';

const run = integration ? describe : describe.skip;

/**
 * The joints between the wave 6 lanes — each of them a link no single lane could test, because
 * the two halves lived on different branches.
 *
 * X1 owns the impact set and the suggestion provenance, X2 the chat and its tools, X3 the
 * structured edit and the analytics, and X6 the migration that indexes across them. What is
 * asserted here is that they agree.
 */
run('wave 6 seams', () => {
  let f: AiFixture;

  beforeAll(async () => {
    f = await makeAiFixture();
    // The deterministic chat: the orchestrator, the tools and the persistence are the real code.
    aiChatHolder.swap(new ScriptedChatModel());
  }, 180_000);
  afterAll(async () => {
    await f?.close();
  });

  const send = (conversationId: string, content: string, u = f.editor) =>
    f.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${conversationId}/messages`,
      headers: auth(u),
      payload: { content },
    });

  const startConversation = async () => {
    const r = await f.post(
      '/api/v1/ai/conversations',
      { kind: 'workspace', documentId: f.techDoc },
      f.editor,
    );
    expect(r.statusCode).toBe(201);
    return r.json().id as string;
  };

  /**
   * X2's local port answered from `graph/repo.ts` alone and reported every related document at
   * `similarity: 0`. Re-pointed at X1's `ImpactService`, `read_impact` returns the same shape the
   * proposal pipeline sees — topics included, which the local port did compute but from a
   * different query. Asserting the tool answers at all, over the real service, is the seam: an
   * unswapped port would still answer, so the test also names the service's own shape.
   */
  it('the chat impact port answers from X1 ImpactService', async () => {
    const id = await startConversation();
    const r = await send(id, 'מה מושפע מהשינוי?');
    expect(r.statusCode).toBe(200);
    const frames = parseSseFrames(r.body);
    expect(frames.at(-1)?.type).toBe('done');

    // The tool itself, called the way the orchestrator calls it, against the swapped port.
    const { impactPort } = await import('../../src/modules/ai/impactPort.js');
    const asUser = {
      id: f.editor.id,
      displayName: f.editor.name,
      permissions: new Set(['docs.read', 'docs.edit', 'ai.chat']),
      worldScopes: ['tech'],
      categoryScopes: null,
      roles: ['editor'],
    } as unknown as Parameters<typeof impactPort.impactOf>[2];
    const impact = await impactPort.impactOf(f.db.pool, f.techDoc, asUser);
    expect(Object.keys(impact).sort()).toEqual(['blocks', 'documents', 'fields', 'related', 'topics']);
    // A document outside the caller's world scope yields the empty set rather than a leak.
    const hidden = await impactPort.impactOf(f.db.pool, f.billingDraft, asUser);
    expect(hidden.documents).toEqual([]);
    expect(hidden.blocks).toEqual([]);
  }, 120_000);

  /**
   * X4a's chat pane could show a chip and nothing else for a proposal read back from history,
   * because no lane shipped the read. Ownership is the conversation's, not the document's.
   */
  it('GET /ai/proposed-edits/:id returns the hunks to the owner and 404s for anyone else', async () => {
    const id = await startConversation();
    const r = await send(id, 'שנה את "חסימת גלישה" ל-"חסימת גלישה בחבילה"');
    const proposed = parseSseFrames(r.body).find((e) => e.type === 'proposed_edits') as
      { proposedEditsId: string } | undefined;
    expect(proposed?.proposedEditsId).toBeTruthy();

    const mine = await f.get(`/api/v1/ai/proposed-edits/${proposed!.proposedEditsId}`, f.editor);
    expect(mine.statusCode).toBe(200);
    const body = mine.json();
    expect(body.documentId).toBe(f.techDoc);
    expect(body.status).toBe('proposed');
    expect(Array.isArray(body.ops) && body.ops.length).toBeTruthy();
    // Every op carries the anchor's current text, so the overlay can render a real diff.
    expect(body.ops.every((o: { before: string }) => typeof o.before === 'string')).toBe(true);

    const theirs = await f.get(`/api/v1/ai/proposed-edits/${proposed!.proposedEditsId}`, f.otherEditor);
    expect(theirs.statusCode).toBe(404);
    // An admin browsing transcripts may read it.
    const admin = await f.get(`/api/v1/ai/proposed-edits/${proposed!.proposedEditsId}`, f.admin);
    expect(admin.statusCode).toBe(200);
  }, 120_000);

  /**
   * Spec §4.2 documents this read and X4a's drawer calls it; no lane shipped it. The row it
   * returns is the one carrying all three lanes' additive fields at once.
   */
  it('GET /suggestions/:id carries X1 and X3 fields on one row', async () => {
    const r = await f.get(`/api/v1/suggestions/${f.suggestionId}`, f.editor);
    expect(r.statusCode).toBe(200);
    const s = r.json();
    expect(s.id).toBe(f.suggestionId);
    for (const k of ['affects', 'promptVersion', 'model', 'editDiff', 'appliedParts', 'parentId'])
      expect(k in s).toBe(true);
  });

  /**
   * X3 wrote the remainder insert behind a `hasColumn` probe because X1's 0051 was on another
   * branch. X6 removed the probe; the provenance must now actually be copied.
   */
  it('a partial accept copies X1 provenance onto the remainder', async () => {
    await f.db.pool.query(
      `update suggestions set affects = $2::jsonb, prompt_version = 'v3.test', model = 'test-model' where id = $1`,
      [
        f.suggestionId,
        JSON.stringify([{ kind: 'document', id: f.techDoc, title: 'אין גלישה', why: 'בדיקה' }]),
      ],
    );
    const sug = (
      await f.db.pool.query(
        `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key,
                                 payload, confidence, rationale, affects, prompt_version, model)
         select source_revision_id, anchor, type, 'עדכון לפיצול', target_document_id, target_step_key,
                $2::jsonb, confidence, rationale, affects, prompt_version, model
           from suggestions where id = $1 returning id`,
        [
          f.suggestionId,
          JSON.stringify({ type: 'update-step', addActions: ['פעולה א', 'פעולה ב'], patch: {} }),
        ],
      )
    ).rows[0].id as string;

    const r = await f.post(`/api/v1/suggestions/${sug}/accept`, { parts: ['add-0'] }, f.admin);
    expect(r.statusCode).toBe(200);
    expect(r.json().appliedParts).toEqual(['add-0']);

    const remainder = (await f.db.pool.query('select * from suggestions where parent_id = $1', [sug]))
      .rows[0];
    expect(remainder).toBeTruthy();
    expect(remainder.prompt_version).toBe('v3.test');
    expect(remainder.model).toBe('test-model');
    expect(remainder.affects).toHaveLength(1);
  }, 120_000);

  /** Migration 0054: the indexes no single lane could see the need for. */
  it('0054 indexes the cross-lane joins', async () => {
    const r = await f.db.pool.query(
      `select indexname from pg_indexes where indexname in
        ('ai_proposed_edits_message_idx','ai_message_feedback_message_idx',
         'suggestions_model_prompt_idx','ai_conversations_deleted_idx') order by 1`,
    );
    expect(r.rows.map((x) => x.indexname)).toEqual([
      'ai_conversations_deleted_idx',
      'ai_message_feedback_message_idx',
      'ai_proposed_edits_message_idx',
      'suggestions_model_prompt_idx',
    ]);
  });

  /**
   * Route coverage for the wave's read surface, by role. `GET /suggestions/analytics` and
   * `GET /admin/ai/eval/runs` are the two the web mounts on tabs nothing else in this suite
   * opens; the rest name the permission each route actually enforces.
   */
  it('names every wave 6 read route with the right role', async () => {
    expect((await f.get('/api/v1/ai/conversations', f.editor)).statusCode).toBe(200);
    expect((await f.get('/api/v1/suggestions/analytics', f.editor)).statusCode).toBe(200);
    expect((await f.get('/api/v1/admin/ai/settings', f.admin)).statusCode).toBe(200);
    expect((await f.get('/api/v1/admin/ai/settings/versions', f.admin)).statusCode).toBe(200);
    expect((await f.get('/api/v1/admin/ai/eval/runs', f.admin)).statusCode).toBe(200);
    expect((await f.get('/api/v1/admin/ai/conversations', f.admin)).statusCode).toBe(200);
    // …and refuses the tiers below it.
    expect((await f.get('/api/v1/admin/ai/settings', f.editor)).statusCode).toBe(403);
    expect((await f.get('/api/v1/admin/ai/eval/runs', f.agent)).statusCode).toBe(403);
    expect((await f.get('/api/v1/suggestions/analytics', f.agent)).statusCode).toBe(403);
  }, 60_000);
});
