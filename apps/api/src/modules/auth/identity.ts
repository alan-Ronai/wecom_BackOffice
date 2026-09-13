import type pg from 'pg';
import { withTransaction } from '../../lib/sql.js';

/** Two characters, matching `users.initials` (max 2) and what the avatar chip renders. */
export const initials = (name: string): string => {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2);
  return (parts[0][0] ?? '') + (parts[1][0] ?? '');
};

export type UpsertInput = {
  subject: string;
  source: 'entra' | 'paloalto' | 'local';
  email: string | null;
  displayName: string;
};

export class IdentityService {
  constructor(
    private db: pg.Pool,
    private invalidate: (userId: string) => void,
  ) {}

  /**
   * One transaction, and the insert is an upsert on `(subject, source)`: this is a
   * read-then-write across four statements, and two concurrent first logins used to
   * race on that unique index.
   */
  async upsertUser(input: UpsertInput): Promise<{ id: string; created: boolean }> {
    const email = input.email ? input.email.toLowerCase() : null;
    return withTransaction(this.db, async (tx) => {
      const bySubject = await tx.query<{ id: string }>(
        `select id from users where subject=$1 and source=$2 for update`,
        [input.subject, input.source],
      );
      let id = bySubject.rows[0]?.id;
      let created = false;
      if (!id && email) {
        // merge: same source, or a VPN-identified (paloalto) row being upgraded to an Entra identity
        const byEmail = await tx.query<{ id: string }>(
          `select id from users where lower(email)=$1 and (source=$2 or (source='paloalto' and $2='entra')) order by created_at limit 1 for update`,
          [email, input.source],
        );
        id = byEmail.rows[0]?.id;
        if (id)
          await tx.query(`update users set subject=$2, source=$3 where id=$1`, [
            id,
            input.subject,
            input.source,
          ]);
      }
      if (!id) {
        const r = await tx.query<{ id: string }>(
          `insert into users(subject, source, email, display_name, initials, last_login_at)
           values ($1,$2,$3,$4,$5,now())
           on conflict (subject, source) do update set last_login_at=now()
           returning id, (xmax = 0) as inserted`,
          [input.subject, input.source, email, input.displayName, initials(input.displayName)],
        );
        id = r.rows[0].id;
        created = (r.rows[0] as { inserted?: boolean }).inserted !== false;
      } else {
        await tx.query(
          `update users set email=coalesce($2,email), display_name=$3, initials=$4, last_login_at=now(), updated_at=now() where id=$1`,
          [id, email, input.displayName, initials(input.displayName)],
        );
      }
      return { id, created };
    });
  }

  async applyGroupMap(userId: string, groupIds: string[]): Promise<{ added: string[]; removed: string[] }> {
    const mapped = await this.db.query<{ role_id: string; name: string }>(
      `select distinct gm.role_id, r.name from groups_map gm join roles r on r.id=gm.role_id`,
    );
    const wanted = await this.db.query<{ role_id: string; name: string }>(
      `select distinct gm.role_id, r.name from groups_map gm join roles r on r.id=gm.role_id where gm.idp_group_id = any($1::text[])`,
      [groupIds],
    );
    const current = await this.db.query<{ role_id: string; name: string }>(
      `select ur.role_id, r.name from user_roles ur join roles r on r.id=ur.role_id where ur.user_id=$1`,
      [userId],
    );
    const wantedIds = new Set(wanted.rows.map((x) => x.role_id));
    const mappedIds = new Set(mapped.rows.map((x) => x.role_id));
    const currentIds = new Set(current.rows.map((x) => x.role_id));
    const added: string[] = [];
    const removed: string[] = [];
    for (const w of wanted.rows)
      if (!currentIds.has(w.role_id)) {
        await this.db.query(
          `insert into user_roles(user_id, role_id) values ($1,$2) on conflict do nothing`,
          [userId, w.role_id],
        );
        added.push(w.name);
      }
    for (const c of current.rows)
      if (mappedIds.has(c.role_id) && !wantedIds.has(c.role_id)) {
        await this.db.query(`delete from user_roles where user_id=$1 and role_id=$2`, [userId, c.role_id]);
        removed.push(c.name);
      }
    if (added.length || removed.length) this.invalidate(userId);
    return { added: added.sort(), removed: removed.sort() };
  }

  async deactivate(userId: string, _actorId: string | null): Promise<void> {
    await this.db.query(`update users set active=false, updated_at=now() where id=$1`, [userId]);
    await this.db.query(`update sessions set revoked_at=now() where user_id=$1 and revoked_at is null`, [
      userId,
    ]);
    this.invalidate(userId);
  }
}
