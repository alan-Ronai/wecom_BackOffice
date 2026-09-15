/**
 * Wave 6 (X2) — the admin transcript export (spec §1.5).
 *
 * NDJSON streamed a conversation at a time rather than a JSON array built in memory: the whole
 * point of keeping transcripts is to have a year of them to tune prompts against, and a year
 * does not fit in a reply buffer. One line per conversation, each carrying its messages and the
 * feedback left on them, so `jq` and a spreadsheet both work without a parser.
 */
import type { FastifyReply } from 'fastify';
import type { Queryable } from '../../lib/sql.js';
import { exportCursor, type ExportFilter } from './repo.js';

export async function streamTranscripts(
  q: Queryable,
  filter: ExportFilter,
  reply: FastifyReply,
): Promise<void> {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'application/x-ndjson; charset=utf-8',
    'content-disposition': 'attachment; filename="ai-conversations.jsonl"',
    'cache-control': 'no-store',
  });
  try {
    for await (const row of exportCursor(q, filter)) {
      if (res.writableEnded) return; // the admin closed the download
      res.write(JSON.stringify(row) + '\n');
    }
  } finally {
    if (!res.writableEnded) res.end();
  }
}
