/**
 * Wave 6 (X2) — the proposal tools.
 *
 * None of them writes. `propose_source_edit` returns hunks the user decides on
 * (`POST /ai/proposed-edits/:id/decide`), `refine_suggestion` returns a payload the user still
 * has to accept through the existing `PUT /suggestions/:id/edit`, and `review_document` /
 * `draft_step` return text and a step the editor dock offers to insert. That is owner decision
 * §1.3, and it is enforced by there being no write in this file at all.
 *
 * Each one runs a **second** model call — tool-less, so it cannot recurse — and validates what
 * comes back before anything reaches the user: a `SuggestionPayload` of the wrong type, a step
 * that fails `StepSchema`, or a rewrite that lost its `§ref` prefixes all fail closed.
 */
import { z } from 'zod';
import {
  htmlToParagraphs,
  paragraphText,
  StepSchema,
  SuggestionPayloadSchema,
  type Paragraph,
  type SuggestionPayload,
} from '@wecom/shared';
import type { ChatMessage } from '@wecom/model';
import { getSourceDocument } from '../../sourcedocs/repo.js';
import { diffToOps } from '../proposedEdits.js';
import { SECOND_CALL } from '../prompt.js';
import { defineTool, NOT_FOUND, type ToolCtx, type ToolOutcome } from './registry.js';
import { visibleDocument } from './read.js';

const Uuid = z.string().uuid();
const Instruction = z.string().min(1).max(2000);

const NO_MODEL: ToolOutcome = { ok: false, summary: 'מודל הצ׳אט אינו זמין כרגע' };

/** One tool-less call. `tools: []` is deliberate: a second call must not start its own loop. */
async function ask(ctx: ToolCtx, header: string, rules: string, user: string): Promise<string | null> {
  if (!ctx.model?.chat) return null;
  const messages: ChatMessage[] = [
    { role: 'system', content: `${header}\n${rules}` },
    { role: 'user', content: user },
  ];
  const r = await ctx.model.chat({ messages, tools: [] });
  return r.content;
}

