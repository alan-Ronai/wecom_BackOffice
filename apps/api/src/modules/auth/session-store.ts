import type pg from 'pg';
import { hashToken, newSessionToken, SESSION_TTL_MS } from '../../lib/session.js';

export type SessionRow = {
  id: string;
  userId: string;
  displayName: string;
  lastSeenAt: Date;
  expiresAt: Date;
};

export class SessionStore {
  constructor(private db: pg.Pool) {}
  async create(
    userId: string,
    ip: string | null,
    userAgent: string | null,
  ): Promise<{ token: string; id: string }> {
    const token = newSessionToken();
    const r = await this.db.query<{ id: string }>(
      `insert into sessions(user_id, token_hash, ip, user_agent, expires_at) values ($1,$2,$3,$4,$5) returning id`,
      [userId, hashToken(token), ip, userAgent, new Date(Date.now() + SESSION_TTL_MS)],
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
      new Date(Date.now() + SESSION_TTL_MS),
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
