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
  /**
   * W4/B-I6: what previous pushes already uploaded for this connector. `rewriteAssets` deduped
   * only within one push, so a document with ten images published fifty times left five
   * hundred copies of the same bytes in the customer's media library, with no cleanup path.
   */
  media?: MediaCache;
}

export interface MediaCache {
  get(assetId: string): Promise<{ remoteMediaId: string; remoteUrl: string } | null>;
  put(assetId: string, remoteMediaId: string, remoteUrl: string): Promise<void>;
  forget(assetId: string): Promise<void>;
}

/**
 * W4/B-C2: the pull-side counterpart of `push`'s asset rewrite. Stores one downloaded remote
 * image and answers the `/api/v1/assets/<id>` src it is now served under. Deduping is the
 * sink's job (sha256), which is what makes "downloaded once" true across syncs.
 */
export type MediaSink = (
  bytes: Uint8Array,
  mime: string,
  remoteUrl: string,
) => Promise<{ src: string }>;

/** What `absorbMedia` did: the rewritten HTML, and the remote images it could not keep. */
export interface AbsorbedMedia {
  html: string;
  dropped: { url: string; error: string }[];
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
  /**
   * W4/B-C2: rewrite remote media URLs in inbound HTML to local assets before it is stored.
   * Without it the sanitizer strips every `<img>` whose `src` is not `/api/v1/assets/<uuid>`,
   * and the next push writes that image-free HTML back to the remote — unrecoverable loss in
   * the customer's CMS, not just in our copy. A connector that serves no media may omit it.
   */
  absorbMedia?(config: C, html: string, sink: MediaSink): Promise<AbsorbedMedia>;
  parseWebhook?(config: C, headers: Record<string, string>, body: unknown): Promise<RemoteChange[]>;
  mapIdentity?(config: C, subject: string): Promise<{ email: string; groups: string[] } | null>;
}
