import { describe, it, expect } from 'vitest';
import { textToHtml, htmlToText } from '../../src/modules/scripts/html.js';

describe('scripts html', () => {
  it('round-trips plain text with newlines and angle brackets', () => {
    const t = '"אתה לא גולש?"\n<b> & more';
    expect(textToHtml(t)).toBe('<p>"אתה לא גולש?"<br>&lt;b&gt; &amp; more</p>');
    expect(htmlToText(textToHtml(t))).toBe(t);
  });
  it('is the same encoding the 0030 migration used', () => {
    expect(htmlToText('<p>"שורה 1"<br>&lt;b&gt;</p>')).toBe('"שורה 1"\n<b>');
  });
});
