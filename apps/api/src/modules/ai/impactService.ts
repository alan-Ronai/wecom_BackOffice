/**
 * Wave 6 (X6 seam): the chat's `read_impact` tool, pointed at X1's `ImpactService`.
 *
 * X2 shipped `impactPort.ts` with a local graph-only implementation because X1 owned
 * `sources/impact.ts` and the two lanes could not share a file. Both are on one branch now, so
 * the tool reads the same impact set the proposal pipeline does — including the embedding-backed
 * `related` scores the local fallback could only report as `0`.
 *
 * The visibility check stays here rather than moving into `ImpactService`: the service is called
 * by the queued proposal job, which has no user, while the tool is called by a person whose world
 * scopes and published-only rule have to hold. A document the caller cannot see yields the empty
 * set, exactly as the local port did.
 */
import type pg from 'pg';
import type { ImpactSet } from '@wecom/model';
import { ImpactService } from '../sources/impact.js';
import { visibleDocument } from './tools/read.js';
import type { ToolCtx } from './tools/registry.js';
import type { Queryable } from '../../lib/sql.js';
import type { ReqUser } from '../../lib/user.js';
import { swapImpactPort, type ImpactPort } from './impactPort.js';

const EMPTY: ImpactSet = { documents: [], blocks: [], fields: [], topics: [], related: [] };

export const impactServicePort = (pool: pg.Pool): ImpactPort => {
  const service = new ImpactService(pool);
  return {
    async impactOf(q: Queryable, documentId: string, user: ReqUser): Promise<ImpactSet> {
      // The same visibility answer the read tools give: out of scope, unpublished and missing
      // are one outcome, and `getVisibleDocument` signals two of them by throwing.
      const doc = await visibleDocument({ db: q, user } as ToolCtx, documentId);
      if (!doc) return EMPTY;
      return service.impactForDocument(documentId, {
        scopes: user.worldScopes ? [...user.worldScopes] : null,
      });
    },
  };
};

/** Called once, from the AI module's boot. */
export const useImpactService = (pool: pg.Pool): void => swapImpactPort(impactServicePort(pool));
