/**
 * The one place that knows which caches a content or taxonomy write moves.
 *
 * Documents and taxonomy are two halves of one invariant and used to be invalidated by two hook
 * families that did not know about each other: a taxonomy rename left every library card on the
 * old world, and `PATCH /documents/:id` with `worlds`/`topics`/`tags` left `World.itemCount`,
 * `Topic.itemCount` and `TagCount.count` — all derived from exactly those fields — reading the
 * pre-write numbers. Users report drifting counters as data loss.
 *
 * `['topic']` and `['search']` are in the list for the visibility half (spec §5.5): a status
 * change moves an item across the published-only boundary, which the topic page and search both
 * enforce, and no SSE event is emitted for it — nothing else would heal those two.
 *
 * Over-invalidation is the deliberate trade. Every one of these queries is small and cached, and
 * the alternative — each caller reasoning about which subset its write touched — is the thing
 * that produced the drift in the first place.
 */
import type { QueryClient } from '@tanstack/react-query';

const CONTENT_ROOTS = [
  ['documents'], // library cards, facets, the pinned-ids query
  ['worlds'], // World.itemCount
  ['topics'], // Topic.itemCount
  ['topic'], // a topic page's grouped item list, filtered to published
  ['tags'], // TagCount.count
  ['search'], // search results are filtered to published too
  ['trash'], // delete/restore move rows in and out of it
] as const;

/** Invalidate every list whose contents or counts a content/taxonomy write can have changed. */
export function invalidateContent(qc: QueryClient): void {
  for (const queryKey of CONTENT_ROOTS) void qc.invalidateQueries({ queryKey });
}
