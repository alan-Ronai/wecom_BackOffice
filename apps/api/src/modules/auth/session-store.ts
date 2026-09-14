import type pg from 'pg';
import { hashToken, newSessionToken, SESSION_TTL_MS } from '../../lib/session.js';

/** Long enough that a session write is not a settings read; short enough to feel immediate. */
const TTL_CACHE_MS = 60_000;

export type SessionRow = {
  id: string;
  userId: string;
  displayName: string;
  lastSeenAt: Date;
  expiresAt: Date;
};

export class SessionStore {
  constructor(private db: pg.Pool) {}

  private ttlCache: { at: number; ms: number } | null = null;

  /**
   * The effective session length. `PUT /admin/identity` accepts `sessionHours` (1-72) and
   * `GET /admin/identity` reads it back, so the admin screen has always *shown* the operator's
   * value — but `create`, `touch` and the cookie all used the module constant, so an operator
   * who tightened sessions to an hour for a compliance reason got eight and a UI that told them
   * otherwise. That is worse than not offering the setting, so the setting is now read here.
   *
   * Read straight from `app_settings` rather than through `SettingsStore`: this is the only
   * non-secret field involved, and the auth layer must not depend on the admin module.
   */
  async ttlMs(): Promise<number> {
    if (this.ttlCache && Date.now() - this.ttlCache.at < TTL_CACHE_MS) return this.ttlCache.ms;
    let ms = SESSION_TTL_MS;
    try {
      const r = await this.db.query<{ hours: number | null }>(
        `select (value->>'sessionHours')::int as hours from app_settings where key = 'identity'`,
      );
      const hours = r.rows[0]?.hours;
      // The same 1-72 bound `IdentitySettingsPutSchema` enforces: a row edited by hand must not
      // be able to mint a ten-year session.
      if (hours && hours >= 1 && hours <= 72) ms = hours * 3_600_000;
    } catch {
      // `app_settings` arrives in 0021; a database migrated only part-way still signs people in.
    }
    this.ttlCache = { at: Date.now(), ms };
    return ms;
  }

  /** Called by `PUT /admin/identity` so a change takes effect on the next sign-in, not in a minute. */
  invalidateTtl(): void {
    this.ttlCache = null;
  }

  async create(
    userId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ token: string; id: string }> {
    const token = newSessionToken();
    const r = await this.db.query<{ id: string }>(
      `insert into sessions(user_id, token_hash, ip, user_agent, expires_at) values ($1,$2,$3,$4,$5) returning id`,
      [userId, hashToken(token), ip, userAgent, new Date(Date.now() + (await this.ttlMs()))],
    );
    return { token, id: r.rows[0].id };
  }
  async find(token: string): Promise<SessionRow | null> {
    const r = await this.db.query<{
      id: string;
      user_id: string;
      display_name: string;
      last_seen_at: Date;
      expires_at: Date;
    }>(
      `select s.id, s.user_id, u.display_name, s.last_seen_at, s.expires_at
         from sessions s join users u on u.id = s.user_id
        where s.token_hash=$1 and s.revoked_at is null and s.expires_at > now() and u.active`,
      [hashToken(token)],
    );
    const s = r.rows[0];
    return s
      ? {
          id: s.id,
          userId: s.user_id,
          displayName: s.display_name,
          lastSeenAt: s.last_seen_at,
          expiresAt: s.expires_at,
        }
      : null;
  }
  async touch(id: string): Promise<void> {
    await this.db.query(`update sessions set last_seen_at=now(), expires_at=$2 where id=$1`, [
      id,
      new Date(Date.now() + (await this.ttlMs())),
    ]);
  }
  async revoke(id: string): Promise<void> {
    await this.db.query(`update sessions set revoked_at=now() where id=$1 and revoked_at is null`, [id]);
  }
  async revokeAllForUser(userId: string): Promise<number> {
    const r = await this.db.query(
      `update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`,
      [userId],
    );
    return r.rowCount ?? 0;
  }
}
