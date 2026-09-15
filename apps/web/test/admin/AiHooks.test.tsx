import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  exportConversations,
  useAiSettings,
  useAiSettingVersions,
  useDeleteConversation,
  usePutAiSettings,
  useTestModel,
} from '../../src/api/hooks/aiAdmin.js';
import { useSuggestionAnalytics } from '../../src/api/hooks/suggestionAnalytics.js';
import { aiAdminState, CONV_1 } from '../msw/ai-admin.js';

// The export path is the one place this lane hands the browser a file; the spy is what proves it
// goes through `download()`'s Blob URL rather than a link the CSP would block.
const { downloadSpy } = vi.hoisted(() => ({ downloadSpy: vi.fn() }));
vi.mock('../../src/lib/format.js', async (orig) => ({
  ...((await orig()) as object),
  download: downloadSpy,
}));

const wrap = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  return {
    qc,
    w: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
};

describe('ai admin hooks', () => {
  it('reads settings and bumps the brief version on save', async () => {
    const { w } = wrap();
    const { result } = renderHook(() => ({ s: useAiSettings(true), put: usePutAiSettings() }), {
      wrapper: w,
    });
    await waitFor(() => expect(result.current.s.data?.models.tier).toBe(1));
    await act(async () => {
      await result.current.put.mutateAsync({ brief: { text: 'טקסט חדש' } });
    });
    expect((aiAdminState.lastPut as { brief: { text: string } }).brief.text).toBe('טקסט חדש');
    await waitFor(() => expect(result.current.s.data?.brief.version).toBe(3));
  });

  it('lists the setting versions newest first', async () => {
    const { w } = wrap();
    const { result } = renderHook(() => useAiSettingVersions(), { wrapper: w });
    await waitFor(() => expect(result.current.data).toHaveLength(3));
    expect(result.current.data?.[0]).toMatchObject({ key: 'ai.brief', version: 2, updatedByName: 'נועה' });
  });

  it('tests a model slot and reports the result', async () => {
    const { w } = wrap();
    const { result } = renderHook(() => useTestModel(), { wrapper: w });
    let dims: number | undefined;
    await act(async () => {
      dims = (await result.current.mutateAsync({ slot: 'embed' })).dims;
    });
    expect(dims).toBe(1024);
    expect(aiAdminState.lastTest).toBe('embed');
  });

  it('deletes a conversation and drops it from the list cache', async () => {
    const { w, qc } = wrap();
    const { result } = renderHook(() => useDeleteConversation(), { wrapper: w });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await act(async () => {
      await result.current.mutateAsync(CONV_1);
    });
    expect(aiAdminState.deleted).toContain(CONV_1);
    // Through `invalidateAi`: the whole `ai` prefix, so every filter combination's cache entry
    // goes, not only the key the screen happens to be holding.
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['ai'] }));
  });

  it('exports the transcripts as JSONL through download()', async () => {
    downloadSpy.mockClear();
    await exportConversations({});
    expect(aiAdminState.exportCalls).toBe(1);
    const [name, body, type] = downloadSpy.mock.calls[0] as [string, string, string];
    expect(name).toMatch(/\.jsonl$/);
    expect(type).toBe('application/x-ndjson');
    expect(JSON.parse(body.trim().split('\n')[0]).conversation.id).toBe(CONV_1);
  });

  it('does not call analytics when disabled', () => {
    const { w } = wrap();
    const { result } = renderHook(() => useSuggestionAnalytics({}, false), { wrapper: w });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
