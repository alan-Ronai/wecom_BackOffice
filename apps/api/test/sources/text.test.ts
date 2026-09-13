import { describe, it, expect } from 'vitest';
import { parseText } from '../../src/modules/sources/text.js';
import { parseUpload } from '../../src/modules/sources/parsers.js';
import { paragraphText } from '@wecom/shared';

describe('parseText', () => {
  it('splits numbered paragraphs and derives refs/headings', () => {
    const c = parseText(
      'נהלים.md',
      '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest.\n\n4.14 בעיות גלישה ברכב. אם הלקוח מדווח על איטיות רק ברכב.\n',
    );
    expect(c.paragraphs.map((p) => [p.ref, p.heading])).toEqual([
      ['4.8', 'בדיקת מהירות גלישה'],
      ['4.14', 'בעיות גלישה ברכב'],
    ]);
    expect(c.title).toBe('נהלים');
  });

  it('uses running numbers when no refs', () => {
    expect(
      parseText(
        'a.txt',
        'פסקה ראשונה ארוכה מספיק כדי להיחשב.\n\nפסקה שנייה ארוכה מספיק כדי להיחשב.',
      ).paragraphs.map((p) => p.ref),
    ).toEqual(['1', '2']);
  });

  it('marks every paragraph as new when allNew is set', () => {
    const c = parseText('a.txt', 'פסקה ראשונה ארוכה מספיק כדי להיחשב.', { allNew: true });
    expect(c.paragraphs[0].isNew).toBe(true);
    expect(c.paragraphs[0].runs[0].add).toBe(true);
  });
});

describe('parseUpload', () => {
  it('dispatches by extension', async () => {
    const j = await parseUpload('topics.json', Buffer.from(JSON.stringify([{ title: 'א', desc: 'ב' }])));
    expect(j.kind).toBe('json');
    expect(paragraphText(j.paragraphs[0])).toBe('א: ב');
    const c = await parseUpload('t.csv', Buffer.from('title,desc\nx,y\n'));
    expect(c.kind).toBe('csv');
    expect(paragraphText(c.paragraphs[0])).toBe('x: y');
    await expect(parseUpload('x.exe', Buffer.from(''))).rejects.toThrow(/unsupported/);
  });

  it('parses markdown as text and keeps the raw body', async () => {
    const t = await parseUpload('נהלים.md', Buffer.from('4.8 בדיקת מהירות גלישה. בקש להריץ Speedtest.'));
    expect(t.kind).toBe('text');
    expect(t.paragraphs[0].ref).toBe('4.8');
    expect(t.raw).toContain('Speedtest');
  });
});
