import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { SuggestionPayloadSchema, SuggestionSchema, SuggestionTypeSchema } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';

/** Bump together with a new `prompts/<version>.md` file; stored on every run for reproducibility. */
export const PROMPT_VERSION = 'propose-v1';
const promptPath = fileURLToPath(new URL(`../prompts/${PROMPT_VERSION}.md`, import.meta.url));
export const SYSTEM_PROMPT = readFileSync(promptPath, 'utf8');

/** JSON schema handed to Ollama's `format` so the model is constrained to our envelope. */
export const RESPONSE_FORMAT = {
  type: 'object',
  properties: {
    suggestions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['anchor', 'type', 'title', 'payload', 'confidence', 'rationale'],
        properties: {
          anchor: { type: 'string' },
          type: { type: 'string', enum: SuggestionTypeSchema.options },
          title: { type: 'string' },
          targetDocumentId: { type: ['string', 'null'] },
          targetStepKey: { type: ['string', 'null'] },
          targetBlockId: { type: ['string', 'null'] },
          payload: { type: 'object' },
          confidence: { type: 'number' },
          rationale: { type: 'string' },
        },
      },
    },
  },
  required: ['suggestions'],
} as const;

const stripAnchor = (ref: string) => ref.replace(/^§/, '');

export function buildMessages(ctx: ProposalContext): { role: 'system' | 'user'; content: string }[] {
  const diffs = ctx.diffs
    .filter((d) => d.kind !== 'same')
    .map(
      (d) =>
        `- §${stripAnchor(d.ref)} ${d.kind}: לפני: ${JSON.stringify(d.before ?? '')} אחרי: ${JSON.stringify(d.after ?? '')}`,
    )
    .join('\n');
  const steps = ctx.linkedSteps
    .map(
      (s) =>
        `- anchor §${stripAnchor(s.anchor)}: documentId=${s.documentId} ("${s.documentTitle}") stepKey=${s.stepKey} מספר ${s.stepNum} "${s.stepTitle}"${s.blockId ? ` blockId=${s.blockId}` : ''} פעולות: ${JSON.stringify(s.actions)}`,
    )
    .join('\n');
  const blocks = ctx.blocks
    .map((b) => `- blockId=${b.id} "${b.title}" פעולות: ${JSON.stringify(b.actions)}`)
    .join('\n');
  const fields = ctx.fields.map((f) => `${f.name} (${f.status})`).join(', ');
  const user = [
    `מסמך מקור: ${ctx.source.title}`,
    '',
    'שינויים:',
    diffs || '- אין',
    '',
    'שלבים ממופים (linkedSteps):',
    steps || '- אין',
    '',
    'בלוקים משותפים:',
    blocks || '- אין',
    '',
    `שדות CRM מוכרים: ${fields || 'אין'}`,
    '',
    'החזר JSON בלבד.',
  ].join('\n');
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: user },
  ];
}

const ProposedSchema = SuggestionSchema.innerType()
  .omit({
    id: true,
    sourceRevisionId: true,
    status: true,
    createdAt: true,
    decidedBy: true,
    decidedAt: true,
    appliedVersionId: true,
    editedPayload: true,
  })
  .refine((s) => s.payload.type === s.type, { message: 'payload.type must equal type' });
const EnvelopeSchema = z.object({ suggestions: z.array(ProposedSchema) });

export function parseProposals(
  text: string,
): { ok: true; items: ProposedSuggestion[] } | { ok: false; error: string } {
  let json: unknown;
  try {
    json = JSON.parse(
      text
        .trim()
        .replace(/^```(?:json)?\s*/, '')
        .replace(/\s*```$/, ''),
    );
  } catch (e) {
    return { ok: false, error: 'invalid json: ' + (e as Error).message };
  }
  const r = EnvelopeSchema.safeParse(json);
  if (!r.success)
    return { ok: false, error: r.error.issues.map((i) => i.path.join('.') + ': ' + i.message).join('; ') };
  for (const s of r.data.suggestions) SuggestionPayloadSchema.parse(s.payload);
  return { ok: true, items: r.data.suggestions as ProposedSuggestion[] };
}
