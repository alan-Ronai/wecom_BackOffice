import { useCallback, useEffect, useId, useRef, useState } from 'react';

export interface OverflowItem {
  label: string;
  run: () => void;
  /**
   * When set, the item is a radio in `group` rather than a plain command — that is how the pane
   * switch survives being folded into the menu without losing which mode is current.
   */
  checked?: boolean;
  group?: string;
  disabled?: boolean;
}

/**
 * A-6. The `⋯` overflow the article topbar collapses into on a phone.
 *
 * Not `CardMenu`: that one is a `position: fixed` popup whose left edge is computed in JS
 * (`r.left - 180`), which is an LTR assumption that happens to look right in this RTL app only
 * because the cards sit where they do. This is positioned with `inset-inline-end`, so the browser
 * resolves the side from `dir` and the menu hangs from the correct edge in both directions with no
 * arithmetic to get wrong. `CardMenu` is left alone rather than retrofitted — it is on every
 * library card, and it has no keyboard story to preserve.
 *
 * The keyboard contract is the WAI-ARIA menu button one: `ArrowDown`/`Enter`/`Space` open at the
 * first item and `ArrowUp` at the last, arrows cycle, `Home`/`End` jump, `Escape` closes and hands
 * focus back to the trigger, and `Tab` closes rather than tabbing into a floating layer that is
 * about to disappear.
 */
export function OverflowMenu({
  label,
  items,
  triggerLabel = '⋯',
  className = '',
}: {
  label: string;
  items: OverflowItem[];
  triggerLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  // -1 while closed, and the index the roving focus sits on while open.
  const [active, setActive] = useState(-1);
  const id = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);

  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    setActive(-1);
    if (refocus) button.current?.focus();
  }, []);

  // Focus follows `active`, so every path that moves it (opening, arrows, Home/End) gets the
  // focus move for free instead of each remembering to do it.
  useEffect(() => {
    if (open && active >= 0) itemRefs.current[active]?.focus();
  }, [open, active]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) close(false);
    };
    // Deferred, or the very click that opened the menu closes it again.
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [open, close]);

  const openAt = (where: 'first' | 'last') => {
    if (!enabled.length) return;
    setOpen(true);
    setActive(where === 'first' ? enabled[0] : enabled[enabled.length - 1]);
  };

  const step = (delta: number) => {
    if (!enabled.length) return;
    const at = enabled.indexOf(active);
    // Wraps, so ArrowDown on the last item returns to the first.
    const next = at < 0 ? 0 : (at + delta + enabled.length) % enabled.length;
    setActive(enabled[next]);
  };

  return (
    <div className={`overflow-menu ${className}`.trim()} ref={wrap}>
      <button
        ref={button}
        type="button"
        className="btn sm overflow-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => (open ? close() : openAt('first'))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            openAt('first');
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            openAt('last');
          }
        }}
      >
        {triggerLabel}
      </button>
      {open ? (
        <div
          id={id}
          className="overflow-menu-list"
          role="menu"
          aria-label={label}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              close();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              step(1);
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              step(-1);
            } else if (e.key === 'Home') {
              e.preventDefault();
              setActive(enabled[0]);
            } else if (e.key === 'End') {
              e.preventDefault();
              setActive(enabled[enabled.length - 1]);
            } else if (e.key === 'Tab') {
              close(false);
            }
          }}
        >
          {items.map((it, i) => (
            <div
              key={it.label}
              ref={(el) => {
                itemRefs.current[i] = el;
              }}
              role={it.group ? 'menuitemradio' : 'menuitem'}
              aria-checked={it.group ? !!it.checked : undefined}
              aria-disabled={it.disabled || undefined}
              // Roving tabindex: exactly one item is in the tab order at a time.
              tabIndex={active === i ? 0 : -1}
              className={'overflow-menu-item' + (it.checked ? ' on' : '')}
              onClick={() => {
                if (it.disabled) return;
                close();
                it.run();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (it.disabled) return;
                  close();
                  it.run();
                }
              }}
            >
              {it.label}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
