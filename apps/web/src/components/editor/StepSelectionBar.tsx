import { useState } from 'react';
import type { Block, Phase } from '@wecom/shared';

/**
 * Card 6c's floating bar for a multi-step selection (shift-click to extend).
 *
 * Every action here is one that is wrong to do a step at a time — moving three steps to another
 * group one by one reverses their order, deleting three renumbers twice on the way — which is why
 * the model operations behind it take the whole set.
 */
export function StepSelectionBar({
  count,
  phases,
  blocks,
  onMoveToPhase,
  onDuplicate,
  onSetBlock,
  onDelete,
  onClear,
}: {
  count: number;
  phases: Phase[];
  blocks: Block[];
  onMoveToPhase: (phaseId: string) => void;
  onDuplicate: () => void;
  onSetBlock: (block: Block | null) => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  const [menu, setMenu] = useState<null | 'phase' | 'block'>(null);
  if (count < 2) return null;

  return (
    <div className="sel-bar" role="region" aria-label="פעולות על השלבים שנבחרו">
      <b aria-live="polite">{count} שלבים</b>

      <div className="bulk-menu">
        <button
          className="btn xs"
          aria-expanded={menu === 'phase'}
          onClick={() => setMenu(menu === 'phase' ? null : 'phase')}
        >
          הזז לקבוצה ▾
        </button>
        {menu === 'phase' ? (
          <div className="menu">
            {phases.map((p, i) => (
              <button
                key={p.id}
                onClick={() => {
                  setMenu(null);
                  onMoveToPhase(p.id);
                }}
              >
                {p.label || `קבוצה ${i + 1}`}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <button className="btn xs" onClick={onDuplicate}>
        שכפל ⧉
      </button>

      <div className="bulk-menu">
        <button
          className="btn xs"
          aria-expanded={menu === 'block'}
          onClick={() => setMenu(menu === 'block' ? null : 'block')}
        >
          הפוך לבלוק משותף ▾
        </button>
        {menu === 'block' ? (
          <div className="menu">
            {!blocks.length ? <span className="muted small">אין בלוקים משותפים</span> : null}
            {blocks.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setMenu(null);
                  onSetBlock(b);
                }}
              >
                ⧉ {b.title}
              </button>
            ))}
            <button
              onClick={() => {
                setMenu(null);
                onSetBlock(null);
              }}
            >
              נתק מבלוק
            </button>
          </div>
        ) : null}
      </div>

      <button className="btn xs danger" onClick={onDelete}>
        מחק
      </button>
      <button className="btn xs ghost" onClick={onClear}>
        נקה בחירה <kbd>Esc</kbd>
      </button>
    </div>
  );
}
