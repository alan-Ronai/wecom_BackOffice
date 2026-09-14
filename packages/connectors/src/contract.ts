import type { ZodTypeAny } from 'zod';
import type { AssetBytesResolver, Block, Document, Paragraph } from '@wecom/shared';

export interface ConnectorInfo {
  id: string;
  name: string;
  capabilities: { read: boolean; write: boolean; webhooks: boolean; identity: boolean };
}
export interface RemoteItem {
  externalId: string;
  title: string;
  hash: string;
  updatedAt: string;
  kind: string;
  url?: string;
}
export interface SourceContent {
  title: string;
  paragraphs: Paragraph[];
  raw?: string;
  hash: string;
  meta?: Record<string, unknown>;
}
export interface LibraryContent {
  document: Document;
  html: string;
  blocks: Block[];
  /** W4: resolves `/api/v1/assets/<id>` images so a push can re-host them on the remote. */
  assets?: AssetBytesResolver;
}
export interface RemoteRef {
  externalId: string;
  url?: string;
  hash: string;
  updatedAt: string;
}
export interface RemoteChange {
  externalId: string;
  kind: 'created' | 'updated' | 'deleted';
  at: string;
}

export interface Connector<C = unknown> {
  describe(): ConnectorInfo;
  configSchema: ZodTypeAny;
  testConnection(config: C): Promise<{ ok: boolean; message: string }>;
  listRemote(config: C, since?: string): Promise<RemoteItem[]>;
  fetch(config: C, externalId: string): Promise<SourceContent>;
  push(config: C, externalId: string | null, content: LibraryContent): Promise<RemoteRef>;
  parseWebhook?(config: C, headers: Record<string, string>, body: unknown): Promise<RemoteChange[]>;
  mapIdentity?(config: C, subject: string): Promise<{ email: string; groups: string[] } | null>;
}
