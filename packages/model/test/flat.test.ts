import { describe, it, expect } from 'vitest';
import {
  buildMessages,
  candidatesOf,
  confidenceFor,
  DEFAULT_CHARS_PER_TOKEN,
  estimateTokens,
  flatResponseFormat,
  LEGACY_PROMPT_VERSION,
  numCtxFor,
  parseFlatProposals,
  parseProposals,
  promptTokenBudget,
  PROMPT_VERSION,
  repairHint,
  toFlatExample,
  RESPONSE_FORMAT,
} from '../src/index.js';
import type { ProposalContext, ProposedSuggestion } from '../src/index.js';

/**
 * The fix wave's default generation path (findings C-C1…C-C5, C-I2, C-I4, C-I7).
 *
 * The measured claim these pin is narrow but load-bearing: the grammar the model is handed names
 * every identifier as an enum of the ids in *this* context and requires all of them, the parse
 * drops a bad suggestion rather than the whole revision, and the confidence an editor sees is
 * the calibrated one rather than the 0.95 the model writes on everything.
 */
const D = '11111111-1111-4111-8111-111111111111';
const B = '44444444-4444-4444-8444-444444444444';

const ctx: ProposalContext = {
  source: { id: 'src', title: 'נהלי SIM' },
  paragraphs: [],
  diffs: [
    { ref: '2.3', kind: 'changed', before: 'המתן דקה.', after: 'המתן 90 שניות.', similarity: 0.7 },
  ],
  linkedSteps: [
    {
      documentId: D,
      documentTitle: 'אין קליטה',
      stepKey: 's3',
      stepNum: '3',
      stepTitle: 'ריענון SIM',
      anchor: '2.3',
      actions: ['בצע ריענון SIM', 'המתן דקה'],
      blockId: B,
    },
  ],
  fields: [{ name: 'sim block lbl', status: 'ok' }],
  blocks: [{ id: B, title: 'ריענון SIM', actions: ['בצע ריענון SIM', 'המתן דקה'] }],
};

const flat = (over: Record<string, unknown> = {}) => ({
  anchor: '§2.3',
  type: 'update-step',
  title: 'המתנה 90 שניות',
  targetDocumentId: D,
  targetStepKey: 's3',
  targetBlockId: '',
  actions: ['המתן 90 שניות'],
  rationale: 'הסף שונה',
  ...over,
});
const answer = (...items: Record<string, unknown>[]) => JSON.stringify({ suggestions: items });

/** One accepted suggestion in the stored (nested) shape, as `fewshot.ts` hands it over. */
const accepted: ProposedSuggestion = {
  anchor: '§2.3',
  type: 'update-block',
  title: 'ריענון SIM: המתנה 90 שניות',
  targetDocumentId: D,
  targetStepKey: 's3',
  targetBlockId: B,
  payload: { type: 'update-block', actions: [{ id: 'b1', text: 'המתן 90 שניות' }] },
  confidence: 0.9,
  rationale: 'הבלוק משותף',
};

describe('the flat response format (C-C1, C-C2, C-C3)', () => {
  const schema = flatResponseFormat(ctx) as {
    properties: { suggestions: { items: Record<string, never> } };
  };
  const item = schema.properties.suggestions.items as unknown as {
    required: string[];
    additionalProperties: boolean;
    properties: Record<string, { enum?: string[] }>;
  };

  it('requires all three target fields rather than leaving them skippable', () => {
    for (const f of ['targetDocumentId', 'targetStepKey', 'targetBlockId', 'actions'])
      expect(item.required).toContain(f);
  });

  it('bounds every identifier to the ids this context actually contains, plus ""', () => {
    expect(item.properties.targetDocumentId.enum).toEqual([D, '']);
    expect(item.properties.targetStepKey.enum).toEqual(['s3', '']);
    expect(item.properties.targetBlockId.enum).toEqual([B, '']);
    expect(item.properties.fieldName.enum).toEqual(['sim block lbl', '']);
  });

  it('forbids fields the grammar did not name (C-M4)', () => {
    expect(item.additionalProperties).toBe(false);
  });

  it('derives its candidate lists from linkedSteps and blocks', () => {
    expect(candidatesOf(ctx)).toEqual({
      documentIds: [D],
      stepKeys: ['s3'],
      blockIds: [B],
      fieldNames: ['sim block lbl'],
    });
  });
});

