import { describe, it, expect, vi } from 'vitest';
import { SyncService } from '../src/modules/connectors/sync.js';
import type { SyncLinkRow, ConnectorsRepo } from '../src/modules/connectors/repo.js';
import { ConnectorRegistry, type Connector } from '@wecom/connectors';

const C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const D = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const doc = (v: number) => ({
  id: D,
  title: 'מסמך',
  currentVersion: v,
  phases: [],
  related: [],
  slug: 'd',
  description: '',
  category: 'tech',
  wave: 1,
  priority: 'm',
  kind: 'steps',
  status: 'published',
  createdAt: '',
  updatedAt: '',
});
const remote = (hash: string) => ({
  externalId: 'posts:7',
  title: 'מסמך',
  hash,
  updatedAt: '2025-07-01T00:00:00Z',
  kind: 'posts',
  url: 'http://wp/7',
});

function setup(link: Partial<SyncLinkRow>, remoteHash: string, localVersion: number) {
  const linkRow: SyncLinkRow = {
    id: 'l1',
    document_id: D,
    connector_id: C,
    external_id: 'posts:7',
    source_id: S,
    base_remote_hash: 'h0',
    base_local_version: 1,
    remote_url: null,
    last_synced_at: null,
    state: 'synced',
    conflict: null,
    ...link,
  };
  const connector: Connector<unknown> = {
    describe: () => ({
      id: 'wordpress',
      name: 'WP',
      capabilities: { read: true, write: true, webhooks: true, identity: false },
    }),
    configSchema: {} as never,
    testConnection: vi.fn(),
    listRemote: vi.fn(async () => [remote(remoteHash)]),
    fetch: vi.fn(async () => ({
      title: 'מסמך',
      paragraphs: [{ ref: 'h2-1', runs: [{ t: 'x' }] }],
      hash: remoteHash,
    })),
    push: vi.fn(async () => ({
      externalId: 'posts:7',
      hash: 'pushed',
      updatedAt: '2025-07-02T00:00:00Z',
    })),
  };
  const registry = new ConnectorRegistry();
  registry.register(connector);
  const repo = {
    get: vi.fn(async () => ({
      id: C,
      type: 'wordpress',
      name: 'wp',
      enabled: true,
      schedule: '',
      last_run_at: null,
      last_status: null,
      health: {},
      config_encrypted: Buffer.alloc(0),
    })),
    config: vi.fn(() => ({})),
    links: vi.fn(async () => [linkRow]),
    linkByRemote: vi.fn(async () => linkRow),
    upsertLink: vi.fn(async (l) => ({ ...linkRow, ...l, state: l.state })),
    setLinkState: vi.fn(),
    setRun: vi.fn(),
  } as unknown as ConnectorsRepo;
  const revisions = { ingest: vi.fn(async () => ({ revisionId: 'r1', changed: true })) };
  const documents = {
    getById: vi.fn(async () => doc(localVersion)),
    getVersionSnapshot: vi.fn(async () => doc(1)),
    getBlocksFor: vi.fn(async () => []),
    ensureSourceForConnector: vi.fn(async () => ({ sourceId: S })),
    replaceStructure: vi.fn(async () => doc(localVersion + 1)),
  };
  const events = { publish: vi.fn() };
  const svc = new SyncService({
    repo,
    registry,
    db: {} as never,
    revisions: revisions as never,
    documents: documents as never,
    events,
  });
  return { svc, connector, repo, revisions, documents, events };
}

