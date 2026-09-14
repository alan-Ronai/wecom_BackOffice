import { describe, it, expect } from 'vitest';
import type pg from 'pg';
import { PgNotifier } from '../../src/modules/feedback/notifier.js';

const fakePool = (regclass: string | null) =>
  ({
    query: async (sql: string) => {
      if (/to_regclass/.test(sql)) return { rows: [{ t: regclass }], rowCount: 1 };
      throw new Error('unexpected query: ' + sql);
    },
    connect: async () => {
      throw new Error('connect must not be called without the table');
    },
  }) as unknown as pg.Pool;

describe('PgNotifier', () => {
  it('logs instead of writing when the notifications table is absent', async () => {
    const lines: unknown[] = [];
    const log = { info: (o: unknown) => lines.push(o), warn: () => {}, error: () => {} } as never;
    const n = new PgNotifier(fakePool(null), { publish: async () => {} } as never, log);
    await n.notify({ userIds: ['a', 'b'], kind: 'feedback', title: 'x' });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ notify: { userIds: ['a', 'b'] } });
  });
  it('maps wave 4 kinds onto the constrained notifications.kind', () => {
    expect(PgNotifier.mapKind('feedback')).toBe('review');
    expect(PgNotifier.mapKind('source')).toBe('sync');
    expect(PgNotifier.mapKind('system')).toBe('system');
  });
});
