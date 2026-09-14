import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WordPressConnector, WpConfigSchema, contentHash, htmlToParagraphs } from '../src/index.js';
import type { Document, Block } from '@wecom/shared';
import { startWpStub, type WpStub } from './helpers/wpStub.js';
import { docFixture } from './helpers/docFixture.js';

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

describe('fetch', () => {
  it('returns normalized paragraphs, raw html, hash and meta', async () => {
    const c = new WordPressConnector();
    const s = await c.fetch(cfg(), 'posts:7');
    expect(s.title).toBe('איטיות גלישה');
    expect(s.paragraphs.map((p) => p.ref)).toEqual(['h2-1', 'h2-1.p-1']);
    expect(s.raw).toContain('<h2>');
    expect(s.hash).toBe((await c.listRemote(cfg()))[0].hash);
    expect(s.meta).toMatchObject({ type: 'posts', id: 7, link: 'http://wp/7', status: 'publish' });
  });
  it('rejects malformed ids and missing posts', async () => {
    await expect(new WordPressConnector().fetch(cfg(), 'bad')).rejects.toThrow(/externalId/);
    await expect(new WordPressConnector().fetch(cfg(), 'posts:999')).rejects.toMatchObject({ status: 404 });
  });
});

describe('push', () => {
  const content = () => ({
    document: { ...(JSON.parse(JSON.stringify(docFixture)) as Document), title: 'מסמך חדש' },
    html: '',
    blocks: [] as Block[],
  });
  it('creates a new post when externalId is null', async () => {
    const ref = await new WordPressConnector().push(cfg(), null, content());
    expect(ref.externalId).toMatch(/^posts:\d+$/);
    const put = stub.puts[stub.puts.length - 1];
    expect(put).toMatchObject({ type: 'posts', id: null });
    expect((put.body as { title: string }).title).toBe('מסמך חדש');
    expect((put.body as { content: string }).content).toContain('<h3 data-kb-step=');
    expect(ref.hash).toBe(contentHash(htmlToParagraphs((put.body as { content: string }).content)));
  });
  it('updates an existing post', async () => {
    const ref = await new WordPressConnector().push(cfg(), 'posts:7', { ...content(), html: '<p>ידני</p>' });
    expect(ref.externalId).toBe('posts:7');
    expect(stub.posts.get('posts:7')?.content.rendered).toBe('<p>ידני</p>');
  });
  it('pushes source html, uploading asset images to wp/v2/media and rewriting src', async () => {
    const c = new WordPressConnector();
    const A = '11111111-1111-4111-8111-111111111111';
    const png = Uint8Array.from([137, 80, 78, 71]);
    const ref = await c.push(cfg(), 'posts:7', {
      ...content(),
      html: `<h2>מקור</h2><p><img src="/api/v1/assets/${A}" alt="x"></p>`,
      assets: async (id) => (id === A ? { bytes: png, mime: 'image/png' } : null),
    });
    const put = stub.puts.filter((p) => p.type === 'posts' && p.id === 7).pop()!;
    expect((put.body as { content: string }).content).toContain('<h2>מקור</h2>');
    expect((put.body as { content: string }).content).toContain('http://wp/media/');
    expect((put.body as { content: string }).content).not.toContain('/api/v1/assets/');
    expect(stub.media.length).toBe(1);
    expect(stub.media[0].mime).toBe('image/png');
    expect(ref.externalId).toBe('posts:7');
  });
});
