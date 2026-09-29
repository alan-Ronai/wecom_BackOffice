import type pg from 'pg';
import {
  NotSplittableError,
  SuggestionPayloadSchema,
  applyStructuredEdit,
  diffPayloads,
  makeEvent,
  rowsOf,
  splitByParts,
  type AffectsItem,
  type Document,
  type Event,
  type Step,
  type StructuredEdit,
  type StructuredEditDiff,
  type Suggestion,
  type SuggestionPayload,
} from '@wecom/shared';
import type { ProposedSuggestion } from '@wecom/model';
import { audit } from '../../lib/audit.js';
import type { ContentApi, ContentClient } from './content-api.js';
import { documentsForSource } from '../documents/sourceReview.js';
import { suggestionVisibleSql, type SuggestionViewer } from './suggestionScope.js';

type Status = Suggestion['status'];

/**
 * The event bus L2 owns (`app.events` from `src/lib/events.ts`): `publish(tx, event)`.
 * Declared structurally so this lane does not depend on L2's file landing first.
 */
export interface EventSink {
  publish(tx: ContentClient, event: Event): void | Promise<void>;
}

/**
 * L6's `SyncService.afterSuggestionsApplied`: the only path that creates a
 * `sync_links` row for a remote item imported as a new card. Supplied by `app.ts`
 * once both modules are registered (L5 must not import L6), and invoked after the
 * apply transaction commits so a remote outage cannot roll the apply back.
 */
export type AppliedHook = (sourceId: string, documentId: string, version: number) => Promise<void>;

/** Request provenance for the audit rows this service writes. */
export interface AuditMeta {
  requestId?: string | null;
  ip?: string | null;
}

const row = (r: Record<string, unknown>): Suggestion => ({
  id: r.id as string,
  sourceRevisionId: r.source_revision_id as string,
  anchor: r.anchor as string,
  type: r.type as Suggestion['type'],
  title: r.title as string,
  targetDocumentId: (r.target_document_id as string) ?? null,
  targetStepKey: (r.target_step_key as string) ?? null,
  targetBlockId: (r.target_block_id as string) ?? null,
  payload: r.payload as SuggestionPayload,
  editedPayload: (r.edited_payload as SuggestionPayload) ?? null,
  confidence: Number(r.confidence),
  rationale: r.rationale as string,
  status: r.status as Status,
  decidedBy: (r.decided_by as string) ?? null,
  decidedAt: r.decided_at ? (r.decided_at as Date).toISOString() : null,
  appliedVersionId: (r.applied_version_id as string) ?? null,
  /**
   * Wave 6 (X0), additive: the column arrives with X1's 0051, so this reads defensively and
   * every row selected before it — and every row a rollback leaves behind — is `[]` rather
   * than a parse failure. X1 computes it; X3's structured editor and analytics read it.
   */
  affects: (r.affects as Suggestion['affects']) ?? [],
  /**
   * Wave 6 (X3), 0053. `edit_diff` is always server-derived (original → edited), `applied_parts`
   * names the rows a partial accept applied, and `parent_id` points a remainder suggestion at
   * the suggestion it was split off. All three read defensively for the same reason `affects`
   * does — a row selected before the migration, or after a rollback, must still map.
   */
  editDiff: (r.edit_diff as Suggestion['editDiff']) ?? null,
  appliedParts: (r.applied_parts as string[] | null) ?? null,
  parentId: (r.parent_id as string | null) ?? null,
  /** Wave 6 (X1): which prompt (`v3.<brief>.<style>`) and which model produced the row. */
  promptVersion: (r.prompt_version as string | null) ?? null,
  model: (r.model as string | null) ?? null,
  createdAt: (r.created_at as Date).toISOString(),
  // Wave Y: only the list joins the source; a bare `select g.*` has neither column.
  ...(r.source_id ? { sourceId: r.source_id as string } : {}),
  ...(typeof r.source_title === 'string' ? { sourceTitle: r.source_title } : {}),
});

const httpErr = (status: number, code: string, message: string) =>
  Object.assign(new Error(message), { statusCode: status, code });

const findStep = (doc: Document, key: string): Step | undefined =>
  doc.phases.flatMap((p) => p.steps).find((s) => s.key === key);

