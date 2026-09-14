import { createHash } from 'node:crypto';

/**
 * The library side's content fingerprint, for the parity report.
 *
 * Connectors already hash their own side (`RemoteItem.hash`), but nothing hashed ours: the local
 * baseline was only ever a *version number*, which answers "did this document change" and not
 * "is this the same content as last time" — a publish that reverts an edit bumps the version and
 * leaves the content where it started, and the report would call that a divergence.
 *
 * The digest is taken over the published snapshot's title and phases, JSON-stringified with sorted
 * keys, so it is stable across a Postgres `jsonb` round trip (which does not preserve key order)
 * and across a snapshot that gains an unrelated field. It is deliberately **not** comparable to a
 * remote hash — the two sides hash different content in different formats — and the contract says
 * so; it is the library's own identity, shown beside the remote's.
 */
export function localContentHash(snapshot: unknown): string {
  const s = (snapshot ?? {}) as { title?: unknown; phases?: unknown };
  return createHash('sha256')
    .update(stableStringify({ title: s.title ?? '', phases: s.phases ?? [] }), 'utf8')
    .digest('hex');
}

/** `JSON.stringify` with object keys sorted at every depth. Arrays keep their order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return '{' + entries.map(([k, v]) => JSON.stringify(k) + ':' + stableStringify(v)).join(',') + '}';
}
