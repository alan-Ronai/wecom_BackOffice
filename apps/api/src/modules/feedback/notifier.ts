import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import { EVENTS, type Notifier, type NotifyInput as Wave4NotifyInput } from '@wecom/shared';
import type { EventBus } from '../../lib/events.js';
import { withTransaction } from '../../lib/sql.js';
import { notify as collabNotify } from '../collab/repo.js';

type DbKind = 'suggestion' | 'sync' | 'mention' | 'review' | 'publish' | 'system';

/**
 * Production `Notifier` (W0 interface). One row per recipient in wave 3's `notifications`,
 * written through the collab helper so `notification.created` fires on the same transaction.
 * The `kind` column is check-constrained to wave 3's six values and `stage45.ts` is frozen,
 * so wave 4 kinds are mapped and the precise kind travels in `entity_type`.
 */
export class PgNotifier implements Notifier {
  private tableChecked: boolean | null = null;
  constructor(
    private db: pg.Pool,
    private events: EventBus,
    private log?: FastifyBaseLogger,
  ) {}

  static mapKind(kind: Wave4NotifyInput['kind']): DbKind {
    return kind === 'feedback' ? 'review' : kind === 'source' ? 'sync' : 'system';
  }

  private async hasTable(): Promise<boolean> {
    if (this.tableChecked !== null) return this.tableChecked;
    const r = await this.db.query(`select to_regclass('notifications') t`);
    this.tableChecked = r.rows[0]?.t != null;
    return this.tableChecked;
  }

  async notify(input: Wave4NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (!userIds.length) return;
    if (!(await this.hasTable())) {
      this.log?.info({ notify: { ...input, userIds } }, 'notification (log sink: notifications table absent)');
      return;
    }
    // `notification.created` exists on main (wave 3 lane B); the guard keeps this file compiling
    // and behaving on a branch where events.ts predates it.
    const events = (EVENTS as readonly string[]).includes('notification.created')
      ? this.events
      : ({ publish: async () => {} } as unknown as EventBus);
    await withTransaction(this.db, async (tx) => {
      for (const userId of userIds)
        await collabNotify(
          tx,
          events,
          {
            userId,
            kind: PgNotifier.mapKind(input.kind),
            title: input.title,
            body: input.body,
            href: input.href ?? null,
            entityType: input.entityType ?? input.kind,
            entityId: input.entityId ?? null,
          },
          null,
        );
    });
  }
}
