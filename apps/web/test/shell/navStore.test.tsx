import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { NavProvider, useNav } from '../../src/components/shell/navStore.js';

const w = ({ children }: { children: ReactNode }) => (
  <MemoryRouter>
    <NavProvider>{children}</NavProvider>
  </MemoryRouter>
);

describe('navStore', () => {
  it('replaces the active tab unless newTab, and closes to the neighbour', () => {
    const { result } = renderHook(() => useNav(), { wrapper: w });
    act(() => result.current.openDoc('a', { title: 'A' }));
    act(() => result.current.openDoc('b', { title: 'B' }));
    expect(result.current.tabs.map((t) => t.docId)).toEqual(['b']);
    act(() => result.current.openDoc('c', { title: 'C', newTab: true }));
    expect(result.current.tabs.map((t) => t.docId)).toEqual(['b', 'c']);
    expect(result.current.activeTab).toBe(1);
    act(() => result.current.closeTab(1));
    expect(result.current.activeTab).toBe(0);
    expect(result.current.tabs.map((t) => t.docId)).toEqual(['b']);
  });

  it('caps the strip at 8 tabs', () => {
    const { result } = renderHook(() => useNav(), { wrapper: w });
    for (let i = 0; i < 10; i++) act(() => result.current.openDoc(`d${i}`, { title: `D${i}`, newTab: true }));
    expect(result.current.tabs).toHaveLength(8);
    expect(result.current.tabs[0].docId).toBe('d2');
  });

  it('persists tabs in sessionStorage', () => {
    const { result } = renderHook(() => useNav(), { wrapper: w });
    act(() => result.current.openDoc('x', { title: 'X' }));
    expect(JSON.parse(sessionStorage.getItem('kb.tabs')!)).toEqual([{ docId: 'x', title: 'X' }]);
  });

  it('splits only from a document route', () => {
    const { result } = renderHook(() => useNav(), { wrapper: w });
    act(() => result.current.toggleSplit('other'));
    expect(result.current.split).toBeNull();
    act(() => result.current.openDoc('a', { title: 'A' }));
    act(() => result.current.openDoc('b', { title: 'B', newTab: true }));
    act(() => result.current.toggleSplit());
    expect(result.current.split).toEqual({ left: 'b', right: 'a' });
    act(() => result.current.toggleSplit());
    expect(result.current.split).toBeNull();
  });
});
