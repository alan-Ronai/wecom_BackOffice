import { describe, it, expect } from 'vitest';
import { buildMessages, LEGACY_PROMPT_VERSION, renderArchitecture } from '../src/index.js';
import type { ProposalContext } from '../src/index.js';

/**
 * Wave 6 (X1), spec §1.7. v3's contract with the api: the system message is assembled from the
 * admin's brief, the architecture and the house style, and everything optional in the user
 * message is dropped in a fixed order when the context budget is exceeded.
 *
 * Fix wave: v3 is no longer the default (`propose-v4` is — see `prompt-v4.test.ts`), so every
 * call here pins the version. The path stays pinned because it is the control arm of the A/B and
 * `OllamaOptions.legacyEnvelope` still selects it.
 */
const v3 = { version: LEGACY_PROMPT_VERSION };
const base: ProposalContext = {
  source: { id: 's', title: 'נהלי SIM' },
  diffs: [{ ref: '4.8', kind: 'changed', before: 'מעל 5 מגה', after: 'מעל 6 מגה', similarity: 0.9 }],
  paragraphs: [],
  linkedSteps: [
    {
      documentId: 'D',
      documentTitle: 'איטיות',
      stepKey: 's8',
      stepNum: '8',
      stepTitle: 'בדיקת מהירות',
      anchor: '4.8',
      actions: ['הרץ Speedtest'],
    },
  ],
  fields: [],
  blocks: [],
};

describe('prompt v3 (legacy, still reachable)', () => {
  it('is versioned v3 and injects brief, architecture and style into the system message', () => {
    expect(LEGACY_PROMPT_VERSION).toBe('propose-v3');
    const [sys, user] = buildMessages({ ...base, brief: 'wecom היא חברת סלולר', style: 'פעולה אחת בשורה' }, v3);
    expect(sys.role).toBe('system');
    expect(sys.content.indexOf('wecom היא חברת סלולר')).toBeLessThan(sys.content.indexOf('ארכיטקטורת הידע'));
    expect(sys.content).toContain('פעולה אחת בשורה');
    expect(sys.content).toContain(renderArchitecture().slice(0, 40));
    // The task rules stay last, and the JSON envelope is unchanged.
    expect(sys.content.indexOf('ארכיטקטורת הידע')).toBeLessThan(sys.content.indexOf('כללים:'));
    expect(user.content).toContain('§4.8');
  });

  it('omits the brief and style blocks entirely when nothing is configured', () => {
    const [sys] = buildMessages(base, v3);
    expect(sys.content).not.toContain('סגנון הבית:');
    expect(sys.content).toContain('ארכיטקטורת הידע');
  });

  it('renders impact and examples in the user message, within budget', () => {
    const [, user] = buildMessages({
      ...base,
      impact: {
        documents: [{ id: 'X', title: 'ניתוקים', why: 'קישור' }],
        blocks: [{ id: 'B', title: 'ריענון SIM', usedBy: 3 }],
        fields: [],
        topics: [],
        related: [],
      },
      examples: [
        {
          diff: '§2 changed: 3 → 4',
          suggestion: {
            anchor: '§2',
            type: 'update-step',
            title: 'ת',
            targetDocumentId: 'D',
            targetStepKey: 's2',
            targetBlockId: null,
            payload: { type: 'update-step', addActions: ['x'], patch: {} },
            confidence: 0.9,
            rationale: 'r',
          },
        },
      ],
      maxContextChars: 6000,
    }, v3);
    expect(user.content).toContain('השפעה');
    expect(user.content).toContain('ריענון SIM');
    expect(user.content).toContain('דוגמאות מאושרות');
    expect(user.content.length).toBeLessThan(6000);
  });

  it('drops examples before impact, and impact before diffs, when over budget', () => {
    const big = 'א'.repeat(3000);
    const ctx: ProposalContext = {
      ...base,
      brief: big,
      impact: {
        documents: [{ id: 'X', title: big, why: 'w' }],
        blocks: [],
        fields: [],
        topics: [],
        related: [],
      },
      examples: [
        {
          diff: big,
          suggestion: {
            anchor: '§1',
            type: 'deprecate-step',
            title: 't',
            targetDocumentId: 'D',
            targetStepKey: 's1',
            targetBlockId: null,
            payload: { type: 'deprecate-step', reason: 'x' },
            confidence: 0.5,
            rationale: '',
          },
        },
      ],
      maxContextChars: 4000,
    };
    const [, user] = buildMessages(ctx, v3);
    expect(user.content).not.toContain('דוגמאות מאושרות');
    expect(user.content).toContain('§4.8'); // diffs always survive
    // Impact is dropped too once even it does not fit beside the brief.
    expect(user.content).not.toContain('השפעה (impact)');
  });
});
