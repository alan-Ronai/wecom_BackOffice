import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { NavProvider, useNav } from '../../src/components/shell/navStore.js';
import { getActiveScope, setActiveScope } from '../../src/lib/keys.js';

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

  /**
   * m3. The hotkey registry reads the active scope through a module-level value — `dispatch` is a
   * plain `window` listener outside React — so the store is not the only place it has to be true.
   */
  it('opening the split claims the left pane, and closing it hands the keys back', () => {
    setActiveScope('article');
    const { result } = renderHook(() => useNav(), { wrapper: w });
    act(() => result.current.openDoc('a', { title: 'A' }));
    act(() => result.current.openDoc('b', { title: 'B', newTab: true }));

    act(() => result.current.toggleSplit());
    expect(result.current.activeScope).toBe('split-left');
    expect(getActiveScope()).toBe('split-left');

    act(() => result.current.setActiveScope('split-right'));
    expect(getActiveScope()).toBe('split-right');

    // Without this the keys would stay addressed to a pane that no longer exists, and call mode
    // would go silent on a screen that looks entirely normal.
    act(() => result.current.toggleSplit());
    expect(result.current.split).toBeNull();
    expect(result.current.activeScope).toBe('article');
    expect(getActiveScope()).toBe('article');
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
