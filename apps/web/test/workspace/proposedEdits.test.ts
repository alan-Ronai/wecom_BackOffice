import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, type ProposedEditOp } from '@wecom/shared';
import { anchorText, anchoredBlocks, applyOps, htmlToPlain } from '../../src/lib/proposedEdits.js';

const html =
  '<h2>בדיקת מהירות גלישה</h2><p>יש לוודא חיבור לרשת לפני הבדיקה.</p><p>פסקה כפולה.</p>' +
  '<h3>תת-סעיף</h3><p>שורה אחרונה.</p>';

const ops: ProposedEditOp[] = [
  {
    id: 'op-1',
    anchor: '§h2-1.p-1',
    kind: 'replace',
    before: 'יש לוודא חיבור לרשת לפני הבדיקה.',
    after: 'ודא חיבור לרשת לפני הבדיקה.',
  },
  { id: 'op-2', anchor: '§h2-1.p-2', kind: 'delete', before: 'פסקה כפולה.', after: '' },
  { id: 'op-3', anchor: '§h2-1.p-1', kind: 'insert', before: 'יש לוודא חיבור לרשת לפני הבדיקה.', after: '<p>חדש.</p>' },
];

describe('paragraph anchors', () => {
  /**
   * The refs are the server's, not ours: asserting against `htmlToParagraphs` itself is what
   * keeps a hunk produced by the API resolvable in the browser. A hard-coded list would only say
   * that this walk is stable, not that it agrees with the one that wrote the anchors.
   */
  it('walks block elements in order, exactly as htmlToParagraphs numbers them', () => {
    expect(anchoredBlocks(html).map((b) => b.ref)).toEqual(htmlToParagraphs(html).map((p) => p.ref));
    expect(anchoredBlocks(html).map((b) => b.ref)).toEqual([
      'h2-1',
      'h2-1.p-1',
      'h2-1.p-2',
      'h2-1.h3-3',
      'h2-1.h3-3.p-1',
    ]);
  });

  it('resolves an anchor with or without the § prefix, and reads its text', () => {
    expect(anchorText(html, '§h2-1.p-2')).toBe('פסקה כפולה.');
    expect(anchorText(html, 'h2-1.p-2')).toBe('פסקה כפולה.');
    expect(anchorText(html, 'h2-1.p-9')).toBeNull();
  });

  it('never looks at a DOM id — the sanitizer strips them', () => {
    const withIds = '<h2 id="h2-3">כותרת</h2><p id="p-7">גוף.</p>';
    expect(anchoredBlocks(withIds).map((b) => b.ref)).toEqual(htmlToParagraphs(withIds).map((p) => p.ref));
    expect(anchorText(withIds, 'p-7')).toBeNull();
  });
});

describe('applyOps', () => {
  it('applies only the accepted ops', () => {
    const out = applyOps(html, ops, new Set(['op-1']));
    expect(out).toContain('ודא חיבור לרשת');
    expect(out).not.toContain('יש לוודא חיבור');
    expect(out).toContain('פסקה כפולה');
  });

  it('removes the anchored block on delete', () => {
    expect(applyOps(html, ops, new Set(['op-2']))).not.toContain('פסקה כפולה');
  });

  it('puts an insert straight after its anchor block', () => {
    const out = applyOps(html, ops, new Set(['op-3']));
    expect(out.indexOf('<p>חדש.</p>')).toBeGreaterThan(out.indexOf('יש לוודא חיבור לרשת לפני הבדיקה.'));
    expect(out.indexOf('<p>חדש.</p>')).toBeLessThan(out.indexOf('פסקה כפולה'));
  });

  it('leaves the html untouched when the anchor text moved under it (stale base)', () => {
    const moved = '<h2>בדיקת מהירות גלישה</h2><p>משהו אחר לגמרי.</p>';
    expect(applyOps(moved, ops, new Set(['op-1', 'op-2']))).toBe(moved);
  });

  it('leaves the html untouched when the anchor no longer resolves', () => {
    expect(applyOps('<p>אחר</p>', ops, new Set(['op-1']))).toBe('<p>אחר</p>');
  });

  it('wraps a bare-text replacement in a paragraph so the block structure survives', () => {
    const out = applyOps(html, [ops[0]!], new Set(['op-1']));
    expect(out).toContain('<p>ודא חיבור לרשת לפני הבדיקה.</p>');
  });

  it('applies several accepted ops together', () => {
    const out = applyOps(html, ops, new Set(['op-1', 'op-2']));
    expect(out).toContain('ודא חיבור לרשת');
    expect(out).not.toContain('פסקה כפולה');
  });
});

describe('htmlToPlain', () => {
  it('strips tags and decodes entities', () => {
    expect(htmlToPlain('<p>a &amp; b</p>')).toBe('a & b');
    expect(htmlToPlain('<ul><li>א</li><li>ב</li></ul>')).toBe('א ב');
  });
});
