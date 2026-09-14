import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { PgNotifier } from '../../src/modules/feedback/notifier.js';

/**
 * A pool whose `connect` fails, standing in for "the write cannot happen". An alert is a
 * side effect of an action, never its point, so the notifier has to swallow that.
 */
const brokenPool = () =>
  ({
    connect: async () => {
      throw new Error('no database');
    },
  }) as unknown as pg.Pool;

/** Captures the rows `notifyMany` would insert, through a fake transaction. */
const capturingPool = (out: { kinds: string[]; users: string[] }) =>
  ({
    connect: async () => ({
      query: async (sql: string, params?: unknown[]) => {
        if (/insert into notifications/.test(sql)) {
          out.users = (params?.[0] as string[]) ?? [];
          out.kinds = (params?.[1] as string[]) ?? [];
          return { rows: out.users.map((_, i) => ({ id: `n${i}` })), rowCount: out.users.length };
        }
        return { rows: [], rowCount: 0 };
      },
      release: () => {},
    }),
  }) as unknown as pg.Pool;

describe('PgNotifier', () => {
  it('writes the wave 4 kind itself now that 0026 widened the check constraint', async () => {
    const out = { kinds: [] as string[], users: [] as string[] };
    const n = new PgNotifier(capturingPool(out), { publish: async () => {} } as never);
    await n.notify({ userIds: ['a', 'b', 'a'], kind: 'feedback', title: 'x' });
    // Deduplicated, and no longer mapped onto wave 3's `review`.
    expect(out.users).toEqual(['a', 'b']);
    expect(out.kinds).toEqual(['feedback', 'feedback']);
  });

  it('never fails the action that raised the alert', async () => {
    const warns: unknown[] = [];
    const log = { info: () => {}, warn: (o: unknown) => warns.push(o), error: () => {} } as never;
    const n = new PgNotifier(brokenPool(), { publish: async () => {} } as never, log);
    await expect(n.notify({ userIds: ['a'], kind: 'source', title: 'x' })).resolves.toBeUndefined();
    expect(warns).toHaveLength(1);
  });
});
