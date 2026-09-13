import { EventEmitter } from 'node:events';
import pg from 'pg';
import { EventSchema, type Event } from '@wecom/shared';
import type { Tx } from './sql.js';

const CHANNEL = 'kb_events';

/**
 * Cross-instance event bus over Postgres LISTEN/NOTIFY. Publishing happens inside the caller's
 * transaction, so subscribers only see events whose transaction committed.
 */
export class EventBus {
  private emitter = new EventEmitter();
  private client: pg.Client | null = null;
  private starting: Promise<void> | null = null;
  onError: ((err: Error) => void) | null = null;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  get listening(): boolean {
    return this.client !== null;
  }

  /** Idempotent: a second call while/after the first one connected is a no-op. */
  async start(databaseUrl: string): Promise<void> {
    if (this.client) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const client = new pg.Client({ connectionString: databaseUrl });
      client.on('notification', (n) => {
        if (n.channel !== CHANNEL || !n.payload) return;
        let raw: unknown;
        try {
          raw = JSON.parse(n.payload);
        } catch {
          return;
        }
        const parsed = EventSchema.safeParse(raw);
        if (parsed.success) this.emitter.emit('event', parsed.data as Event);
      });
      client.on('error', (err: Error) => this.onError?.(err));
      await client.connect();
      await client.query(`listen ${CHANNEL}`);
      this.client = client;
    })();
    try {
      await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.emitter.removeAllListeners();
    if (client) {
      try {
        await client.end();
      } catch {
        /* already closed */
      }
    }
  }

  /** Publish inside a transaction: NOTIFY is only delivered when that transaction commits. */
  async publish(tx: Tx, event: Event): Promise<void> {
    await tx.query('select pg_notify($1, $2)', [CHANNEL, JSON.stringify(event)]);
  }

  subscribe(fn: (e: Event) => void): () => void {
    this.emitter.on('event', fn);
    return () => {
      this.emitter.off('event', fn);
    };
  }
}

declare module 'fastify' {
  interface FastifyInstance {
    events: EventBus;
  }
}
