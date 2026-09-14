import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useDocument } from '../../api/hooks/documents.js';
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
  /**
   * I10: one targeted `GET /documents/{id}` for the hovered document. Reading the library list
   * meant the peek card rendered *nothing* for any document past card #50 — a hover that silently
   * does nothing is worse than a slow one. The lookup is cached under the same `keys.doc(id)` the
   * article page uses, so opening the document afterwards is instant.
   */
  const docQ = useDocument(peek?.docId);
  const doc = docQ.data;
  const stepCount = doc ? doc.phases.reduce((n, p) => n + p.steps.length, 0) : 0;

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

  if (!peek) return null;
  if (!doc)
    return (
      <div className="peek" style={{ top: peek.top, left: peek.left }} aria-busy="true">
        <div className="eyebrow">תצוגה מקדימה · ריחוף על קישור</div>
        <div className="m">{docQ.isError ? 'המסמך לא נמצא' : 'טוען…'}</div>
      </div>
    );
  return (
    <div
      className="peek"
      style={{ top: peek.top, left: peek.left }}
      onMouseEnter={() => hideTimer.current && clearTimeout(hideTimer.current)}
      onMouseLeave={() => hide()}
    >
      <div className="eyebrow">תצוגה מקדימה · ריחוף על קישור</div>
      <div className="t">{doc.title}</div>
      <div className="m">
        {CATS[doc.category].label} · {stepCount} שלבים · {PRI[doc.priority].label} · v{doc.currentVersion}
      </div>
      <div className="s">{doc.description}</div>
      <div className="b">
        <span
          className="p"
          role="button"
          tabIndex={0}
          onClick={() => {
            hide(true);
            nav.openDoc(doc.id, { title: doc.title });
          }}
        >
          פתח
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={() => {
            hide(true);
            nav.openDoc(doc.id, { title: doc.title, newTab: true });
          }}
        >
          פתח בלשונית
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={() => {
            hide(true);
            if (/^\/doc\//.test(loc.pathname)) nav.toggleSplit(doc.id);
            else go(`/doc/${doc.id}`);
          }}
        >
          פיצול מסך
        </span>
      </div>
    </div>
  );
}
