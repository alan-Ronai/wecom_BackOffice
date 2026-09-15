/**
 * Wave 6 (X2) — system prompt assembly for the chat, and the four second-call prompts the
 * proposal tools use.
 *
 * The prompt has a *budget* (`ai.limits.maxContextChars`, 24 000 by default) because the
 * target machine is a CPU-only 7B: everything appended is latency, and a prompt that overruns
 * the context window silently loses its head — which is where the rules are. So the assembler,
 * not the caller, decides what to drop, and it drops in one fixed order:
 *
 *   source text → the document's steps → the brief → the style rules
 *
 * The rules block itself is never truncatable. "You do not change documents yourself" is the
 * whole safety story of spec §1.3, and a rule that can be dropped by a long brief is not a rule.
 */
import {
  AI_TOOLS,
  type AiSettings,
  type AiToolName,
  type ConversationKind,
  type Document,
  type SendMessageContext,
} from '@wecom/shared';

/**
 * Headers that name a second model call. They are part of the prompt a real model reads, and
 * they are also how the scripted stand-in (`scripted.ts`) tells the four calls apart without
 * anything having to pass it out-of-band state.
 */
export const SECOND_CALL = {
  proposeSourceEdit: 'שכתוב פסקאות מקור',
  refineSuggestion: 'חידוד הצעה',
  reviewDocument: 'סקירת מסמך',
  draftStep: 'טיוטת שלב',
} as const;

/** The label the prompt prints in front of the conversation's document id. */
export const DOCUMENT_ID_LABEL = 'מזהה מסמך';
/** The label `withContext` prints in front of an open suggestion card's id. */
export const SUGGESTION_ID_LABEL = 'מזהה הצעה';

/** A `§ref`-headed block: how paragraphs travel to the model and back. */
export interface RefBlock {
  ref: string;
  text: string;
}

const REF_HEADER = /(^|\n)§([^\s\n]+)[ \t]*\n/g;

/**
 * Read `§ref`-headed blocks out of text — the prompt the rewrite tool sends *and* the reply it
 * gets back, which is why it lives here rather than in either.
 *
 * Deliberately scanning rather than splitting on blank lines: the prompt has a preamble and an
 * "הפסקאות:" header before the first block, a model reply may have prose around it, and a
 * paragraph may itself contain a blank line. Anything not under a `§` header is ignored.
 */
export function parseRefBlocks(text: string): RefBlock[] {
  const marks: { ref: string; markStart: number; bodyStart: number }[] = [];
  REF_HEADER.lastIndex = 0;
  for (let m = REF_HEADER.exec(text); m; m = REF_HEADER.exec(text))
    marks.push({ ref: m[2], markStart: m.index, bodyStart: m.index + m[0].length });
  return marks.map((mark, i) => ({
    ref: mark.ref,
    text: text.slice(mark.bodyStart, i + 1 < marks.length ? marks[i + 1].markStart : undefined).trim(),
  }));
}

/** The inverse of `parseRefBlocks`. */
export const renderRefBlocks = (blocks: readonly RefBlock[]): string =>
  blocks.map((b) => `§${b.ref}\n${b.text}`).join('\n\n');

const KIND_ROLE: Record<ConversationKind, string> = {
  article: 'אתה עונה לנציג שירות על מסמך אחד. אתה קורא בלבד — אינך מציע עריכות.',
  editor: 'אתה עוזר לעורך בתוך עורך המסמך: קריאה, בדיקת השפעה, והצעות עריכה לאישור.',
  workspace: 'אתה עוזר במרחב העבודה: חיפוש, קריאה, השוואה בין מסמכים והצעות לאישור.',
};

/**
 * Never truncated. Every line here is an invariant the rest of the lane enforces in code as
 * well — the prompt says it so the model does not fight the enforcement.
 */
