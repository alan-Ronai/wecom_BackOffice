import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, contentHash, normalizeText } from '../src/index.js';
import { paragraphText } from '@wecom/shared';

const html = `
<h2>4. איטיות גלישה</h2>
<p>בקש מהלקוח להריץ <strong>Speedtest</strong>. מעל 6&nbsp;מגה – תקין.</p>
<ul><li>נתונים סלולריים – להדליק</li><li>Wi-Fi – לכבות</li></ul>
<h3>4.11 ריענון SIM</h3>
<table><tr><td>אם</td><td>ניצל 100%</td></tr></table>
<!-- wp:paragraph --><p>  </p><!-- /wp:paragraph -->
`;

describe('htmlToParagraphs', () => {
  it('produces stable refs by heading path', () => {
    const ps = htmlToParagraphs(html);
    expect(ps.map((p) => p.ref)).toEqual(['h2-1', 'h2-1.p-1', 'h2-1.ul-2', 'h2-1.h3-3', 'h2-1.h3-3.table-1']);
    expect(ps[0]).toMatchObject({ heading: '4. איטיות גלישה', level: 2 });
  });
  it('flattens lists and tables, decodes entities, drops empty blocks', () => {
    const ps = htmlToParagraphs(html);
    expect(paragraphText(ps[1])).toBe('בקש מהלקוח להריץ Speedtest. מעל 6 מגה – תקין.');
    expect(paragraphText(ps[2])).toBe('• נתונים סלולריים – להדליק\n• Wi-Fi – לכבות');
    expect(paragraphText(ps[4])).toBe('אם | ניצל 100%');
  });
  it('hashes deterministically and changes on edits', () => {
    const a = contentHash(htmlToParagraphs(html));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHash(htmlToParagraphs(html.replace('6&nbsp;מגה', '5&nbsp;מגה')))).not.toBe(a);
    expect(contentHash(htmlToParagraphs(html + '\n\n'))).toBe(a);
  });
  it('normalizes whitespace', () => {
    expect(normalizeText('  a \n\t b  ')).toBe('a b');
  });
});
