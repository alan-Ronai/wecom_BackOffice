import { describe, it, expect } from 'vitest';
import {
  AiSettingsSchema,
  AiSettingVersionSchema,
  AiSettingVersionsResponseSchema,
  ConversationDetailSchema,
  ConversationsResponseSchema,
  EvalRunSchema,
  JobQueuedSchema,
  ModelTestResultSchema,
  SuggestionAnalyticsSchema,
} from '@wecom/shared';
import {
  sampleAnalytics,
  sampleConversation,
  sampleEvalRun,
  sampleMessages,
  sampleModelTest,
  sampleSettings,
  sampleVersions,
} from '../msw/ai-admin.js';

describe('ai admin msw fixtures match the wave 6 contract', () => {
  it('settings, versions and model tests parse', () => {
    const s = AiSettingsSchema.parse(sampleSettings());
    expect(s.models.tier).toBe(1);
    expect(s.limits.chatPerUserPerHour).toBe(60);
    for (const v of sampleVersions()) AiSettingVersionSchema.parse(v);
    expect(AiSettingVersionsResponseSchema.parse({ items: sampleVersions() }).items).toHaveLength(3);
    expect(ModelTestResultSchema.parse(sampleModelTest('chat')).reachable).toBe(true);
    expect(ModelTestResultSchema.parse(sampleModelTest('embed')).dims).toBe(1024);
  });

  it('eval runs, queued jobs and suggestion analytics parse', () => {
    expect(EvalRunSchema.parse(sampleEvalRun()).hitTarget).toBeGreaterThan(0);
    expect(JobQueuedSchema.parse({ queued: true, jobId: 'job-eval-1' }).jobId).toBe('job-eval-1');
    expect(SuggestionAnalyticsSchema.parse(sampleAnalytics()).total).toBeGreaterThan(0);
  });

  it('conversations list and detail parse', () => {
    const list = ConversationsResponseSchema.parse({
      items: [sampleConversation()],
      total: 1,
      page: 1,
      pageSize: 50,
    });
    expect(list.items[0].kind).toBe('workspace');
    expect(list.items[0].messageCount).toBe(2);
    const detail = ConversationDetailSchema.parse({
      conversation: sampleConversation(),
      messages: sampleMessages(),
    });
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(detail.messages[1].feedback).toBe('up');
    expect(detail.messages[1].toolCalls[0].name).toBe('propose_source_edit');
  });
});
