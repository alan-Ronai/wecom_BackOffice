import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Event } from '@wecom/shared';
import type { DocumentsService, EventBus, SourceRevisionService } from './sync.js';

/**
 * Cross-lane touchpoints, reached structurally rather than through module
 * augmentation: L2 (`app.events`, documents service), L3 (`req.user`,
 * `app.audit`) and L5 (`SourceRevisionService`) are written concurrently, so L6
 * must neither declare their types nor create their files.
 */

export interface L6User {
  id: string;
  permissions: ReadonlySet<string> | readonly string[];
}

export const userOf = (req: FastifyRequest): L6User | undefined =>
  (req as FastifyRequest & { user?: L6User }).user;

export const hasPermission = (user: L6User | undefined, permission: string): boolean => {
  if (!user) return false;
  const p = user.permissions;
  return p instanceof Set ? p.has(permission) : (p as readonly string[]).includes(permission);
};

export type AuditFn = (
  req: FastifyRequest,
  action: string,
  entityType: string,
  entityId: string,
  before: unknown,
  after: unknown,
) => Promise<unknown>;

/** L3's `app.audit(req, …)` wrapper when it has landed; a no-op until then. */
export const auditOf = (app: FastifyInstance): AuditFn => {
  const decorated = (app as FastifyInstance & { audit?: AuditFn }).audit;
  return decorated ? decorated.bind(app) : async () => undefined;
};

export type Enqueue = (name: string, data: unknown) => Promise<string>;

/**
 * L2's event bus publishes inside a transaction (`publish(tx, event)`); this
 * lane has no transaction of its own, so it adapts by arity and falls back to a
 * no-op while L2 is unlanded.
 */
export const eventsOf = (app: FastifyInstance): EventBus => {
  const bus = (app as FastifyInstance & { events?: { publish: (...a: unknown[]) => void } }).events;
  if (!bus) return { publish: () => undefined };
  return {
    publish: (e: Event) => {
      if (bus.publish.length >= 2) bus.publish(app.db, e);
      else bus.publish(e);
    },
  };
};

type Services = { revisions?: SourceRevisionService; documents?: DocumentsService };

/** L5's pipeline entry point; a no-op until `SourceRevisionService` lands. */
export const revisionsOf = (app: FastifyInstance): SourceRevisionService => {
  const s = (app as FastifyInstance & { services?: Services }).services?.revisions;
  return s ?? { ingest: async () => ({ revisionId: '', changed: false }) };
};

/** L2's documents service; unlinked documents make every reconciliation a no-op. */
export const documentsOf = (app: FastifyInstance): DocumentsService => {
  const s = (app as FastifyInstance & { services?: Services }).services?.documents;
  return (
    s ?? {
      getById: async () => null,
      getVersionSnapshot: async () => null,
      getBlocksFor: async () => [],
      ensureSourceForConnector: async () => {
        throw new Error('documents service is not available yet (L2)');
      },
      replaceStructure: async () => {
        throw new Error('documents service is not available yet (L2)');
      },
    }
  );
};
