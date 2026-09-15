import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { ChatEvent } from '@wecom/shared';
import { integration } from './helpers/db.js';
import { auth, type TestUser } from './helpers/fixtures.js';
import { makeAiFixture } from './helpers/ai/fixture.js';
import { chatResult, fakeChat } from './helpers/ai/fakeChat.js';
import { aiChatHolder } from '../src/modules/ai/chatModel.js';
import { SECOND_CALL } from '../src/modules/ai/prompt.js';
import { parseSseFrames } from '../src/modules/ai/sse.js';

const run = integration ? describe : describe.skip;

/**
 * The only path in this lane that writes to a document. Everything asserted here is a way the
 * click can arrive after the world moved — and the answer is always a 409, never a silent
 * overwrite of somebody else's edit.
 */
run('ai proposed edits', () => {
  let fx: Awaited<ReturnType<typeof makeAiFixture>>;
  beforeAll(async () => {
    fx = await makeAiFixture();
  }, 240_000);
  afterAll(async () => fx?.close());

  /**
   * One chat turn that produces a proposal. The same fake answers both calls: the tool's
   * second, paragraph-rewriting call is the one whose system prompt names it.
   */
  const propose = async (rewrite: (text: string, index: number) => string, u: TestUser = fx.editor) => {
    aiChatHolder.swap(
      fakeChat(({ system, lastUser, messages }) => {
        if (system.includes(SECOND_CALL.proposeSourceEdit)) {
          const blocks = [...lastUser.matchAll(/§(\S+)\n([^\n]+)/g)].map((m) => ({
            ref: m[1],
            text: m[2],
          }));
          return chatResult(
            blocks.map((b, i) => `§${b.ref}\n${rewrite(b.text, i)}`).join('\n\n'),
          );
        }
        return messages.some((m) => m.role === 'tool')
          ? chatResult('הצעתי שינוי.')
          : chatResult('', [
              {
                id: 'p1',
                name: 'propose_source_edit',
                args: { documentId: fx.techDoc, instruction: 'קצר את הפסקה הראשונה' },
              },
            ]);
      }),
    );
    const c = await fx.post('/api/v1/ai/conversations', { kind: 'editor', documentId: fx.techDoc }, u);
    const r = await fx.app.inject({
      method: 'POST',
      url: `/api/v1/ai/conversations/${c.json().id}/messages`,
      headers: auth(u),
      payload: { content: 'קצר את הפסקה הראשונה' },
    });
    const frame = parseSseFrames(r.body).find((e) => e.type === 'proposed_edits') as
      | Extract<ChatEvent, { type: 'proposed_edits' }>
      | undefined;
    if (!frame) throw new Error('no proposed_edits frame: ' + r.body);
    return { frame, conversationId: c.json().id as string };
  };

  const decide = (id: string, body: unknown, u: TestUser = fx.editor) =>
    fx.app.inject({
      method: 'POST',
      url: `/api/v1/ai/proposed-edits/${id}/decide`,
      headers: auth(u),
      payload: body,
    });

  const sourceRow = async () =>
    (
      await fx.db.pool.query(
        'select current_version, html from source_documents where document_id=$1',
        [fx.techDoc],
      )
    ).rows[0] as { current_version: number; html: string };

  it('the proposal frame carries the base version and writes nothing on its own', async () => {
    const before = await sourceRow();
    const { frame } = await propose((t, i) => (i === 1 ? 'טקסט מקוצר.' : t));
    expect(frame.documentId).toBe(fx.techDoc);
    expect(frame.baseSourceVersion).toBe(before.current_version);
    expect(frame.ops).toHaveLength(1);
    expect(frame.ops[0]).toMatchObject({ kind: 'replace', after: 'טקסט מקוצר.' });
    expect((await sourceRow()).current_version).toBe(before.current_version);
  });

  it('accepting everything saves one new source version, audits it and re-ingests', async () => {
    const before = await sourceRow();
    const { frame } = await propose((t, i) => (i === 1 ? 'בדוק חסימה מהירה.' : t));
    const revisionsBefore = (await fx.db.pool.query('select count(*)::int n from source_revisions'))
      .rows[0].n as number;

    const r = await decide(frame.proposedEditsId, { accept: 'all', reject: [] });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({
      status: 'accepted',
      resultingSourceVersion: before.current_version + 1,
    });

    const after = await sourceRow();
    expect(after.current_version).toBe(before.current_version + 1);
    expect(after.html).toContain('בדוק חסימה מהירה.');
    expect(after.html).toContain('הצע חבילה נוספת'); // the untouched paragraph survived

    const row = await fx.db.pool.query('select status, resulting_source_version from ai_proposed_edits where id=$1', [
      frame.proposedEditsId,
    ]);
    expect(row.rows[0].status).toBe('accepted');
    expect(row.rows[0].resulting_source_version).toBe(after.current_version);

    const audit = await fx.db.pool.query(
      `select after from audit_log where action='ai.proposed_edits.apply' and entity_id=$1 order by at desc limit 1`,
      [fx.techDoc],
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0].after).toMatchObject({ proposedEditsId: frame.proposedEditsId });
    expect(audit.rows[0].after.messageId).toBeTruthy();

    const revisionsAfter = (await fx.db.pool.query('select count(*)::int n from source_revisions'))
      .rows[0].n as number;
    expect(revisionsAfter).toBeGreaterThan(revisionsBefore);
  });

  it('applies only the accepted hunk on a partial decision', async () => {
    const before = await sourceRow();
    const { frame } = await propose((t, i) => (i === 1 ? 'ראשון חדש.' : i === 2 ? 'שני חדש.' : t));
    expect(frame.ops).toHaveLength(2);
    const r = await decide(frame.proposedEditsId, {
      accept: 'all',
      reject: [frame.ops[1].id],
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().status).toBe('partially_accepted');
    const after = await sourceRow();
    expect(after.current_version).toBe(before.current_version + 1);
    expect(after.html).toContain('ראשון חדש.');
    expect(after.html).not.toContain('שני חדש.');
  });

  it('rejecting everything is a decision with no save', async () => {
    const before = await sourceRow();
    const { frame } = await propose((t, i) => (i === 1 ? 'לא יתקבל.' : t));
    const r = await decide(frame.proposedEditsId, { accept: 'all', reject: 'all' });
    expect(r.json()).toEqual({ status: 'rejected', resultingSourceVersion: null });
    expect((await sourceRow()).current_version).toBe(before.current_version);
  });

  it('409s a second decision on the same proposal', async () => {
    const { frame } = await propose((t, i) => (i === 1 ? 'פעם אחת בלבד.' : t));
    expect((await decide(frame.proposedEditsId, { accept: 'all', reject: [] })).statusCode).toBe(200);
    const again = await decide(frame.proposedEditsId, { accept: 'all', reject: [] });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_DECIDED');
  });

  it('409s SOURCE_MOVED when the source was edited between the proposal and the click', async () => {
    const { frame } = await propose((t, i) => (i === 1 ? 'לעולם לא ייושם.' : t));
    const etag = (
      await fx.app.inject({
        method: 'GET',
        url: `/api/v1/documents/${fx.techDoc}/source`,
        headers: auth(fx.admin),
      })
    ).headers.etag as string;
    const edit = await fx.app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${fx.techDoc}/source`,
      headers: { ...auth(fx.admin), 'if-match': etag },
      payload: { html: '<p>מישהו אחר כתב כאן.</p>', label: 'עריכה מקבילה' },
    });
    expect(edit.statusCode).toBe(200);
    const r = await decide(frame.proposedEditsId, { accept: 'all', reject: [] });
    expect(r.statusCode).toBe(409);
    expect(r.json().code).toBe('SOURCE_MOVED');
    // Still undecided: the user can reopen the chat and ask again.
    const row = await fx.db.pool.query('select status from ai_proposed_edits where id=$1', [
      frame.proposedEditsId,
    ]);
    expect(row.rows[0].status).toBe('proposed');
  });

  it('404s a non-owner editor and 403s an agent', async () => {
    // The SOURCE_MOVED case above replaced the source with a single paragraph, so index 0 is it.
    const { frame } = await propose((t, i) => (i === 0 ? 'של מישהו אחר.' : t));
    expect((await decide(frame.proposedEditsId, { accept: 'all', reject: [] }, fx.otherEditor)).statusCode).toBe(
      404,
    );
    expect((await decide(frame.proposedEditsId, { accept: 'all', reject: [] }, fx.agent)).statusCode).toBe(403);
  });
});
