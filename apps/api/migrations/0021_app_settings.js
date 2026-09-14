/**
 * Stage 5 — runtime settings an operator edits from the admin UI instead of redeploying.
 *
 * `value` holds everything safe to read back; `secrets_encrypted` is an AES-256-GCM blob
 * written with the same `CONNECTOR_KEY` helper the connector configs use, so a database
 * dump never carries the Entra client secret or the Palo Alto API key in the clear. The
 * environment stays the fallback: an empty table means "whatever the env says".
 */
exports.up = (pgm) => {
  pgm.createTable('app_settings', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'jsonb', notNull: true, default: '{}' },
    secrets_encrypted: 'bytea',
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    updated_by: { type: 'uuid', references: 'users' },
  });
};

exports.down = (pgm) => {
  pgm.dropTable('app_settings');
};