const RULES = [
  'כללים:',
  '- אינך משנה מסמכים בעצמך. כל שינוי הוא הצעה שהמשתמש מאשר בלחיצה.',
  '- ענה בעברית בלבד, קצר ולעניין.',
  '- ציין את מספר השלב שעליו אתה מסתמך, למשל "לפי שלב 2".',
  '- אם הכלים לא החזירו מידע, אמור "לא יודע" ואל תמציא.',
  '- אל תצטט תוכן שלא קיבלת מכלי.',
].join('\n');

const stepsText = (document: Document): string =>
  document.phases
    .flatMap((ph) =>
      ph.steps.map((s) =>
        [
          `שלב ${s.num} (${s.key}): ${s.title}`,
          ...s.actions.map((a) => `  • ${a.text}`),
          ...s.outcomes.map((o) => `  ← ${o.text}${o.goto ? ` → ${o.goto}` : ''}`),
        ].join('\n'),
      ),
    )
    .join('\n');

const documentHeader = (document: Document): string =>
  [
    `${DOCUMENT_ID_LABEL}: ${document.id}`,
    `כותרת: ${document.title}`,
    `סטטוס: ${document.status}`,
    document.worlds?.length ? `עולמות: ${document.worlds.join(', ')}` : '',
    document.tags?.length ? `תגיות: ${document.tags.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

export interface SystemPromptInput {
  settings: AiSettings;
  kind: ConversationKind;
  document: Document | null;
  source: { version: number; text: string } | null;
  allowed: AiToolName[];
  budgetChars: number;
}

/** Below this there is no point appending a section at all — a stub confuses more than it helps. */
const MIN_SECTION_CHARS = 120;

export function buildSystemPrompt(input: SystemPromptInput): string {
  const labels = new Map(AI_TOOLS.map((t) => [t.name as string, t.label]));
  const fixed = [
    'אתה עוזר הידע הפנימי של מערכת הידע. אתה עובד מול מסמכי נהלים לנציגי שירות.',
    KIND_ROLE[input.kind],
    RULES,
    input.allowed.length
      ? 'כלים זמינים לך:\n' + input.allowed.map((n) => `- ${n} — ${labels.get(n) ?? n}`).join('\n')
      : 'אין לך כלים זמינים בשיחה זו; ענה מהידע שבהקשר בלבד.',
    input.document ? documentHeader(input.document) : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  // Lowest priority last: this is the drop order, read backwards.
  const optional: { header: string; body: string }[] = [
    { header: 'סגנון', body: input.settings.style.text },
    { header: 'רקע ארגוני', body: input.settings.brief.text },
    { header: 'שלבי המסמך', body: input.document ? stepsText(input.document) : '' },
    {
      header: 'מסמך המקור',
      body: input.source ? `גרסה ${input.source.version}\n${input.source.text}` : '',
    },
  ];

  let out = fixed.length > input.budgetChars ? fixed.slice(0, input.budgetChars) : fixed;
  for (const section of optional) {
    if (!section.body.trim()) continue;
    const prefix = `\n\n${section.header}:\n`;
    const left = input.budgetChars - out.length - prefix.length;
    if (left < MIN_SECTION_CHARS) continue;
    out += prefix + (section.body.length <= left ? section.body : section.body.slice(0, left - 1) + '…');
  }
  return out;
}

/**
 * The user's turn, plus the context the pane already knows. The ids are spelled out because the
 * model needs them to call a tool at all — `read_document` takes a `documentId`, and a model
 * that was never told one can only guess.
 */
export function withContext(content: string, context?: SendMessageContext): string {
  if (!context) return content;
  const lines = [
    context.stepKey ? `השלב הפתוח: ${context.stepKey}` : '',
    context.suggestionId ? `${SUGGESTION_ID_LABEL}: ${context.suggestionId}` : '',
    context.selection ? `הטקסט המסומן:\n${context.selection}` : '',
  ].filter(Boolean);
  return lines.length ? `${content}\n\n---\nהקשר:\n${lines.join('\n')}` : content;
}

/** The transcript browser needs a name; the first thing the user said is the honest one. */
export const titleFrom = (content: string): string => content.trim().replace(/\s+/g, ' ').slice(0, 60);
