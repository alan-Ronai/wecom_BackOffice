import { createHash } from 'node:crypto';
import type pg from 'pg';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient | Tx;

/**
 * Header a current WordPress plugin sends with a unique random value per delivery.
 *
 * It is documented in `docs/connectors.md` and it is **not** what the replay key is derived
 * from — a header is outside the HMAC, so an attacker replaying a captured body could simply
 * put a fresh value in it. The key below hashes the signed bytes instead. The header's job is
 * to tell the operator that the plugin is new enough to also carry a `nonce` *field inside the
 * signed body*, which is what makes two saves of the same post in the same second distinct
 * requests rather than a false replay.
 */
export const NONCE_HEADER = 'x-kb-nonce';

/**
 * How long a delivery is remembered. `MAX_WEBHOOK_SKEW_MS` (5 minutes) already rejects anything
 * older, so an hour is a wide margin over the only window in which a replay can land; the rows
 * are kept longer than they are useful purely so the purge can run on a schedule rather than on
 * every request.
 */
export const NONCE_TTL_MS = 60 * 60_000;

/**
 * The replay key: sha256 of the exact request body.
 *
 * The body is what the HMAC covers, so two requests with the same key are byte-identical and
 * carry the same signature — which is precisely what a replay is. Hashing the body rather than
 * the signature keeps this connector-agnostic (a connector that signs differently, or names its
 * signature header differently, needs no change here) and keeps the stored value fixed-width.
 */
export const replayKey = (rawBody: string): string =>
  createHash('sha256').update(rawBody, 'utf8').digest('hex');

/**
 * Records this delivery and reports whether it is the first time we have seen it.
 *
 * `on conflict do nothing` makes the claim atomic, so two workers racing the same replayed
 * request cannot both decide they were first.
 */
export async function claimWebhookNonce(q: Q, connectorId: string, nonce: string): Promise<boolean> {
  const r = await q.query(
    `insert into webhook_nonces(connector_id, nonce) values ($1, $2)
       on conflict (connector_id, nonce) do nothing`,
    [connectorId, nonce],
  );
  return (r.rowCount ?? 0) > 0;
}

/**
 * Gives a claim back, for a delivery that was claimed and then could not be acted on.
 *
 * The claim has to be taken *before* the work is enqueued — taking it after would let two
 * copies of the same delivery both enqueue a sync run, which is the thing replay protection
 * exists to stop. That ordering leaves one hole: if the enqueue then fails, the claim outlives
 * the delivery it was claimed for, and WordPress's retry of the same bytes answers 409 REPLAY
 * for a sync that never ran — the author's edit lost, silently, until the next full run.
 * Releasing the row on that path closes it: the retry is a first delivery again.
 */
export async function releaseWebhookNonce(q: Q, connectorId: string, nonce: string): Promise<void> {
  await q.query(`delete from webhook_nonces where connector_id=$1 and nonce=$2`, [connectorId, nonce]);
}

/** Drops deliveries older than the TTL. Runs on the nightly `trash.purge` housekeeping job. */
export async function purgeWebhookNonces(q: Q, ttlMs: number = NONCE_TTL_MS): Promise<number> {
  const r = await q.query(
    `delete from webhook_nonces where seen_at < now() - ($1 || ' milliseconds')::interval`,
    [String(ttlMs)],
  );
  return r.rowCount ?? 0;
}
