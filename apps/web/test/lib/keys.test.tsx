/**
 * The hotkey registry's contract. These are the properties three lanes binding their own `window`
 * listeners could not have: a defined precedence between scopes, a way for a local handler to
 * decline, and a map that cannot silently gain an undocumented key.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import {
  KEYMAP,
  KEYS,
  SCOPES,
  combosFor,
  getActiveScope,
  setActiveScope,
  useHotkeys,
  type ActiveScope,
  type HotkeyMap,
  type Scope,
} from '../../src/lib/keys.js';

function Binder({ scope, map, pane }: { scope: Scope; map: HotkeyMap; pane?: ActiveScope }) {
  useHotkeys(scope, map, pane);
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

  it('lets Escape through while typing — it is the one bare key that always must', () => {
    const escape = vi.fn();
    const pin = vi.fn();
    const { container } = render(
      <>
        <input aria-label="field" />
        <Binder scope="editor" map={{ Escape: escape }} />
        <Binder scope="article" map={{ p: pin }} />
      </>,
    );
    container.querySelector('input')!.focus();
    press('Escape');
    press('p');
    // `p` is a character somebody is trying to type. `Escape` never is, and without this the
    // editor's title input could not clear a selection or leave the editor at all.
    expect(escape).toHaveBeenCalledTimes(1);
    expect(pin).not.toHaveBeenCalled();
    cleanup();
  });

  it('gives an open overlay Escape before the route underneath sees it', () => {
    const dialog = vi.fn();
    const editor = vi.fn();
    render(
      <>
        <Binder scope="editor" map={{ Escape: editor }} />
        <Binder scope="overlay" map={{ Escape: dialog }} />
      </>,
    );
    press('Escape');
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(editor).not.toHaveBeenCalled();
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

/**
 * m3: two panes in one scope.
 *
 * Split view mounts the article page twice. Scope order cannot separate them — both are the
 * `article` scope — and `document.activeElement` cannot either, because for most of a call focus
 * sits on `<body>`: an agent reading a procedure is not tabbing through it. So the pane that owns
 * the keyboard is stated, not inferred, and these are the properties that buys.
 */
describe('the active scope decides between two panes in one scope', () => {
  beforeEach(() => setActiveScope('article'));
  afterEach(() => {
    cleanup();
    setActiveScope('article');
  });

  const twoPanes = () => {
    const left = vi.fn();
    const right = vi.fn();
    render(
      <>
        <Binder scope="article" map={{ ArrowDown: left }} pane="split-left" />
        <Binder scope="article" map={{ ArrowDown: right }} pane="split-right" />
      </>,
    );
    return { left, right };
  };

  it('sends the keystroke to the pane that is active, not the one that mounted first', () => {
    const { left, right } = twoPanes();
    setActiveScope('split-left');
    press('ArrowDown');
    expect(left).toHaveBeenCalledTimes(1);
    expect(right).not.toHaveBeenCalled();

    // The bug this closes: mounted first, the left pane took every arrow regardless of which pane
    // the operator had just clicked.
    setActiveScope('split-right');
    press('ArrowDown');
    expect(right).toHaveBeenCalledTimes(1);
    expect(left).toHaveBeenCalledTimes(1);
  });

  it('leaves both panes silent when the keyboard is somewhere else entirely', () => {
    const { left, right } = twoPanes();
    setActiveScope('library');
    press('ArrowDown');
    expect(left).not.toHaveBeenCalled();
    expect(right).not.toHaveBeenCalled();
  });

  it('does not require focus to be inside a pane — body focus is the normal case mid-call', () => {
    const { right } = twoPanes();
    setActiveScope('split-right');
    // Nothing is focused; a containment check would have disabled call mode here entirely, which
    // is the failure a click-then-type test would never have caught.
    expect(document.activeElement).toBe(document.body);
    press('ArrowDown');
    expect(right).toHaveBeenCalledTimes(1);
  });

  it('leaves a binding with no pane answering regardless, so nothing older had to change', () => {
    const anyPane = vi.fn();
    render(<Binder scope="article" map={{ ArrowDown: anyPane }} />);
    setActiveScope('split-right');
    press('ArrowDown');
    setActiveScope('library');
    press('ArrowDown');
    expect(anyPane).toHaveBeenCalledTimes(2);
  });

  it('a declining pane still hands the chord on to the next scope', () => {
    const library = vi.fn();
    render(
      <>
        <Binder scope="library" map={{ Enter: library }} />
        <Binder scope="article" map={{ Enter: () => false }} pane="split-right" />
      </>,
    );
    setActiveScope('split-right');
    press('Enter');
    // Declining is unchanged by panes: a pane that is addressed and says no still passes it on.
    expect(library).toHaveBeenCalledTimes(1);
  });
});

describe('the active scope also orders whole route scopes', () => {
  afterEach(() => {
    cleanup();
    setActiveScope('article');
  });

  it('gives the library its arrows even while an article scope is registered', () => {
    const article = vi.fn();
    const library = vi.fn();
    render(
      <>
        <Binder scope="article" map={{ ArrowDown: article }} />
        <Binder scope="library" map={{ ArrowDown: library }} />
      </>,
    );
    // Static scope order puts `article` ahead of `library`, so the list never saw an arrow.
    setActiveScope('library');
    press('ArrowDown');
    expect(library).toHaveBeenCalledTimes(1);
    expect(article).not.toHaveBeenCalled();

    setActiveScope('article');
    press('ArrowDown');
    expect(article).toHaveBeenCalledTimes(1);
  });

  it('keeps an open overlay ahead of the active route and the shell behind everything', () => {
    const dialog = vi.fn();
    const library = vi.fn();
    const global = vi.fn();
    render(
      <>
        <Binder scope="global" map={{ Escape: global }} />
        <Binder scope="library" map={{ Escape: library }} />
        <Binder scope="overlay" map={{ Escape: dialog }} />
      </>,
    );
    setActiveScope('library');
    press('Escape');
    expect(dialog).toHaveBeenCalledTimes(1);
    expect(library).not.toHaveBeenCalled();
    expect(global).not.toHaveBeenCalled();
  });

  it('defaults to the article scope, which is what the registry starts in', () => {
    expect(getActiveScope()).toBe('article');
  });
});
