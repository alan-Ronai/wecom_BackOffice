import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useWorlds,
  useTopics,
  useTopicView,
  useTags,
  useCreateWorld,
  useReorderTopics,
} from '../../src/api/hooks/taxonomy.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

describe('taxonomy hooks', () => {
  it('lists worlds in position order', async () => {
    const { result } = renderHook(() => useWorlds(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.length).toBe(fx.worlds.length));
    expect(result.current.data?.map((w) => w.slug)).toEqual([
      'sim',
      'tech',
      'billing',
      'plans',
      'intl',
      'ops',
    ]);
  });

  it('lists topics of a world and a topic view', async () => {
    const t = renderHook(() => useTopics('tech'), { wrapper: wrap() });
    await waitFor(() => expect(t.result.current.data?.length).toBeGreaterThan(0));
    const v = renderHook(() => useTopicView(fx.topics[0]!.id), { wrapper: wrap() });
    await waitFor(() => expect(v.result.current.data?.groups.length).toBeGreaterThan(0));
    expect(v.result.current.data?.groups[0]?.docType).toBe('M');
  });

  it('suggests tags and creates a world', async () => {
    const tags = renderHook(() => useTags('ap'), { wrapper: wrap() });
    await waitFor(() => expect(tags.result.current.data?.[0]?.tag).toBe('apn'));
    const w = wrap();
    const create = renderHook(() => useCreateWorld(), { wrapper: w });
    await act(async () => {
      await create.result.current.mutateAsync({
        slug: 'field',
        name: 'שטח',
        description: '',
        active: true,
      });
    });
    expect(state.worlds.some((x) => x.slug === 'field')).toBe(true);
    const re = renderHook(() => useReorderTopics(), { wrapper: w });
    await act(async () => {
      await re.result.current.mutateAsync({
        worldSlug: 'tech',
        ids: [...fx.topics.map((t) => t.id)].reverse(),
      });
    });
    expect(state.topics[0]!.id).toBe(fx.topics[fx.topics.length - 1]!.id);
  });
});
