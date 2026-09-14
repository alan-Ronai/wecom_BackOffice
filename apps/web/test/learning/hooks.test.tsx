import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useCreateLearningItem,
  useDocumentLearning,
  useLearningItems,
  usePublishLearningItem,
} from '../../src/api/hooks/learningManage.js';
import { useDismissGap, useGaps } from '../../src/api/hooks/gaps.js';
import { usePutWorkflowSettings, useWorkflowSettings } from '../../src/api/hooks/workflow.js';
import { keys } from '../../src/api/keys.js';
import { learningState } from '../msw/learning-manage.js';
import { D_BROWSING } from '../msw/fixtures.js';

const wrap = () => {
  const qc = new QueryClient({
    // A real `gcTime`: a seeded-but-unobserved key is the only way to see an invalidation flag
    // that an active query would have already cleared by refetching.
    defaultOptions: { queries: { retry: false, gcTime: 60_000 }, mutations: { retry: false } },
  });
  return {
    qc,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    ),
  };
};

describe('wave 5 V4b hooks', () => {
  it('lists items parsed against the contract and invalidates the list on create', async () => {
    const { wrapper } = wrap();
    const list = renderHook(() => useLearningItems({ kind: 'quiz' }), { wrapper });
    await waitFor(() => expect(list.result.current.data?.items).toHaveLength(1));
    const create = renderHook(() => useCreateLearningItem(), { wrapper });
    await act(() => create.result.current.mutateAsync({ kind: 'quiz', title: 'חדש' }));
    expect(learningState.items.some((i) => i.title === 'חדש')).toBe(true);
    // The live list is invalidated, so it refetches and sees the new quiz without being told.
    await waitFor(() => expect(list.result.current.data?.items).toHaveLength(2));
  });

  it('publish sends the label and invalidates item, versions and my-learning', async () => {
    const { qc, wrapper } = wrap();
    const id = learningState.items[0]!.id;
    for (const k of [keys.learning.item(id), keys.learning.versions(id), keys.learning.my])
      qc.setQueryData(k, {});
    const pub = renderHook(() => usePublishLearningItem(id), { wrapper });
    await act(() => pub.result.current.mutateAsync({ label: 'גרסה ראשונה' }));
    expect(learningState.published).toEqual([{ itemId: id, label: 'גרסה ראשונה' }]);
    // The item itself is written straight back from the response, so only the other two are stale.
    expect(qc.getQueryState(keys.learning.versions(id))?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys.learning.my)?.isInvalidated).toBe(true);
  });

  it('reads the learning items that reference one document', async () => {
    const { wrapper } = wrap();
    const forDoc = renderHook(() => useDocumentLearning(D_BROWSING), { wrapper });
    // Only the quiz anchors its questions to that document.
    await waitFor(() => expect(forDoc.result.current.data?.items).toHaveLength(1));
    expect(forDoc.result.current.data?.refreshAssignmentId).toBeNull();
  });

  it('gaps: list defaults to open and dismiss carries the reason', async () => {
    const { wrapper } = wrap();
    const list = renderHook(() => useGaps({}), { wrapper });
    await waitFor(() => expect(list.result.current.data?.items).toHaveLength(2));
    const dismiss = renderHook(() => useDismissGap(), { wrapper });
    await act(() => dismiss.result.current.mutateAsync({ id: learningState.gaps[0]!.id, reason: 'כפול' }));
    expect(learningState.gaps[0]!.status).toBe('dismissed');
    expect(learningState.gaps[0]!.dismissedReason).toBe('כפול');
  });

  it('workflow settings round-trip a deep patch', async () => {
    const { wrapper } = wrap();
    const get = renderHook(() => useWorkflowSettings(true), { wrapper });
    await waitFor(() => expect(get.result.current.data?.requireApprover).toBe(false));
    const put = renderHook(() => usePutWorkflowSettings(), { wrapper });
    await act(() => put.result.current.mutateAsync({ requireApprover: true, gaps: { staleDays: 90 } }));
    expect(learningState.workflow.requireApprover).toBe(true);
    expect(learningState.workflow.gaps.staleDays).toBe(90);
    expect(learningState.workflow.learning.defaultPassMark).toBe(80);
  });
});
