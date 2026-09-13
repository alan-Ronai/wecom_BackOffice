import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Paragraph } from '@wecom/shared';
import type {
  Connector,
  ConnectorInfo,
  LibraryContent,
  RemoteItem,
  RemoteRef,
  SourceContent,
} from '../contract.js';
import { JsonConfigSchema, type JsonConfig } from './config.js';

type Row = Record<string, unknown>;
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function parseCsv(text: string): Row[] {
  const lines = text
    .replace(/\r/g, '')
    .split('\n')
    .filter((l) => l.trim().length);
  const split = (l: string) => {
    const out: string[] = [];
    let cur = '';
    let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === ',' && !q) {
        out.push(cur);
        cur = '';
      } else cur += ch;
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const head = split(lines[0] ?? '');
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? String(i), v])));
}

/** Read-only connector over a static JSON or CSV data file: one row becomes one card. */
export class JsonFileConnector implements Connector<JsonConfig> {
  configSchema = JsonConfigSchema;

  describe(): ConnectorInfo {
    return {
      id: 'json',
      name: 'קובץ JSON / CSV',
      capabilities: { read: true, write: false, webhooks: false, identity: false },
    };
  }

  private async rows(cfg: JsonConfig): Promise<Row[]> {
    const text = cfg.inline ?? (await readFile(cfg.path as string, 'utf8'));
    if (cfg.format === 'csv') return parseCsv(text);
    const j = JSON.parse(text) as unknown;
    const arr = Array.isArray(j)
      ? j
      : ((j as { rows?: unknown[] }).rows ??
        (j as { topics?: unknown[] }).topics ??
        (j as { docs?: unknown[] }).docs ??
        []);
    return arr as Row[];
  }

  private idOf(cfg: JsonConfig, row: Row, i: number): string {
    const v = cfg.mapping.id ? row[cfg.mapping.id] : undefined;
    return v == null || v === '' ? 'row-' + (i + 1) : String(v);
  }

  async testConnection(cfg: JsonConfig): Promise<{ ok: boolean; message: string }> {
    try {
      const n = (await this.rows(cfg)).length;
      return { ok: true, message: `נקראו ${n} שורות` };
    } catch (e) {
      return { ok: false, message: 'הקובץ לא נקרא: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  async listRemote(cfg: JsonConfig): Promise<RemoteItem[]> {
    const rows = await this.rows(cfg);
    return rows.map((r, i) => ({
      externalId: this.idOf(cfg, r, i),
      title: String(r[cfg.mapping.title] ?? ''),
      hash: hash(JSON.stringify(r)),
      updatedAt: new Date(0).toISOString(),
      kind: cfg.format,
    }));
  }

  async fetch(cfg: JsonConfig, externalId: string): Promise<SourceContent> {
    const rows = await this.rows(cfg);
    const i = rows.findIndex((r, idx) => this.idOf(cfg, r, idx) === externalId);
    if (i < 0) throw new Error('row not found: ' + externalId);
    const r = rows[i];
    const m = cfg.mapping;
    const title = String(r[m.title] ?? '');
    const paragraphs: Paragraph[] = [{ ref: 'h2-1', heading: title, level: 2, runs: [{ t: title }] }];
    let n = 1;
    const desc = m.description ? String(r[m.description] ?? '') : '';
    if (desc) paragraphs.push({ ref: 'h2-1.p-' + n++, runs: [{ t: desc }] });
    const steps = m.steps
      ? String(r[m.steps] ?? '')
          .split(/\n+/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    for (const s of steps) paragraphs.push({ ref: 'h2-1.p-' + n++, runs: [{ t: s }] });
    return {
      title,
      paragraphs,
      hash: hash(JSON.stringify(r)),
      meta: {
        row: i,
        category: m.category ? r[m.category] : undefined,
        wave: m.wave ? Number(r[m.wave]) || undefined : undefined,
        priority: m.priority ? r[m.priority] : undefined,
      },
    };
  }

  async push(_cfg: JsonConfig, _externalId: string | null, _content: LibraryContent): Promise<RemoteRef> {
    throw new Error('read-only connector');
  }
}
