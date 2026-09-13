import { describe, it, expect } from 'vitest';
import { paragraphDiff } from '../../src/modules/sources/diff.js';
import type { Paragraph } from '@wecom/shared';

const P = (ref: string, t: string): Paragraph => ({ ref, runs: [{ t }] });

describe('paragraphDiff', () => {
  it('aligns by ref and classifies', () => {
    const d = paragraphDiff(
      [P('4.8', 'מעל 5 מגה'), P('4.9', 'x'), P('4.10', 'ישן')],
      [P('4.8', 'מעל 6 מגה'), P('4.9', 'x'), P('4.14', 'חדש לגמרי')],
    );
    expect(d.map((x) => [x.ref, x.kind])).toEqual([
      ['4.8', 'changed'],
      ['4.9', 'same'],
      ['4.14', 'added'],
      ['4.10', 'removed'],
    ]);
  });

  it('aligns renumbered paragraphs by similarity', () => {
    const d = paragraphDiff(
      [P('4.8', 'בקש מהלקוח להריץ Speedtest מעל 5 מגה תקין')],
      [P('4.9', 'בקש מהלקוח להריץ Speedtest מעל 6 מגה תקין')],
    );
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ ref: '4.9', kind: 'changed' });
    expect(d[0].similarity).toBeGreaterThanOrEqual(0.6);
  });

  it('uses tracked-change runs directly', () => {
    const next: Paragraph[] = [
      { ref: '4.8', runs: [{ t: 'מעל ' }, { t: '5', del: true }, { t: '6', add: true }, { t: ' מגה' }] },
    ];
    const d = paragraphDiff(null, next);
    expect(d[0]).toMatchObject({ kind: 'changed', before: 'מעל 5 מגה', after: 'מעל 6 מגה' });
  });

  it('reports tracked-change paragraphs flagged as new or deleted', () => {
    const d = paragraphDiff(null, [
      { ref: '5.1', runs: [{ t: 'פסקה חדשה', add: true }], isNew: true },
      { ref: '5.2', runs: [{ t: 'פסקה שנמחקה', del: true }], isDeleted: true },
    ]);
    expect(d.map((x) => [x.ref, x.kind])).toEqual([
      ['5.1', 'added'],
      ['5.2', 'removed'],
    ]);
    expect(d[0].before).toBeNull();
    expect(d[1].after).toBeNull();
  });

  it('treats everything as added on first import', () => {
    expect(paragraphDiff(null, [P('1', 'a'), P('2', 'b')]).every((x) => x.kind === 'added')).toBe(true);
  });
});
