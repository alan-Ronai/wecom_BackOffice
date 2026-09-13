import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WordPressConnector, WpConfigSchema } from '../src/index.js';
import { startWpStub, type WpStub } from './helpers/wpStub.js';

let stub: WpStub;
beforeAll(async () => {
  stub = await startWpStub([
    {
      id: 7,
      title: { rendered: 'איטיות גלישה' },
      content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' },
      modified_gmt: '2025-06-12T10:00:00',
      link: 'http://wp/7',
      status: 'publish',
    },
  ]);
});
afterAll(async () => {
  await stub.close();
});

const cfg = () =>
  WpConfigSchema.parse({
    baseUrl: stub.url,
    username: 'kb',
    applicationPassword: 'xxxx yyyy',
    postTypes: ['posts'],
    categoryMap: {},
    webhookSecret: 's3cret12',
  });

describe('WordPressConnector basics', () => {
  it('describes capabilities', () => {
    expect(new WordPressConnector().describe()).toEqual({
      id: 'wordpress',
      name: 'WordPress',
      capabilities: { read: true, write: true, webhooks: true, identity: false },
    });
  });
  it('validates config', () => {
    expect(WpConfigSchema.safeParse({ baseUrl: 'not-a-url' }).success).toBe(false);
    expect(cfg().postTypes).toEqual(['posts']);
  });
  it('tests the connection with basic auth', async () => {
    const r = await new WordPressConnector().testConnection(cfg());
    expect(r.ok).toBe(true);
    expect(stub.lastAuth).toBe('Basic ' + Buffer.from('kb:xxxx yyyy').toString('base64'));
  });
  it('reports a failed connection', async () => {
    const r = await new WordPressConnector().testConnection({ ...cfg(), baseUrl: 'http://127.0.0.1:1' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/חיבור/);
  });
});

describe('listRemote', () => {
  it('walks all pages of every post type and filters by since', async () => {
    for (let i = 1; i <= 150; i++)
      stub.posts.set('pages:' + i, {
        id: i,
        title: { rendered: 'עמוד ' + i },
        content: { rendered: '<p>תוכן ' + i + '</p>' },
        modified_gmt: i > 120 ? '2025-07-01T00:00:00' : '2025-05-01T00:00:00',
        link: 'http://wp/p' + i,
        status: 'publish',
      });
    const c = new WordPressConnector();
    const all = await c.listRemote({ ...cfg(), postTypes: ['posts', 'pages'] });
    expect(all.length).toBe(151);
    expect(all[0]).toMatchObject({
      externalId: 'posts:7',
      kind: 'posts',
      updatedAt: '2025-06-12T10:00:00Z',
      url: 'http://wp/7',
    });
    expect(all[0].hash).toMatch(/^[a-f0-9]{64}$/);
    const recent = await c.listRemote({ ...cfg(), postTypes: ['pages'] }, '2025-06-01T00:00:00Z');
    expect(recent.length).toBe(30);
  });
});
