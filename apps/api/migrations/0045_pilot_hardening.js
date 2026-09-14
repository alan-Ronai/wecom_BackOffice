/**
 * Pilot hardening — the acceptance review's "can wait" backend items, in one migration.
 *
 * 1. `webhook_nonces` (I7 residual) — replay protection for `POST /connectors/:id/webhook`.
 *    `assertFresh` already bounds how *old* a captured request may be (five minutes); nothing
 *    stopped the same signed bytes being posted a hundred times inside that window. One row per
 *    accepted webhook, keyed by a hash of the exact request body, makes the second one a 409.
 *
 * `down` reverses everything so `migrations.test.ts`'s full rollback stays green.
 */

exports.up = (pgm) => {
  // ── 1. webhook replay protection (I7) ──────────────────────────────────
  pgm.createTable(
    'webhook_nonces',
    {
      connector_id: { type: 'uuid', notNull: true, references: 'connectors', onDelete: 'cascade' },
      // sha256 of the raw request body, hex. See `connectors/nonces.ts` for why the body and
      // not the `X-KB-Nonce` header is what gets hashed.
      nonce: { type: 'text', notNull: true },
      seen_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    },
    { constraints: { primaryKey: ['connector_id', 'nonce'] } },
  );
  // The TTL purge deletes by age across every connector, so the index is on `seen_at` alone.
  pgm.createIndex('webhook_nonces', 'seen_at', { name: 'webhook_nonces_seen_at_index' });
};

exports.down = (pgm) => {
  pgm.dropTable('webhook_nonces');
};
