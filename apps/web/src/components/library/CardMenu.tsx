import { useEffect, useLayoutEffect, useRef, useState } from 'react';

export interface MenuItem {
  label: string;
  run: () => void;
}

/** The ⋯ kebab menu, anchored under the card (legacy KB.cardMenu). */
export function CardMenu({
  items,
  anchor,
  onClose,
}: {
  items: MenuItem[];
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const r = anchor.getBoundingClientRect();
  /**
   * The menu is `position: fixed` at the anchor, and wave 4 made it taller (the status actions
   * join it for anyone who may publish). Unclamped, the last item of a menu opened near the
   * bottom of the window lands below the fold and is simply unclickable — so it is measured once
   * and pulled up, or flipped above the anchor when even that does not fit.
   */
  const [top, setTop] = useState(r.bottom + 4);
  useLayoutEffect(() => {
    const h = ref.current?.offsetHeight ?? 0;
    const below = r.bottom + 4;
    const maxTop = window.innerHeight - h - 8;
    setTop(below <= maxTop ? below : Math.max(8, Math.min(maxTop, r.top - h - 4)));
  }, [r.bottom, r.top]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', h), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', h);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="slash"
      role="menu"
      style={{ position: 'fixed', width: 220, top, left: Math.max(8, r.left - 180) }}
    >
      {items.map((it) => (
        <div
          key={it.label}
          role="menuitem"
          tabIndex={0}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </div>
      ))}
    </div>
  );
}
