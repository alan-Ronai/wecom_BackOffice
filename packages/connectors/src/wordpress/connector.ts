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
import { WpClient } from './client.js';
import { contentHash, htmlToParagraphs, normalizeText } from './html.js';

export class WordPressConnector implements Connector<WpConfig> {
  configSchema = WpConfigSchema;
  constructor(private fetchImpl: typeof fetch = fetch) {}

  protected client(cfg: WpConfig): WpClient {
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

  async push(_cfg: WpConfig, _externalId: string | null, _content: LibraryContent): Promise<RemoteRef> {
    throw new Error('not implemented');
  }

  async parseWebhook(
    _cfg: WpConfig,
    _headers: Record<string, string>,
    _body: unknown,
  ): Promise<RemoteChange[]> {
    throw new Error('not implemented');
  }
}
