import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import {
  useSourceDocument,
  useSaveSource,
  useSourceVersions,
  useUploadAsset,
} from '../../src/api/hooks/sourcedocs.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';
import { ApiError } from '../../src/api/unwrap.js';

const wrap = () => {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
};

describe('sourcedocs hooks', () => {
  it('returns null for a document with no source (204)', async () => {
    const { result } = renderHook(() => useSourceDocument(fx.docBrowsing.id), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });

  it('saves with the current etag and refreshes versions', async () => {
    const w = wrap();
    const save = renderHook(() => useSaveSource(fx.docBrowsing.id), { wrapper: w });
    await act(async () => {
      await save.result.current.mutateAsync({ html: '<p>x</p>', label: 'v1' });
    });
    expect(state.sourceDocs.get(fx.docBrowsing.id)?.version).toBe(1);
    const vers = renderHook(() => useSourceVersions(fx.docBrowsing.id), { wrapper: w });
    await waitFor(() => expect(vers.result.current.data?.length).toBe(1));
  });

  it('surfaces 412 as ApiError ETAG_MISMATCH', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, {
      html: '<p>a</p>',
      text: 'a',
      version: 1,
      etag: 'e1',
      versions: [],
    });
    const save = renderHook(() => useSaveSource(fx.docBrowsing.id), { wrapper: wrap() });
    await expect(save.result.current.mutateAsync({ html: '<p>b</p>', etag: 'stale' })).rejects.toMatchObject({
      status: 412,
      code: 'ETAG_MISMATCH',
    });
    expect(new ApiError(412, 'ETAG_MISMATCH', 'x').code).toBe('ETAG_MISMATCH');
  });

  it('uploads an asset and returns its url', async () => {
    const up = renderHook(() => useUploadAsset(), { wrapper: wrap() });
    const a = await up.result.current.mutateAsync(
      new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }),
    );
    expect(a.url).toMatch(/^\/api\/v1\/assets\//);
  });
});
