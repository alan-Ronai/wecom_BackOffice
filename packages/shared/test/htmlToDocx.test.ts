import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { htmlToDocx } from '../src/index.js';

const A = '11111111-1111-4111-8111-111111111111';
// 1x1 transparent PNG
const PNG = Uint8Array.from(
  Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  ),
);
const resolveAsset = async (id: string) =>
  id === A ? { bytes: PNG, mime: 'image/png', width: 1, height: 1 } : null;
const docXml = async (buf: Uint8Array) =>
  (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');

describe('htmlToDocx', () => {
  it('emits headings, paragraphs, runs and links', async () => {
    const xml = await docXml(
      await htmlToDocx(
        '<h1>כותרת</h1><p>טקסט <strong>מודגש</strong> <em>נטוי</em> <u>קו</u> <s>מחוק</s> <a href="https://x.y/z">קישור</a></p>',
        { resolveAsset },
      ),
    );
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('כותרת');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:strike/>');
    expect(xml).toContain('w:hyperlink');
    expect(xml).toContain('w:bidi'); // RTL paragraphs
  });
  it('emits nested lists and tables', async () => {
    const xml = await docXml(
      await htmlToDocx(
        '<ul><li>א<ul><li>ב</li></ul></li></ul><ol><li>1</li></ol><table><tr><th>ש</th><th>ע</th></tr><tr><td>a</td><td>b</td></tr></table>',
        { resolveAsset },
      ),
    );
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('w:ilvl w:val="1"');
    expect(xml).toContain('<w:tbl>');
    expect((xml.match(/<w:tc>/g) ?? []).length).toBe(4);
  });
  it('embeds asset images and skips unknown ones', async () => {
    const buf = await htmlToDocx(
      `<p><img src="/api/v1/assets/${A}" alt="x"></p><p><img src="/api/v1/assets/22222222-2222-4222-8222-222222222222"></p>`,
      { resolveAsset },
    );
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:drawing>');
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(1);
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });
  it('emits blockquote and code as styled paragraphs', async () => {
    const xml = await docXml(
      await htmlToDocx('<blockquote>ציטוט</blockquote><pre><code>let x = 1;</code></pre>', {
        resolveAsset,
      }),
    );
    expect(xml).toContain('w:val="Quote"');
    expect(xml).toContain('Courier New');
  });
});
