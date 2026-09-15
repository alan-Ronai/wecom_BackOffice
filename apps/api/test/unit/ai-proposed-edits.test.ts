import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, paragraphRefs } from '@wecom/shared';
import { acceptedOps, applyOps, decisionStatus, diffToOps } from '../../src/modules/ai/proposedEdits.js';

describe('ai proposed edits (pure)', () => {
  it('applyOps replaces exactly the anchored paragraph and leaves the rest byte-identical', () => {
    const html = '<h2>כותרת</h2><p>ראשון</p><p>שני</p>';
    // The anchor is a `htmlToParagraphs` ref, so a paragraph under a heading is `h2-1.p-1`,
    // not `p-1` — the ref is the heading path plus an index inside it.
    const refs = paragraphRefs(html);
    expect(refs.map((r) => r.ref)).toEqual(['h2-1', 'h2-1.p-1', 'h2-1.p-2']);
    const out = applyOps(html, [
      { id: 'o1', anchor: 'h2-1.p-1', kind: 'replace', before: 'ראשון', after: 'ראשון מעודכן' },
    ]);
    expect(out).toBe('<h2>כותרת</h2><p>ראשון מעודכן</p><p>שני</p>');
  });

  it('applyOps refuses a stale before', () => {
    expect(() =>
      applyOps('<p>א</p>', [{ id: 'o', anchor: 'p-1', kind: 'replace', before: 'ב', after: 'ג' }]),
    ).toThrow(/AI_EDIT_ANCHOR|אינה מתאימה/);
  });

  it('applyOps refuses an anchor that is not in the document at all', () => {
    expect(() =>
      applyOps('<p>א</p>', [{ id: 'o', anchor: 'p-9', kind: 'replace', before: 'א', after: 'ב' }]),
    ).toThrow(/אינה מתאימה/);
  });

  it('applyOps inserts after the anchor and deletes the anchored block', () => {
    const html = '<p>א</p><p>ב</p>';
    expect(
      applyOps(html, [{ id: 'o', anchor: 'p-1', kind: 'insert', before: 'א', after: 'חדש' }]),
    ).toBe('<p>א</p><p>חדש</p><p>ב</p>');
    expect(
      applyOps(html, [{ id: 'o', anchor: 'p-1', kind: 'delete', before: 'א', after: '' }]),
    ).toBe('<p>ב</p>');
  });

  it('applyOps escapes model text rather than letting it inject markup', () => {
    const out = applyOps('<p>א</p>', [
      { id: 'o', anchor: 'p-1', kind: 'replace', before: 'א', after: '<script>x</script>' },
    ]);
    expect(out).not.toContain('<script>');
    expect(out).toContain('&lt;script&gt;');
  });

  it('diffToOps yields replace/insert/delete by ref', () => {
    const cur = htmlToParagraphs('<p>א</p><p>ב</p><p>ג</p>');
    const ops = diffToOps(
      cur,
      [
        { ref: cur[0].ref, text: 'א1' },
        { ref: cur[2].ref, text: 'ג' },
        { ref: 'new-1', text: 'ד' },
      ],
      cur.map((p) => p.ref),
    );
    expect(ops.map((o) => o.kind)).toEqual(['replace', 'delete', 'insert']);
    expect(ops[0]).toMatchObject({ anchor: cur[0].ref, before: 'א', after: 'א1' });
    // Contract: every op carries `before`, inserts included — the anchor's current text.
    expect(ops[2]).toMatchObject({ anchor: cur[2].ref, before: 'ג', after: 'ד' });
    expect(new Set(ops.map((o) => o.id)).size).toBe(3);
  });

  it('diffToOps never deletes a paragraph the model merely failed to echo', () => {
    const cur = htmlToParagraphs('<p>א</p><p>ב</p>');
    const ops = diffToOps(cur, [{ ref: cur[0].ref, text: 'א1' }]);
    expect(ops.map((o) => o.kind)).toEqual(['replace']);
  });

  it('diffToOps ignores paragraphs outside the named scope', () => {
    const cur = htmlToParagraphs('<p>א</p><p>ב</p>');
    const ops = diffToOps(
      cur,
      [
        { ref: cur[0].ref, text: 'א1' },
        { ref: cur[1].ref, text: 'ב1' },
      ],
      [cur[1].ref],
    );
    expect(ops).toEqual([
      { id: 'op-1', anchor: cur[1].ref, kind: 'replace', before: 'ב', after: 'ב1' },
    ]);
  });

  it('acceptedOps lets a reject win over an accept and reports the status', () => {
    const ops = [
      { id: 'a', anchor: 'p-1', kind: 'replace' as const, before: '1', after: '2' },
      { id: 'b', anchor: 'p-2', kind: 'replace' as const, before: '3', after: '4' },
    ];
    expect(acceptedOps(ops, { accept: 'all', reject: ['b'] }).map((o) => o.id)).toEqual(['a']);
    expect(acceptedOps(ops, { accept: 'all', reject: 'all' })).toEqual([]);
    expect(acceptedOps(ops, { accept: [], reject: [] })).toEqual([]);
    expect(decisionStatus(ops, acceptedOps(ops, { accept: 'all', reject: [] }))).toBe('accepted');
    expect(decisionStatus(ops, acceptedOps(ops, { accept: ['a'], reject: [] }))).toBe(
      'partially_accepted',
    );
    expect(decisionStatus(ops, [])).toBe('rejected');
  });
});
