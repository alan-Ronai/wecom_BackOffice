import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ASSET_MAX_BYTES, ASSET_MIMES, type Asset } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient | Tx;
export const assetUrl = (id: string) => '/api/v1/assets/' + id;

/** PNG/JPEG/GIF/WebP dimensions from the header; null when unrecognised (the exporter then uses a default box). */
export function imageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && bytes.length > 24)
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'image/gif' && bytes.length > 10)
    return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3)
        return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  if (mime === 'image/webp' && bytes.length > 30 && bytes.toString('ascii', 12, 16) === 'VP8 ')
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  return null;
}

const toAsset = (r: Record<string, unknown>): Asset => ({
  id: r.id as string,
  url: assetUrl(r.id as string),
  mime: r.mime as Asset['mime'],
  size: r.size as number,
  width: (r.width as number | null) ?? null,
  height: (r.height as number | null) ?? null,
});

export async function putAsset(
  q: Q,
  a: { bytes: Buffer; mime: string; createdBy: string | null },
): Promise<Asset> {
  if (!(ASSET_MIMES as readonly string[]).includes(a.mime))
    throw httpError(415, 'UNSUPPORTED_ASSET', 'סוג קובץ לא נתמך: מותרים PNG, JPEG, GIF, WebP');
  if (a.bytes.length > ASSET_MAX_BYTES) throw httpError(413, 'ASSET_TOO_LARGE', 'הקובץ גדול מ-10MB');
  if (!a.bytes.length) throw httpError(400, 'EMPTY_ASSET', 'קובץ ריק');
  const sha = createHash('sha256').update(a.bytes).digest('hex');
  const existing = await q.query('select id, mime, size, width, height from assets where sha256=$1', [
    sha,
  ]);
  if (existing.rowCount) return toAsset(existing.rows[0]);
  const dim = imageSize(a.bytes, a.mime);
  const r = await q.query(
    `insert into assets(mime, bytes, sha256, size, width, height, created_by) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (sha256) do update set size=excluded.size returning id, mime, size, width, height`,
    [a.mime, a.bytes, sha, a.bytes.length, dim?.width ?? null, dim?.height ?? null, a.createdBy],
  );
  return toAsset(r.rows[0]);
}

export async function getAsset(
  q: Q,
  id: string,
): Promise<{
  mime: string;
  bytes: Buffer;
  size: number;
  width: number | null;
  height: number | null;
} | null> {
  const r = await q.query('select mime, bytes, size, width, height from assets where id=$1', [id]);
  if (!r.rowCount) return null;
  const x = r.rows[0];
  return {
    mime: x.mime,
    bytes: x.bytes as Buffer,
    size: x.size,
    width: x.width ?? null,
    height: x.height ?? null,
  };
}

/** Deletes assets that no source document version and no text-kind body references. */
export async function gcUnreferencedAssets(q: Q): Promise<number> {
  // `documents.body_html` only exists once W1's migration lands; probe rather than assume.
  const hasBody = await q.query(
    "select 1 from information_schema.columns where table_name='documents' and column_name='body_html'",
  );
  const bodyClause = hasBody.rowCount
    ? "and not exists (select 1 from documents d where d.body_html like '%' || a.id::text || '%')"
    : '';
  const r = await q.query(`
    delete from assets a
    where not exists (select 1 from source_document_versions v where v.html like '%' || a.id::text || '%')
      and not exists (select 1 from source_documents s where s.html like '%' || a.id::text || '%')
      ${bodyClause}
      and a.created_at < now() - interval '1 day'`);
  return r.rowCount ?? 0;
}
