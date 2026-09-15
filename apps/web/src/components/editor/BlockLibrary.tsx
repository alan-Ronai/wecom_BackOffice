import { useState } from 'react';
import type { Block } from '@wecom/shared';
import { PRESETS } from '../../lib/constants.js';
import type { BasicType } from '../../lib/editorModel.js';

const BASICS: { type: BasicType; label: string; ic: string; cls: string }[] = [
  { type: 'step', label: 'שלב', ic: '1', cls: 'round' },
  { type: 'branch', label: 'הסתעפות אם/אז', ic: '?', cls: 'navy' },
  { type: 'outcomes', label: 'תוצאות', ic: '✓', cls: 'ok' },
  { type: 'script', label: 'תסריט שיחה', ic: '“', cls: 'quote' },
  { type: 'description', label: 'תיאור · הנחיה', ic: '¶', cls: '' },
];

/**
 * G10 — the two quick-commands that open a picker instead of inserting something fixed. They are
 * not `BasicType`s: nothing is added until a field or a document has been chosen.
 */
const PICKERS: { kind: 'crm' | 'link'; label: string; ic: string; cls: string }[] = [
  { kind: 'crm', label: '+ שדה CRM', ic: '⌗', cls: 'navy' },
  { kind: 'link', label: '+ קישור', ic: '↗', cls: 'ok' },
];

/** Port of the legacy left pane: basics, shared blocks and the wording presets. */
export function BlockLibrary({
  blocks,
  usage,
  onBasic,
  onPick,
  onShared,
  onPreset,
  onNewBlock,
}: {
  blocks: Block[];
  usage: Record<string, number>;
  onBasic: (t: BasicType) => void;
  onPick: (kind: 'crm' | 'link') => void;
  onShared: (b: Block) => void;
  onPreset: (text: string) => void;
  onNewBlock: () => void;
}) {
  const [q, setQ] = useState('');
  const match = (t: string) => !q || t.toLowerCase().includes(q.toLowerCase());
  const basics = BASICS.filter((b) => match(b.label));
  const pickers = PICKERS.filter((p) => match(p.label));
  const shared = blocks.filter((b) => match(b.title + ' ' + b.actions.map((a) => a.text).join(' ')));

  return (
    <aside className="ed-blocks">
      <div
        className="eyebrow"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        ספריית בלוקים
      </div>
      <input
        type="text"
        placeholder="חפש בלוק…"
        aria-label="חפש בלוק"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="list">
        {basics.length || pickers.length ? (
          <>
            <div className="gl">
              <span>יסודות</span>
            </div>
            {basics.map((b) => (
              <div
                key={b.type}
                className="blk"
                draggable
                title="גרור לטופס או לחץ להוספה"
                role="button"
                tabIndex={0}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/kb', 'basic:' + b.type);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                onClick={() => onBasic(b.type)}
              >
                <span className={'ic ' + b.cls}>{b.ic}</span>
                {b.label}
              </div>
            ))}
            {pickers.map((p) => (
              <div
                key={p.kind}
                className="blk"
                style={{ cursor: 'pointer' }}
                title="בחר מתוך רשימה והוסף כפעולה לשלב"
                role="button"
                tabIndex={0}
                onClick={() => onPick(p.kind)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onPick(p.kind);
                  }
                }}
              >
                <span className={'ic ' + p.cls}>{p.ic}</span>
                <span>{p.label}</span>
              </div>
            ))}
          </>
        ) : null}
        <div className="gl">
          <span>בלוקים משותפים</span>
          <span>{blocks.length}</span>
        </div>
        {shared.map((b) => {
          const used = usage[b.id] ?? 0;
          return (
            <div
              key={b.id}
              className={'blk' + (used >= 3 ? ' shared' : '')}
              draggable
              role="button"
              tabIndex={0}
              onDragStart={(e) => {
                e.dataTransfer.setData('text/kb', 'shared:' + b.id);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              onClick={() => onShared(b)}
            >
              <span className={'ic ' + (used >= 3 ? 'red' : 'navy')}>⧉</span>
              <div className="tx">
                {b.title}
                <div>{(b.kind === 'script' ? 'תסריט' : `${b.actions.length} פעולות`) + ` · ב-${used}`}</div>
              </div>
            </div>
          );
        })}
        <div
          className="blk"
          style={{ borderStyle: 'dashed', justifyContent: 'center', color: 'var(--muted)' }}
          role="button"
          tabIndex={0}
          onClick={onNewBlock}
        >
          + בלוק משותף חדש
        </div>
        {PRESETS.map((g) => {
          const items = g.items.filter(match);
          if (!items.length) return null;
          return (
            <div key={g.group}>
              <div className="gl">
                <span>{g.group}</span>
              </div>
              {items.map((t) => (
                <div
                  key={t}
                  className="preset-item"
                  draggable
                  title="הוסף כפעולה לשלב הנבחר"
                  role="button"
                  tabIndex={0}
                  onDragStart={(e) => e.dataTransfer.setData('text/kb', 'preset:' + t)}
                  onClick={() => onPreset(t)}
                >
                  {t}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
