import { describe, it, expect } from 'vitest';
import {
  AI_SETTINGS_KEYS,
  AI_TOOLS,
  AiSettingsSchema,
  AiSettingVersionSchema,
  AiSettingVersionsResponseSchema,
  AiToolNameSchema,
  ChatEventSchema,
  ConversationSchema,
  CreateConversationBodySchema,
  DecideProposedEditsBodySchema,
  EvalRunSchema,
  JobQueuedSchema,
  MODEL_TIER_PRESETS,
  ModelTestResultSchema,
  ProposedEditsSchema,
  SendMessageBodySchema,
  toolsFor,
  type AiSettings,
  type AiToolName,
  type ChatEvent,
  type ConversationKind,
  type ProposedEdits,
} from '../src/index.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const now = new Date().toISOString();

describe('wave 6 chat events', () => {
  it('parses every event type', () => {
    const events: ChatEvent[] = [
      { type: 'token', text: 'שלום' },
      { type: 'tool_call', id: 'c1', name: 'read_document', args: { documentId: id } },
      { type: 'tool_result', id: 'c1', ok: true, summary: 'נקרא מסמך אחד' },
      {
        type: 'proposed_edits',
        proposedEditsId: id,
        documentId: other,
        baseSourceVersion: 4,
        ops: [{ id: 'op1', anchor: '4.8', kind: 'replace', before: 'א', after: 'ב' }],
      },
      { type: 'refined_suggestion', suggestionId: id, editedPayload: { type: 'deprecate-step' } },
      { type: 'done', messageId: id, tokensIn: 10, tokensOut: 20, latencyMs: 1200 },
      { type: 'error', code: 'AI_RATE_LIMITED', message: 'יותר מדי בקשות' },
    ];
    for (const e of events) expect(ChatEventSchema.parse(e).type).toBe(e.type);
    expect(() => ChatEventSchema.parse({ type: 'bogus' })).toThrow();
  });
  it('defaults tool-call args and tool-result summary', () => {
    const e = ChatEventSchema.parse({ type: 'tool_call', id: 'c1', name: 'search_kb' });
    expect(e).toMatchObject({ type: 'tool_call', args: {} });
    expect(ChatEventSchema.parse({ type: 'tool_result', id: 'c1', ok: false })).toMatchObject({
      summary: '',
    });
  });
});

describe('wave 6 tool sets', () => {
  it('gives ai.ask exactly the four read-only tools', () => {
    expect(toolsFor(new Set(['ai.ask']))).toEqual([
      'read_document',
      'read_topic',
      'search_kb',
      'explain_step',
    ]);
  });
  it('ai.chat adds the seven editor tools', () => {
    const tools = toolsFor(new Set(['ai.ask', 'ai.chat']));
    expect(tools).toHaveLength(11);
    expect(tools).toEqual(
      expect.arrayContaining([
        'read_source',
        'read_impact',
        'list_suggestions',
        'propose_source_edit',
        'refine_suggestion',
        'review_document',
        'draft_step',
      ]),
    );
    expect(tools).not.toContain('read_eval');
    // The tiers nest, so ai.chat on its own is still the full editor set.
    expect(toolsFor(new Set(['ai.chat']))).toEqual(tools);
  });
  it('ai.manage adds read_eval and nothing else', () => {
    const tools = toolsFor(new Set(['ai.ask', 'ai.chat', 'ai.manage']));
    expect(tools).toHaveLength(12);
    expect(tools.at(-1)).toBe('read_eval');
  });
  it('no permission is no tools, and no tool writes on its own', () => {
    expect(toolsFor(new Set())).toEqual([]);
    expect(AI_TOOLS.filter((t) => t.writes)).toEqual([]);
  });
  it('AiToolNameSchema covers the catalogue', () => {
    for (const t of AI_TOOLS) expect(AiToolNameSchema.parse(t.name)).toBe(t.name);
    expect(() => AiToolNameSchema.parse('rm_rf')).toThrow();
    const n: AiToolName = 'propose_source_edit';
    expect(n).toBe('propose_source_edit');
  });
});

