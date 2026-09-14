/**
 * Small key/value table so a background worker's result can be read back by a request
 * handler in a different process — first user: `system.backup-check` (see
 * `apps/api/src/services/backupCheck.ts`, `apps/api/src/plugins/boss.ts`).
 */
exports.up = (pgm) => {
  pgm.createTable('system_state', {
    key: { type: 'text', primaryKey: true },
    value: { type: 'jsonb', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};
exports.down = (pgm) => {
  pgm.dropTable('system_state');
};
