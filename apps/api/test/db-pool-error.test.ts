import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import Fastify from 'fastify';
import dbPlugin from '../src/plugins/db.js';

/**
 * `pg` forwards an idle client's error to the pool; with no listener that is an uncaught
 * exception and the API process dies on a Postgres restart. The plugin must own that event.
 */
describe('db plugin', () => {
  it('handles an idle-client error on the pool instead of crashing', async () => {
    const pool = Object.assign(new EventEmitter(), { end: async () => undefined });
    const app = Fastify({ logger: false });
    const warned: unknown[] = [];
    app.log.warn = ((obj: unknown) => warned.push(obj)) as typeof app.log.warn;
    await app.register(dbPlugin, { pool: pool as unknown as import('pg').Pool });
    expect(pool.listenerCount('error')).toBe(1);
    expect(() =>
      pool.emit('error', new Error('terminating connection due to administrator command')),
    ).not.toThrow();
    expect(warned).toHaveLength(1);
    await app.close();
  });
});
