import { describe, it, expect } from 'vitest';
import Fastify from 'fastify';
import wave4Plugin, { LogNotifier, NullTaxonomy, NullUsage, setUsage } from '../../src/plugins/wave4.js';
import { QUEUES } from '../../src/plugins/boss.js';

describe('wave4 plugin', () => {
  it('decorates boot-safe defaults', async () => {
    const app = Fastify({ logger: false });
    await app.register(wave4Plugin);
    await app.ready();
    expect(app.notifier.impl).toBeInstanceOf(LogNotifier);
    expect(app.taxonomy.impl).toBeInstanceOf(NullTaxonomy);
    expect(app.usage.impl).toBeInstanceOf(NullUsage);
    await expect(app.notifier.notify({ userIds: ['u1'], kind: 'system', title: 'x' })).resolves.toBeUndefined();
    await expect(app.taxonomy.worldsOf('d1')).resolves.toEqual([]);
    await expect(app.taxonomy.usersWithPermissionInWorld('docs.publish', 'sim')).resolves.toEqual([]);
    await expect(
      app.usage.recordSearch({ userId: null, q: 'a', filters: {}, results: 0, tookMs: 1 }),
    ).resolves.toBeUndefined();
    await app.close();
  });
  it('accepts overrides', async () => {
    const app = Fastify({ logger: false });
    const calls: string[] = [];
    await app.register(wave4Plugin, {
      notifier: {
        notify: async (n) => {
          calls.push(n.title);
        },
      },
    });
    await app.ready();
    await app.notifier.notify({ userIds: [], kind: 'feedback', title: 'hello' });
    expect(calls).toEqual(['hello']);
    await app.close();
  });
  it('swaps an implementation from an encapsulated child context', async () => {
    const app = Fastify({ logger: false });
    await app.register(wave4Plugin);
    const seen: string[] = [];
    // A lane's module is a plain (encapsulated) plugin, like every entry in registerModules().
    await app.register(async (child) => {
      setUsage(child, {
        recordTopicView: async () => {},
        recordSearch: async (e) => {
          seen.push(e.q);
        },
      });
    });
    await app.register(async (sibling) => {
      sibling.get('/probe', async () => {
        await sibling.usage.recordSearch({
          userId: null,
          q: 'from-sibling',
          filters: {},
          results: 1,
          tookMs: 1,
        });
        return {};
      });
    });
    await app.ready();
    await app.inject({ method: 'GET', url: '/probe' });
    expect(seen).toEqual(['from-sibling']);
    await app.close();
  });
  it('registers the wave 4 queues', () => {
    expect(QUEUES.feedbackDigest).toBe('feedback.digest');
    expect(QUEUES.feedbackAlerts).toBe('feedback.alerts');
    expect(QUEUES.assetsGc).toBe('assets.gc');
  });
});
