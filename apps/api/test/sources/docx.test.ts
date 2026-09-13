import { describe, it, expect } from 'vitest';
import { buildDocx } from './fixtures/docx-builder.js';
import { parseDocx } from '../../src/modules/sources/docx.js';
import { paragraphText } from '@wecom/shared';

describe('parseDocx', () => {
  it('extracts numbered paragraphs, headings and title', async () => {
    const buf = await buildDocx({
      title: 'נהלי תמיכה טכנית',
      paragraphs: [
        { style: 'Heading1', runs: [{ t: 'פרק 4 · איטיות גלישה' }] },
        { runs: [{ t: '4.8 בדיקת מהירות גלישה. בקש מהלקוח להריץ Speedtest.' }] },
      ],
    });
    const c = await parseDocx(buf);
    expect(c.title).toBe('נהלי תמיכה טכנית');
    expect(c.paragraphs[0]).toMatchObject({ level: 1, heading: 'פרק 4 · איטיות גלישה' });
    expect(c.paragraphs[1]).toMatchObject({ ref: '4.8', heading: 'בדיקת מהירות גלישה' });
    expect(paragraphText(c.paragraphs[1])).toContain('Speedtest');
    expect(c.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('maps tracked insertions, deletions and moves to runs', async () => {
    const buf = await buildDocx({
      paragraphs: [
        {
          runs: [
            { t: '4.8 בדיקת מהירות. ' },
            { t: 'מעל 5 מגה', del: { author: 'ענבר ל.', date: '2025-06-12T12:48:00Z' } },
            { t: 'מעל 6 מגה', ins: { author: 'ענבר ל.', date: '2025-06-12T12:48:00Z' } },
            { t: ' – תקין.' },
          ],
        },
        { runs: [{ t: 'טקסט שהוזז', moveTo: true }] },
        { runs: [{ t: 'טקסט שהוזז', moveFrom: true }] },
      ],
    });
    const c = await parseDocx(buf);
    const runs = c.paragraphs[0].runs;
    expect(runs.find((r) => r.del)).toMatchObject({ t: 'מעל 5 מגה', author: 'ענבר ל.' });
    expect(runs.find((r) => r.add)).toMatchObject({ t: 'מעל 6 מגה', date: '2025-06-12T12:48:00.000Z' });
    expect(paragraphText(c.paragraphs[0])).toBe('4.8 בדיקת מהירות. מעל 6 מגה – תקין.');
    expect(c.paragraphs[1].runs[0].add).toBe(true);
    expect(c.paragraphs[1].isNew).toBe(true);
    expect(c.paragraphs[2].runs[0].del).toBe(true);
    expect(c.paragraphs[2].isDeleted).toBe(true);
    expect(c.meta?.trackedChanges).toBe(4);
  });

  it('attaches comments and flattens tables', async () => {
    const buf = await buildDocx({
      paragraphs: [
        { runs: [{ t: '4.11 ריענון SIM.' }], comment: { author: 'דנה ר.', text: 'לבדוק סף חדש' } },
        {
          table: [
            ['שדה', 'ערך'],
            ['APN', 'WE'],
          ],
        },
      ],
    });
    const c = await parseDocx(buf);
    expect(c.paragraphs[0].comments).toEqual([
      { author: 'דנה ר.', text: 'לבדוק סף חדש', date: '2025-06-12T12:48:00.000Z' },
    ]);
    expect(paragraphText(c.paragraphs[1])).toBe('שדה | ערך');
    expect(paragraphText(c.paragraphs[2])).toBe('APN | WE');
  });

  it('produces the same hash for the same content', async () => {
    const spec = { paragraphs: [{ runs: [{ t: 'x' }] }] };
    expect((await parseDocx(await buildDocx(spec))).hash).toBe((await parseDocx(await buildDocx(spec))).hash);
  });

  it('rejects a zip that is not a docx', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    zip.file('readme.txt', 'hello');
    await expect(parseDocx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/not a docx/);
  });
});
