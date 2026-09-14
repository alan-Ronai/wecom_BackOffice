import type pg from 'pg';
import type { ParagraphDiff, SourceRevision } from '@wecom/shared';
import type { ProposalContext } from '@wecom/model';
import type { MappingService } from './mapping.js';
import type { ContentApi } from './content-api.js';

/** Assembles everything the model is allowed to see for one revision. */
export class ProposalService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly mapping: MappingService,
    private readonly content: ContentApi,
  ) {}

  async buildContext(revision: SourceRevision, diffs: ParagraphDiff[]): Promise<ProposalContext> {
    const src = await this.pool.query<{
      title: string;
      connector_id: string | null;
      external_id: string | null;
    }>(`select title, connector_id, external_id from sources where id=$1`, [revision.sourceId]);
    const client = await this.pool.connect();
    try {
      const [linkedSteps, blocks, fields] = await Promise.all([
        this.mapping.linkedSteps(revision.sourceId),
        this.content.listBlocks(client),
        this.content.listFields(client),
      ]);
      return {
        source: {
          id: revision.sourceId,
          title: src.rows[0]?.title ?? '',
          /**
           * A connector-backed source is exactly one remote item (one WordPress post, one
           * JSON/CSV row-group). Its sections belong to a single document, otherwise the
           * single `(connector, external_id)` sync link can only point at one of the cards
           * the item fanned out into and the rest are orphaned.
           */
          singleDocument: !!(src.rows[0]?.connector_id && src.rows[0]?.external_id),
        },
        diffs,
        paragraphs: revision.paragraphs,
        linkedSteps,
        fields: fields.map((f) => ({ name: f.name, status: f.status })),
        blocks: blocks.map((b) => ({ id: b.id, title: b.title, actions: b.actions.map((a) => a.text) })),
      };
    } finally {
      client.release();
    }
  }
}
