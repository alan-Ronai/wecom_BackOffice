import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { Notifier, NotifyInput as Wave4NotifyInput } from '@wecom/shared';
import type { EventBus } from '../../lib/events.js';
import { withTransaction } from '../../lib/sql.js';
import { notifyMany } from '../collab/repo.js';

/**
 * Production `Notifier` (W0 interface). One row per recipient in wave 3's `notifications`,
 * written through the collab helper so `notification.created` fires on the same transaction and
 * reaches only its own recipient.
 *
 * W3 shipped this behind a `to_regclass('notifications')` guard and mapped `feedback`/`source`
 * onto wave 3's six kinds, because the column's check constraint predated them. Both are gone:
 * `0026_notification_kinds` widens the constraint and `NotificationKindSchema` carries the two
 * new values, so the wave-4 kind is what lands in the row — which is what the bell filters on.
 *
 * The whole fan-out is one multi-row insert; the recipient list is bounded upstream
 * (`recipientsFor` is an item's owner/editor, `leadIds` everyone who may publish).
 */
export class PgNotifier implements Notifier {
  constructor(
    private db: pg.Pool,
    private events: EventBus,
    private log?: FastifyBaseLogger,
  ) {}

  async notify(input: Wave4NotifyInput): Promise<void> {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (!userIds.length) return;
    try {
      await withTransaction(this.db, (tx) =>
        notifyMany(
          tx,
          this.events,
          userIds.map((userId) => ({
            userId,
            kind: input.kind,
            title: input.title,
            body: input.body,
            href: input.href ?? null,
            entityType: input.entityType ?? input.kind,
            entityId: input.entityId ?? null,
          })),
          null,
        ),
      );
    } catch (e) {
      // An alert is never worth failing the action that raised it.
      this.log?.warn({ err: e, notify: { ...input, userIds } }, 'notification write failed');
    }
  }
}
