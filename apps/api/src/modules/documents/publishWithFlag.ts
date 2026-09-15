/**
 * A-C2 — the one place a publish that agents learn from is recorded.
 *
 * Spec §1.5 says significant-change detection runs "on publish", and §1.6's whole point is that
 * with `workflow.requireApprover` on, publishing *is* the approver's decision. `applyChangeFlag`
 * was called from exactly one of the five callers of `publishDocument` — the editor route — so in
 * the configuration §1.6 exists to enable, every editorial publish went through
 * `POST /documents/:id/review-decision` and recorded no `document_change_flags` row, invalidated
 * no completion and created no refresh assignment. §1.5 silently stopped working.
 *
 * This wrapper is the pairing, so a new publish path has to decide about the flag rather than
 * forget it. Three callers use it:
 *
 *   - `documents/routes.ts` — the editor publish, which carries the editor's override checkbox;
 *   - `collab/reviews.ts` — the approve decision (`override: undefined`: the approver has no
 *     checkbox, so the detector's own verdict stands);
 *   - `sources/content-adapter.ts` — an accepted suggestion (`override: undefined`), which is the
 *     second-order version of the same thing: a model-applied change that removes a step is the
 *     textbook significant change.
 *
 * Two publish paths stay deliberately excluded, recorded in `docs/wave5-acceptance.md`:
 *
 *   - `fields/repo.ts`'s field-rename republish — it rewrites a CRM field's *name* across every
 *     document that references it. The detector's "CRM field changed" rule would fire on all of
 *     them at once, so one rename would invalidate every completion in the system for a change
 *     that taught nobody anything new.
 *   - `connectors/documents-adapter.ts`'s sync publish (`kind: 'sync'`) — the remote is the author
 *     there; a pull is not an editorial decision, and `publishDocument` already treats it as
 *     non-human for the approver and source-review flags.
 */
import type { ChangeFlag, Document } from '@wecom/shared';
import type { Tx } from '../../lib/sql.js';
import { publishDocument, type PublishOptions } from './repo.js';
import { applyChangeFlag } from '../learning/tracking/refresh.js';
import type { TrackingDeps } from '../learning/tracking/audiences.js';

export type PublishFlagDeps = Pick<TrackingDeps, 'notifier' | 'events'>;

export interface PublishAndFlagInput extends PublishOptions {
  /** The document to publish: the assembled document, or just its id — as `publishDocument` takes it. */
  doc: Document | string;
  /**
   * The editor's "שינוי מהותי" checkbox. `undefined` — every caller but the editor route — leaves
   * the detector's verdict alone, which is the honest default for a path with no checkbox.
   */
  significantChange?: boolean;
}

/** `publishDocument`, then §1.5's change flag and its refresh fan-out, in the caller's transaction. */
export async function publishAndFlag(
  tx: Tx,
  deps: PublishFlagDeps,
  input: PublishAndFlagInput,
): Promise<{ doc: Document; version: number; versionId: string; changeFlag: ChangeFlag }> {
  const { doc, significantChange, ...opts } = input;
  const published = await publishDocument(tx, doc, opts);
  const changeFlag = await applyChangeFlag(tx, deps, {
    documentId: published.doc.id,
    version: published.version,
    after: published.doc,
    override: significantChange,
    actorId: opts.actorId,
  });
  return { ...published, changeFlag };
}

/**
 * The notifier and the event bus, for the one caller that cannot reach `app`.
 *
 * `sources/content-adapter.ts` implements `ContentApi`, whose `publishDocument(client, doc, opts)`
 * is handed a database client and nothing else — the interface is L5's and predates wave 5.
 * Rather than widen it for one field (and make every `ContentApi` test double carry a notifier),
 * the learning-tracking module registers the holders here from its own `index.ts`, the way wave 4
 * says lanes wire `setNotifier` and friends. It throws rather than degrading to a silent no-op:
 * an unregistered holder would mean a refresh assignment nobody is told about, which is the
 * failure mode this whole finding is about.
 */
let ambient: PublishFlagDeps | null = null;
export const setPublishFlagDeps = (deps: PublishFlagDeps): void => {
  ambient = deps;
};
export const publishFlagDeps = (): PublishFlagDeps => {
  if (!ambient)
    throw new Error(
      'publishFlagDeps: setPublishFlagDeps was never called — the learning tracking module registers it',
    );
  return ambient;
};
