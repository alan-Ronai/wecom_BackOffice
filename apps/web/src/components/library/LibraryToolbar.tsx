import type { SavedView } from '../../api/hooks/collab.js';
import type { Density } from '../../api/hooks/uiPrefs.js';

/**
 * Card 6a's second row: saved views, density and the cards/list switch.
 *
 * All three are per-user state that must survive a reload and follow the user to another machine,
 * so they live in `/me/preferences` (`useUiPrefs`), not in component state.
 */
export function LibraryToolbar({
  views,
  activeViewId,
  onApplyView,
  onSaveView,
  onDeleteView,
  density,
  onDensity,
  mode,
  onMode,
}: {
  views: SavedView[];
  activeViewId: string | null;
  onApplyView: (v: SavedView | null) => void;
  onSaveView: () => void;
  onDeleteView: (v: SavedView) => void;
  density: Density;
  onDensity: (d: Density) => void;
  mode: 'cards' | 'list';
  onMode: (m: 'cards' | 'list') => void;
}) {
  return (
    <div className="lib-toolbar">
      <div className="saved-views" role="group" aria-label="תצוגות שמורות">
        <span className="eyebrow">תצוגות שמורות</span>
        <button
          className={'facet' + (activeViewId === null ? ' on' : '')}
          aria-pressed={activeViewId === null}
          onClick={() => onApplyView(null)}
        >
          כל הספרייה
        </button>
        {views.map((v) => (
          <span key={v.id} className={'saved-view' + (activeViewId === v.id ? ' on' : '')}>
            <button
              className={'facet' + (activeViewId === v.id ? ' on' : '')}
              aria-pressed={activeViewId === v.id}
              aria-label={`תצוגה שמורה: ${v.name}`}
              onClick={() => onApplyView(v)}
            >
              {v.name}
              {v.shared ? <span title="משותף לצוות"> ·⁂</span> : null}
            </button>
            <button
              className="view-x"
              aria-label={`מחק את התצוגה ${v.name}`}
              title="מחק תצוגה"
              onClick={() => onDeleteView(v)}
            >
              ✕
            </button>
          </span>
        ))}
        <button className="btn xs dashed" onClick={onSaveView}>
          ✚ שמור תצוגה
        </button>
      </div>

      <div className="lib-toggles">
        <div className="seg" role="group" aria-label="צפיפות">
          <button
            className={density === 'comfortable' ? 'on' : ''}
            aria-pressed={density === 'comfortable'}
            onClick={() => onDensity('comfortable')}
          >
            נוח
          </button>
          <button
            className={density === 'compact' ? 'on' : ''}
            aria-pressed={density === 'compact'}
            onClick={() => onDensity('compact')}
          >
            דחוס
          </button>
        </div>
        <div className="seg" role="group" aria-label="סוג תצוגה">
          <button
            className={mode === 'cards' ? 'on' : ''}
            aria-pressed={mode === 'cards'}
            onClick={() => onMode('cards')}
          >
            כרטיסים
          </button>
          <button
            className={mode === 'list' ? 'on' : ''}
            aria-pressed={mode === 'list'}
            onClick={() => onMode('list')}
          >
            רשימה
          </button>
        </div>
      </div>
    </div>
  );
}
