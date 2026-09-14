import type { FeedbackRow, Notifier, TaxonomyResolver } from '@wecom/shared';
import type pg from 'pg';
import type { FastifyBaseLogger } from 'fastify';

export interface AlertDeps {
  db: pg.Pool;
  notifier: Notifier;
  taxonomy: TaxonomyResolver;
  log: FastifyBaseLogger;
}
/** Filled in by Task 4. */
export async function notifyOnCreate(_deps: AlertDeps, _f: FeedbackRow, _title: string): Promise<void> {}
