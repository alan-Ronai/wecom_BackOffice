import type {
  AbsorbedMedia,
  Connector,
  ConnectorInfo,
  LibraryContent,
  MediaSink,
  RemoteChange,
  RemoteItem,
  RemoteRef,
  SourceContent,
} from '../contract.js';
import { WpConfigSchema, type WpConfig } from './config.js';
import { WpClient, WpError, type WpPost } from './client.js';
import { contentHash, htmlToParagraphs, normalizeText } from './html.js';
import { renderWpHtml } from '../render/wpHtml.js';
import { assertFresh, verifySignature, WebhookBodySchema } from './webhook.js';
import { assertAllowedHost, type ConnectorGuards } from '../guards.js';

export class WordPressConnector implements Connector<WpConfig> {
  configSchema = WpConfigSchema;
  /**
   * `guards.hostAllowlist` limits where `cfg.baseUrl` may point. Without it every
   * authenticated call is an SSRF primitive against anything the API container
   * can reach; link-local metadata is refused either way.
   */
  constructor(
    private fetchImpl: typeof fetch = fetch,
    private guards: ConnectorGuards = {},
  ) {}

  protected client(cfg: WpConfig): WpClient {
    assertAllowedHost(cfg.baseUrl, this.guards.hostAllowlist);
    return new WpClient(cfg, this.fetchImpl);
  }

  describe(): ConnectorInfo {
    return {
      id: 'wordpress',
      name: 'WordPress',
      capabilities: { read: true, write: true, webhooks: true, identity: false },
    };
  }

  async testConnection(cfg: WpConfig): Promise<{ ok: boolean; message: string }> {
    try {
      await this.client(cfg).ping();
      return { ok: true, message: 'החיבור ל-WordPress תקין' };
    } catch (e) {
      return { ok: false, message: 'החיבור נכשל: ' + (e instanceof Error ? e.message : String(e)) };
    }
  }

  async listRemote(cfg: WpConfig, since?: string): Promise<RemoteItem[]> {
    const client = this.client(cfg);
    const out: RemoteItem[] = [];
    for (const type of cfg.postTypes) {
      for (let page = 1; ; page++) {
        const { items, totalPages } = await client.listPosts(type, {
          modifiedAfter: since?.replace(/Z$/, ''),
          page,
          perPage: 100,
        });
        for (const p of items)
          out.push({
            externalId: `${type}:${p.id}`,
            title: normalizeText(p.title.rendered),
            hash: contentHash(htmlToParagraphs(p.content.rendered)),
            updatedAt: p.modified_gmt + 'Z',
            kind: type,
            url: p.link,
          });
        if (page >= totalPages) break;
      }
    }
    return out;
  }

  static parseExternalId(externalId: string): { type: string; id: number } {
    const m = /^(\w+):(\d+)$/.exec(externalId);
    if (!m) throw new Error('invalid externalId: ' + externalId);
    return { type: m[1], id: Number(m[2]) };
  }

  async fetch(cfg: WpConfig, externalId: string): Promise<SourceContent> {
    const { type, id } = WordPressConnector.parseExternalId(externalId);
    const p = await this.client(cfg).getPost(type, id);
    const paragraphs = htmlToParagraphs(p.content.rendered);
    return {
      title: normalizeText(p.title.rendered),
      paragraphs,
      raw: p.content.rendered,
      hash: contentHash(paragraphs),
      meta: {
        type,
        id,
        link: p.link,
        status: p.status,
        modifiedAt: p.modified_gmt + 'Z',
        categories: p.categories ?? [],
      },
    };
  }

  async push(cfg: WpConfig, externalId: string | null, content: LibraryContent): Promise<RemoteRef> {
    const client = this.client(cfg);
    let html = content.html && content.html.trim() ? content.html : renderWpHtml(content);
    if (content.assets) html = await this.rewriteAssets(client, html, content.assets, content.media);
    let type: string;
    let post: WpPost;
    if (externalId) {
      const parsed = WordPressConnector.parseExternalId(externalId);
      type = parsed.type;
      post = await client.updatePost(type, parsed.id, { title: content.document.title, content: html });
    } else {
      type = cfg.postTypes[0];
      post = await client.createPost(type, {
        title: content.document.title,
        content: html,
        status: 'publish',
      });
    }
    return {
      externalId: `${type}:${post.id}`,
      url: post.link,
      hash: contentHash(htmlToParagraphs(html)),
      updatedAt: post.modified_gmt + 'Z',
    };
  }

