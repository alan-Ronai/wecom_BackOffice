import type { EditorHistory } from '../../lib/editorHistory.js';

const clock = (at: number) =>
  new Date(at).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/**
 * Card 6c's "נקודות שמירה": undo, redo and the labelled points between them.
 *
 * The labels are what makes the strip worth having over a bare Ctrl Z — "שלב 8", "בלוק" — so
 * every `update()` in the editor passes one describing the edit rather than "שינוי".
 */
export function HistoryStrip({
  history,
  onUndo,
  onRedo,
  onJump,
}: {
  history: EditorHistory;
  onUndo: () => void;
  onRedo: () => void;
  onJump: (index: number) => void;
}) {
  const { entries, index, canUndo, canRedo } = history;
  // Oldest first, newest last, the last few only — the strip is an orientation aid, not a log.
  const shown = entries.slice(-6);
  const offset = entries.length - shown.length;

  return (
    <div className="hist-strip" role="group" aria-label="נקודות שמירה">
      <button
        className="btn ghost xs"
        aria-label="בטל שינוי"
        title="בטל · Ctrl Z"
        disabled={!canUndo}
        onClick={onUndo}
      >
        ↶
      </button>
      <button
        className="btn ghost xs"
        aria-label="בצע מחדש"
        title="בצע מחדש · Ctrl Shift Z"
        disabled={!canRedo}
        onClick={onRedo}
      >
        ↷
      </button>
      <span className="muted small">נקודות שמירה:</span>
      {shown.map((e, i) => {
        const real = offset + i;
        return (
          <button
            key={`${e.at}-${real}`}
            className={'hist-point' + (real === index ? ' on' : '') + (real > index ? ' future' : '')}
            aria-current={real === index}
            aria-label={`${clock(e.at)} · ${e.label}`}
            onClick={() => onJump(real)}
          >
            <bdi className="lat" dir="ltr">
              {clock(e.at)}
            </bdi>
            <span>{e.label}</span>
          </button>
        );
      })}
    </div>
  );
}
