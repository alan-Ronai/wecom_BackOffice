/**
 * The hotkey registry's contract. These are the properties three lanes binding their own `window`
 * listeners could not have: a defined precedence between scopes, a way for a local handler to
 * decline, and a map that cannot silently gain an undocumented key.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  KEYMAP,
  KEYS,
  SCOPES,
  combosFor,
  useHotkeys,
  type HotkeyMap,
  type Scope,
} from '../../src/lib/keys.js';

function Binder({ scope, map }: { scope: Scope; map: HotkeyMap }) {
  useHotkeys(scope, map);
  return null;
}

const press = (key: string, init: KeyboardEventInit = {}) =>
  window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));

describe('the hotkey registry', () => {
  it('gives the most local scope the keystroke', () => {
    const editor = vi.fn();
    const global = vi.fn();
    // Mounted global-first, the way the shell mounts before the route it renders — the old
    // per-component listeners fired in exactly this order, which was the bug.
    render(
      <>
        <Binder scope="global" map={{ Escape: global }} />
        <Binder scope="editor" map={{ Escape: editor }} />
      </>,
    );
    press('Escape');
    expect(editor).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
    cleanup();
  });

  it('falls through to the next scope when a handler declines', () => {
    const global = vi.fn();
    render(
      <>
        <Binder scope="global" map={{ Escape: global }} />
        <Binder scope="editor" map={{ Escape: () => false }} />
      </>,
    );
    press('Escape');
    expect(global).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('stops at the first scope that handles the chord, so nothing fires twice', () => {
    const library = vi.fn();
    const global = vi.fn();
    render(
      <>
        <Binder scope="global" map={{ Escape: global }} />
        <Binder scope="library" map={{ Escape: library }} />
      </>,
    );
    press('Escape');
    press('Escape');
    expect(library).toHaveBeenCalledTimes(2);
    expect(global).not.toHaveBeenCalled();
    cleanup();
  });

  it('holds bare keys while typing but lets modifier combos through', () => {
    const bare = vi.fn();
    const combo = vi.fn();
    const { container } = render(
      <>
        <input aria-label="field" />
        <Binder scope="article" map={{ p: bare }} />
        <Binder scope="global" map={{ 'ctrl+k': combo }} />
      </>,
    );
    container.querySelector('input')!.focus();
    press('p');
    press('k', { ctrlKey: true });
    expect(bare).not.toHaveBeenCalled();
    expect(combo).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('matches the un-normalised spelling, which is how Shift R reaches the editor', () => {
    const review = vi.fn();
    render(<Binder scope="editor" map={{ R: review }} />);
    press('R', { shiftKey: true });
    expect(review).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it('refuses a chord that is not declared in the map', () => {
    // The guard is what stops the next lane from binding a key the `?` overlay never mentions.
    // React logs the boundary-less throw itself; the test is about the throw, not the log.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Binder scope="global" map={{ q: vi.fn() }} />)).toThrow(/Undeclared hotkey/);
    quiet.mockRestore();
    cleanup();
  });

  it('declares every scope it dispatches, and renders the overlay from that declaration', () => {
    for (const s of SCOPES) expect(combosFor(s).size).toBeGreaterThan(0);
    // Every overlay row is a real binding, and the keys the QOL round added are documented.
    const labels = KEYMAP.map(([chord]) => chord);
    expect(labels).toContain('Ctrl Z / Ctrl Shift Z');
    expect(labels).toContain('J / K');
    expect(KEYS.every((k) => k.combos.length > 0)).toBe(true);
  });

  it('unbinds on unmount', () => {
    const fn = vi.fn();
    const view = render(<Binder scope="global" map={{ Escape: fn }} />);
    view.unmount();
    press('Escape');
    expect(fn).not.toHaveBeenCalled();
  });
});