  /**
   * Matches the `src` `sanitizeHtml` emits. A strict UUID rather than 36 characters of hex and
   * hyphens, so a malformed src cannot round-trip into a media upload (C-M1).
   */
  private static ASSET_IMG =
    /<img([^>]*?)\ssrc="\/api\/v1\/assets\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"([^>]*)>/g;
  /** Remote `<img>` in inbound HTML: absolute http(s) only, single- or double-quoted. */
  private static REMOTE_IMG = /<img([^>]*?)\ssrc=(["'])(https?:\/\/[^"']+)\2([^>]*)>/g;

  private static EXT: Record<string, string> = {
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/jpeg': 'jpg',
  };

  /** `"` inside an attribute value would break out of it; the remote controls this string. */
  private static attr = (v: string) => v.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

  /** Every KB asset image becomes a WordPress media item; unknown assets are dropped rather than left broken. */
  private async rewriteAssets(
    client: WpClient,
    html: string,
    resolve: NonNullable<LibraryContent['assets']>,
    media?: LibraryContent['media'],
  ): Promise<string> {
    const uploaded = new Map<string, string>();
    const ids = [...html.matchAll(WordPressConnector.ASSET_IMG)].map((m) => m[2]!);
    for (const id of new Set(ids)) {
      /**
       * B-I6: reuse what an earlier push uploaded. Without this a document with ten images
       * published fifty times left five hundred copies of the same bytes in the customer's
       * media library. A HEAD detects a media item deleted on the remote; anything other than
       * a clean 404/410 counts as "still there", so a transient network failure does not
       * re-upload the whole library.
       */
      const known = await media?.get(id);
      if (known) {
        if (!(await this.mediaMissing(known.remoteUrl))) {
          uploaded.set(id, known.remoteUrl);
          continue;
        }
        await media?.forget(id);
      }
      const a = await resolve(id);
      if (!a) continue;
      const m = await client.uploadMedia(
        a.bytes,
        a.mime,
        `${id}.${WordPressConnector.EXT[a.mime] ?? 'jpg'}`,
      );
      uploaded.set(id, m.source_url);
      await media?.put(id, String(m.id), m.source_url);
    }
    return html.replace(WordPressConnector.ASSET_IMG, (_all, pre: string, id: string, post: string) =>
      uploaded.has(id) ? `<img${pre} src="${WordPressConnector.attr(uploaded.get(id)!)}"${post}>` : '',
    );
  }

  private async mediaMissing(url: string): Promise<boolean> {
    try {
      assertAllowedHost(url, this.guards.hostAllowlist);
      const res = await this.fetchImpl(url, { method: 'HEAD' });
      return res.status === 404 || res.status === 410;
    } catch {
      return false;
    }
  }

  /**
   * B-C2 — the missing half of §5.1: "pull rewrites WordPress media URLs back to assets
   * (downloaded once, deduped by sha256)".
   *
   * Inbound bodies point at `https://<site>/wp-content/uploads/…`, and `sanitizeHtml` keeps a
   * `src` only when it is `/api/v1/assets/<uuid>`, so every image was stripped on the way in —
   * and the next push then wrote that image-free HTML back with `updatePost`, removing the
   * images from the WordPress post as well. Each remote image is fetched through the same
   * allowlisted `fetch` the connector uses everywhere else, handed to the sink (which dedupes
   * on sha256, so "downloaded once" holds across syncs) and its `src` rewritten. A failure
   * drops that one image and is reported, never swallowed.
   */
  async absorbMedia(cfg: WpConfig, html: string, sink: MediaSink): Promise<AbsorbedMedia> {
    assertAllowedHost(cfg.baseUrl, this.guards.hostAllowlist);
    const rewritten = new Map<string, string>();
    const dropped: AbsorbedMedia['dropped'] = [];
    const urls = [...html.matchAll(WordPressConnector.REMOTE_IMG)].map((m) => m[3]!);
    if (!urls.length) return { html, dropped };
    const headers = this.client(cfg).mediaHeaders();
    for (const url of new Set(urls)) {
      try {
        assertAllowedHost(url, this.guards.hostAllowlist);
        const res = await this.fetchImpl(url, { headers });
        if (!res.ok) throw new WpError(res.status, `WordPress GET media → ${res.status}`);
        const mime = (res.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
        if (!WordPressConnector.EXT[mime])
          throw new Error(`unsupported media type: ${mime || 'unknown'}`);
        const bytes = new Uint8Array(await res.arrayBuffer());
        rewritten.set(url, (await sink(bytes, mime, url)).src);
      } catch (e) {
        dropped.push({ url, error: e instanceof Error ? e.message : String(e) });
      }
    }
    return {
      html: html.replace(
        WordPressConnector.REMOTE_IMG,
        (all, pre: string, _q: string, url: string, post: string) => {
          const src = rewritten.get(url);
          // An image we could not take stays as it is: the sanitizer drops it, and the drop is
          // already on the record in `dropped` rather than being invisible.
          return src ? `<img${pre} src="${WordPressConnector.attr(src)}"${post}>` : all;
        },
      ),
      dropped,
    };
  }

  /** `body` carries the raw request text so the HMAC can be checked byte for byte. */
  async parseWebhook(cfg: WpConfig, headers: Record<string, string>, body: unknown): Promise<RemoteChange[]> {
    const raw = (body as { raw?: string })?.raw ?? '';
    const sig = headers['x-kb-signature'] ?? headers['X-KB-Signature'];
    if (!verifySignature(cfg.webhookSecret, raw, sig)) throw new Error('invalid signature');
    const b = WebhookBodySchema.parse(JSON.parse(raw));
    assertFresh(b.sent_at);
    return [
      {
        externalId: `${b.post_type}:${b.post_id}`,
        kind: b.event === 'delete_post' ? 'deleted' : 'updated',
        at: b.modified_gmt.endsWith('Z') ? b.modified_gmt : b.modified_gmt + 'Z',
      },
    ];
  }
}
