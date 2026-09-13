import { createHash } from 'node:crypto';
import type { Paragraph } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';

/** "4.8 בדיקת מהירות גלישה." → ref "4.8", heading "בדיקת מהירות גלישה". */
const HEAD_RE = /^(\d+(?:\.\d+)*)\.?\s+([^.:\n]{3,80})[.:]?\s*/;
const MIN_PARAGRAPH = 20;

export function parseText(name: string, text: string, opts: { allNew?: boolean } = {}): SourceContent {
  const chunks = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n|\n(?=\s*\d+(?:\.\d+)*\.?\s)/)
    .map((p) => p.trim())
    .filter((p) => p.length > MIN_PARAGRAPH);
  const paragraphs: Paragraph[] = chunks.map((p, i) => {
    const m = HEAD_RE.exec(p);
    const para: Paragraph = {
      ref: m ? m[1] : String(i + 1),
      runs: [{ t: p, ...(opts.allNew ? { add: true } : {}) }],
    };
    if (m) para.heading = m[2].trim();
    if (opts.allNew) para.isNew = true;
    return para;
  });
  const hash = createHash('sha256')
    .update(JSON.stringify(paragraphs.map((p) => [p.ref, p.runs[0].t])))
    .digest('hex');
  return { title: name.replace(/\.[^.]+$/, ''), paragraphs, raw: text, hash, meta: { trackedChanges: 0 } };
}
