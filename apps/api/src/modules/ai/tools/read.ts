/**
 * Wave 6 (X2) — the read tools.
 *
 * Every document-addressed tool starts at `visibleDocument`, which is the visibility rule
 * (`getVisibleDocument`) and the world scope (`hasScope`) in one place. A document the caller
 * may not see answers "לא נמצא" and nothing else: not the title, not the status, not the fact
 * that an id resolves at all. That is what `int/scope-leak.test.ts` holds this lane to.
 */
import { z } from 'zod';
import { htmlToParagraphs, paragraphText, type Document } from '@wecom/shared';
import { getVisibleDocument } from '../../documents/repo.js';
import { getSourceDocument } from '../../sourcedocs/repo.js';
import { topicView } from '../../taxonomy/repo.js';
import { search } from '../../search/repo.js';
import { canReadUnpublished } from '../../../lib/visibility.js';
import { hasScope } from '../../../lib/user.js';
import { impactPort } from '../impactPort.js';
import { suggestionVisibleSql } from '../../sources/suggestionScope.js';
import { defineTool, NOT_FOUND, type ToolCtx, type ToolOutcome } from './registry.js';

const Uuid = z.string().uuid();

/** The visibility rule and the world scope, in the one place every read tool starts from. */
export async function visibleDocument(ctx: ToolCtx, id: string): Promise<Document | null> {
  try {
    const doc = await getVisibleDocument(ctx.db, id, ctx.user);
    if (!doc || !hasScope(ctx.user, doc.worlds)) return null;
    return doc;
  } catch {
    // `getVisibleDocument` throws 404 NOT_PUBLISHED rather than returning null; same answer.
    return null;
  }
}

const stepsOf = (doc: Document) =>
  doc.phases.flatMap((phase) =>
    phase.steps.map((s) => ({
      phase: phase.label,
      key: s.key,
      num: s.num,
      title: s.title,
      actions: s.actions.map((a) => a.text),
      outcomes: s.outcomes.map((o) => ({ kind: o.kind, text: o.text, goto: o.goto ?? null })),
      branch: s.branch ?? null,
    })),
  );

export const readDocument = defineTool({
  name: 'read_document',
  description: 'קורא מסמך נוהל שלם: כותרת, סטטוס, עולמות, תגיות והשלבים עם הפעולות והתוצאות.',
  args: z.object({ documentId: Uuid }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    return {
      ok: true,
      summary: `קראתי את "${doc.title}"`,
      data: {
        id: doc.id,
        title: doc.title,
        status: doc.status,
        worlds: doc.worlds,
        tags: doc.tags,
        steps: stepsOf(doc),
      },
    };
  },
});

export const readTopic = defineTool({
  name: 'read_topic',
  description: 'מציג את המסמכים שתחת נושא מסוים, מקובצים לפי סוג מסמך.',
  args: z.object({ topicId: Uuid }),
  async run(ctx, args): Promise<ToolOutcome> {
    const view = await topicView(ctx.db, args.topicId, {
      unpublished: canReadUnpublished(ctx.user),
      worldScopes: ctx.user.worldScopes,
    });
    if (!view) return NOT_FOUND;
    return {
      ok: true,
      summary: `קראתי את הנושא "${view.topic.name}"`,
      data: {
        topic: view.topic.name,
        world: view.world.name,
        items: view.groups.flatMap((g) =>
          g.items.map((i) => ({
            docType: g.docType,
            id: i.id,
            title: i.title,
            description: i.description ?? '',
          })),
        ),
      },
    };
  },
});

export const searchKb = defineTool({
  name: 'search_kb',
  description: 'מחפש בבסיס הידע ומחזיר מסמכים ושלבים תואמים. השתמש בזה כשאינך יודע איזה מסמך רלוונטי.',
  args: z.object({ q: z.string().min(2).max(120), limit: z.number().int().min(1).max(10).optional() }),
  async run(ctx, args): Promise<ToolOutcome> {
    const res = await search(
      ctx.db,
      { q: args.q, limit: args.limit ?? 8, types: 'documents,steps' },
      null,
      ctx.user.worldScopes,
      canReadUnpublished(ctx.user),
    );
    const hits = res.groups.flatMap((g) =>
      g.hits.map((h) => ({
        type: h.type,
        id: h.id,
        title: h.title,
        snippet: h.snippet,
        documentId: h.documentId ?? null,
        stepKey: h.stepKey ?? null,
        num: h.num ?? null,
      })),
    );
    return { ok: true, summary: `חיפשתי "${args.q}" ומצאתי ${hits.length} תוצאות`, data: { hits } };
  },
});

export const explainStep = defineTool({
  name: 'explain_step',
  description: 'מסביר שלב אחד: הפעולות שלו, לאן כל תוצאה מובילה, ואילו שלבים מפנים אליו.',
  args: z.object({ documentId: Uuid, stepKey: z.string().min(1).max(200) }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    const all = stepsOf(doc);
    const step = all.find((s) => s.key === args.stepKey);
    if (!step) return { ok: false, summary: `לא נמצא שלב ${args.stepKey}` };
    const byKey = new Map(all.map((s) => [s.key, s]));
    return {
      ok: true,
      summary: `הסברתי את שלב ${step.num}`,
      data: {
        step,
        goesTo: step.outcomes
          .filter((o) => o.goto)
          .map((o) => ({ key: o.goto!, title: byKey.get(o.goto!)?.title ?? null, via: o.text })),
        comesFrom: all
          .filter((s) => s.outcomes.some((o) => o.goto === step.key))
          .map((s) => ({ key: s.key, num: s.num, title: s.title })),
      },
    };
  },
});

