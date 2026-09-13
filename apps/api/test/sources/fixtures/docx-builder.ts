import JSZip from 'jszip';

export interface DocxRun {
  t: string;
  ins?: { author: string; date: string };
  del?: { author: string; date: string };
  moveTo?: boolean;
  moveFrom?: boolean;
}
export interface DocxPara {
  style?: string;
  runs?: DocxRun[];
  comment?: { author: string; text: string };
  table?: string[][];
}
export interface DocxSpec {
  title?: string;
  paragraphs: DocxPara[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const runXml = (r: DocxRun, id: number) => {
  const inner = r.del
    ? `<w:r><w:delText xml:space="preserve">${esc(r.t)}</w:delText></w:r>`
    : `<w:r><w:t xml:space="preserve">${esc(r.t)}</w:t></w:r>`;
  if (r.ins)
    return `<w:ins w:id="${id}" w:author="${esc(r.ins.author)}" w:date="${r.ins.date}">${inner}</w:ins>`;
  if (r.del)
    return `<w:del w:id="${id}" w:author="${esc(r.del.author)}" w:date="${r.del.date}">${inner}</w:del>`;
  if (r.moveTo)
    return `<w:moveTo w:id="${id}" w:author="מערכת" w:date="2025-06-12T00:00:00Z">${inner}</w:moveTo>`;
  if (r.moveFrom)
    return `<w:moveFrom w:id="${id}" w:author="מערכת" w:date="2025-06-12T00:00:00Z">${inner}</w:moveFrom>`;
  return inner;
};

/** Builds a minimal but structurally real .docx so parser tests do not need binary fixtures. */
export async function buildDocx(spec: DocxSpec): Promise<Buffer> {
  let id = 1;
  const comments: string[] = [];
  const body = spec.paragraphs
    .map((p) => {
      if (p.table)
        return `<w:tbl>${p.table
          .map(
            (row) =>
              `<w:tr>${row
                .map((c) => `<w:tc><w:p><w:r><w:t xml:space="preserve">${esc(c)}</w:t></w:r></w:p></w:tc>`)
                .join('')}</w:tr>`,
          )
          .join('')}</w:tbl>`;
      const pPr = p.style ? `<w:pPr><w:pStyle w:val="${p.style}"/></w:pPr>` : '';
      let runs = (p.runs ?? []).map((r) => runXml(r, id++)).join('');
      if (p.comment) {
        const cid = comments.length;
        comments.push(
          `<w:comment w:id="${cid}" w:author="${esc(p.comment.author)}" w:date="2025-06-12T12:48:00Z"><w:p><w:r><w:t>${esc(p.comment.text)}</w:t></w:r></w:p></w:comment>`,
        );
        runs = `<w:commentRangeStart w:id="${cid}"/>${runs}<w:commentRangeEnd w:id="${cid}"/>`;
      }
      return `<w:p>${pPr}${runs}</w:p>`;
    })
    .join('');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  if (comments.length)
    zip.file(
      'word/comments.xml',
      `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${comments.join('')}</w:comments>`,
    );
  if (spec.title)
    zip.file(
      'docProps/core.xml',
      `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${esc(spec.title)}</dc:title></cp:coreProperties>`,
    );
  return zip.generateAsync({ type: 'nodebuffer' });
}
