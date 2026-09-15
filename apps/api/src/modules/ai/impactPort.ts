/**
 * Wave 6 — the seam between X2's `read_impact` tool and X1's `ImpactService`.
 *
 * X1 and X2 ship in parallel and X1 owns `sources/impact.ts`, so the chat lane cannot import it
 * at compile time without the two lanes colliding on the same file. This port is what it calls
 * instead: a local implementation built on `graph/repo.ts`'s `inboundFor` and the same
 * `documents.related` computation the document page uses, behind the one method the tool needs.
 *
 * **X6 re-points this**: replace `impactPort.impactOf` with a delegate to `ImpactService`
 * (`swapImpactPort`) and the tool, its tests and the prompt stay exactly as they are.
 */
import type { ImpactSet } from '@wecom/model';
import { inboundFor } from '../graph/repo.js';
import { getVisibleDocument, relatedFor } from '../documents/repo.js';
import { canReadUnpublished } from '../../lib/visibility.js';
import type { Queryable } from '../../lib/sql.js';
import type { ReqUser } from '../../lib/user.js';

export interface ImpactPort {
  impactOf(q: Queryable, documentId: string, user: ReqUser): Promise<ImpactSet>;
}

const EMPTY: ImpactSet = { documents: [], blocks: [], fields: [], topics: [], related: [] };

/** Every count is "how many *other* documents", which is the number that makes an editor pause. */
export const localImpactPort: ImpactPort = {
  async impactOf(q, documentId, user) {
    const doc = await getVisibleDocument(q, documentId, user);
    if (!doc) return EMPTY;
    const readUnpublished = canReadUnpublished(user);
    const scopes = user.worldScopes ? [...user.worldScopes] : null;

    const inbound = await inboundFor(q, { kind: 'document', key: documentId }, scopes, readUnpublished);
    const documents = inbound.slice(0, 20).map((r) => ({
      id: r.documentId,
      title: r.title,
      why: r.stepKey ? `מפנה לכאן משלב ${r.stepKey}` : 'מפנה למסמך זה',
    }));

    const blockIds = [
      ...new Set(doc.phases.flatMap((p) => p.steps.flatMap((s) => [s.blockId, ...s.blockRefs]))),
    ].filter((id): id is string => !!id);
    const blocks = blockIds.length
      ? (
          await q.query(
            `select b.id, b.title, (select count(distinct s.document_id)::int from steps s where s.block_id = b.id) used_by
               from blocks b where b.id = any($1)`,
            [blockIds],
          )
        ).rows.map((r) => ({
          id: r.id as string,
          title: r.title as string,
          usedBy: Number(r.used_by ?? 0),
        }))
      : [];

    const fields = (
      await q.query(
        `select f.field_name name, (select count(distinct s2.document_id)::int
             from step_field_refs f2 join steps s2 on s2.id = f2.step_id where f2.field_name = f.field_name) used_by
           from step_field_refs f join steps s on s.id = f.step_id
          where s.document_id = $1 group by f.field_name order by f.field_name`,
        [documentId],
      )
    ).rows.map((r) => ({ name: r.name as string, usedBy: Number(r.used_by ?? 0) }));

    const topics = (
      await q.query(
        `select t.id, t.name from document_topics dt join topics t on t.id = dt.topic_id where dt.document_id = $1 order by t.name`,
        [documentId],
      )
    ).rows.map((r) => ({ id: r.id as string, name: r.name as string }));

    /**
     * `relatedFor` has no similarity score to give — it is graph- and field-overlap-based, not
     * embedding-based. Reporting 0 rather than inventing a number keeps the shape honest until
     * X6 points this at X1's embedding-backed service.
     */
    const related = (await relatedFor(q, doc, readUnpublished)).map((r) => ({
      id: r.documentId,
      title: r.title,
      similarity: 0,
    }));

    return { documents, blocks, fields, topics, related };
  },
};

let active: ImpactPort = localImpactPort;

/** X6's seam: point the tool at X1's `ImpactService` without touching the tool. */
export const swapImpactPort = (port: ImpactPort): void => {
  active = port;
};

export const impactPort: ImpactPort = {
  impactOf: (q, documentId, user) => active.impactOf(q, documentId, user),
};
