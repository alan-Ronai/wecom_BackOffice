import mammoth from 'mammoth';
import { sanitizeHtml } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import { assetUrl } from './assets.js';

const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='heading 1'] => h1:fresh",
  "p[style-name='heading 2'] => h2:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
];

/**
 * Word → sanitized HTML for the source document. The suggestion pipeline keeps using
 * `modules/sources/docx.ts` (tracked changes, comments, refs); this path only feeds the editor.
 */
export async function importDocx(
  buffer: Buffer,
  deps: { putAsset: (bytes: Buffer, mime: string) => Promise<{ id: string }> },
): Promise<{ html: string; messages: string[] }> {
  if (buffer.length < 4 || buffer.toString('ascii', 0, 2) !== 'PK')
    throw httpError(400, 'BAD_DOCX', 'הקובץ אינו מסמך Word תקין');
  let result: { value: string; messages: { message: string }[] };
  try {
    result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: STYLE_MAP,
        convertImage: mammoth.images.imgElement(async (img) => {
          const bytes = Buffer.from(await img.readAsArrayBuffer());
          try {
            const { id } = await deps.putAsset(bytes, img.contentType);
            return { src: assetUrl(id) };
          } catch {
            return { src: '' }; // unsupported type → sanitizer drops the <img>
          }
        }),
      },
    );
  } catch (e) {
    throw httpError(
      400,
      'BAD_DOCX',
      'לא ניתן לקרוא את מסמך ה-Word: ' + (e instanceof Error ? e.message : String(e)),
    );
  }
  return { html: sanitizeHtml(result.value), messages: result.messages.map((m) => m.message) };
}
