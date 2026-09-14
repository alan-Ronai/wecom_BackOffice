import type { FastifyInstance } from 'fastify';
import type { WorkflowSettings } from '@wecom/shared';
import { QUEUES } from '../../../plugins/boss.js';
import { getWorkflowSettings } from '../../../lib/workflowSettings.js';
import { resolveAllAudiences, type TrackingDeps } from './audiences.js';
import { markOverdue } from './repo.js';

/**
 * Overdue marking is idempotent. A reminder goes out once per assignment (`reminded_at`) when
 * it is due within `reminderDaysBefore` days or already overdue.
 */
export async function runReminders(
  deps: TrackingDeps,
  settings: WorkflowSettings,
): Promise<{ overdue: number; reminded: number }> {
  const overdue = await markOverdue(deps.db);
  const due = await deps.db.query(
    `select a.id, a.user_id, a.due_at, a.status, i.title, i.kind
       from learning_assignments a join learning_items i on i.id=a.item_id
      where a.status in ('open','overdue') and a.reminded_at is null
        and a.due_at <= now() + ($1::int || ' days')::interval`,
    [settings.learning.reminderDaysBefore],
  );
  let reminded = 0;
  for (const r of due.rows) {
    const upd = await deps.db.query(
      `update learning_assignments set reminded_at=now() where id=$1 and reminded_at is null`,
      [r.id],
    );
    if (!upd.rowCount) continue;
    await deps.notifier.notify({
      userIds: [r.user_id as string],
      kind: 'learning',
      title:
        (r.status === 'overdue' ? 'משימת למידה באיחור: ' : 'תזכורת: משימת למידה מתקרבת: ') +
        (r.title as string),
      body: `מועד היעד: ${new Date(r.due_at as Date).toLocaleDateString('he-IL')}`,
      href: `/learning/${r.id as string}`,
      entityType: 'learning_assignment',
      entityId: r.id as string,
    });
    reminded++;
  }
  return { overdue, reminded };
}

/** Same shape as the feedback jobs: no-op without pg-boss or under NODE_ENV=test. */
export async function startTrackingJobs(
  app: FastifyInstance,
  deps: () => TrackingDeps,
): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.learningResolveAudiences, async () => {
    const r = await resolveAllAudiences(deps());
    app.log.info(r, 'learning audiences re-resolved');
  });
  await boss.work(QUEUES.learningReminders, async () => {
    const r = await runReminders(deps(), await getWorkflowSettings(deps().db));
    app.log.info(r, 'learning reminders sent');
  });
  for (const [q, cron] of [
    [QUEUES.learningResolveAudiences, '30 3 * * *'],
    [QUEUES.learningReminders, '30 8 * * *'],
  ] as const) {
    try {
      await boss.schedule(q, cron, {}, { tz: 'Asia/Jerusalem' });
    } catch (err) {
      app.log.warn({ err, q }, 'could not schedule learning job');
    }
  }
}
