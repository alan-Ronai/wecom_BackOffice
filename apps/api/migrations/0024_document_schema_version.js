/**
 * Backend review deferred minor #15: `getVersion` used to re-validate every stored
 * `document_versions.snapshot` against the *current* `DocumentSchema`, so a schema change
 * that wasn't backward-compatible turned every old version into a 500. This stamps each
 * snapshot with the schema version it was written under so a future incompatible change
 * can migrate old snapshots forward before parsing, instead of failing at read time.
 * See `apps/api/src/modules/documents/repo.ts` (`CURRENT_DOCUMENT_SCHEMA_VERSION`,
 * `SNAPSHOT_MIGRATIONS`, `parseSnapshot`).
 */
exports.up = (pgm) => {
  pgm.addColumns('document_versions', {
    schema_version: { type: 'integer', notNull: true, default: 1 },
  });
};
exports.down = (pgm) => {
  pgm.dropColumns('document_versions', ['schema_version']);
};
