import { useEffect, useMemo, useRef, useState } from 'react';
import type { Category, DocumentCard } from '@wecom/shared';
import { useDocuments } from '../../api/hooks/documents.js';
import { CATS } from '../../lib/constants.js';

/**
 * Card 6b's breadcrumb quick-switch: the category crumb opens the sibling documents so an agent
 * who opened the wrong one is two keystrokes from the right one, instead of going back to the
 * library and losing the call's progress.
 *
 * Scoped to the category by the query itself (`GET /documents?category=…`), so it is a switcher
 * over a real result set rather than a filter over whatever page happens to be cached.
 */
export function QuickSwitch({
  category,
  currentId,
  onPick,
}: {
  category: Category;
  currentId: string;
  onPick: (c: DocumentCard) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const siblings = useDocuments(open ? { category, sort: 'wave' } : {});

  const items = useMemo(
    () => (open ? (siblings.data?.items ?? []).filter((c) => c.id !== currentId) : []),
    [open, siblings.data, currentId],
  );

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  return (
    <span className="quick-switch" ref={box}>
      <button
        className="qs-trigger"
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`מסמכים אחרים ב${CATS[category].label}`}
        onClick={() => {
          setOpen((v) => !v);
          setActive(0);
        }}
      >
        {CATS[category].label} ▾
      </button>
      {open ? (
        <div
          className="qs-menu"
          role="listbox"
          aria-label={`מסמכים אחרים ב${CATS[category].label}`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter' && items[active]) {
              e.preventDefault();
              setOpen(false);
              onPick(items[active]);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        >
          <div className="eyebrow">מסמכים אחרים ב{CATS[category].label} · ↑↓</div>
          {!items.length ? <div className="muted small">אין מסמכים נוספים בקטגוריה</div> : null}
          {items.map((c, i) => (
            <button
              key={c.id}
              role="option"
              aria-selected={i === active}
              className={i === active ? 'on' : ''}
              autoFocus={i === 0}
              onMouseEnter={() => setActive(i)}
              onClick={() => {
                setOpen(false);
                onPick(c);
              }}
            >
              {c.title}
              <span className="muted small">{c.stepCount} שלבים</span>
            </button>
          ))}
        </div>
      ) : null}
    </span>
  );
}
