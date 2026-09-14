import type pg from 'pg';
import type { FastifyInstance } from 'fastify';
import type { OidcProvider } from '../modules/auth/oidc.js';
import type { IdentityService } from '../modules/auth/identity.js';
import { audit } from '../lib/audit.js';
import { recordGroupsSynced } from '../modules/admin/groups-sync-state.js';
import { withTransaction } from '../lib/sql.js';
import { QUEUES } from '../plugins/boss.js';

export type SyncDeps = {
  db: pg.Pool;
  oidc: Pick<OidcProvider, 'listDisabledUsers' | 'listUserGroups'>;
  identity: IdentityService;
  log: { info: (o: unknown, m?: string) => void };
};

export async function runIdentitySync(
  deps: SyncDeps,
): Promise<{ checked: number; deactivated: number; roleChanges: number; groups: number }> {
  const users = (
    await deps.db.query<{ id: string; subject: string }>(
      `select id, subject from users where active and source='entra'`,
    )
  ).rows;
  const disabled = await deps.oidc.listDisabledUsers(users.map((u) => u.subject));
  let deactivated = 0,
    roleChanges = 0;
  for (const u of users) {
    if (disabled.has(u.subject)) {
      await deps.identity.deactivate(u.id, null);
      deactivated++;
      continue;
    }
    const groups = await deps.oidc.listUserGroups(u.subject);
    const ch = await deps.identity.applyGroupMap(u.id, groups);
    if (ch.added.length || ch.removed.length) roleChanges++;
  }
  // Bookkeeping the admin screen reads back (`GET /admin/groups-map`): the run reconciled every
  // mapping, so every mapping is stamped with the run's time. Recorded after the loop, so a run
  // that threw half way through does not claim the mappings it never reached.
  const syncedGroups = await recordGroupsSynced(deps.db, new Date());
  const summary = { checked: users.length, deactivated, roleChanges, groups: syncedGroups.length };
  await withTransaction(deps.db, (tx) =>
    audit(tx, {
      actorId: null,
      action: 'identity.sync',
      entityType: 'system',
      entityId: null,
      before: null,
      after: summary,
      requestId: null,
      ip: null,
    }),
  );
  deps.log.info(summary, 'identity sync finished');
  return summary;
}

export async function registerIdentitySyncJob(app: FastifyInstance): Promise<void> {
  if (!app.oidc) {
    app.log.info('identity.sync not scheduled: OIDC not configured');
    return;
  }
  if (!app.boss) {
    app.log.warn('identity.sync not scheduled: pg-boss unavailable');
    return;
  }
  const oidc = app.oidc;
  await app.boss.work(QUEUES.identitySync, async () => {
    await runIdentitySync({ db: app.db, oidc, identity: app.identity, log: app.log });
  });
  try {
    await app.boss.schedule(QUEUES.identitySync, '0 3 * * *', {}, { tz: 'Asia/Jerusalem' });
  } catch (err) {
    app.log.warn({ err }, 'could not schedule identity.sync');
  }
}
