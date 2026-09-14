/**
 * The documents ⇄ taxonomy invalidation seam (C-I3, C-I4) and the two gates that share its shape.
 *
 * These assert the *pairing*, not each hook's own key: the defect was two hook families owning the
 * two halves of one invariant with neither invalidating the other, which no per-hook test can see.
 */
import { describe, it, expect } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { z } from 'zod';
import { usePatchDocument, useDeleteDocument } from '../../src/api/hooks/documents.js';
import { useCreateWorld } from '../../src/api/hooks/taxonomy.js';
import { useSetStatus } from '../../src/api/hooks/governance.js';
import { can } from '../../src/api/hooks/me.js';
import { checkedMaybe } from '../../src/api/stage45.js';
import { ApiError } from '../../src/api/unwrap.js';
import { fx, D_BROWSING } from '../msw/fixtures.js';
import type { Me } from '@wecom/shared';

/** Every root the helper is responsible for, seeded so invalidation is observable. */
const ROOTS = [['documents'], ['worlds'], ['topics'], ['topic'], ['tags'], ['search'], ['trash']];

const harness = () => {
  const qc = new QueryClient({
    // `gcTime: Infinity` matters: the seeded rows have no observer, and the default sweep would
    // remove them the moment they are invalidated — which reads as "never invalidated".
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  for (const k of ROOTS) qc.setQueryData([...k, 'seed'], { seeded: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const stale = () =>
    ROOTS.filter((k) => qc.getQueryState([...k, 'seed'])?.isInvalidated).map((k) => k[0]);
  return { qc, wrapper, stale };
};

describe('content invalidation', () => {
  it('a taxonomy write also drops the document, search and trash caches', async () => {
    const h = harness();
    const { result } = renderHook(() => useCreateWorld(), { wrapper: h.wrapper });
    await act(async () => {
      await result.current.mutateAsync({ slug: 'field2', name: 'שטח', description: '', active: true });
    });
    await waitFor(() => expect(h.stale()).toEqual(ROOTS.map((k) => k[0])));
  });

  it('a document patch also drops the taxonomy counts it can have moved', async () => {
    const h = harness();
    const { result } = renderHook(() => usePatchDocument(D_BROWSING), { wrapper: h.wrapper });
    await act(async () => {
      await result.current.mutateAsync({ worlds: ['tech'], tags: ['apn'] });
    });
    await waitFor(() => expect(h.stale()).toEqual(ROOTS.map((k) => k[0])));
  });

  it('a status change drops topic and search, which enforce the published-only boundary', async () => {
    const h = harness();
    const { result } = renderHook(() => useSetStatus(), { wrapper: h.wrapper });
    await act(async () => {
      await result.current.mutateAsync({ id: D_BROWSING, status: 'invalid', reason: 'לא רלוונטי' });
    });
    await waitFor(() => expect(h.stale()).toEqual(ROOTS.map((k) => k[0])));
  });

  it('a delete drops both the lists and the trash', async () => {
    const h = harness();
    const { result } = renderHook(() => useDeleteDocument(), { wrapper: h.wrapper });
    await act(async () => {
      await result.current.mutateAsync(D_BROWSING);
    });
    await waitFor(() => expect(h.stale()).toEqual(ROOTS.map((k) => k[0])));
  });
});

describe('the client scope gate mirrors the server', () => {
  const me = (scopes: string[] | null): Me =>
    ({ ...fx.me, permissions: ['docs.read', 'docs.edit'], worldScopes: scopes, categoryScopes: scopes }) as Me;

  it('allows a document whose secondary world is in scope', () => {
    // The server intersects the whole membership; checking `doc.category` alone made the client
    // stricter than the API and silently hid the edit affordances.
    expect(can(me(['billing']), 'docs.edit', { category: 'tech', worlds: ['tech', 'billing'] })).toBe(true);
  });

  it('still refuses a document in no scoped world', () => {
    expect(can(me(['billing']), 'docs.edit', { category: 'tech', worlds: ['tech', 'plans'] })).toBe(false);
  });

  it('falls back to the primary world when the document carries no world list', () => {
    expect(can(me(['tech']), 'docs.edit', { category: 'tech' })).toBe(true);
    expect(can(me(['billing']), 'docs.edit', { category: 'tech' })).toBe(false);
  });

  it('reads worldScopes, and categoryScopes only as the deprecated fallback', () => {
    const renamed = { ...fx.me, permissions: ['docs.edit'], worldScopes: ['billing'] } as unknown as Me;
    expect(can(renamed, 'docs.edit', { category: 'billing' })).toBe(true);
    expect(can(renamed, 'docs.edit', { category: 'tech' })).toBe(false);
    const legacy = { ...fx.me, permissions: ['docs.edit'], categoryScopes: ['billing'] } as unknown as Me;
    expect(can(legacy, 'docs.edit', { category: 'billing' })).toBe(true);
  });

  it('leaves an unscoped user unrestricted', () => {
    expect(can(me(null), 'docs.edit', { category: 'anything' })).toBe(true);
  });
});

describe('checkedMaybe distinguishes "no source yet" from "you may not see this"', () => {
  const S = z.object({ ok: z.boolean() });
  const res = (status: number, error?: unknown) => ({
    error,
    response: new Response(null, { status }),
  });

  it('treats a bare 404 as absent', () => {
    expect(checkedMaybe(S, res(404))).toBeNull();
    expect(checkedMaybe(S, res(404, { code: 'NOT_FOUND' }))).toBeNull();
    expect(checkedMaybe(S, res(204))).toBeNull();
  });

  it('rethrows NOT_PUBLISHED so the caller can render the unavailable page', () => {
    expect(() => checkedMaybe(S, res(404, { code: 'NOT_PUBLISHED', message: 'לא זמין' }))).toThrow(
      ApiError,
    );
  });
});
