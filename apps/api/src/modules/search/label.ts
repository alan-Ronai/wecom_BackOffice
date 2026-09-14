import type { SearchResponse } from '@wecom/shared';
import type { Q } from '../documents/repo.js';

/**
 * A-2 (review §3, §7 item 8) — label a search result with the *knowledge item*.
 *
 * Every palette hit used to read `topics.json · תמיכה טכנית · שלב 1 – מסנן`. `topics.json` is the
 * static file the seed was imported from: a developer-facing artefact that an agent has no way to
 * interpret, sitting in the most-read position of the most-used control in the product. Worse, a
 * *step* hit named only the step, so the one thing the agent actually needed — which knowledge
 * item this step belongs to — was the one thing the row did not say.
 *
 * `meta` stays exactly as `repo.ts` renders it (it is that module's display string, and the "N
 * קבצים" counter is still computed from the same source files), so nothing that reads it breaks.
 * What this adds is the structured trio the web needs to render the same chips the library card
 * renders: `docType`, `world` and `docTitle`. The client prefers them and falls back to `meta`,
 * which keeps an older client and a newer API compatible in both directions.
 *
 * One query, keyed on the document ids already in the response. Visibility needs no repeating:
 * every id here came out of `search()`, which applied the scope and publication predicates — this
 * only re-reads three columns of rows the caller has already been shown.
 */
export async function labelHits(q: Q, res: SearchResponse): Promise<SearchResponse> {
  const ids = [
    ...new Set(res.groups.flatMap((g) => g.hits.map((h) => h.documentId).filter((x): x is string => !!x))),
  ];
  if (!ids.length) return res;

  const r = await q.query(`select id, title, doc_type, category from documents where id = any($1::uuid[])`, [
    ids,
  ]);
  const byId = new Map(
    r.rows.map((x) => [
      x.id as string,
      { title: x.title as string, docType: x.doc_type as string, world: x.category as string },
    ]),
  );

  return {
    ...res,
    groups: res.groups.map((g) => ({
      ...g,
      hits: g.hits.map((h) => {
        const d = h.documentId ? byId.get(h.documentId) : undefined;
        // A document whose row has gone (deleted between the two queries) keeps the hit rather
        // than dropping it: the label is an improvement to a result, never a filter over results.
        if (!d) return h;
        return {
          ...h,
          docType: d.docType as typeof h.docType,
          world: d.world,
          docTitle: d.title,
        };
      }),
    })),
  };
}
