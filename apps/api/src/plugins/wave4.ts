import fp from 'fastify-plugin';
import type { FastifyBaseLogger } from 'fastify';
import type { Notifier, NotifyInput, SearchLogInput, TaxonomyResolver, UsageRecorder } from '@wecom/shared';

declare module 'fastify' {
  interface FastifyInstance {
    notifier: NotifierHolder;
    taxonomy: TaxonomyHolder;
    usage: UsageHolder;
  }
}

/** Default until W3 lands: alerts go to the log so nothing is silently dropped. */
export class LogNotifier implements Notifier {
  constructor(private log?: FastifyBaseLogger) {}
  async notify(input: NotifyInput): Promise<void> {
    this.log?.info({ notify: input }, 'notification (log sink)');
  }
}
/** Default until W1 lands: no worlds, no recipients. */
export class NullTaxonomy implements TaxonomyResolver {
  async worldsOf(): Promise<string[]> {
    return [];
  }
  async usersWithPermissionInWorld(): Promise<string[]> {
    return [];
  }
}
/** Default until W5 lands: usage is not recorded. */
export class NullUsage implements UsageRecorder {
  async recordTopicView(): Promise<void> {}
  async recordSearch(_e: SearchLogInput): Promise<void> {}
}

/**
 * Holders delegate to a swappable implementation. They are decorated ONCE on the root
 * instance, so `swap()` from any encapsulated child context (a lane's module) is seen by
 * every sibling module and by jobs — plain reassignment of `app.usage` inside a child
 * plugin would only shadow the property in that child.
 */
export class NotifierHolder implements Notifier {
  constructor(public impl: Notifier) {}
  swap(impl: Notifier) {
    this.impl = impl;
  }
  notify(input: NotifyInput) {
    return this.impl.notify(input);
  }
}
export class TaxonomyHolder implements TaxonomyResolver {
  constructor(public impl: TaxonomyResolver) {}
  swap(impl: TaxonomyResolver) {
    this.impl = impl;
  }
  worldsOf(documentId: string) {
    return this.impl.worldsOf(documentId);
  }
  usersWithPermissionInWorld(permission: string, world: string) {
    return this.impl.usersWithPermissionInWorld(permission, world);
  }
}
export class UsageHolder implements UsageRecorder {
  constructor(public impl: UsageRecorder) {}
  swap(impl: UsageRecorder) {
    this.impl = impl;
  }
  recordTopicView(userId: string, topicId: string) {
    return this.impl.recordTopicView(userId, topicId);
  }
  recordSearch(entry: SearchLogInput) {
    return this.impl.recordSearch(entry);
  }
}

export interface Wave4PluginOptions {
  notifier?: Notifier;
  taxonomy?: TaxonomyResolver;
  usage?: UsageRecorder;
}

/** Registered once in app.ts (root context) with no options; tests may pass overrides. */
export default fp(async (app, opts: Wave4PluginOptions) => {
  app.decorate('notifier', new NotifierHolder(opts.notifier ?? new LogNotifier(app.log)));
  app.decorate('taxonomy', new TaxonomyHolder(opts.taxonomy ?? new NullTaxonomy()));
  app.decorate('usage', new UsageHolder(opts.usage ?? new NullUsage()));
});

/** Lane hooks: W3 → setNotifier, W1 → setTaxonomy, W5 → setUsage, called from the lane's module index (any context). */
export const setNotifier = (app: { notifier: NotifierHolder }, n: Notifier) => app.notifier.swap(n);
export const setTaxonomy = (app: { taxonomy: TaxonomyHolder }, t: TaxonomyResolver) => app.taxonomy.swap(t);
export const setUsage = (app: { usage: UsageHolder }, u: UsageRecorder) => app.usage.swap(u);
