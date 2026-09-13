import type {
  Connector,
  ConnectorInfo,
  LibraryContent,
  RemoteChange,
  RemoteItem,
  RemoteRef,
  SourceContent,
} from '../contract.js';
import { WpConfigSchema, type WpConfig } from './config.js';
import { WpClient, type WpPost } from './client.js';
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
    const html = content.html && content.html.trim() ? content.html : renderWpHtml(content);
    const client = this.client(cfg);
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
