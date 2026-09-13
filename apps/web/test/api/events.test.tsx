import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEvents } from '../../src/api/events.js';
import { keys } from '../../src/api/keys.js';
import { D_BROWSING, SRC_TECH, SUG_1, U1 } from '../msw/fixtures.js';

class FakeES {
  static last: FakeES;
  listeners: Record<string, ((e: MessageEvent) => void)[]> = {};
  constructor() {
    FakeES.last = this;
  }
  addEventListener(n: string, f: (e: MessageEvent) => void) {
    (this.listeners[n] ??= []).push(f);
  }
  removeEventListener() {}
  close() {}
  emit(n: string, data: unknown) {
    (this.listeners[n] ?? []).forEach((f) => f({ data: JSON.stringify(data) } as MessageEvent));
  }
}

const mount = () => {
  (globalThis as unknown as { EventSource: unknown }).EventSource = FakeES;
  const qc = new QueryClient();
  const spy = vi.spyOn(qc, 'invalidateQueries');
  const Wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useEvents(), { wrapper: Wrapper });
  return { qc, spy, hook };
};

describe('useEvents', () => {
  it('invalidates document queries on document.published', async () => {
    const { spy } = mount();
    FakeES.last.emit('document.published', {
      name: 'document.published',
      payload: { documentId: D_BROWSING, version: 8, actorId: null },
      at: new Date().toISOString(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: keys.doc(D_BROWSING) }));
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.versions(D_BROWSING) });
  });

  it('invalidates the pipeline on suggestion and sync events', async () => {
    const { spy } = mount();
    FakeES.last.emit('suggestion.decided', {
      name: 'suggestion.decided',
      payload: { suggestionId: SUG_1, status: 'accepted', actorId: U1 },
      at: new Date().toISOString(),
    });
    FakeES.last.emit('sync.conflict', {
      name: 'sync.conflict',
      payload: { connectorId: SRC_TECH, documentId: D_BROWSING, externalId: 'wp-1' },
      at: new Date().toISOString(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: ['suggestions'] }));
    expect(spy).toHaveBeenCalledWith({ queryKey: keys.sources });
  });

  it('invalidates system status and ignores malformed payloads', async () => {
    const { spy, hook } = mount();
    FakeES.last.emit('system.status', {
      name: 'system.status',
      payload: { db: true, model: false, queue: 2, connectors: {} },
      at: new Date().toISOString(),
    });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: keys.admin.system }));
    const calls = spy.mock.calls.length;
    FakeES.last.emit('document.published', { nope: true });
    expect(spy.mock.calls.length).toBe(calls);
    expect(hook.result.current.last?.name).toBe('system.status');
  });
});