/** The first balanced-looking JSON object or array in a reply, fences and prose stripped. */
function extractJson(text: string): unknown {
  const body = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
  const start = Math.min(
    ...[body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0).concat(Number.MAX_SAFE_INTEGER),
  );
  if (start === Number.MAX_SAFE_INTEGER) return null;
  const end = Math.max(body.lastIndexOf('}'), body.lastIndexOf(']'));
  if (end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** `§ref` + text blocks, the form `propose_source_edit` asks for and `diffToOps` reads back. */
export function parseParagraphBlocks(text: string): { ref: string; text: string }[] {
  const out: { ref: string; text: string }[] = [];
  for (const block of text.split(/\n\s*\n/)) {
    const m = /^\s*§([^\s\n]+)[ \t]*\n([\s\S]*)$/.exec(block);
    if (m) out.push({ ref: m[1], text: m[2].trim() });
  }
  return out;
}

/** Paragraphs as `§ref\ntext`, addressed ones kept whole and the rest dropped once over budget. */
function renderParagraphs(
  paragraphs: readonly Paragraph[],
  budget: number,
  addressed?: readonly string[],
): string {
  const wanted = addressed?.length ? paragraphs.filter((p) => addressed.includes(p.ref)) : paragraphs;
  const out: string[] = [];
  let used = 0;
  for (const p of wanted) {
    const block = `§${p.ref}\n${paragraphText(p)}`;
    if (used + block.length > budget) break;
    out.push(block);
    used += block.length + 2;
  }
  return out.join('\n\n');
}

export const proposeSourceEdit = defineTool({
  name: 'propose_source_edit',
  description:
    'מציע עריכה למסמך המקור לפי הנחיה. מחזיר הצעה בלבד — המשתמש הוא שמאשר אותה. אל תשתמש בזה כדי "לבצע" שינוי.',
  args: z.object({
    documentId: Uuid,
    instruction: Instruction,
    scope: z.object({ paragraphRefs: z.array(z.string().min(1)).max(50).optional() }).optional(),
  }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    const source = await getSourceDocument(ctx.db, doc.id);
    if (!source) return { ok: false, summary: 'למסמך זה אין מסמך מקור לערוך' };
    if (!ctx.model?.chat) return NO_MODEL;

    const current = htmlToParagraphs(source.html);
    const refs = args.scope?.paragraphRefs?.filter((r) => current.some((p) => p.ref === r));
    const reply = await ask(
      ctx,
      SECOND_CALL.proposeSourceEdit,
      [
        'קיבלת פסקאות מסומנות ב-§מזהה. החזר את אותן הפסקאות בדיוק באותו פורמט, עם המזהה שלהן, אחרי שיישמת את ההנחיה.',
        'אל תוסיף הסברים, כותרות או טקסט מחוץ לפסקאות. פסקה שלא צריכה שינוי — החזר אותה כמות שהיא.',
        'פסקה חדשה: תן לה מזהה §new-1, §new-2 והצב אותה אחרי הפסקה שהיא שייכת לה.',
      ].join('\n'),
      `הנחיה: ${args.instruction}\n\nהפסקאות:\n${renderParagraphs(current, ctx.settings.limits.maxContextChars, refs)}`,
    );
    if (!reply) return NO_MODEL;
    const proposed = parseParagraphBlocks(reply);
    if (!proposed.length) return { ok: false, summary: 'המודל לא החזיר פסקאות בפורמט הנדרש' };

    const ops = diffToOps(current, proposed, refs);
    if (!ops.length)
      return { ok: true, summary: 'לא נדרש שינוי במסמך המקור', data: { ops: [], version: source.version } };
    return {
      ok: true,
      summary: `הצעתי ${ops.length} שינויים במסמך המקור — צריך את אישורך`,
      data: { ops, version: source.version },
      proposedEdits: ops,
    };
  },
});

export const refineSuggestion = defineTool({
  name: 'refine_suggestion',
  description: 'משכתב הצעת פייפליין קיימת לפי הנחיה, ומחזיר תוכן מוצע מאותו סוג. המשתמש עדיין מאשר.',
  args: z.object({ suggestionId: Uuid, instruction: Instruction }),
  async run(ctx, args): Promise<ToolOutcome> {
    const r = await ctx.db.query(
      'select id, type, title, target_document_id, coalesce(edited_payload, payload) payload from suggestions where id=$1',
      [args.suggestionId],
    );
    if (!r.rowCount) return NOT_FOUND;
    const row = r.rows[0] as {
      type: string;
      title: string;
      target_document_id: string | null;
      payload: SuggestionPayload;
    };
    if (row.target_document_id && !(await visibleDocument(ctx, row.target_document_id)))
      return NOT_FOUND;
    if (!ctx.model?.chat) return NO_MODEL;

    const reply = await ask(
      ctx,
      SECOND_CALL.refineSuggestion,
      [
        `החזר JSON תקין בלבד של ההצעה המשוכתבת, מאותו סוג בדיוק: "type": "${row.type}".`,
        'אל תשנה את שדה type ואל תוסיף טקסט מחוץ ל-JSON.',
      ].join('\n'),
      `הנחיה: ${args.instruction}\n\nההצעה הנוכחית (${row.title}):\n${JSON.stringify(row.payload)}`,
    );
    if (!reply) return NO_MODEL;
    const parsed = SuggestionPayloadSchema.safeParse(extractJson(reply));
    if (!parsed.success) return { ok: false, summary: 'המודל החזיר תוכן שאינו הצעה תקינה' };
    // A refinement that changed the *type* is a different suggestion, not a refinement.
    if (parsed.data.type !== row.type)
      return { ok: false, summary: `סוג ההצעה השתנה (${parsed.data.type} במקום ${row.type})` };
    return {
      ok: true,
      summary: 'חידדתי את ההצעה — צריך את אישורך',
      data: { suggestionId: args.suggestionId, editedPayload: parsed.data },
      refined: { suggestionId: args.suggestionId, editedPayload: parsed.data },
    };
  },
});

const FindingsSchema = z.object({
  findings: z
    .array(
      z.object({
        severity: z.enum(['high', 'medium', 'low']),
        stepKey: z.string().nullable().default(null),
        text: z.string().min(1).max(600),
      }),
    )
    .default([]),
});

export const reviewDocument = defineTool({
  name: 'review_document',
  description: 'סוקר מסמך ומחזיר ממצאים לשיפור (בהירות, שלמות, עקביות). ממצאים בלבד — לא שינויים.',
  args: z.object({
    documentId: Uuid,
    focus: z.enum(['clarity', 'completeness', 'consistency', 'all']).optional(),
  }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    if (!ctx.model?.chat) return NO_MODEL;
    const steps = doc.phases
      .flatMap((p) => p.steps)
      .map((s) => `${s.key} · שלב ${s.num}: ${s.title}\n${s.actions.map((a) => '  • ' + a.text).join('\n')}`)
      .join('\n')
      .slice(0, ctx.settings.limits.maxContextChars);
    const reply = await ask(
      ctx,
      SECOND_CALL.reviewDocument,
      'החזר JSON תקין בלבד בצורה {"findings":[{"severity":"high|medium|low","stepKey":"s1|null","text":"…"}]}. עד 12 ממצאים.',
      `מיקוד: ${args.focus ?? 'all'}\nמסמך: ${doc.title}\n${steps}`,
    );
    if (!reply) return NO_MODEL;
    const parsed = FindingsSchema.safeParse(extractJson(reply));
    if (!parsed.success) return { ok: false, summary: 'המודל לא החזיר ממצאים תקינים' };
    const findings = parsed.data.findings.slice(0, 12);
    return { ok: true, summary: `סקרתי את המסמך: ${findings.length} ממצאים`, data: { findings } };
  },
});

export const draftStep = defineTool({
  name: 'draft_step',
  description: 'מנסח טיוטת שלב חדש למסמך. הטיוטה חוזרת לעורך להוספה ידנית — היא אינה נשמרת.',
  args: z.object({
    documentId: Uuid,
    afterStepKey: z.string().max(200).nullable().optional(),
    instruction: Instruction,
  }),
  async run(ctx, args): Promise<ToolOutcome> {
    const doc = await visibleDocument(ctx, args.documentId);
    if (!doc) return NOT_FOUND;
    if (!ctx.model?.chat) return NO_MODEL;
    const existing = doc.phases.flatMap((p) => p.steps);
    const reply = await ask(
      ctx,
      SECOND_CALL.draftStep,
      'החזר JSON תקין בלבד של שלב אחד: {"num":"…","title":"…","actions":[{"id":"a1","text":"…"}],"outcomes":[{"kind":"ok","text":"…"}]}. בלי שדה key.',
      [
        `הנחיה: ${args.instruction}`,
        args.afterStepKey ? `השלב החדש בא אחרי ${args.afterStepKey}` : '',
        `מסמך: ${doc.title}`,
        existing
          .map((s) => `${s.key} · שלב ${s.num}: ${s.title}`)
          .join('\n')
          .slice(0, ctx.settings.limits.maxContextChars),
      ]
        .filter(Boolean)
        .join('\n'),
    );
    if (!reply) return NO_MODEL;
    const raw = extractJson(reply);
    if (!raw || typeof raw !== 'object') return { ok: false, summary: 'המודל לא החזיר שלב תקין' };
    /**
     * The key is the server's, never the model's: `draft-<n>` cannot collide with a real step
     * key, so a draft that reaches the editor dock can never be mistaken for an existing step.
     */
    const draftNumber = existing.filter((s) => s.key.startsWith('draft-')).length + 1;
    const parsed = StepSchema.safeParse({
      ...(raw as Record<string, unknown>),
      key: `draft-${draftNumber}`,
      num: String((raw as { num?: unknown }).num ?? draftNumber),
    });
    if (!parsed.success) return { ok: false, summary: 'המודל לא החזיר שלב תקין' };
    return {
      ok: true,
      summary: `ניסחתי טיוטת שלב: ${parsed.data.title}`,
      data: { step: parsed.data, afterStepKey: args.afterStepKey ?? null },
    };
  },
});
