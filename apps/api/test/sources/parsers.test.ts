import { describe, it, expect } from 'vitest';
import { parseUpload } from '../../src/modules/sources/parsers.js';
import { parseDocx } from '../../src/modules/sources/docx.js';

const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return { statusCode: (e as { statusCode?: number }).statusCode, code: (e as { code?: string }).code };
  }
};

/** Upload accepts 25 MB from any `sources.manage` holder and the worker is concurrency 1. */
describe('upload parsing is defensive', () => {
  it('rejects an unreadable zip as a 400, not a thrown JSZip error', async () => {
    expect(await status(parseDocx(Buffer.from('this is not a zip file')))).toEqual({
      statusCode: 400,
      code: 'UNSUPPORTED_FILE',
    });
  });

  it('rejects malformed JSON as a 400, not a 500 with a stack trace', async () => {
    expect(await status(parseUpload('rows.json', Buffer.from('{"docs": [}')))).toEqual({
      statusCode: 400,
      code: 'UNSUPPORTED_FILE',
    });
  });

  it('still parses a well-formed JSON upload', async () => {
    const c = await parseUpload(
      'rows.json',
      Buffer.from(JSON.stringify([{ title: 'בירור חיוב', category: 'billing' }])),
    );
    expect(c.kind).toBe('json');
    expect(c.paragraphs).toHaveLength(1);
  });

  it('rejects an unknown extension', async () => {
    expect(await status(parseUpload('x.pdf', Buffer.from('%PDF')))).toEqual({
      statusCode: 400,
      code: 'UNSUPPORTED_FILE',
    });
  });
});
