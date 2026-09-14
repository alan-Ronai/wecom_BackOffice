import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, htmlToText, normalizeText } from '../src/index.js';

describe('htmlParagraphs', () => {
  it('normalizes entities and whitespace', () => {
    expect(normalizeText('a&nbsp;&amp;  b   c')).toBe('a & b c');
  });
  it('turns blocks into stable refs under headings', () => {
    const ps = htmlToParagraphs(
      '<h2>שלב 1</h2><p>פתח CRM</p><ul><li>א</li><li>ב</li></ul><h2>שלב 2</h2><p>סיים</p>',
    );
    expect(ps.map((p) => p.ref)).toEqual(['h2-1', 'h2-1.p-1', 'h2-1.ul-2', 'h2-2', 'h2-2.p-1']);
    expect(ps[0].heading).toBe('שלב 1');
    expect(ps[0].level).toBe(2);
    expect(ps[2].runs[0].t).toBe('• א\n• ב');
  });
  it('flattens tables row by row', () => {
    const ps = htmlToParagraphs(
      '<table><tr><th>שדה</th><th>ערך</th></tr><tr><td>APN</td><td>internet</td></tr></table>',
    );
    expect(ps[0].runs[0].t).toBe('שדה | ערך\nAPN | internet');
  });
  it('htmlToText joins block texts with newlines and drops refs', () => {
    expect(htmlToText('<h2>כותרת</h2><p>גוף <strong>מודגש</strong></p>')).toBe('כותרת\nגוף מודגש');
  });
});
