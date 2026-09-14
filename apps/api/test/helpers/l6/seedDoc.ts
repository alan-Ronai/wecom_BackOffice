import type pg from 'pg';
import type { Block, Document } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';
import type { DocumentsService, SourceRevisionService } from '../../../src/modules/connectors/sync.js';
import { getSourceDocument, saveSourceDocument } from '../../../src/modules/sourcedocs/repo.js';
import { withTransaction } from '../../../src/lib/sql.js';

let seq = 0;

/** Inserts a minimal source + document + version-1 snapshot with raw SQL (L2's services are not landed). */
export async function seedDocument(
  pool: pg.Pool,
  connectorId: string,
  externalId: string,
): Promise<{ docId: string; sourceId: string }> {
  const slug = 'browsing-' + ++seq;
  const src = await pool.query(
    "insert into sources(kind, connector_id, external_id, title) values ('wordpress', $1, $2, 'איטיות גלישה') returning id",
    [connectorId, externalId],
  );
  const doc = await pool.query(
    "insert into documents(slug, title, category, wave, priority, status, current_version, source_id) values ($2, 'איטיות גלישה', 'tech', 1, 'hh', 'published', 1, $1) returning id",
    [src.rows[0].id, slug],
  );
  const docId = doc.rows[0].id as string;
  const snapshot = {
    id: docId,
    slug,
    title: 'איטיות גלישה',
    description: '',
    category: 'tech',
    wave: 1,
    priority: 'hh',
    kind: 'steps',
    status: 'published',
    currentVersion: 1,
    related: [],
    phases: [
      {
        id: 'p1',
        label: 'שלב 1',
        steps: [
          {
            key: 's1',
            num: '1',
            title: 'פתח CRM',
            actions: [{ id: 'a1', text: 'פתח CRM' }],
            outcomes: [],
            blockRefs: [],
            deps: [],
          },
        ],
      },
    ],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await pool.query(
    'insert into document_versions(document_id, version, snapshot, label) values ($1, 1, $2, $3)',
    [docId, snapshot, 'seed'],
  );
  return { docId, sourceId: src.rows[0].id as string };
}

/** SQL-backed `DocumentsService` matching the interface L2 will own. */
export function sqlDocumentsService(pool: pg.Pool): DocumentsService {
  const load = async (id: string): Promise<Document | null> => {
    const d = (await pool.query('select * from documents where id=$1', [id])).rows[0];
    if (!d) return null;
    const v = (
      await pool.query(
        'select snapshot from document_versions where document_id=$1 order by version desc limit 1',
        [id],
      )
    ).rows[0];
    return {
      ...(v?.snapshot ?? {}),
      id,
      title: d.title,
      currentVersion: d.current_version,
      updatedAt: d.updated_at.toISOString(),
    } as Document;
  };
  return {
    getById: load,
    getVersionSnapshot: async (id, version) =>
      (
        await pool.query(
          'select snapshot from document_versions where document_id=$1 and version<=$2 order by version desc limit 1',
          [id, version],
        )
      ).rows[0]?.snapshot ?? null,
    getBlocksFor: async (): Promise<Block[]> => [],
    // W4: real source-document reads/writes so the sync path behaves as in production.
    getSourceHtml: async (id) => (await getSourceDocument(pool, id))?.html ?? null,
    putSourceFromRemote: (id, html, label) =>
      withTransaction(pool, async (tx) => {
        await saveSourceDocument(tx, id, { html, label, authorId: null });
      }),
    ensureSourceForConnector: async (connectorId, externalId, title) => {
      const existing = await pool.query('select id from sources where connector_id=$1 and external_id=$2', [
        connectorId,
        externalId,
      ]);
      if (existing.rows[0]) return { sourceId: existing.rows[0].id as string };
      const r = await pool.query(
        "insert into sources(kind, connector_id, external_id, title) values ('wordpress',$1,$2,$3) returning id",
        [connectorId, externalId, title],
      );
      return { sourceId: r.rows[0].id as string };
    },
    replaceStructure: async (id, doc, _actor, label) => {
      const v = (
        await pool.query(
          'update documents set current_version=current_version+1, updated_at=now() where id=$1 returning current_version',
          [id],
        )
      ).rows[0].current_version;
      await pool.query(
        'insert into document_versions(document_id, version, snapshot, label) values ($1,$2,$3,$4)',
        [id, v, { ...doc, currentVersion: v }, label],
      );
      return (await load(id)) as Document;
    },
  };
}

export function memoryRevisions(): SourceRevisionService & {
  calls: { sourceId: string; content: SourceContent }[];
} {
  const calls: { sourceId: string; content: SourceContent }[] = [];
  return {
    calls,
    ingest: async (sourceId, content) => {
      calls.push({ sourceId, content });
      return { revisionId: 'mem-' + calls.length };
    },
  };
}
