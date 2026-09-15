import { describe, it, expect } from 'vitest';
import { AiSettingsSchema, type Document } from '@wecom/shared';
import { buildSystemPrompt, titleFrom, withContext } from '../../src/modules/ai/prompt.js';

const defaults = AiSettingsSchema.parse({ brief: {}, style: {}, models: {}, limits: {} });

const bigDoc: Document = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'no-browsing',
  title: 'אין גלישה',
  description: '',
  category: 'tech',
  wave: 1,
  priority: 'P1',
  kind: 'steps',
  status: 'published',
  currentVersion: 3,
  phases: [
    {
      id: 'p1',
      label: 'שלב 1',
      steps: [
        {
          key: 's1',
          num: '1',
          title: 'בדיקת חסימה',
          blockRefs: [],
          deps: [],
          actions: [{ id: 'a1', text: 'ג'.repeat(20_000) }],
          outcomes: [{ kind: 'ok', text: '✓ המשך', goto: 's2' }],
        },
      ],
    },
  ],
  related: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  tags: ['גלישה'],
  worlds: ['tech'],
  topics: [],
  sourceReviewNeeded: false,
};

describe('buildSystemPrompt', () => {
  it('keeps the system prompt inside the char budget and always includes brief, style and rules', () => {
    const p = buildSystemPrompt({
      settings: {
        ...defaults,
        brief: { text: 'א'.repeat(50_000), version: 1 },
        style: { text: 'קצר וענייני', version: 1 },
      },
      kind: 'editor',
      document: bigDoc,
      source: { version: 3, text: 'ב'.repeat(50_000) },
      allowed: ['read_document'],
      budgetChars: 24_000,
    });
    expect(p.length).toBeLessThanOrEqual(24_000);
    expect(p).toContain('סגנון'); // style header survives
    expect(p).toContain('אינך משנה מסמכים בעצמך'); // the never-write rule is not truncatable
    expect(p).toContain('רקע ארגוני');
    // Lowest priority is dropped first: the 50 000-char source cannot have survived.
    expect(p).not.toContain('ב'.repeat(2000));
  });

  it('article kind states the read-only role and cites step numbers', () => {
    const p = buildSystemPrompt({
      settings: defaults,
      kind: 'article',
      document: bigDoc,
      source: null,
      allowed: ['read_document', 'explain_step'],
      budgetChars: 24_000,
    });
    expect(p).toMatch(/ציין את מספר השלב/);
    expect(p).toMatch(/קורא בלבד/);
  });

  it('names the document id so the model can address a tool at it', () => {
    const p = buildSystemPrompt({
      settings: defaults,
      kind: 'editor',
      document: bigDoc,
      source: null,
      allowed: ['read_document'],
      budgetChars: 24_000,
    });
    expect(p).toContain(`מזהה מסמך: ${bigDoc.id}`);
    expect(p).toContain('read_document');
    // A tool the caller may not run is never named.
    expect(p).not.toContain('propose_source_edit');
  });

  it('survives a budget smaller than the fixed block', () => {
    const p = buildSystemPrompt({
      settings: defaults,
      kind: 'workspace',
      document: null,
      source: null,
      allowed: [],
      budgetChars: 200,
    });
    expect(p.length).toBeLessThanOrEqual(200);
  });
});

describe('withContext / titleFrom', () => {
  it('spells the ids out and leaves a bare message alone', () => {
    expect(withContext('שאלה')).toBe('שאלה');
    const c = withContext('שאלה', {
      stepKey: 's2',
      suggestionId: '22222222-2222-4222-8222-222222222222',
      selection: 'טקסט',
    });
    expect(c).toContain('השלב הפתוח: s2');
    expect(c).toContain('מזהה הצעה: 22222222-2222-4222-8222-222222222222');
    expect(c).toContain('טקסט');
  });

  it('titles a conversation from the first thing the user said', () => {
    expect(titleFrom('  מה   עושים כשאין גלישה?  ')).toBe('מה עושים כשאין גלישה?');
    expect(titleFrom('א'.repeat(200)).length).toBe(60);
  });
});
