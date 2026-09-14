/**
 * Wave-5 parked-item cleanup: the schema half.
 *
 * - B-M10 `source_document_versions.etag`. A source *version* had no etag of its own, so
 *   `getSourceVersion` served the live `source_documents.etag` alongside a historical body: a
 *   client that opened version 3, edited and `PUT`-ed passed `If-Match` even though current was
 *   7, and the newer text was overwritten with no 412. Each version now carries the etag that was
 *   current while it was, which is what makes "the etag I was given no longer matches" true for
 *   an old version.
 *
 * - A-M13 a unique index on `document_links`. The seed's `_usedIn` insert lost the
 *   `on conflict do nothing` the old `script_refs` insert had, because after the scripts fold
 *   there was nothing to conflict on. Picking the constraint was the part the fix wave declined
 *   to do: `document_links` legitimately carries several rows per document pair — different
 *   `from_step_key`, `type` and `origin`, and four mutually exclusive targets — so the key is the
 *   whole edge rather than the pair.
 */

/**
 * The edge identity, as an expression list over `p` (a table alias with its dot, or '' for the
 * index, where Postgres wants bare column names). Null-safe: `coalesce(…, '')` is what makes two
 * rows that are both "no step key, document target" collide, where a unique index over nullable
 * columns would call every such pair distinct.
 */
const linkKey = (p) => [
  `${p}from_document_id`,
  `coalesce(${p}from_step_key, '')`,
  `coalesce(${p}to_document_id::text, '')`,
  `coalesce(${p}to_block_id::text, '')`,
  `coalesce(${p}to_field_name, '')`,
  `coalesce(${p}to_source_id::text, '')`,
  `${p}type`,
  `${p}origin`,
];

exports.up = (pgm) => {
  /* ── B-M10 ─────────────────────────────────────────────────────────────── */
  pgm.addColumns('source_document_versions', { etag: { type: 'text' } });
  // The version that is current keeps the live etag, so `GET /source` and
  // `GET /source/versions/<current>` agree and an in-flight editor's If-Match still matches.
  pgm.sql(`update source_document_versions v
              set etag = s.etag
             from source_documents s
            where s.id = v.source_document_id and v.version = s.current_version`);
  // Historical rows get a deterministic value derived from the body. The version number is in
  // the hash on purpose: a restore re-saves an older body verbatim, so two versions can share
  // their html, and two versions sharing an etag would reopen exactly the hole being closed.
  pgm.sql(`update source_document_versions
              set etag = md5(version::text || ':' || html)
            where etag is null`);
  pgm.alterColumn('source_document_versions', 'etag', {
    notNull: true,
    default: pgm.func('gen_random_uuid()::text'),
  });

  /* ── A-M13 ─────────────────────────────────────────────────────────────── */
  // Dedupe first, or the index cannot be built on a database that already ran the seed twice.
  // `ctid` keeps the physically-first row of each edge and needs no ordering column, which
  // `document_links` does not have.
  const a = linkKey('a.');
  const b = linkKey('b.');
  pgm.sql(`delete from document_links a using document_links b
            where a.ctid > b.ctid
              and ${a.map((k, i) => `${k} = ${b[i]}`).join('\n              and ')}`);
  pgm.sql(`create unique index document_links_edge_uniq on document_links (${linkKey('').join(', ')})`);
};

exports.down = (pgm) => {
  pgm.sql('drop index if exists document_links_edge_uniq');
  pgm.dropColumns('source_document_versions', ['etag']);
};
