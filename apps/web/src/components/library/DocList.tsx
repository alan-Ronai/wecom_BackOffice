import { useEffect, useRef } from 'react';
import type { DocumentCard } from '@wecom/shared';
import { cat } from '../../lib/constants.js';
import { ago } from '../../lib/format.js';

/**
 * Card 6a's list mode: the same library, dense, and driven entirely from the keyboard.
 *
 * The point is triage — a lead scanning 52 items for what changed — so the row carries the four
 * facts you sort on (category, wave, state, last change) and nothing else, and `J`/`K`/`X`/`P`/`↵`
 * move, select, pin and open without the hand leaving the keyboard.
 *
 * The "changed since I last looked" dot is per *user*, compared against the last-seen map in
 * preferences, so it means "changed since **you** last opened it" rather than "changed recently".
 */
export function DocList({
  items,
  cursor,
  selected,
  changed,
  onCursor,
  onToggleSelect,
  onSelectAll,
  onOpen,
  onPin,
}: {
  items: DocumentCard[];
  cursor: number;
  selected: Set<string>;
  changed: (c: DocumentCard) => boolean;
  onCursor: (i: number) => void;
  onToggleSelect: (id: string, range?: boolean) => void;
  onSelectAll: (next: boolean) => void;
  onOpen: (c: DocumentCard) => void;
  onPin: (c: DocumentCard) => void;
}) {
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  const allSelected = items.length > 0 && items.every((c) => selected.has(c.id));

  return (
    <div className="doc-list" role="grid" aria-label="רשימת פריטי ידע" data-testid="doc-list">
      <div className="dl-row head" role="row">
        <span role="columnheader">
          <input
            type="checkbox"
            aria-label="בחר הכל"
            checked={allSelected}
            onChange={() => onSelectAll(!allSelected)}
          />
        </span>
        <span role="columnheader">פריט</span>
        <span role="columnheader">קטגוריה</span>
        <span role="columnheader">גל</span>
        <span role="columnheader">מצב</span>
        <span role="columnheader">שינוי אחרון</span>
      </div>
      {items.map((c, i) => {
        const isChanged = changed(c);
        return (
          <div
            key={c.id}
            ref={(el) => {
              rowRefs.current[i] = el;
            }}
            role="row"
            aria-selected={selected.has(c.id)}
            tabIndex={i === cursor ? 0 : -1}
            data-doc={c.id}
            data-nopeek=""
            className={
              'dl-row' +
              (i === cursor ? ' cur' : '') +
              (selected.has(c.id) ? ' sel' : '') +
              (c.status === 'partial' ? ' partial' : '')
            }
            onClick={(e) => {
              onCursor(i);
              if (e.shiftKey) onToggleSelect(c.id, true);
              else onOpen(c);
            }}
          >
            <span role="gridcell">
              <input
                type="checkbox"
                aria-label={`בחר את ${c.title}`}
                checked={selected.has(c.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => onToggleSelect(c.id)}
              />
            </span>
            <span role="gridcell" className="t">
              <button
                className={'star' + (c.pinned ? ' on' : '')}
                aria-label={c.pinned ? `בטל הצמדה של ${c.title}` : `הצמד את ${c.title}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onPin(c);
                }}
              >
                ★
              </button>
              <span>{c.title}</span>
              {isChanged ? (
                <span
                  className="changed-dot"
                  title="השתנה מאז הפעם האחרונה שפתחת"
                  aria-label="השתנה מאז שצפית"
                >
                  ●
                </span>
              ) : null}
              <span className="v">v{c.currentVersion}</span>
            </span>
            <span role="gridcell">{cat(c.category).label}</span>
            <span role="gridcell">גל {c.wave}</span>
            <span role="gridcell">
              {c.status === 'partial' ? 'חלקי' : c.status === 'draft' ? 'טיוטה' : 'מלא'}
            </span>
            <span role="gridcell" className="lat" dir="auto">
              {ago(Date.parse(c.updatedAt))}
            </span>
          </div>
        );
      })}
      <div className="dl-foot">
        <span>
          <kbd>J</kbd>/<kbd>K</kbd> ניווט
        </span>
        <span>
          <kbd>X</kbd> בחירה
        </span>
        <span>
          <kbd>P</kbd> הצמד
        </span>
        <span>
          <kbd>↵</kbd> פתח
        </span>
      </div>
    </div>
  );
}
