import { useEffect, useRef } from 'react';

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

  const r = anchor.getBoundingClientRect();
  return (
    <div
      ref={ref}
      className="slash"
      role="menu"
      style={{ position: 'fixed', width: 220, top: r.bottom + 4, left: Math.max(8, r.left - 180) }}
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
