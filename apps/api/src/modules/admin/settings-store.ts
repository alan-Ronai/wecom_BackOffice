import type pg from 'pg';
import { decryptConfig, encryptConfig } from '../connectors/crypto.js';
import type { Tx } from '../../lib/sql.js';

export type Q = pg.Pool | Tx;

export interface SettingsRow<V, S> {
  value: V;
  secrets: S;
  updatedAt: string | null;
}

/**
 * `app_settings` is the operator-editable half of the configuration: a row per key,
 * non-secret fields in `value`, secrets in an AES-256-GCM blob written with the same
 * `CONNECTOR_KEY` helper the connector configs use. A database dump therefore never
 * carries the Entra client secret or the Palo Alto API key in the clear.
 *
 * An absent row means "nothing has been set here" — the caller falls back to the
 * environment, which is what a fresh install and every container-only deployment use.
 */
export class SettingsStore {
  constructor(
    private db: pg.Pool,
    private keyHex: string,
  ) {}

  async read<V extends object, S extends object>(
    q: Q,
    key: string,
  ): Promise<SettingsRow<Partial<V>, Partial<S>> | null> {
    const r = await q.query<{ value: V; secrets_encrypted: Buffer | null; updated_at: Date }>(
      'select value, secrets_encrypted, updated_at from app_settings where key=$1',
      [key],
    );
    if (!r.rowCount) return null;
    const row = r.rows[0];
    let secrets: Partial<S> = {};
    if (row.secrets_encrypted) {
      try {
        secrets = decryptConfig<Partial<S>>(this.keyHex, row.secrets_encrypted);
      } catch {
        // A rotated CONNECTOR_KEY makes old secrets unreadable. That must degrade to
        // "no stored secret" (env fallback, `hasSecret: false`) rather than 500 the
        // settings page an operator needs in order to re-enter them.
        secrets = {};
      }
    }
    return { value: (row.value ?? {}) as Partial<V>, secrets, updatedAt: row.updated_at.toISOString() };
  }

  /** Merges into the stored row; `secrets` keys whose value is `undefined` are kept. */
  async write<V extends object, S extends object>(
    tx: Tx,
    key: string,
    value: V,
    secrets: Partial<S>,
    actorId: string | null,
  ): Promise<void> {
    const current = await this.read<V, S>(tx, key);
    const mergedSecrets = { ...(current?.secrets ?? {}), ...secrets };
    for (const [k, v] of Object.entries(mergedSecrets))
      if (v === null || v === undefined) delete (mergedSecrets as Record<string, unknown>)[k];
    const blob = Object.keys(mergedSecrets).length ? encryptConfig(this.keyHex, mergedSecrets) : null;
    await tx.query(
      `insert into app_settings(key, value, secrets_encrypted, updated_by) values ($1,$2::jsonb,$3,$4)
       on conflict (key) do update set value=excluded.value, secrets_encrypted=excluded.secrets_encrypted,
                                       updated_by=excluded.updated_by, updated_at=now()`,
      [key, JSON.stringify(value), blob, actorId],
    );
  }

  /** Convenience for the read path, which never has a transaction of its own. */
  pool(): pg.Pool {
    return this.db;
  }
}
