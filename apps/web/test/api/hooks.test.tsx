import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDocuments, useTogglePin, usePublish } from '../../src/api/hooks/documents.js';
import { useBlocks, useFields, useAddNote, useNotes } from '../../src/api/hooks/content.js';
import { useMe, can } from '../../src/api/hooks/me.js';
import { useSearch } from '../../src/api/hooks/search.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  return Wrapper;
};

describe('hooks', () => {
  it('lists documents by category', async () => {
    const { result } = renderHook(() => useDocuments({ category: 'intl', sort: 'wave' }), {
      wrapper: wrap(),
    });
    await waitFor(() => expect(result.current.data?.items.length).toBeGreaterThan(0));
    expect(result.current.data?.items.every((c) => c.category === 'intl')).toBe(true);
  });

  it('toggles pin optimistically and persists', async () => {
    const w = wrap();
    const list = renderHook(() => useDocuments({ sort: 'wave' }), { wrapper: w });
    const pin = renderHook(() => useTogglePin(), { wrapper: w });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    await act(async () => {
      await pin.result.current.mutateAsync({ id: fx.docIntl.id, pinned: true });
    });
    expect(state.pins.has(fx.docIntl.id)).toBe(true);
  });

  it('resolves permissions with category scope', async () => {
    const { result } = renderHook(() => useMe(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.user.displayName).toBe('ענבר ל.'));
    expect(can(result.current.data, 'docs.publish', { category: 'tech' })).toBe(true);
    expect(
      can({ ...result.current.data!, categoryScopes: ['intl'] }, 'docs.publish', { category: 'tech' }),
    ).toBe(false);
    expect(can(result.current.data, 'users.manage')).toBe(false);
    expect(can(undefined, 'docs.read')).toBe(false);
  });

  it('loads blocks and fields', async () => {
    const w = wrap();
    const b = renderHook(() => useBlocks(), { wrapper: w });
    const f = renderHook(() => useFields(), { wrapper: w });
    await waitFor(() => expect(b.result.current.data).toHaveLength(fx.blocks.length));
    await waitFor(() => expect(f.result.current.data).toHaveLength(fx.fields.length));
  });

  it('adds a note through the API', async () => {
    const w = wrap();
    const add = renderHook(() => useAddNote(fx.docBrowsing.id), { wrapper: w });
    const list = renderHook(() => useNotes(fx.docBrowsing.id), { wrapper: w });
    await waitFor(() => expect(list.result.current.data).toHaveLength(1));
    await act(async () => {
      await add.result.current.mutateAsync({ stepKey: 's1', text: 'בדיקה' });
    });
    expect(state.notes.map((n) => n.text)).toContain('בדיקה');
  });

  it('publishes with a label', async () => {
    const { result } = renderHook(() => usePublish(fx.docBrowsing.id), { wrapper: wrap() });
    await act(async () => {
      await result.current.mutateAsync({ label: 'עדכון' });
    });
    expect(state.published).toEqual([{ id: fx.docBrowsing.id, label: 'עדכון' }]);
  });

  it('search stays disabled until there is a query', async () => {
    const w = wrap();
    const empty = renderHook(() => useSearch(''), { wrapper: w });
    expect(empty.result.current.fetchStatus).toBe('idle');
    const hit = renderHook(() => useSearch('ריענון sim'), { wrapper: w });
    await waitFor(() => expect(hit.result.current.data?.total).toBe(1));
    expect(hit.result.current.data?.groups[0].hits[0].stepKey).toBe('s11');
  });
});
