/**
 * Wave-5 parked-item cleanup: the schema half.
 *
 * - B-M10 `source_document_versions.etag`. A source *version* had no etag of its own, so
 *   `getSourceVersion` served the live `source_documents.etag` alongside a historical body: a
 *   client that opened version 3, edited and `PUT`-ed passed `If-Match` even though current was
 *   7, and the newer text was overwritten with no 412. Each version now carries the etag that was
 *   current while it was, which is what makes "the etag I was given no longer matches" true for
 *   an old version.
 */

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
};

exports.down = (pgm) => {
  pgm.dropColumns('source_document_versions', ['etag']);
};