describe('parseFlatProposals', () => {
  it('re-inflates the discriminated union the grammar cannot express', () => {
    const r = parseFlatProposals(ctx, answer(flat()));
    expect(r.ok && r.items[0].payload).toEqual({
      type: 'update-step',
      addActions: ['המתן 90 שניות'],
      patch: {},
    });
  });

  it('drops one bad suggestion instead of failing the whole revision (C-C4)', () => {
    const r = parseFlatProposals(ctx, answer(flat(), flat({ type: 'not-a-type' })));
    expect(r.ok && r.items).toHaveLength(1);
    expect(r.ok && r.errors).toHaveLength(1);
  });

  it('refuses an id the model invented even though the grammar allowed it', () => {
    const r = parseFlatProposals(
      ctx,
      answer(flat({ targetDocumentId: '99999999-9999-4999-8999-999999999999' })),
    );
    expect(r.ok).toBe(false);
  });

  it('routes confidence through the calibration table, not the model (C-I2)', () => {
    const r = parseFlatProposals(ctx, answer(flat({ confidence: 0.99 })));
    expect(r.ok && r.items[0].confidence).toBe(confidenceFor('update-step'));
  });

  it('names the missing field so the retry can quote it in Hebrew (C-I7)', () => {
    const r = parseFlatProposals(ctx, answer(flat({ targetStepKey: '' })));
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain('targetStepKey');
    expect(repairHint(!r.ok ? r.error : '')).toContain('מפתח השלב');
  });
});

describe('the context budget is in tokens (C-I4)', () => {
  it('estimates at the measured Hebrew+JSON ratio', () => {
    expect(DEFAULT_CHARS_PER_TOKEN).toBe(2.6);
    expect(estimateTokens('א'.repeat(260))).toBe(100);
  });

  it('converts a char limit rather than comparing chars to a token window', () => {
    expect(promptTokenBudget({ ...ctx, maxContextChars: 26_000 })).toBe(10_000);
    expect(promptTokenBudget({ ...ctx, maxContextChars: 26_000, maxContextTokens: 4000 })).toBe(4000);
  });

  it('sizes num_ctx from the budget and never below the 8k floor', () => {
    expect(numCtxFor({ ...ctx, maxContextTokens: 1000 })).toBe(8192);
    expect(numCtxFor({ ...ctx, maxContextTokens: 12_000 })).toBe(14_336);
  });

  it('drops examples before impact, and never the diffs', () => {
    const big = 'א'.repeat(6000);
    const [, msg] = buildMessages({
      ...ctx,
      impact: { documents: [{ id: 'X', title: 'ניתוקים חוזרים', why: 'w' }], blocks: [], fields: [], topics: [], related: [] },
      examples: [{ diff: big, suggestion: accepted }],
      maxContextTokens: 2200,
    });
    expect(msg.content).not.toContain('דוגמאות מאושרות');
    expect(msg.content).toContain('§2.3');
  });
});

describe('few-shot examples are rendered in the answer shape (C-I3)', () => {
  it('flattens a stored nested payload into the flat shape the model answers in', () => {
    expect(toFlatExample(accepted)).toEqual({
      anchor: '§2.3',
      type: 'update-block',
      title: 'ריענון SIM: המתנה 90 שניות',
      targetDocumentId: D,
      targetStepKey: 's3',
      targetBlockId: B,
      actions: ['המתן 90 שניות'],
      rationale: 'הבלוק משותף',
    });
  });

  it('shows the flat shape on v4 and the stored envelope on the legacy path', () => {
    const withExample = { ...ctx, examples: [{ diff: '§2.3 changed', suggestion: accepted }] };
    expect(buildMessages(withExample)[1].content).not.toContain('"payload"');
    expect(buildMessages(withExample, { version: LEGACY_PROMPT_VERSION })[1].content).toContain('"payload"');
  });
});

describe('the legacy envelope path is still reachable', () => {
  it('keeps propose-v4 as the default and propose-v3 as the named legacy version', () => {
    expect(PROMPT_VERSION).toBe('propose-v4');
    expect(LEGACY_PROMPT_VERSION).toBe('propose-v3');
    expect(buildMessages(ctx)[0].content).not.toContain('ארכיטקטורת הידע');
    expect(buildMessages(ctx, { version: LEGACY_PROMPT_VERSION })[0].content).toContain('ארכיטקטורת הידע');
  });

  it('still parses an envelope answer, and reports rather than throws on a bad payload (C-M1)', () => {
    const ok = parseProposals(
      JSON.stringify({
        suggestions: [
          {
            anchor: '§2.3',
            type: 'update-step',
            title: 't',
            targetDocumentId: D,
            targetStepKey: 's3',
            targetBlockId: null,
            payload: { type: 'update-step', addActions: ['x'], patch: {} },
            confidence: 0.9,
            rationale: 'r',
          },
        ],
      }),
    );
    expect(ok.ok).toBe(true);
    expect(RESPONSE_FORMAT.required).toEqual(['suggestions']);
    expect(() => parseProposals('{"suggestions":[{}]}')).not.toThrow();
  });
});
