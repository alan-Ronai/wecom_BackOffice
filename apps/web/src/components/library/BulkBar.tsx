import { useState } from 'react';
import type { Category, Priority, Wave } from '@wecom/shared';
import { CATS, CAT_KEYS, PRI } from '../../lib/constants.js';
import type { BulkBody } from '../../api/hooks/collab.js';

/**
 * Card 6a's floating bar. Appears only while something is selected, and every action is one
 * `POST /documents/bulk` — the server applies the permission check per document and answers with
 * what it **skipped**, so the caller can say "23 מתוך 25" instead of claiming a clean sweep.
 */
export function BulkBar({
  count,
  busy,
  can,
  onAction,
  onExport,
  onClear,
}: {
  count: number;
  busy: boolean;
  can: (p: 'docs.edit' | 'docs.delete' | 'docs.publish') => boolean;
  onAction: (a: BulkBody['action'], extra?: Partial<BulkBody>) => void;
  onExport: () => void;
  onClear: () => void;
}) {
  const [menu, setMenu] = useState<null | 'wave' | 'priority' | 'category'>(null);
  if (!count) return null;

  const close = () => setMenu(null);
  const pick = (a: BulkBody['action'], extra: Partial<BulkBody>) => {
    close();
    onAction(a, extra);
  };

  return (
    <div className="bulkbar" role="region" aria-label="פעולות על הפריטים שנבחרו">
      <b aria-live="polite">{count} נבחרו</b>
      {can('docs.edit') ? (
        <>
          <button className="btn xs" disabled={busy} onClick={() => onAction('pin')}>
            📌 הצמד
          </button>
          <button className="btn xs" disabled={busy} onClick={() => onAction('unpin')}>
            בטל הצמדה
          </button>
          <div className="bulk-menu">
            <button
              className="btn xs"
              aria-expanded={menu === 'wave'}
              onClick={() => setMenu(menu === 'wave' ? null : 'wave')}
            >
              שנה גל ▾
            </button>
            {menu === 'wave' ? (
              <div className="menu">
                {([1, 2, 3] as const).map((w) => (
                  <button key={w} onClick={() => pick('set-wave', { wave: w as Wave })}>
                    גל {w}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="bulk-menu">
            <button
              className="btn xs"
              aria-expanded={menu === 'priority'}
              onClick={() => setMenu(menu === 'priority' ? null : 'priority')}
            >
              שכיחות ▾
            </button>
            {menu === 'priority' ? (
              <div className="menu">
                {(Object.keys(PRI) as Priority[]).map((p) => (
                  <button key={p} onClick={() => pick('set-priority', { priority: p })}>
                    {PRI[p].label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="bulk-menu">
            <button
              className="btn xs"
              aria-expanded={menu === 'category'}
              onClick={() => setMenu(menu === 'category' ? null : 'category')}
            >
              קטגוריה ▾
            </button>
            {menu === 'category' ? (
              <div className="menu">
                {CAT_KEYS.map((c) => (
                  <button key={c} onClick={() => pick('set-category', { category: c as Category })}>
                    {CATS[c].label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
      <button className="btn xs" onClick={onExport}>
        ⬇ ייצא
      </button>
      {can('docs.edit') ? (
        <button className="btn xs" disabled={busy} onClick={() => onAction('request-review')}>
          📤 שלח לסקירה
        </button>
      ) : null}
      {can('docs.delete') ? (
        <button className="btn xs danger" disabled={busy} onClick={() => onAction('delete')}>
          מחק
        </button>
      ) : null}
      <button className="btn xs ghost" onClick={onClear}>
        נקה בחירה <kbd>Esc</kbd>
      </button>
    </div>
  );
}
