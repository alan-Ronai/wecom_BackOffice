/**
 * Wave 5 (V1) — prompt builder and response parser for model-assisted quiz question generation.
 * Mirrors `prompt.ts`: a versioned system prompt file, a JSON-mode response format, and a zod
 * envelope that the caller validates before anything reaches the database. The api's rule-based
 * generator (`modules/learning/fallback.ts`) is the fallback; this module never falls back itself.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { GeneratedQuestion, QuestionContext } from './contract.js';

export const QUESTIONS_PROMPT_VERSION = 'questions-v1';
const promptPath = fileURLToPath(new URL(`../prompts/${QUESTIONS_PROMPT_VERSION}.md`, import.meta.url));
export const QUESTIONS_SYSTEM_PROMPT = readFileSync(promptPath, 'utf8');

const OptionSchema = z.object({ id: z.string().min(1), text: z.string().min(1), correct: z.boolean() });
export const GeneratedQuestionSchema = z
  .object({
    documentId: z.string().uuid(),
    stepKey: z.string().nullable(),
    stem: z.string().min(3),
    kind: z.enum(['single', 'multi', 'order', 'free']),
    options: z.array(OptionSchema),
    explanation: z.string().default(''),
    modelConf: z.number().min(0).max(1).nullable().default(null),
  })
  .refine((q) => q.kind !== 'single' || q.options.filter((o) => o.correct).length === 1, {
    message: 'single needs exactly one correct option',
  })
  .refine((q) => q.kind !== 'multi' || q.options.some((o) => o.correct), {
    message: 'multi needs a correct option',
  })
  .refine((q) => q.kind !== 'order' || (q.options.length >= 2 && q.options.every((o) => o.correct)), {
    message: 'order options must all be correct',
  });
const EnvelopeSchema = z.object({ questions: z.array(GeneratedQuestionSchema) });

/** JSON schema handed to Ollama's `format` so the model is constrained to our envelope. */
export const QUESTIONS_RESPONSE_FORMAT = {
  type: 'object',
  properties: { questions: { type: 'array', items: { type: 'object' } } },
  required: ['questions'],
} as const;

export function buildQuestionMessages(ctx: QuestionContext): { role: 'system' | 'user'; content: string }[] {
  return [
    { role: 'system', content: QUESTIONS_SYSTEM_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        perDocument: ctx.perDocument,
        documents: ctx.documents,
        seeds: ctx.seeds,
      }),
    },
  ];
}

export function parseQuestions(
  text: string,
): { ok: true; items: GeneratedQuestion[] } | { ok: false; error: string } {
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
  return { ok: true, items: r.data.questions };
}
