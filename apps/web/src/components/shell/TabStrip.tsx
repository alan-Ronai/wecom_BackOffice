import { useLocation, useNavigate } from 'react-router-dom';
import { useNav } from './navStore.js';
import { usePalette } from '../palette/paletteStore.js';

/** Port of legacy renderTabs — open documents, back/forward and the split toggle. */
export function TabStrip() {
  const nav = useNav();
  const palette = usePalette();
  const go = useNavigate();
  const loc = useLocation();
  const activeDocId = /^\/doc\/([^/]+)/.exec(loc.pathname)?.[1];
  if (!nav.tabs.length) return null;

  const dirBack = document.dir === 'rtl' ? '→' : '←';
  const dirFwd = document.dir === 'rtl' ? '←' : '→';

  return (
    <div className="tabstrip" id="tabstrip">
      {nav.tabs.map((t, i) => (
        <div
          key={t.docId}
          className={'tab' + (t.docId === activeDocId ? ' on' : '')}
          title={t.title}
          role="button"
          tabIndex={0}
          onClick={() => {
            nav.setActiveTab(i);
            go(`/doc/${t.docId}`);
          }}
          onAuxClick={(e) => {
            if (e.button === 1) {
              e.preventDefault();
              nav.closeTab(i);
            }
          }}
        >
          <span className="t">{t.title}</span>
          <span
            className="x"
            title="סגור (W)"
            aria-label={`סגור לשונית · ${t.title}`}
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              nav.closeTab(i);
            }}
          >
            ×
          </span>
        </div>
      ))}
      <span
        className="plus"
        title="לשונית חדשה · Alt T"
        aria-label="לשונית חדשה"
        role="button"
        tabIndex={0}
        onClick={() => palette.open({ mode: 'newtab' })}
      >
        +
      </span>
      <div className="navbtns">
        <button title="אחורה · Alt ←" aria-label="אחורה" disabled={!nav.canBack} onClick={nav.back}>
          {dirBack}
        </button>
        <button title="קדימה · Alt →" aria-label="קדימה" disabled={!nav.canForward} onClick={nav.forward}>
          {dirFwd}
        </button>
        <button
          className={nav.split ? 'on' : ''}
          aria-label="פיצול מסך"
          aria-pressed={!!nav.split}
          title="פיצול מסך · Ctrl \"
          onClick={() => nav.toggleSplit()}
        >
          ⫿
        </button>
      </div>
    </div>
  );
}