const nextKey = (doc: Document) =>
  's' +
  (Math.max(
    0,
    ...doc.phases
      .flatMap((p) => p.steps)
      .map((s) => parseInt(s.key.replace(/^s/, ''), 10))
      .filter((n) => !isNaN(n)),
  ) +
    1);

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Every world `publishAccepted` would write for a source's accepted suggestions — the write
 * scope a caller must hold all of (wave Y, A-M6):
 *
 * - `update-step` / `new-step` / `deprecate-step`: the target document's worlds;
 * - `new-card`: the primary world the new document is created in (`category` of the payload the
 *   reviewer settled on);
 * - `update-block`: the worlds of every live document embedding or referencing the block, the
 *   same set `PUT /blocks/:id` checks;
 * - `field-alert`: the worlds of every live document whose steps reference the field, the same
 *   set `PUT /fields/:name` checks.
 */
export async function worldsWrittenBy(q: pg.PoolClient | pg.Pool, sourceId: string): Promise<string[]> {
  const r = await q.query<{ w: string }>(
    `with acc as (
       select g.target_document_id, g.target_block_id, coalesce(g.edited_payload, g.payload) p
         from suggestions g join source_revisions sr on sr.id = g.source_revision_id
        where sr.source_id = $1 and g.status = 'accepted'),
     docs as (
       select target_document_id id from acc where target_document_id is not null
       union
       select s.document_id from acc
         join steps s on s.block_id = acc.target_block_id or acc.target_block_id = any(s.block_refs)
        where acc.target_block_id is not null and acc.p->>'type' = 'update-block'
       union
       select s.document_id from acc
         join step_field_refs f on f.field_name = acc.p->>'fieldName'
         join steps s on s.id = f.step_id
        where acc.p->>'type' = 'field-alert')
     select dw.world_slug w from docs
       join documents d on d.id = docs.id and d.deleted_at is null
       join document_worlds dw on dw.document_id = d.id
     union
     select acc.p->>'category' from acc where acc.p->>'type' = 'new-card' and acc.p->>'category' is not null
     order by 1`,
    [sourceId],
  );
  return r.rows.map((x) => x.w);
}

export class SuggestionService {
  constructor(
    private readonly pool: pg.Pool,
    private readonly content: ContentApi,
    private readonly events: EventSink,
  ) {}

  private afterApplied: AppliedHook | null = null;

  /** Wired in `app.ts` after the connectors module is registered. */
  setAfterApplied(fn: AppliedHook | null): void {
    this.afterApplied = fn;
  }

