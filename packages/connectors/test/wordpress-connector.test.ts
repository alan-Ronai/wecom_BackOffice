import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
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
    expect((put.body as { content: string }).content).toContain('/wp-content/uploads/');
    expect((put.body as { content: string }).content).not.toContain('/api/v1/assets/');
    expect(stub.media.length).toBe(1);
    expect(stub.media[0].mime).toBe('image/png');
    expect(ref.externalId).toBe('posts:7');
  });
});

/**
 * B-C2 — the pull side of §5.1. Before this, `fetch` handed the remote body straight to
 * `saveSourceDocument`, whose sanitizer keeps a `src` only when it is `/api/v1/assets/<uuid>`,
 * so every WordPress image was stripped on the way in — and the *next* push then wrote that
 * image-free HTML back with `updatePost`, deleting the images from the customer's post too.
 */
describe('absorbMedia (pull-side rewrite)', () => {
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489', 'hex');
  const A = '22222222-2222-4222-8222-222222222222';
  const doc = () => ({
    document: { ...(JSON.parse(JSON.stringify(docFixture)) as Document), title: 'עם תמונה' },
    blocks: [] as Block[],
  });

  it('survives a push → pull → push round trip with exactly one asset image', async () => {
    const c = new WordPressConnector();
    const stored = new Map<string, { bytes: Uint8Array; mime: string }>([
      [A, { bytes: new Uint8Array(png), mime: 'image/png' }],
    ]);

    // 1. push: the asset becomes a WordPress media item and the src is rewritten to it.
    await c.push(cfg(), 'posts:7', {
      ...doc(),
      html: `<p><img src="/api/v1/assets/${A}" alt="x"></p>`,
      assets: async (id) => stored.get(id) ?? null,
    });
    const pushed = stub.posts.get('posts:7')!.content.rendered;
    expect(pushed).toMatch(/\/wp-content\/uploads\/\d+\.png/);

    // 2. pull: the remote body's media URL comes back as a local asset.
    const content = await c.fetch(cfg(), 'posts:7');
    const seen: { mime: string; bytes: Uint8Array }[] = [];
    const absorbed = await c.absorbMedia(cfg(), content.raw!, async (bytes, mime) => {
      const id = `3333333${seen.length}-3333-4333-8333-333333333333`;
      seen.push({ mime, bytes });
      stored.set(id, { bytes, mime });
      return { src: '/api/v1/assets/' + id };
    });
    expect(absorbed.dropped).toEqual([]);
    expect(seen).toHaveLength(1);
    expect(seen[0].mime).toBe('image/png');
    expect(Buffer.from(seen[0].bytes).equals(png)).toBe(true);
    expect(absorbed.html.match(/\/api\/v1\/assets\//g)).toHaveLength(1);
    expect(absorbed.html).not.toContain('/wp-content/uploads/');

    // 3. push again: the image is still there, so the remote keeps it.
    await c.push(cfg(), 'posts:7', {
      ...doc(),
      html: absorbed.html,
      assets: async (id) => stored.get(id) ?? null,
    });
    expect(stub.posts.get('posts:7')!.content.rendered).toMatch(/\/wp-content\/uploads\/\d+\.png/);
  });

  it('drops an image it cannot fetch and reports it rather than failing silently', async () => {
    const c = new WordPressConnector();
    const html = `<p><img src="${stub.url}/wp-content/uploads/9999.png" alt="gone"></p>`;
    const absorbed = await c.absorbMedia(cfg(), html, async () => ({ src: '/api/v1/assets/x' }));
    expect(absorbed.dropped).toHaveLength(1);
    expect(absorbed.dropped[0].url).toContain('9999.png');
    expect(absorbed.html).toBe(html); // left as-is; the sanitizer drops it, the report does not
  });

  it('refuses a remote image outside the host allowlist', async () => {
    const c = new WordPressConnector(fetch, { hostAllowlist: ['127.0.0.1'] });
    const absorbed = await c.absorbMedia(cfg(), '<p><img src="http://evil.example/x.png"></p>', async () => ({
      src: '/api/v1/assets/x',
    }));
    expect(absorbed.dropped).toHaveLength(1);
    expect(absorbed.dropped[0].error).toMatch(/host not allowed/);
  });

  /**
   * H2. `mediaHeaders()` carries the site's application password — full REST access to the whole
   * library. The HTML it is applied to is written by WordPress authors, so a single
   * `<img src="https://evil/x.png">` in any post used to hand that credential to whoever hosts
   * `evil`, on the next sync, silently. It is only ever needed for a private upload on the site's
   * own origin.
   */
  it('sends the application password to the site itself and to nobody else', async () => {
    const seen: (string | undefined)[] = [];
    const third = http.createServer((req, res) => {
      seen.push(req.headers.authorization);
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(png);
    });
    await new Promise<void>((r) => third.listen(0, '127.0.0.1', r));
    const thirdUrl = `http://127.0.0.1:${(third.address() as AddressInfo).port}/x.png`;
    const sent: Record<string, string | null> = {};
    const spy: typeof fetch = (input, init) => {
      sent[String(input)] = new Headers(init?.headers as HeadersInit | undefined).get('authorization');
      return fetch(input as string, init);
    };
    try {
      // 127.0.0.1 is allowlisted, so the guard is not what is being tested here.
      const c = new WordPressConnector(spy, { hostAllowlist: ['127.0.0.1'] });
      // Give the site an upload of its own, so one call of `absorbMedia` covers both origins.
      await c.push(cfg(), 'posts:7', {
        ...doc(),
        html: `<p><img src="/api/v1/assets/${A}" alt="x"></p>`,
        assets: async () => ({ bytes: new Uint8Array(png), mime: 'image/png' }),
      });
      const ownUrl = /src="([^"]+\/wp-content\/uploads\/[^"]+)"/.exec(
        stub.posts.get('posts:7')!.content.rendered,
      )![1];

      let n = 0;
      const absorbed = await c.absorbMedia(
        cfg(),
        `<p><img src="${ownUrl}"></p><p><img src="${thirdUrl}"></p>`,
        async () => ({ src: `/api/v1/assets/4444444${n++}-4444-4444-8444-444444444444` }),
      );
      // Both images are still taken — this is about the credential, not about refusing the fetch.
      expect(absorbed.dropped).toEqual([]);
      expect(absorbed.html.match(/\/api\/v1\/assets\//g)).toHaveLength(2);

      const basic = 'Basic ' + Buffer.from('kb:xxxx yyyy').toString('base64');
      // The site's own upload gets the credential — the reason `mediaHeaders()` exists…
      expect(sent[ownUrl]).toBe(basic);
      // …and the third-party host gets nothing, neither from us nor in what it observed.
      expect(sent[thirdUrl]).toBeNull();
      expect(seen).toEqual([undefined]);
    } finally {
      await new Promise<void>((r) => third.close(() => r()));
    }
  });

  it('reuses a recorded media item instead of re-uploading it (B-I6)', async () => {
    const c = new WordPressConnector();
    const png2 = new Uint8Array(png);
    const cache = new Map<string, { remoteMediaId: string; remoteUrl: string }>();
    const media = {
      get: async (id: string) => cache.get(id) ?? null,
      put: async (id: string, remoteMediaId: string, remoteUrl: string) => {
        cache.set(id, { remoteMediaId, remoteUrl });
      },
      forget: async (id: string) => {
        cache.delete(id);
      },
    };
    const body = {
      ...doc(),
      html: `<p><img src="/api/v1/assets/${A}" alt="x"></p>`,
      assets: async () => ({ bytes: png2, mime: 'image/png' }),
      media,
    };
    const before = stub.media.length;
    await c.push(cfg(), 'posts:7', body);
    expect(stub.media.length).toBe(before + 1);
    await c.push(cfg(), 'posts:7', body);
    await c.push(cfg(), 'posts:7', body);
    expect(stub.media.length).toBe(before + 1); // no second or third copy of the same bytes

    // A media item deleted on the remote is detected by the HEAD and re-uploaded.
    stub.deleteMedia(Number(cache.get(A)!.remoteMediaId));
    await c.push(cfg(), 'posts:7', body);
    expect(stub.media.length).toBe(before + 2);
  });
});
