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

  async listRemote(_cfg: WpConfig, _since?: string): Promise<RemoteItem[]> {
    throw new Error('not implemented');
  }

  async fetch(_cfg: WpConfig, _externalId: string): Promise<SourceContent> {
    throw new Error('not implemented');
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
