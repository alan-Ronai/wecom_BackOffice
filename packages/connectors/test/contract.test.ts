import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { ConnectorRegistry, type Connector } from '../src/index.js';

const fake: Connector<{ url: string }> = {
  describe: () => ({ id: 'fake', name: 'Fake', capabilities: { read: true, write: false, webhooks: false, identity: false } }),
  configSchema: z.object({ url: z.string().url() }),
  testConnection: async () => ({ ok: true, message: 'ok' }),
  listRemote: async () => [{ externalId: '1', title: 't', hash: 'h', updatedAt: '2025-01-01T00:00:00.000Z', kind: 'post' }],
  fetch: async () => ({ title: 't', paragraphs: [{ ref: '1', runs: [{ t: 'x' }] }], hash: 'h' }),
  push: async () => { throw new Error('read-only'); },
};

describe('ConnectorRegistry', () => {
  it('registers and lists connectors', () => {
    const r = new ConnectorRegistry(); r.register(fake);
    expect(r.list().map((c) => c.id)).toEqual(['fake']);
    expect(r.get('fake').describe().name).toBe('Fake');
    expect(() => r.get('nope')).toThrow(/unknown connector/);
    expect(() => r.register(fake)).toThrow(/already registered/);
  });
});
