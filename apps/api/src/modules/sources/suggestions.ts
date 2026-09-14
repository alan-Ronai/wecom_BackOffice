import type pg from 'pg';
import {
  SuggestionPayloadSchema,
  makeEvent,
  type Document,
  type Event,
  type Step,
  type Suggestion,
  type SuggestionPayload,
} from '@wecom/shared';
import type { ProposedSuggestion } from '@wecom/model';
import { audit } from '../../lib/audit.js';
import type { ContentApi, ContentClient } from './content-api.js';

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
  createdAt: (r.created_at as Date).toISOString(),
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
  async createFromProposals(revisionId: string, items: ProposedSuggestion[]): Promise<Suggestion[]> {
    const out: Suggestion[] = [];
    const srcRow = await this.pool.query(`select source_id from source_revisions where id=$1`, [revisionId]);
    if (!srcRow.rowCount) throw httpErr(404, 'NOT_FOUND', 'גרסת המקור לא נמצאה');
    for (const it of items) SuggestionPayloadSchema.parse(it.payload);
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      for (const it of items) {
        const r = await client.query(
          `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, target_block_id, payload, confidence, rationale)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
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

  async get(id: string): Promise<Suggestion> {
    const r = await this.pool.query(`select * from suggestions where id=$1`, [id]);
    if (!r.rowCount) throw httpErr(404, 'NOT_FOUND', 'ההצעה לא נמצאה');
    return row(r.rows[0]);
  }

  async list(q: {
    status?: Status;
    sourceId?: string;
    page: number;
    pageSize: number;
  }): Promise<{ items: Suggestion[]; total: number }> {
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
    const w = where.length ? 'where ' + where.join(' and ') : '';
    const total = await this.pool.query(
      `select count(*)::int as n from suggestions g join source_revisions sr on sr.id=g.source_revision_id ${w}`,
      params,
    );
    params.push(q.pageSize, (q.page - 1) * q.pageSize);
    const r = await this.pool.query(
      `select g.* from suggestions g join source_revisions sr on sr.id=g.source_revision_id ${w}
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
                  count(*) filter (where status in ('accepted','applied')) kept,
                  array_agg(distinct target_document_id) filter (where target_document_id is not null) docs
             from suggestions where source_revision_id=$1`,
          [cur.sourceRevisionId],
        );
        const row0 = left.rows[0] as { pending: string; kept: string; docs: string[] | null };
        if (Number(row0.pending) === 0 && Number(row0.kept) === 0)
          for (const d of row0.docs ?? [])
            await client.query(
              `update documents set source_review_needed=false, source_review_reason=null, source_review_at=null where id=$1`,
              [d],
            );
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
    const r = await this.pool.query(
      `update suggestions set edited_payload=$2, decided_by=coalesce(decided_by,$3) where id=$1 returning *`,
      [id, JSON.stringify(parsed), actorId],
    );
    return row(r.rows[0]);
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
               values ($1,$2,$3,'derived_from_source','explicit')`,
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
           values ($1,$2,$3,'derived_from_source','explicit')`,
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
   */
  async publishAccepted(
    sourceId: string,
    actorId: string,
    meta: AuditMeta = {},
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
