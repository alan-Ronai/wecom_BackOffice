import { useMemo, useState } from 'react';
import type { Block } from '@wecom/shared';

export type SlashCommand =
  | { kind: 'basic'; value: string }
  | { kind: 'shared'; value: string }
  | { kind: 'phase'; value: '' }
  | { kind: 'title'; value: string };

/** Port of the legacy drop zone with the `/` quick-command menu. */
export function DropZone({
  onCommand,
  onDrop,
  blocks,
}: {
  onCommand: (c: SlashCommand) => void;
  onDrop: (data: string) => void;
  blocks: Block[];
}) {
  const [value, setValue] = useState('');
  const [idx, setIdx] = useState(0);
  const [over, setOver] = useState(false);

  const cmds = useMemo<[string, SlashCommand][]>(
    () => [
      ['✚ שלב חדש', { kind: 'basic', value: 'step' }],
      ['? הסתעפות אם/אז', { kind: 'basic', value: 'branch' }],
      ['✓ תוצאות', { kind: 'basic', value: 'outcomes' }],
      ['“ תסריט שיחה', { kind: 'basic', value: 'script' }],
      ...blocks.map<[string, SlashCommand]>((b) => [
        `⧉ ${b.title} (בלוק משותף)`,
        { kind: 'shared', value: b.id },
      ]),
      ['▤ קבוצת שלבים חדשה', { kind: 'phase', value: '' }],
    ],
    [blocks],
  );

  const open = value.startsWith('/');
  const q = value.replace(/^\//, '').trim().toLowerCase();
  const items = open ? cmds.filter(([l]) => !q || l.toLowerCase().includes(q)) : [];

  return (
    <div className="dropzone">
      <span className="n" />
      <div
        className={'z' + (over ? ' over' : '')}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/kb')) {
            e.preventDefault();
            setOver(true);
          }
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          onDrop(e.dataTransfer.getData('text/kb'));
        }}
      >
        <span>שחרר בלוק כאן · או </span>
        <b role="button" tabIndex={0} onClick={() => setValue('/')}>
          /
        </b>
        <span> לפקודה מהירה</span>
        <input
          type="text"
          aria-label="פקודה מהירה"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setIdx(0);
          }}
          onKeyDown={(e) => {
            if (!open) {
              if (e.key === 'Enter' && value.trim()) {
                e.preventDefault();
                onCommand({ kind: 'title', value: value.trim() });
                setValue('');
              }
              return;
            }
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIdx((i) => Math.min(items.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIdx((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const it = items[idx];
              setValue('');
              if (it) onCommand(it[1]);
            } else if (e.key === 'Escape') {
              e.stopPropagation();
              setValue('');
            }
          }}
        />
        {open ? (
          <div className="slash" role="listbox">
            {items.length ? (
              items.map(([label, cmd], i) => (
                <div
                  key={label}
                  role="option"
                  aria-selected={i === idx}
                  className={i === idx ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setValue('');
                    onCommand(cmd);
                  }}
                >
                  {label}
                </div>
              ))
            ) : (
              <div className="muted">אין פקודה תואמת</div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
