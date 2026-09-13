import { useEffect, useMemo, useRef } from 'react';
import type { Document } from '@wecom/shared';
import { useDocument } from '../../api/hooks/documents.js';
import { useBlocks } from '../../api/hooks/content.js';
import { resolvedSteps, type ResolvedStep } from '../../lib/steps.js';
import { useNav } from '../shell/navStore.js';
import { usePalette } from '../palette/paletteStore.js';
import { DocBody, type StepCtx } from './StepView.js';

/** Two documents side by side with the legacy block-synced scroll. */
export function SplitView({
  doc,
  rightId,
  ctx,
  steps,
}: {
  doc: Document;
  rightId: string;
  ctx: StepCtx;
  steps: ResolvedStep[];
}) {
  const nav = useNav();
  const palette = usePalette();
  const right = useDocument(rightId);
  const blocks = useBlocks();
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const rightSteps = useMemo(() => resolvedSteps(right.data, blocks.data), [right.data, blocks.data]);

  const shared = useMemo(() => {
    const mine = new Set(steps.map((s) => s.blockId).filter(Boolean));
    return rightSteps.filter((s) => s.blockId && mine.has(s.blockId));
  }, [steps, rightSteps]);

  useEffect(() => {
    const l = leftRef.current;
    const r = rightRef.current;
    if (!l || !r) return;
    let lock = 0;
    const sync = (from: HTMLElement, to: HTMLElement) => () => {
      if (lock) return;
      const top = from.getBoundingClientRect().top;
      const near = [...from.querySelectorAll<HTMLElement>('.step[data-block]')].find((n) => {
        const b = n.getBoundingClientRect();
        return b.top >= top - 20 && b.top <= top + 140;
      });
      if (!near) return;
      const target = to.querySelector<HTMLElement>(`.step[data-block="${near.dataset.block}"]`);
      if (!target) return;
      lock = 1;
      to.scrollTop +=
        target.getBoundingClientRect().top -
        to.getBoundingClientRect().top -
        (near.getBoundingClientRect().top - top);
      setTimeout(() => {
        lock = 0;
      }, 120);
    };
    const a = sync(l, r);
    const b = sync(r, l);
    l.addEventListener('scroll', a);
    r.addEventListener('scroll', b);
    return () => {
      l.removeEventListener('scroll', a);
      r.removeEventListener('scroll', b);
    };
  }, [right.data]);

  const leftCtx: StepCtx = { ...ctx, connections: false, prefix: 'L-' };
  const rightCtx: StepCtx = {
    fields: ctx.fields,
    docs: ctx.docs,
    blocks: ctx.blocks,
    expandAll: true,
    prefix: 'R-',
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div className="split-banner">
        <b>פיצול מסך</b>
        <span className="muted">
          {shared.length
            ? `· גלילה מסונכרנת לפי בלוק משותף: ${shared.map((s) => '⧉ ' + (s.block?.title ?? '')).join(', ')}`
            : '· אין בלוק משותף בין שני המסמכים — גלילה חופשית'}
        </span>
        <span className="small muted">⫿ Ctrl \</span>
        <button className="btn xs" onClick={() => palette.open({ mode: 'split' })}>
          החלף מסמך
        </button>
        <button className="btn xs" onClick={() => nav.toggleSplit()}>
          ✕ סגור פיצול
        </button>
      </div>
      <div className="splitwrap">
        <div className="pane">
          <div className="pane-head">
            <b>{doc.title}</b>
            <span className="chip chip-gray">
              שלב {steps.find((s) => s.key === ctx.activeKey)?.num ?? ''}
            </span>
          </div>
          <div className="doc-scroll no-aside" ref={leftRef}>
            <article className="doc">
              <DocBody doc={doc} ctx={leftCtx} steps={steps} />
            </article>
          </div>
        </div>
        <div className="pane">
          <div className="pane-head">
            <b>{right.data?.title ?? ''}</b>
            <button className="btn xs" onClick={() => nav.openDoc(rightId)}>
              פתח מלא
            </button>
          </div>
          <div className="doc-scroll no-aside" ref={rightRef}>
            <article className="doc">
              {right.data ? <DocBody doc={right.data} ctx={rightCtx} steps={rightSteps} /> : null}
            </article>
          </div>
        </div>
      </div>
    </div>
  );
}