describe('wave 6 AI settings and tiers', () => {
  it('parses an empty object into the documented defaults', () => {
    const s: AiSettings = AiSettingsSchema.parse({});
    expect(s.limits).toEqual({ chatPerUserPerHour: 60, maxContextChars: 24000 });
    expect(s.brief).toEqual({ text: '', version: 0 });
    expect(s.style).toEqual({ text: '', version: 0 });
    expect(s.models).toEqual({
      tier: 1,
      suggestModel: MODEL_TIER_PRESETS[1].suggestModel,
      chatModel: MODEL_TIER_PRESETS[1].chatModel,
      embedModel: 'bge-m3',
      embedDimension: 1024,
    });
  });
  it('keeps the four settings keys', () => {
    expect([...AI_SETTINGS_KEYS]).toEqual(['ai.brief', 'ai.style', 'ai.models', 'ai.limits']);
  });
  it('tier 1 is the multilingual embedder at 1024 dimensions; tier 0 is today', () => {
    expect(MODEL_TIER_PRESETS[1].embedDimension).toBe(1024);
    expect(MODEL_TIER_PRESETS[1].embedModel).toBe('bge-m3');
    expect(MODEL_TIER_PRESETS[0]).toMatchObject({
      suggestModel: 'qwen2.5:3b-instruct-q4_K_M',
      embedModel: 'nomic-embed-text',
      embedDimension: 768,
    });
    for (const tier of [0, 1, 2, 3, 4] as const)
      expect(MODEL_TIER_PRESETS[tier].tier, String(tier)).toBe(tier);
  });
  it('names the author of a settings version and envelopes a queued job', () => {
    const v = AiSettingVersionSchema.parse({
      key: 'ai.brief',
      version: 2,
      value: { text: 'רונאי' },
      updatedBy: null,
      updatedAt: now,
    });
    expect(v.updatedByName).toBeNull();
    expect(AiSettingVersionsResponseSchema.parse({ items: [v] }).items).toHaveLength(1);
    expect(JobQueuedSchema.parse({ queued: true, jobId: null })).toEqual({ queued: true, jobId: null });
    expect(() => JobQueuedSchema.parse({ queued: false, jobId: null })).toThrow();
  });
  it('validates a model test result', () => {
    expect(
      ModelTestResultSchema.parse({ slot: 'embed', tag: 'bge-m3', reachable: true, dims: 1024 }).dims,
    ).toBe(1024);
    expect(() => ModelTestResultSchema.parse({ slot: 'bogus', tag: 'x', reachable: true })).toThrow();
  });
});

describe('wave 6 conversations and proposed edits', () => {
  it('parses a conversation and its create body', () => {
    const kind: ConversationKind = 'workspace';
    const c = ConversationSchema.parse({
      id,
      kind,
      userId: other,
      createdAt: now,
      updatedAt: now,
    });
    expect(c).toMatchObject({
      documentId: null,
      documentTitle: null,
      sourceRevisionId: null,
      userName: '',
      title: '',
      messageCount: 0,
    });
    expect(CreateConversationBodySchema.parse({ kind: 'article', documentId: id }).kind).toBe('article');
    expect(() => CreateConversationBodySchema.parse({ kind: 'sidebar' })).toThrow();
  });
  it('caps message content and selection', () => {
    expect(SendMessageBodySchema.parse({ content: 'מה השתנה?' }).context).toBeUndefined();
    expect(() => SendMessageBodySchema.parse({ content: '' })).toThrow();
    expect(() => SendMessageBodySchema.parse({ content: 'x'.repeat(8001) })).toThrow();
    expect(() =>
      SendMessageBodySchema.parse({ content: 'x', context: { selection: 'y'.repeat(4001) } }),
    ).toThrow();
  });
  it('accepts both "all" and id arrays for a decision', () => {
    expect(DecideProposedEditsBodySchema.parse({ accept: 'all' })).toEqual({
      accept: 'all',
      reject: [],
    });
    expect(DecideProposedEditsBodySchema.parse({ accept: ['op1'], reject: ['op2'] }).accept).toEqual(['op1']);
    expect(DecideProposedEditsBodySchema.parse({})).toEqual({ accept: [], reject: [] });
    expect(() => DecideProposedEditsBodySchema.parse({ accept: 'some' })).toThrow();
  });
  it('parses a proposed-edit set', () => {
    const p: ProposedEdits = ProposedEditsSchema.parse({
      id,
      messageId: other,
      documentId: id,
      baseSourceVersion: 3,
      ops: [{ id: 'op1', anchor: 'A12', kind: 'insert', before: '', after: 'שורה חדשה' }],
      status: 'proposed',
    });
    expect(p.ops[0]?.kind).toBe('insert');
    expect(() => ProposedEditsSchema.parse({ ...p, status: 'applied' })).toThrow();
  });
});

describe('wave 6 eval', () => {
  it('parses a run with its scores', () => {
    const r = EvalRunSchema.parse({
      id,
      model: MODEL_TIER_PRESETS[1].suggestModel,
      promptVersion: 'v3.1.2',
      embedModel: 'bge-m3',
      startedAt: now,
      cases: 12,
      hitTarget: 0.75,
    });
    expect(r).toMatchObject({ finishedAt: null, hitType: 0, contentOverlap: 0, notes: '' });
    expect(() => EvalRunSchema.parse({ ...r, hitTarget: 1.4 })).toThrow();
  });
});
