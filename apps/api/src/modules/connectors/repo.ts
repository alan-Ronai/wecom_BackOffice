import type pg from 'pg';
import { decryptConfig, encryptConfig } from './crypto.js';

export interface ConnectorRow {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
  schedule: string;
  last_run_at: Date | null;
  last_status: string | null;
  health: Record<string, unknown>;
  config_encrypted: Buffer;
}

export type SyncLinkState = 'synced' | 'pending_import' | 'pending_push' | 'conflict';

export interface SyncLinkRow {
  id: string;
  document_id: string;
  connector_id: string;
  external_id: string;
  source_id: string | null;
  base_remote_hash: string | null;
  base_local_version: number;
  remote_url: string | null;
  last_synced_at: Date | null;
  state: SyncLinkState;
  conflict: unknown | null;
}

const SECRET_KEYS = /password|secret|token|key/i;

/** Never return a decrypted secret to a client: mask by key name. */
export const maskConfig = (c: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(c).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '••••' : v]));

export class ConnectorsRepo {
  constructor(
    private db: pg.Pool,
    private keyHex: string,
  ) {}

  async list(): Promise<ConnectorRow[]> {
    return (await this.db.query<ConnectorRow>('select * from connectors order by created_at')).rows;
  }

  async get(id: string): Promise<ConnectorRow | null> {
    return (await this.db.query<ConnectorRow>('select * from connectors where id=$1', [id])).rows[0] ?? null;
  }

  async create(
    b: { type: string; name: string; config: Record<string, unknown>; schedule?: string; enabled?: boolean },
    actorId: string | null,
  ): Promise<ConnectorRow> {
    const r = await this.db.query<ConnectorRow>(
      "insert into connectors(type,name,config_encrypted,schedule,enabled,created_by) values ($1,$2,$3,coalesce($4,'*/15 * * * *'),coalesce($5,true),$6) returning *",
      [b.type, b.name, encryptConfig(this.keyHex, b.config), b.schedule ?? null, b.enabled ?? null, actorId],
    );
    return r.rows[0];
  }

  async update(
    id: string,
    p: { name?: string; config?: Record<string, unknown>; schedule?: string; enabled?: boolean },
  ): Promise<ConnectorRow | null> {
    const r = await this.db.query<ConnectorRow>(
      'update connectors set name=coalesce($2,name), config_encrypted=coalesce($3,config_encrypted), schedule=coalesce($4,schedule), enabled=coalesce($5,enabled), updated_at=now() where id=$1 returning *',
      [
        id,
        p.name ?? null,
        p.config ? encryptConfig(this.keyHex, p.config) : null,
        p.schedule ?? null,
        p.enabled ?? null,
      ],
    );
    return r.rows[0] ?? null;
  }

  async remove(id: string): Promise<boolean> {
    return ((await this.db.query('delete from connectors where id=$1', [id])).rowCount ?? 0) > 0;
  }

  config<T = Record<string, unknown>>(row: ConnectorRow): T {
    return decryptConfig<T>(this.keyHex, row.config_encrypted);
  }

  async setRun(id: string, status: string, health: Record<string, unknown>): Promise<void> {
    await this.db.query('update connectors set last_run_at=now(), last_status=$2, health=$3 where id=$1', [
      id,
      status,
      health,
    ]);
  }

  async links(connectorId: string): Promise<(SyncLinkRow & { document_title: string })[]> {
    return (
      await this.db.query<SyncLinkRow & { document_title: string }>(
        'select l.*, d.title as document_title from sync_links l join documents d on d.id=l.document_id where l.connector_id=$1 order by d.title',
        [connectorId],
      )
    ).rows;
  }

  async linksForDocument(documentId: string): Promise<SyncLinkRow[]> {
    return (await this.db.query<SyncLinkRow>('select * from sync_links where document_id=$1', [documentId]))
      .rows;
  }

  async linkById(id: string): Promise<SyncLinkRow | null> {
    return (await this.db.query<SyncLinkRow>('select * from sync_links where id=$1', [id])).rows[0] ?? null;
  }

  async linkByRemote(connectorId: string, externalId: string): Promise<SyncLinkRow | null> {
    return (
      (
        await this.db.query<SyncLinkRow>(
          'select * from sync_links where connector_id=$1 and external_id=$2',
          [connectorId, externalId],
        )
      ).rows[0] ?? null
    );
  }

  async linkByDocument(connectorId: string, documentId: string): Promise<SyncLinkRow | null> {
    return (
      (
        await this.db.query<SyncLinkRow>(
          'select * from sync_links where connector_id=$1 and document_id=$2',
          [connectorId, documentId],
        )
      ).rows[0] ?? null
    );
  }

  async upsertLink(l: {
    documentId: string;
    connectorId: string;
    externalId: string;
    sourceId?: string | null;
    baseRemoteHash: string | null;
    baseLocalVersion: number;
    remoteUrl?: string | null;
    state: SyncLinkState;
  }): Promise<SyncLinkRow> {
    const r = await this.db.query<SyncLinkRow>(
      `insert into sync_links(document_id,connector_id,external_id,source_id,base_remote_hash,base_local_version,remote_url,state,last_synced_at) values ($1,$2,$3,$4,$5,$6,$7,$8,now())
      on conflict (connector_id, external_id) do update set document_id=excluded.document_id, source_id=coalesce(excluded.source_id, sync_links.source_id), base_remote_hash=excluded.base_remote_hash, base_local_version=excluded.base_local_version, remote_url=coalesce(excluded.remote_url, sync_links.remote_url), state=excluded.state, conflict=null, last_synced_at=now(), updated_at=now() returning *`,
      [
        l.documentId,
        l.connectorId,
        l.externalId,
        l.sourceId ?? null,
        l.baseRemoteHash,
        l.baseLocalVersion,
        l.remoteUrl ?? null,
        l.state,
      ],
    );
    return r.rows[0];
  }

  async setLinkState(id: string, state: SyncLinkState, conflict: unknown | null = null): Promise<void> {
    await this.db.query('update sync_links set state=$2, conflict=$3, updated_at=now() where id=$1', [
      id,
      state,
      conflict,
    ]);
  }
}
