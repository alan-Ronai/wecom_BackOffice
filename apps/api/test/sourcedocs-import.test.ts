import { describe, it, expect } from 'vitest';
import { buildDocx } from './sources/fixtures/docx-builder.js';
import { importDocx } from '../src/modules/sourcedocs/import.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

describe('importDocx', () => {
  it('maps headings, paragraphs, tables and images to sanitized HTML with asset srcs', async () => {
    const buf = await buildDocx({
      paragraphs: [
        { style: 'Heading1', runs: [{ t: 'נוהל SIM' }] },
        { runs: [{ t: 'פתח את ה-CRM' }] },
        {
          table: [
            ['שדה', 'ערך'],
            ['APN', 'internet'],
          ],
        },
        { image: { png: PNG } },
      ],
    });
    const put = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
    const { html } = await importDocx(buf, { putAsset: put });
    expect(html).toContain('<h1>נוהל SIM</h1>');
    expect(html).toContain('<p>פתח את ה-CRM</p>');
    expect(html).toContain('<table>');
    // mammoth always wraps cell content in a paragraph, which is also what TipTap's table cells hold.
    expect(html).toContain('<td><p>APN</p></td>');
    expect(html).toContain('<img src="/api/v1/assets/11111111-1111-4111-8111-111111111111"');
    expect(html).not.toContain('data:');
  });
  it('rejects a non-docx buffer', async () => {
    await expect(
      importDocx(Buffer.from('nope'), { putAsset: async () => ({ id: 'x' }) }),
    ).rejects.toMatchObject({ statusCode: 400, code: 'BAD_DOCX' });
  });
});