describe('SyncService.runConnector', () => {
  it('does nothing when neither side changed', async () => {
    const { svc, revisions, connector } = setup({}, 'h0', 1);
    const r = await svc.runConnector(C, null);
    expect(r).toEqual({ imported: 0, pushed: 0, conflicts: 0, linked: 0 });
    expect(revisions.ingest).not.toHaveBeenCalled();
    expect(connector.push).not.toHaveBeenCalled();
  });
  it('imports when only remote changed', async () => {
    const { svc, revisions, repo, events } = setup({}, 'h1', 1);
    const r = await svc.runConnector(C, 'u1');
    expect(r.imported).toBe(1);
    expect(revisions.ingest).toHaveBeenCalledWith(S, expect.objectContaining({ hash: 'h1' }), 'u1');
    expect(repo.setLinkState).toHaveBeenCalledWith('l1', 'pending_import');
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.completed',
        payload: expect.objectContaining({ imported: 1, conflicts: 0 }),
      }),
    );
  });
  it('pushes when only local changed and rebases', async () => {
    const { svc, connector, repo } = setup({}, 'h0', 3);
    const r = await svc.runConnector(C, null);
    expect(r.pushed).toBe(1);
    expect(connector.push).toHaveBeenCalledWith(
      {},
      'posts:7',
      expect.objectContaining({ document: expect.objectContaining({ id: D }) }),
    );
    expect(repo.upsertLink).toHaveBeenCalledWith(
      expect.objectContaining({ baseRemoteHash: 'pushed', baseLocalVersion: 3, state: 'synced' }),
    );
  });
  it('flags a conflict when both changed and never pushes', async () => {
    const { svc, connector, repo, events, revisions } = setup({}, 'h1', 3);
    const r = await svc.runConnector(C, null);
    expect(r.conflicts).toBe(1);
    expect(connector.push).not.toHaveBeenCalled();
    expect(revisions.ingest).not.toHaveBeenCalled();
    expect(repo.setLinkState).toHaveBeenCalledWith(
      'l1',
      'conflict',
      expect.objectContaining({
        remoteHash: 'h1',
        base: expect.objectContaining({ currentVersion: 1 }),
        local: expect.objectContaining({ currentVersion: 3 }),
      }),
    );
    expect(events.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'sync.conflict',
        payload: { connectorId: C, documentId: D, externalId: 'posts:7' },
      }),
    );
  });
  it('links and ingests unknown remote items', async () => {
    const { svc, repo, revisions, documents } = setup({}, 'h0', 1);
    (repo.links as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (repo.linkByRemote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await svc.runConnector(C, null);
    expect(r.linked).toBe(1);
    expect(documents.ensureSourceForConnector).toHaveBeenCalledWith(C, 'posts:7', 'מסמך');
    expect(revisions.ingest).toHaveBeenCalledWith(S, expect.anything(), null);
  });
});

describe('SyncService.resolveConflict', () => {
  it('ours → push and rebase', async () => {
    const { svc, connector, repo } = setup({ state: 'conflict' }, 'h1', 3);
    const link = (await repo.links(C))[0];
    const out = await svc.resolveConflict(link, { resolution: 'ours' }, 'u1');
    expect(connector.push).toHaveBeenCalled();
    expect(out.state).toBe('synced');
  });
  it('theirs → ingest remote, pending_import', async () => {
    const { svc, revisions, repo } = setup({ state: 'conflict' }, 'h1', 3);
    const link = (await repo.links(C))[0];
    await svc.resolveConflict(link, { resolution: 'theirs' }, 'u1');
    expect(revisions.ingest).toHaveBeenCalled();
    expect(repo.setLinkState).toHaveBeenCalledWith('l1', 'pending_import');
  });
  it('merged → replace structure then push', async () => {
    const { svc, documents, connector } = setup({ state: 'conflict' }, 'h1', 3);
    const link = {
      id: 'l1',
      document_id: D,
      connector_id: C,
      external_id: 'posts:7',
      source_id: S,
      base_remote_hash: 'h0',
      base_local_version: 1,
      remote_url: null,
      last_synced_at: null,
      state: 'conflict' as const,
      conflict: null,
    };
    await svc.resolveConflict(link, { resolution: 'merged', merged: doc(3) as never }, 'u1');
    expect(documents.replaceStructure).toHaveBeenCalledWith(
      D,
      expect.objectContaining({ id: D }),
      'u1',
      'מיזוג סנכרון WordPress',
    );
    expect(connector.push).toHaveBeenCalled();
  });
});
