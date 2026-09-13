import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDocuments } from '../../api/hooks/documents.js';
import { useNav } from '../shell/navStore.js';
import { useEntityDialogs } from '../library/dialogs.js';
import { CATS } from '../../lib/constants.js';
import { PRI } from '../../lib/constants.js';

interface PeekState {
  docId: string;
  top: number;
  left: number;
}

/**
 * Hover preview for any `[data-doc]` anchor plus the click delegation for `a.doc-link`
 * and `.crm[data-crm]` chips — the three places `<Fmt>` output needs behaviour.
 */
export function Peek() {
  const [peek, setPeek] = useState<PeekState | null>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nav = useNav();
  const go = useNavigate();
  const loc = useLocation();
  const dialogs = useEntityDialogs();
  const all = useDocuments({ sort: 'wave' });
  const card = all.data?.items.find((c) => c.id === peek?.docId);

  const hide = useCallback((now = false) => {
    if (showTimer.current) clearTimeout(showTimer.current);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (now) setPeek(null);
    else hideTimer.current = setTimeout(() => setPeek(null), 220);
  }, []);

  useEffect(() => hide(true), [loc.pathname, hide]);

  useEffect(() => {
    const over = (e: MouseEvent) => {
      const a = (e.target as HTMLElement)?.closest?.('[data-doc]') as HTMLElement | null;
      if (!a || a.dataset.nopeek != null) return;
      if (showTimer.current) clearTimeout(showTimer.current);
      if (hideTimer.current) clearTimeout(hideTimer.current);
      showTimer.current = setTimeout(() => {
        const r = a.getBoundingClientRect();
        setPeek({
          docId: a.dataset.doc!,
          top: r.bottom + 8,
          left: Math.min(Math.max(8, r.left + r.width / 2 - 150), Math.max(8, window.innerWidth - 308)),
        });
      }, 350);
    };
    const out = (e: MouseEvent) => {
      if ((e.target as HTMLElement)?.closest?.('[data-doc]')) hide();
    };
    const click = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      const link = t?.closest?.('a.doc-link[data-doc]') as HTMLElement | null;
      if (link) {
        e.preventDefault();
        hide(true);
        nav.openDoc(link.dataset.doc!, {
          step: link.dataset.step || undefined,
          newTab: e.ctrlKey || e.metaKey,
        });
        return;
      }
      const chip = t?.closest?.('.crm[data-crm]') as HTMLElement | null;
      if (chip && !t.closest('.eact')) {
        e.stopPropagation();
        dialogs.showField(chip.dataset.crm!);
      }
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('mouseout', out);
    document.addEventListener('click', click);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('mouseout', out);
      document.removeEventListener('click', click);
    };
  }, [nav, dialogs, hide]);

  if (!peek || !card) return null;
  return (
    <div
      className="peek"
      style={{ top: peek.top, left: peek.left }}
      onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
      onMouseLeave={() => hide()}
    >
      <div className="eyebrow">תצוגה מקדימה · ריחוף על קישור</div>
      <div className="t">{card.title}</div>
      <div className="m">
        {CATS[card.category].label} · {card.stepCount} שלבים · {PRI[card.priority].label} · v
        {card.currentVersion}
      </div>
      <div className="s">{card.description}</div>
      <div className="b">
        <span
          className="p"
          role="button"
          tabIndex={0}
          onClick={() => {
            hide(true);
            nav.openDoc(card.id, { title: card.title });
          }}
        >
          פתח
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={() => {
            hide(true);
            nav.openDoc(card.id, { title: card.title, newTab: true });
          }}
        >
          פתח בלשונית
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={() => {
            hide(true);
            if (/^\/doc\//.test(loc.pathname)) nav.toggleSplit(card.id);
            else go(`/doc/${card.id}`);
          }}
        >
          פיצול מסך
        </span>
      </div>
    </div>
  );
}
