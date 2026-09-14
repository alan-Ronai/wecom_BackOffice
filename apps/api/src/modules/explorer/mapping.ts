import { createHash } from 'node:crypto';
import type { ColumnMappingSchema, MappingFieldSchema, Paragraph } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';
import type { z } from 'zod';

export type MappingField = z.infer<typeof MappingFieldSchema>;
export type ColumnMapping = z.infer<typeof ColumnMappingSchema>;
/** How a source's mapping is persisted in the existing `sources.mapping` jsonb: column -> field. */
export type MappingRecord = Record<string, string>;

/** Cell values of a json upload can be anything; the explorer renders text. */
export const cell = (v: unknown): string => {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(cell).filter(Boolean).join(' · ');
  return JSON.stringify(v);
};

export const normaliseRow = (row: Record<string, unknown>): Record<string, string> =>
  Object.fromEntries(Object.entries(row ?? {}).map(([k, v]) => [k, cell(v)]));

/** Union of the keys of the sampled rows, in first-seen order — the header the UI shows. */
export function inferColumns(rows: Record<string, unknown>[], sample = 200): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const row of rows.slice(0, sample))
    for (const k of Object.keys(row ?? {}))
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
      }
  return out;
}

/**
 * First-guess column -> field mapping. Hebrew and English headers both matter: the exports
 * this lands from are written by whoever owned the spreadsheet, so match on either.
 */
const HEURISTICS: [MappingField, RegExp][] = [
  ['title', /^(title|name|subject|topic|כותרת|שם|נושא)$|title|כותרת/i],
  ['description', /desc|summary|body|content|abstract|תיאור|תקציר|פירוט/i],
  ['category', /categor|section|domain|area|קטגורי|תחום|אזור/i],
  ['wave', /wave|phase|גל|שלב/i],
  ['priority', /priorit|severity|urgen|עדיפות|דחיפות/i],
  ['code', /^(code|id|key|sku|מזהה|קוד)$|code|קוד/i],
  ['stepTitle', /step.*(title|name)|שם.?שלב|כותרת.?שלב/i],
  ['stepAction', /action|instruction|do|פעולה|הוראה/i],
  ['stepOutcome', /outcome|result|expected|תוצאה|תוצר/i],
];

export function inferMapping(columns: string[], rows: Record<string, string>[]): MappingRecord {
  const out: MappingRecord = {};
  const taken = new Set<MappingField>();
  for (const [field, re] of HEURISTICS) {
    const hit = columns.find((c) => !(c in out) && re.test(c));
    if (hit) {
      out[hit] = field;
      taken.add(field);
    }
  }
  // A file with no recognisable header still has to produce something importable: the first
  // column that actually carries text becomes the title.
  if (!taken.has('title')) {
    const first = columns.find((c) => !(c in out) && rows.some((r) => (r[c] ?? '').trim()));
    if (first) out[first] = 'title';
  }
  for (const c of columns) if (!(c in out)) out[c] = 'ignore';
  return out;
}

/** The persisted record plus a live sample per column — what `DataFileSchema.mapping` carries. */
export function toColumnMapping(
  columns: string[],
  record: MappingRecord | null,
  firstRow: Record<string, string> | null,
): ColumnMapping[] {
  return columns.map((column) => {
    const sample = (firstRow?.[column] ?? '').slice(0, 120);
    const field = (record?.[column] ?? 'ignore') as MappingField;
    return sample ? { column, field, sample } : { column, field };
  });
}

export const toMappingRecord = (mapping: ColumnMapping[]): MappingRecord =>
  Object.fromEntries(mapping.map((m) => [m.column, m.field]));

const pick = (row: Record<string, string>, record: MappingRecord, field: MappingField): string => {
  for (const [column, f] of Object.entries(record))
    if (f === field && (row[column] ?? '').trim()) return row[column].trim();
  return '';
};

/**
 * Rows -> the `SourceContent` the L5 pipeline understands, one paragraph per row, rendered
 * through the current mapping. The hash covers the mapping as well as the data, so
 * re-importing after a mapping change is a genuinely new revision rather than a duplicate.
 */
export function contentFromRows(
  title: string,
  rows: Record<string, string>[],
  record: MappingRecord,
): SourceContent {
  const paragraphs: Paragraph[] = rows.map((row, i) => {
    const heading = pick(row, record, 'title') || pick(row, record, 'stepTitle');
    const body = [
      pick(row, record, 'description'),
      pick(row, record, 'stepAction'),
      pick(row, record, 'stepOutcome'),
    ]
      .filter(Boolean)
      .join('. ');
    const text = [heading, body].filter(Boolean).join('. ') || Object.values(row).filter(Boolean).join(' · ');
    const para: Paragraph = { ref: String(i + 1), runs: [{ t: text }] };
    if (heading) para.heading = heading.slice(0, 80);
    return para;
  });
  return {
    title,
    paragraphs,
    hash: createHash('sha256').update(JSON.stringify({ rows, record })).digest('hex'),
    meta: { rows: rows.length, columns: inferColumns(rows) },
  };
}