  /**
   * `EventBus.publish` NOTIFYs inside the caller's transaction so subscribers only
   * ever see committed writes; publishing on the pool fired the event even when the
   * insert later failed. Both write paths therefore open one transaction.
   */
  /**
   * `meta` is wave 6 (X1) provenance, all optional so every existing caller is unchanged:
   * which prompt version and model produced the batch, and a function that computes what each
   * suggestion touches. `affects` is deliberately *not* read off the model's answer (spec §1.6)
   * — a model must not be able to claim a change reaches a document it never saw.
   */
  async createFromProposals(
    revisionId: string,
    items: ProposedSuggestion[],
    meta: {
      promptVersion?: string;
      model?: string;
      affects?: (s: ProposedSuggestion) => AffectsItem[];
    } = {},
  ): Promise<Suggestion[]> {
    const out: Suggestion[] = [];
    const srcRow = await this.pool.query(`select source_id from source_revisions where id=$1`, [revisionId]);
    if (!srcRow.rowCount) throw httpErr(404, 'NOT_FOUND', 'גרסת המקור לא נמצאה');
    for (const it of items) SuggestionPayloadSchema.parse(it.payload);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const it of items) {
        const r = await client.query(
          `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, target_block_id, payload, confidence, rationale, affects, prompt_version, model)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
          [
            revisionId,
            it.anchor,
            it.type,
            it.title,
            it.targetDocumentId,
            it.targetStepKey,
            it.targetBlockId,
            JSON.stringify(it.payload),
            clamp01(it.confidence),
            it.rationale,
            JSON.stringify(meta.affects?.(it) ?? []),
            meta.promptVersion ?? null,
            meta.model ?? null,
          ],
        );
        const s = row(r.rows[0]);
        out.push(s);
        await this.events.publish(
          client,
          makeEvent('suggestion.created', {
            suggestionId: s.id,
            sourceId: srcRow.rows[0].source_id as string,
            targetDocumentId: s.targetDocumentId,
            type: s.type,
          }),
        );
      }
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    return out;
  }

  /**
   * A-I6: the review queue is world-scoped like every other reader. `viewer` is the caller's
   * reach (`suggestionViewer(req.user)`); a suggestion outside it answers **404**, not 403, for
   * the same reason `getVisibleDocument` does — the id must not tell you the row exists. Callers
   * with no viewer (the apply pipeline, the service's own internal reads) see everything, which
   * is what a server-side job needs.
   */
  async get(id: string, viewer?: SuggestionViewer): Promise<Suggestion> {
    const scoped = viewer ? ` and ${suggestionVisibleSql('g', '$2', viewer.readUnpublished)}` : '';
    const r = await this.pool.query(
      `select g.* from suggestions g where g.id=$1${scoped}`,
      viewer ? [id, viewer.worldScopes ? [...viewer.worldScopes] : null] : [id],
    );
    if (!r.rowCount) throw httpErr(404, 'NOT_FOUND', 'ההצעה לא נמצאה');
    return row(r.rows[0]);
  }

  async list(
    q: {
      status?: Status;
      sourceId?: string;
      documentId?: string;
      page: number;
      pageSize: number;
    },
    viewer?: SuggestionViewer,
  ): Promise<{ items: Suggestion[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (q.status) {
      params.push(q.status);
      where.push(`g.status=$${params.length}`);
    }
    if (q.sourceId) {
      params.push(q.sourceId);
      where.push(`sr.source_id=$${params.length}`);
    }
    if (q.documentId) {
      // Wave Y: the document's primary source and every source it links to (`sourceReview.ts`'s
      // `documentsForSource` is the same relation read the other way round).
      params.push(q.documentId);
      const p = `$${params.length}`;
      where.push(`sr.source_id in (
        select d.source_id from documents d where d.id=${p} and d.source_id is not null
        union
        select l.to_source_id from document_links l where l.from_document_id=${p} and l.to_source_id is not null)`);
    }
    if (viewer) {
      params.push(viewer.worldScopes ? [...viewer.worldScopes] : null);
      where.push(suggestionVisibleSql('g', `$${params.length}`, viewer.readUnpublished));
    }
    const w = where.length ? 'where ' + where.join(' and ') : '';
    const total = await this.pool.query(
      `select count(*)::int as n from suggestions g join source_revisions sr on sr.id=g.source_revision_id ${w}`,
      params,
    );
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const r = await this.pool.query(
      `select g.*, sr.source_id, s.title source_title
         from suggestions g
         join source_revisions sr on sr.id=g.source_revision_id
         join sources s on s.id=sr.source_id ${w}
       order by g.created_at desc limit $${params.length - 1} offset $${params.length}`,
      params,
    );
    return { items: r.rows.map(row), total: total.rows[0].n as number };
  }

  async decide(
    id: string,
    status: 'accepted' | 'rejected' | 'pending',
    actorId: string,
  ): Promise<Suggestion> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const r = await client.query(
        `update suggestions set status=$2, decided_by=$3, decided_at=case when $2='pending' then null else now() end
         where id=$1 returning *`,
        [id, status, status === 'pending' ? null : actorId],
      );
      const s = row(r.rows[0]);
      if (status === 'rejected') {
        // Every suggestion of this revision decided and none accepted/applied → the editor judged the
        // working view unaffected; the source-review flag on the targeted documents comes down.
        const left = await client.query(
          `select count(*) filter (where status='pending') pending,
                  count(*) filter (where status in ('accepted','applied')) kept
             from suggestions where source_revision_id=$1`,
          [cur.sourceRevisionId],
        );
        const row0 = left.rows[0] as { pending: string; kept: string };
        if (Number(row0.pending) === 0 && Number(row0.kept) === 0) {
          /**
           * B-M6: the flag was raised by `onIngested` for every document the source feeds, not
           * only the ones this revision produced a suggestion for, so clearing over
           * `target_document_id` left the rest flagged with no user action that could clear
           * them. Clear over the same set that was raised.
           */
          const srcRow = await client.query<{ source_id: string }>(
            'select source_id from source_revisions where id=$1',
            [cur.sourceRevisionId],
          );
          const sourceId = srcRow.rows[0]?.source_id;
          for (const d of sourceId ? await documentsForSource(client, sourceId) : [])
            await client.query(
              `update documents set source_review_needed=false, source_review_reason=null, source_review_at=null where id=$1`,
              [d],
            );
        }
      }
      await this.events.publish(
        client,
        makeEvent('suggestion.decided', { suggestionId: id, status, actorId }),
      );
      await client.query('commit');
      return s;
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  async edit(id: string, editedPayload: SuggestionPayload, actorId: string): Promise<Suggestion> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    const parsed = SuggestionPayloadSchema.parse(editedPayload);
    if (parsed.type !== cur.type) throw httpErr(400, 'TYPE_MISMATCH', 'סוג ההצעה אינו ניתן לשינוי (type)');
    return this.storeEdit(id, parsed, diffPayloads(cur.payload, parsed), actorId);
  }

  /**
   * Field-level edit (spec §1.8). Always applied to the **original** payload, never to the
   * previous edit, so the row ids the editor is looking at mean the same thing on every pass and
   * `edit_diff` always reads "as proposed → as it stands".
   */
  async editStructured(id: string, edit: StructuredEdit, actorId: string): Promise<Suggestion> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    if (edit.type !== cur.type) throw httpErr(400, 'TYPE_MISMATCH', 'סוג ההצעה אינו ניתן לשינוי (type)');
    let applied: { payload: SuggestionPayload; diff: StructuredEditDiff };
    try {
      applied = applyStructuredEdit(cur.payload, edit);
    } catch (e) {
      const m = (e as Error).message;
      if (/unknown row/.test(m))
        throw httpErr(400, 'UNKNOWN_ROW', 'שורה לא מוכרת בהצעה: ' + m.split(': ')[1]);
      if (/required row/.test(m)) throw httpErr(400, 'REQUIRED_ROW', 'לא ניתן להסיר שורת חובה');
      if (/at least one action/.test(m))
        throw httpErr(400, 'REQUIRED_ROW', 'שלב חדש חייב לכלול לפחות הוראה אחת');
      throw httpErr(400, 'VALIDATION', 'ערך לא תקין בשורה: ' + m);
    }
    return this.storeEdit(id, applied.payload, applied.diff, actorId);
  }

  /** The edited payload and its server-derived diff are written together or not at all. */
  private async storeEdit(
    id: string,
    payload: SuggestionPayload,
    diff: StructuredEditDiff,
    actorId: string,
  ): Promise<Suggestion> {
    const r = await this.pool.query(
      `update suggestions set edited_payload=$2, edit_diff=$3, decided_by=coalesce(decided_by,$4)
       where id=$1 returning *`,
      [id, JSON.stringify(payload), JSON.stringify(diff), actorId],
    );
    return row(r.rows[0]);
  }

  /**
   * Partial accept (spec §1.8). The original row keeps the selected rows as its `edited_payload`
   * — so the ordinary accepted → applied path applies exactly those — and records `applied_parts`;
   * the rows left out are re-queued as a pending remainder suggestion linked by `parent_id`, so
   * nothing an editor did not explicitly reject quietly leaves the queue.
   */
  async acceptParts(
    id: string,
    parts: string[],
    actorId: string,
  ): Promise<{ accepted: Suggestion; remainder: Suggestion | null }> {
    const cur = await this.get(id);
    if (cur.status === 'applied') throw httpErr(409, 'ALREADY_APPLIED', 'ההצעה כבר יושמה');
    /**
     * A-I4. A partial accept is only meaningful on a *pending* suggestion. On a repeat call
     * (double-click, a retry after a timeout) `base` would be the already-narrowed
     * `edited_payload`, so `whole` came out true, `applied_parts` was erased — taking the row out
     * of the analytics' `EDITED` count — and the first remainder stayed in the queue with nothing
     * explaining it. The claim below (`where id=$1 and status='pending'`) is the real guard, the
     * same claim-by-predicate `decideProposedEdits` uses; this is the cheap early answer.
     */
    if (cur.status !== 'pending')
      throw httpErr(409, 'NOT_PENDING', 'ההצעה כבר הוכרעה — אי אפשר לאשר חלקים ממנה שוב');
    const base = cur.editedPayload ?? cur.payload;
    let split: { applied: SuggestionPayload; remainder: SuggestionPayload | null };
    try {
      split = splitByParts(base, parts);
    } catch (e) {
      if (e instanceof NotSplittableError) {
        const err = httpErr(400, 'NOT_SPLITTABLE', e.message) as Error & { details?: unknown };
        err.details = { group: e.group };
        throw err;
      }
      throw e;
    }
    const srcRow = await this.pool.query<{ source_id: string }>(
      'select source_id from source_revisions where id=$1',
      [cur.sourceRevisionId],
    );
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const whole = split.remainder === null && rowsOf(base).every((r) => parts.includes(r.rowId));
      // A-I4: claim the row by predicate, so two concurrent partial accepts cannot both write a
      // remainder. The loser sees zero rows and gets a 409 rather than duplicating the queue.
      const upd = await client.query(
        `update suggestions set status='accepted', decided_by=$2, decided_at=now(),
                edited_payload=$3, edit_diff=$4, applied_parts=$5
          where id=$1 and status='pending' returning *`,
        [
          id,
          actorId,
          JSON.stringify(split.applied),
          JSON.stringify(diffPayloads(cur.payload, split.applied)),
          whole ? null : JSON.stringify([...new Set(parts)].sort()),
        ],
      );
      if (!upd.rowCount) throw httpErr(409, 'NOT_PENDING', 'ההצעה כבר הוכרעה — אי אפשר לאשר חלקים ממנה שוב');
      const accepted = row(upd.rows[0]);
      let remainder: Suggestion | null = null;
      if (split.remainder) {
        const cols = [
          'source_revision_id',
          'anchor',
          'type',
          'title',
          'target_document_id',
          'target_step_key',
          'target_block_id',
          'payload',
          'confidence',
          'rationale',
          'status',
          'parent_id',
          // X6: X1's 0051 is on this branch, so the provenance columns are unconditional.
          'affects',
          'prompt_version',
          'model',
        ];
        const vals: unknown[] = [
          cur.sourceRevisionId,
          cur.anchor,
          cur.type,
          cur.title + ' (המשך)',
          cur.targetDocumentId,
          cur.targetStepKey,
          cur.targetBlockId,
          JSON.stringify(split.remainder),
          cur.confidence,
          'שארית של הצעה שיושמה חלקית · ' + cur.rationale,
          'pending',
          id,
          // The remainder is the same proposal, so it keeps the same provenance: the impact set
          // X1 computed and the model and prompt version that produced it.
          JSON.stringify(cur.affects ?? []),
          cur.promptVersion ?? null,
          cur.model ?? null,
        ];
        const ins = await client.query(
          `insert into suggestions(${cols.join(', ')}) values (${cols.map((_, i) => '$' + (i + 1)).join(',')}) returning *`,
          vals,
        );
        remainder = row(ins.rows[0]);
        await this.events.publish(
          client,
          makeEvent('suggestion.created', {
            suggestionId: remainder.id,
            sourceId: srcRow.rows[0].source_id,
            targetDocumentId: remainder.targetDocumentId,
            type: remainder.type,
          }),
        );
      }
      await this.events.publish(
        client,
        makeEvent('suggestion.decided', { suggestionId: id, status: 'accepted', actorId }),
      );
      await client.query('commit');
      return { accepted, remainder };
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
  }

  /** Applies one suggestion inside the caller's transaction. Returns the document version it created, if any. */
  async applyOne(
    client: pg.PoolClient,
    s: Suggestion,
    actorId: string,
    sourceTitle: string,
  ): Promise<{ versionId: string | null }> {
    const p = s.editedPayload ?? s.payload;
    const label = `ממסמך מקור · ${sourceTitle} ${s.anchor} · ${s.title}`;
    const sourceId = (
      await client.query(`select source_id from source_revisions where id=$1`, [s.sourceRevisionId])
    ).rows[0].source_id as string;
    const publish = async (doc: Document) =>
      (await this.content.publishDocument(client, doc, { actorId, label, suggestionId: s.id })).versionId;

    switch (p.type) {
      case 'update-step': {
        const doc = await this.needDoc(client, s.targetDocumentId);
        const st = this.needStep(doc, s.targetStepKey);
        p.addActions.forEach((t, i) => st.actions.push({ id: 'a' + (st.actions.length + i + 1), text: t }));
        if (p.replaceActions) st.actions = p.replaceActions;
        if (p.branch) st.branch = p.branch;
        if (p.branch === null) delete st.branch;
        if (p.outcomes) st.outcomes = p.outcomes;
        Object.assign(st, p.patch);
        return { versionId: await publish(doc) };
      }
      case 'new-card': {
        const created = await this.content.createDocument(
          client,
          {
            title: p.title,
            description: p.description,
            category: p.category,
            wave: p.wave,
            priority: p.priority,
            kind: 'steps',
            phases: p.phases,
            sourceId,
            sourceRef: s.anchor,
            // W1 taxonomy defaults: the suggestion only names a primary world.
            tags: [],
            worlds: [],
            topics: [],
          },
          actorId,
        );
        created.status = 'published';
        const versionId = await publish(created);
        for (const st of created.phases.flatMap((ph) => ph.steps))
          if (st.sourceRef)
            await client.query(
              `insert into document_links(from_document_id, from_step_key, to_source_id, type, origin)
               values ($1,$2,$3,'derived_from_source','explicit') on conflict do nothing`,
              [created.id, st.key, sourceId],
            );
        return { versionId };
      }
      case 'new-step': {
        const doc = await this.needDoc(client, s.targetDocumentId);
        const key = nextKey(doc);
        const step: Step = {
          key,
          num: '',
          title: p.title,
          actions: p.actions.map((t, i) => ({ id: 'a' + (i + 1), text: t })),
          outcomes: p.outcomes,
          blockRefs: [],
          deps: [],
          sourceRef: s.anchor,
        };
        const phase = p.afterStepKey
          ? (doc.phases.find((ph) => ph.steps.some((x) => x.key === p.afterStepKey)) ??
            doc.phases[doc.phases.length - 1])
          : doc.phases[doc.phases.length - 1];
        if (!phase) throw httpErr(409, 'NO_PHASE', 'למסמך היעד אין שלבים');
        const idx = p.afterStepKey
          ? phase.steps.findIndex((x) => x.key === p.afterStepKey) + 1
          : phase.steps.length;
        phase.steps.splice(idx, 0, step);
        let n = 1;
        for (const x of doc.phases.flatMap((ph) => ph.steps))
          if (!/[א-ת]/.test(x.num) || x === step) x.num = String(n++);
        await client.query(
          `insert into document_links(from_document_id, from_step_key, to_source_id, type, origin)
           values ($1,$2,$3,'derived_from_source','explicit') on conflict do nothing`,
          [doc.id, key, sourceId],
        );
        return { versionId: await publish(doc) };
      }
      case 'update-block': {
        const b = await this.content.getBlock(client, s.targetBlockId ?? '');
        if (!b) throw httpErr(404, 'NOT_FOUND', 'הבלוק לא נמצא');
        b.actions = p.actions;
        if (p.script != null) b.script = p.script;
        await this.content.publishBlock(client, b, { actorId, label });
        return { versionId: null };
      }
      case 'deprecate-step': {
        const doc = await this.needDoc(client, s.targetDocumentId);
        const st = this.needStep(doc, s.targetStepKey);
        st.tone = 'alert';
        st.hint = 'הוצא משימוש במקור';
        st.outcomes.unshift({ kind: 'alert', text: '⚑ השלב הוצא משימוש – ' + p.reason });
        return { versionId: await publish(doc) };
      }
      case 'field-alert': {
        await this.content.upsertField(
          client,
          {
            name: p.fieldName,
            status: p.issue === 'unknown' ? 'new' : p.issue === 'renamed' ? 'renamed' : 'retired',
            path: '',
          },
          actorId,
        );
        return { versionId: null };
      }
    }
  }

  private async needDoc(client: pg.PoolClient, id: string | null): Promise<Document> {
    const d = id ? await this.content.getDocument(client, id) : null;
    if (!d) throw httpErr(404, 'NOT_FOUND', 'מסמך היעד לא נמצא');
    return d;
  }

  private needStep(doc: Document, key: string | null): Step {
    const st = key ? findStep(doc, key) : undefined;
    if (!st) throw httpErr(404, 'NOT_FOUND', 'שלב היעד לא נמצא');
    return st;
  }

  /**
   * Applies every accepted suggestion of a source in one transaction, marks the source
   * synced and its revision accepted, then publishes the document.published events.
   *
   * `guard` (wave Y, A-M6) is handed every world the publish would write — see
   * `worldsWrittenBy` — inside the transaction and before anything is applied, so a caller who
   * may not write one of them is refused for the whole request and nothing is half-published.
   */
  async publishAccepted(
    sourceId: string,
    actorId: string,
    meta: AuditMeta = {},
    guard?: (worlds: string[]) => void,
  ): Promise<{ applied: number; versions: string[] }> {
    const client = await this.pool.connect();
    const versions: string[] = [];
    const published: { documentId: string; version: number }[] = [];
    let applied = 0;
    try {
      await client.query('begin');
      const srcTitle = (await client.query(`select title from sources where id=$1 for update`, [sourceId]))
        .rows[0]?.title as string;
      const acc = await client.query(
        `select g.* from suggestions g join source_revisions sr on sr.id=g.source_revision_id
         where sr.source_id=$1 and g.status='accepted' order by g.created_at, g.id`,
        [sourceId],
      );
      if (guard) guard(await worldsWrittenBy(client, sourceId));
      for (const r of acc.rows) {
        const s = row(r);
        const res = await this.applyOne(client, s, actorId, srcTitle);
        await client.query(`update suggestions set status='applied', applied_version_id=$2 where id=$1`, [
          s.id,
          res.versionId,
        ]);
        // Inside the transaction, so a rolled-back apply leaves no audit row.
        await audit(client, {
          actorId,
          action: 'suggestions.apply',
          entityType: 'suggestion',
          entityId: s.id,
          before: { status: s.status, type: s.type, targetDocumentId: s.targetDocumentId },
          after: { status: 'applied', versionId: res.versionId, edited: !!s.editedPayload },
          requestId: meta.requestId ?? null,
          ip: meta.ip ?? null,
        });
        applied++;
        if (res.versionId) {
          versions.push(res.versionId);
          const v = await client.query(`select document_id, version from document_versions where id=$1`, [
            res.versionId,
          ]);
          published.push({ documentId: v.rows[0].document_id, version: v.rows[0].version });
        }
      }
      await client.query(
        `update source_revisions set accepted=true
         where source_id=$1
           and id in (select g.source_revision_id from suggestions g
                        join source_revisions sr2 on sr2.id=g.source_revision_id
                        where sr2.source_id=$1 and g.status in ('applied','rejected'))
           and not exists (select 1 from suggestions g2 where g2.source_revision_id=source_revisions.id and g2.status='pending')`,
        [sourceId],
      );
      await client.query(
        `update sources set sync_state='synced', last_synced_at=now(), updated_by=$2 where id=$1`,
        [sourceId, actorId],
      );
      await audit(client, {
        actorId,
        action: 'sources.publish',
        entityType: 'source',
        entityId: sourceId,
        before: null,
        after: { applied, versions },
        requestId: meta.requestId ?? null,
        ip: meta.ip ?? null,
      });
      await client.query('commit');
    } catch (e) {
      await client.query('rollback');
      throw e;
    } finally {
      client.release();
    }
    for (const p of published) {
      await this.events.publish(
        this.pool,
        makeEvent('document.published', { documentId: p.documentId, version: p.version, actorId }),
      );
      // Closes the remote -> KB half of the two-way sync loop.
      if (this.afterApplied) await this.afterApplied(sourceId, p.documentId, p.version);
    }
    return { applied, versions };
  }
}
