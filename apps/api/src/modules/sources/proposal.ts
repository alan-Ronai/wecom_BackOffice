import type pg from 'pg';
import type { AiSettings, ParagraphDiff, SourceRevision } from '@wecom/shared';
import type { ProposalContext } from '@wecom/model';
import type { MappingService } from './mapping.js';
import type { ContentApi } from './content-api.js';
import { ImpactService } from './impact.js';
import { fewShotExamples } from './fewshot.js';
import { getAiSettings } from '../../lib/aiSettings.js';

/** The suggestion type a diff of this shape is most likely to produce — the few-shot filter. */
const likelyType = (d: ParagraphDiff, mapped: Set<string>): string =>
  d.kind === 'removed' ? 'deprecate-step' : mapped.has(d.ref.replace(/^§/, '')) ? 'update-step' : 'new-card';

/** Assembles everything the model is allowed to see for one revision. */
export class ProposalService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly mapping: MappingService,
    private readonly content: ContentApi,
    /**
     * Wave 6 (X1): the blast radius, also exposed to X2's `read_impact` tool. Defaulted so a
     * caller that only wants a context (the explorer preview, unit tests) needs no wiring.
     */
    readonly impactService: ImpactService = new ImpactService(pool),
    /** Wave 6 (X1): `() => getAiSettings(app.db)`. Read per revision, not cached — an admin
     * editing the brief must affect the next run, not the next restart. */
    private readonly settings: () => Promise<AiSettings> = () => getAiSettings(pool),
  ) {}

  /** The effective AI settings behind the context that was just built (for `currentPromptVersion`). */
  currentSettings(): Promise<AiSettings> {
    return this.settings();
  }

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
      /**
       * Wave 6 (X1), spec §1.6/§1.7: the model no longer sees only the diff and the steps it
       * maps to. It sees who the company is (`brief`), how the house writes (`style`), what
       * else the change reaches (`impact`) and what an accepted answer to a change like this
       * one looked like (`examples`). All four are optional — with nothing configured and no
       * impact, `buildMessages` renders exactly what it rendered before this wave.
       */
      const [settings, impact] = await Promise.all([
        this.settings(),
        this.impactService.impactForSteps(
          linkedSteps.map((s) => ({
            documentId: s.documentId,
            stepKey: s.stepKey,
            blockId: s.blockId,
          })),
        ),
      ]);
      const docIds = [...new Set(linkedSteps.map((s) => s.documentId))];
      const worldSlugs = docIds.length
        ? [
            ...new Set(
              (
                await this.pool.query(
                  `select world_slug from document_worlds where document_id = any($1::uuid[])`,
                  [docIds],
                )
              ).rows.map((r) => r.world_slug as string),
            ),
          ]
        : [];
      const mapped = new Set(linkedSteps.map((s) => s.anchor.replace(/^§/, '')));
      const types = [...new Set(diffs.filter((d) => d.kind !== 'same').map((d) => likelyType(d, mapped)))];
      const examples = await fewShotExamples(this.pool, {
        sourceId: revision.sourceId,
        worldSlugs,
        types,
        limit: 3,
      });
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
        brief: settings.brief.text || undefined,
        style: settings.style.text || undefined,
        impact,
        examples,
        maxContextChars: settings.limits.maxContextChars,
      };
    } finally {
      client.release();
    }
  }
}
