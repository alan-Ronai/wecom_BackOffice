import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { bindRoleButtonKeys, pressKeys } from '../../src/lib/keyboard.js';
import { withMe } from '../msw/handlers.js';
import { server } from '../msw/server.js';
import { LI_BRIEF } from '../msw/fixtures.js';

/**
 * B-M6 (wave 5): `role="button"` elements are operable by Enter/Space on their own, not only
 * through the document-level bridge — which never sees a key a focus trap or a component rendered
 * outside `<App>` stops on the way up.
 */
describe('pressKeys — per-element Enter/Space activation', () => {
  let unbind: (() => void) | undefined;
  afterEach(() => unbind?.());

  it('activates on Enter and on Space, without the document bridge', async () => {
    const onClick = vi.fn();
    render(
      <span role="button" tabIndex={0} onKeyDown={pressKeys} onClick={onClick}>
        go
      </span>,
    );
    screen.getByRole('button', { name: 'go' }).focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it('ignores other keys, modified keys and aria-disabled elements', async () => {
    const onClick = vi.fn();
    render(
      <>
        <span role="button" tabIndex={0} onKeyDown={pressKeys} onClick={onClick}>
          a
        </span>
        <span role="button" tabIndex={0} aria-disabled="true" onKeyDown={pressKeys} onClick={onClick}>
          b
        </span>
      </>,
    );
    screen.getByRole('button', { name: 'a' }).focus();
    await userEvent.keyboard('x{Control>}{Enter}{/Control}');
    screen.getByRole('button', { name: 'b' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('fires once even with the document bridge bound', async () => {
    unbind = bindRoleButtonKeys();
    const onClick = vi.fn();
    render(
      <span role="button" tabIndex={0} onKeyDown={pressKeys} onClick={onClick}>
        once
      </span>,
    );
    screen.getByRole('button', { name: 'once' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('leaves a key pressed on a nested control to that control', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    render(
      <div role="button" tabIndex={0} onKeyDown={pressKeys} onClick={outer}>
        card
        <span
          role="button"
          tabIndex={0}
          onKeyDown={pressKeys}
          onClick={(e) => (e.stopPropagation(), inner())}
        >
          pin
        </span>
      </div>,
    );
    screen.getByRole('button', { name: 'pin' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });

  it('activates an SVG node, which has no .click()', async () => {
    const onClick = vi.fn();
    render(
      <svg>
        <g role="button" tabIndex={0} aria-label="node" onKeyDown={pressKeys} onClick={onClick}>
          <circle r={4} />
        </g>
      </svg>,
    );
    (screen.getByRole('button', { name: 'node' }) as unknown as SVGGElement).focus();
    await userEvent.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('B-M6 call sites', () => {
  it("the assign dialog's close ✕ is a real button, and Enter closes the dialog", async () => {
    server.use(
      withMe({
        roles: ['editor'],
        permissions: ['docs.read', 'learning.read', 'learning.manage', 'notes.write'],
      }),
    );
    renderWithProviders(<App />, { route: `/learning/manage/${LI_BRIEF}` });
    await userEvent.click(await screen.findByRole('button', { name: 'הקצה' }));
    const dlg = await screen.findByRole('dialog', { name: 'הקצאת פריט למידה' });
    const close = screen.getByTitle('סגור (Esc)');
    expect(dlg.contains(close)).toBe(true);
    expect(close.tagName).toBe('BUTTON');
    expect(close).toHaveAttribute('type', 'button');
    close.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'הקצאת פריט למידה' })).toBeNull());
  });
});
