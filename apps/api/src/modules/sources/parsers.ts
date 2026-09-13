import { createHash } from 'node:crypto';
import type { SourceContent } from '@wecom/connectors';
import type { Paragraph } from '@wecom/shared';
import { parseDocx } from './docx.js';
import { parseText } from './text.js';

export type UploadKind = 'docx' | 'text' | 'json' | 'csv';

const rows2content = (name: string, rows: Record<string, string>[]): SourceContent => {
  const paragraphs: Paragraph[] = rows.map((r, i) => {
    const vals = Object.values(r)
      .map((v) => String(v ?? '').trim())
      .filter(Boolean);
    const para: Paragraph = {
      ref: String(i + 1),
      runs: [{ t: vals.slice(0, 2).join(': ') + (vals.length > 2 ? ' · ' + vals.slice(2).join(' · ') : '') }],
    };
    if (vals[0]) para.heading = vals[0].slice(0, 80);
    return para;
  });
  return {
    title: name.replace(/\.[^.]+$/, ''),
    paragraphs,
    hash: createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    meta: { rows: rows.length, columns: Object.keys(rows[0] ?? {}) },
  };
};

const parseCsv = (text: string): Record<string, string>[] => {
  const lines = text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((l) => l.trim());
  const head = (lines.shift() ?? '').split(',').map((h) => h.trim());
  return lines.map((l) =>
    Object.fromEntries(l.split(',').map((c, i) => [head[i] ?? 'col' + i, c.trim().replace(/^"|"$/g, '')])),
  );
};

export async function parseUpload(
  filename: string,
  buffer: Buffer,
): Promise<SourceContent & { kind: UploadKind }> {
  const ext = (filename.split('.').pop() ?? '').toLowerCase();
  if (ext === 'docx') return { ...(await parseDocx(buffer)), kind: 'docx' };
  if (ext === 'txt' || ext === 'md')
    return { ...parseText(filename, buffer.toString('utf8'), { allNew: true }), kind: 'text' };
  if (ext === 'json') {
    const j = JSON.parse(buffer.toString('utf8')) as unknown;
    const rows = Array.isArray(j)
      ? j
      : ((j as { docs?: unknown[]; topics?: unknown[] }).docs ?? (j as { topics?: unknown[] }).topics ?? []);
    return { ...rows2content(filename, rows as Record<string, string>[]), kind: 'json' };
  }
  if (ext === 'csv') return { ...rows2content(filename, parseCsv(buffer.toString('utf8'))), kind: 'csv' };
  throw Object.assign(new Error('unsupported file type: ' + ext), {
    statusCode: 400,
    code: 'UNSUPPORTED_FILE',
  });
}
