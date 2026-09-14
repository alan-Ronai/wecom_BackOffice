import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';
import type { SearchLogInput, UsageRecorder } from '@wecom/shared';

/**
 * Production `UsageRecorder` (W0 contract). Callers fire-and-forget; a usage write must never
 * surface as a failed search or topic page, so both methods swallow and log.
 */
export class PgUsage implements UsageRecorder {
  constructor(
    private db: pg.Pool,
    private log?: Pick<FastifyBaseLogger, 'warn'>,
  ) {}

  async recordTopicView(userId: string, topicId: string): Promise<void> {
    try {
      await this.db.query(
        `insert into topic_views(user_id, topic_id) values ($1,$2)
         on conflict (user_id, topic_id) do update set viewed_at=now(), count=topic_views.count+1`,
        [userId, topicId],
      );
    } catch (err) {
      this.log?.warn({ err, userId, topicId }, 'usage: topic view not recorded');
    }
  }

  async recordSearch(e: SearchLogInput): Promise<void> {
    try {
      await this.db.query(
        'insert into search_log(user_id, q, filters, results, took_ms) values ($1,$2,$3,$4,$5)',
        [e.userId, e.q, JSON.stringify(e.filters ?? {}), e.results, Math.max(0, Math.round(e.tookMs))],
      );
    } catch (err) {
      this.log?.warn({ err, q: e.q }, 'usage: search not logged');
    }
  }
}