export const readSource = defineTool({
  name: 'read_source',
  description: 'קורא את מסמך המקור (הטקסט הגולמי) של מסמך, כולל מזהי הפסקאות לצורך הצעת עריכה.',
  args: z.object({ documentId: Uuid }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    const source = await getSourceDocument(ctx.db, doc.id);
    if (!source) return { ok: false, summary: 'למסמך זה אין מסמך מקור' };
    const budget = ctx.settings.limits.maxContextChars;
    return {
      ok: true,
      summary: `קראתי את מסמך המקור (גרסה ${source.version})`,
      data: {
        version: source.version,
        text: source.text.length > budget ? source.text.slice(0, budget) + '…' : source.text,
        paragraphs: htmlToParagraphs(source.html).map((p) => ({
          ref: p.ref,
          text: paragraphText(p),
        })),
      },
    };
  },
});

export const readImpact = defineTool({
  name: 'read_impact',
  description: 'מה שינוי במסמך הזה נוגע בו: מסמכים מקשרים, בלוקים משותפים, שדות CRM, נושאים ומסמכים קרובים.',
  args: z.object({ documentId: Uuid }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    const impact = await impactPort.impactOf(ctx.db, doc.id, ctx.user);
    return {
      ok: true,
      summary: `בדקתי השפעה: ${impact.documents.length} מסמכים, ${impact.blocks.length} בלוקים`,
      data: impact,
    };
  },
});

export const listSuggestions = defineTool({
  name: 'list_suggestions',
  description: 'רשימת הצעות הפייפליין למסמך או לגרסת מקור, כולל הסטטוס והתוכן שלהן.',
  args: z.object({
    documentId: Uuid.optional(),
    sourceRevisionId: Uuid.optional(),
    status: z.enum(['pending', 'accepted', 'rejected']).optional(),
  }),
  async run(ctx, args): Promise<ToolOutcome> {
    /**
     * A-I2: with neither argument this was "the 30 most recent suggestions on the instance".
     * The tool addresses one document or one revision; asking it to browse the whole queue is
     * what `GET /suggestions` is for, and that route has its own permission.
     */
    if (!args.documentId && !args.sourceRevisionId)
      return { ok: false, summary: 'צריך לציין מסמך או גרסת מקור כדי לרשום הצעות' };
    if (args.documentId && !(await visibleDocument(ctx, args.documentId))) return NOT_FOUND;
    /**
     * `suggestionVisibleSql` is the visibility rule for a suggestion nobody can see the target of:
     * a suggestion whose `target_document_id` is unpublished or out of scope is not listed, even
     * when the caller named the revision rather than the document — and a **null-target** row
     * (`new-card`, which carries a whole proposed document, and `field-alert`) is scoped through
     * its source's documents instead of skipping the check entirely (A-I2).
     */
    const r = await ctx.db.query(
      `select g.id, g.type, g.title, g.target_document_id, g.target_step_key, g.confidence, g.status,
              coalesce(g.edited_payload, g.payload) payload
         from suggestions g
        where ($1::uuid is null or g.target_document_id = $1)
          and ($2::uuid is null or g.source_revision_id = $2)
          and ($3::text is null or g.status = $3)
          and ${suggestionVisibleSql('g', '$4', canReadUnpublished(ctx.user))}
        order by g.created_at desc limit 30`,
      [
        args.documentId ?? null,
        args.sourceRevisionId ?? null,
        args.status ?? null,
        ctx.user.worldScopes ? [...ctx.user.worldScopes] : null,
      ],
    );
    const items = r.rows.map((x) => ({
      id: x.id as string,
      type: x.type as string,
      title: x.title as string,
      documentId: (x.target_document_id as string) ?? null,
      targetStepKey: (x.target_step_key as string) ?? null,
      confidence: Number(x.confidence),
      status: x.status as string,
      payload: x.payload,
    }));
    return { ok: true, summary: `מצאתי ${items.length} הצעות`, data: { items } };
  },
});

export const readEval = defineTool({
  name: 'read_eval',
  description: 'תוצאות ריצות ההערכה האחרונות של המודל (לאדמין בלבד).',
  args: z.object({ limit: z.number().int().min(1).max(20).optional() }),
  async run(ctx, args): Promise<ToolOutcome> {
    /**
     * `ai_eval_runs` is X1's table (0051). This lane must compile and run against a database
     * that does not have it yet, so the tool reports "no runs" rather than failing the turn.
     */
    const present = await ctx.db.query("select to_regclass('public.ai_eval_runs') t");
    if (!present.rows[0]?.t) return { ok: true, summary: 'אין עדיין ריצות הערכה', data: { items: [] } };
    const r = await ctx.db.query('select * from ai_eval_runs order by started_at desc limit $1', [
      args.limit ?? 5,
    ]);
    return { ok: true, summary: `${r.rowCount} ריצות הערכה`, data: { items: r.rows } };
  },
});
