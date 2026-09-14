import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AdminSystemSchema, VERSION } from '@wecom/shared';
import { QUEUES } from '../../plugins/boss.js';
import { checkBackupAge, getRecordedBackupCheck } from '../../services/backupCheck.js';

const started = Date.now();
const MODEL_PROBE_MS = 2000;

/**
 * Stage-1 §4 `GET /admin/system`. `/system/health` is the liveness probe the
 * container and `smoke.sh` hit; this is the operator's diagnostic view —
 * per-queue depth, last backup age, connector health, pipeline backlog — and it
 * is what INSTALL.md's troubleshooting section points at.
 */
export default async function systemRoutes(instance: FastifyInstance) {
  const app = instance.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/system',
    {
      config: { requires: ['system.admin'] },
      schema: { tags: ['admin'], response: { 200: AdminSystemSchema } },
    },
    async () => {
      let db = false;
      try {
        await app.db.query('select 1');
        db = true;
      } catch {
        db = false;
      }
      // `app.model` is decorated by L5's model plugin later in the same scope.
      const model = app.model
        ? await Promise.race([
            app.model.available().catch(() => false),
            new Promise<boolean>((r) => setTimeout(() => r(false), MODEL_PROBE_MS)),
          ])
        : false;
      const queues: Record<string, number> = {};
      if (app.boss)
        for (const q of Object.values(QUEUES)) {
          try {
            queues[q] = await app.boss.getQueueSize(q);
          } catch {
            /* a queue that has never been created reports nothing */
          }
        }
      const queue = app.boss ? Object.values(queues).reduce((a, b) => a + b, 0) : null;

      const connectors = db
        ? (
            await app.db.query(
              `select c.id, c.name, c.type, c.enabled, c.last_status, c.last_run_at,
                 (select count(*)::int from sync_links l where l.connector_id=c.id and l.state='conflict') as conflicts
               from connectors c order by c.name`,
            )
          ).rows.map((c) => ({
            id: c.id as string,
            name: c.name as string,
            type: c.type as string,
            enabled: c.enabled as boolean,
            lastStatus: (c.last_status as string | null) ?? null,
            lastRunAt: c.last_run_at ? new Date(c.last_run_at as Date).toISOString() : null,
            conflicts: c.conflicts as number,
          }))
        : [];

      const counts = db
        ? (
            await app.db.query<{ pending: number; error: number; suggestions: number }>(
              `select
                 (select count(*)::int from sources where sync_state='pending' and deleted_at is null) as pending,
                 (select count(*)::int from sources where sync_state='error' and deleted_at is null) as error,
                 (select count(*)::int from suggestions where status='pending') as suggestions`,
            )
          ).rows[0]
        : { pending: 0, error: 0, suggestions: 0 };

      // Prefer the `system.backup-check` worker's recorded result — it's what the
      // schedule actually verified — and fall back to a live filesystem check only
      // when the worker has never run yet (e.g. right after a fresh deploy).
      const recorded = db ? await getRecordedBackupCheck(app.db) : null;
      const backup = recorded ?? { ...(await checkBackupAge(app.config.BACKUP_DIR)), checkedAt: null };
      return {
        db,
        model,
        modelName: app.model?.name ?? 'unavailable',
        queue,
        queues,
        backup: {
          ok: backup.ok,
          latestFile: backup.latestFile,
          ageHours: backup.ageHours,
          checkedAt: backup.checkedAt,
          lastBackupAt: backup.latestAt,
          lastBackupOk: backup.ok,
        },
        connectors,
        sources: { pending: counts.pending, error: counts.error },
        suggestions: { pending: counts.suggestions },
        version: VERSION,
        uptimeSec: Math.round((Date.now() - started) / 1000),
      };
    },
  );
}
