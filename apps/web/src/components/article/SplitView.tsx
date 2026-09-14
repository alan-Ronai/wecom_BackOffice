import { useEffect, useMemo, useRef } from 'react';
import type { Document } from '@wecom/shared';
import { useDocument } from '../../api/hooks/documents.js';
import { useBlocks } from '../../api/hooks/content.js';
import { resolvedSteps, type ResolvedStep } from '../../lib/steps.js';
import { useHotkeys } from '../../lib/keys.js';
import { useNav } from '../shell/navStore.js';
import { usePalette } from '../palette/paletteStore.js';
import { DocBody, type StepCtx } from './StepView.js';
import { useCall } from './useCall.js';

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

  /**
   * The right pane's own call state.
   *
   * It had none: the pane rendered the second document with `expandAll` and no notion of a current
   * step, so "two documents side by side" was really one live document next to a printout. Call
   * mode is the whole reason split view exists mid-call — the agent is following one procedure
   * while checking another — and the second one has to be followable too.
   */
  const callMode = ctx.callMode ?? false;
  // `syncUrl: false` — only one document can be named in the URL, and it is the left one.
  const rightCall = useCall(right.data, rightSteps, callMode, false);

  /**
   * Call-mode navigation for whichever pane is active. Both panes register in the `article` scope;
   * the third argument is what tells them apart, and `navStore.activeScope` is what decides — not
   * DOM focus, which sits on `<body>` for most of a call (see `lib/keys.ts#ActiveScope`).
   *
   * Only the navigation keys are bound here. `p`, `e`, `h` and `c` act on *the* document — pin it,
   * edit it, copy its summary — and the left pane is the document this route is about; rebinding
   * them per pane would make "ערוך" mean different things depending on where the last click landed.
   */
  useHotkeys(
    'article',
    {
      ArrowDown: (e) => {
        e.preventDefault();
        rightCall.move(1);
      },
      ArrowUp: (e) => {
        e.preventDefault();
        rightCall.move(-1);
      },
      Enter: () => {
        if (rightCall.activeKey)
          document
            .getElementById(`step-${rightCall.activeKey}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
    },
    'split-right',
  );

  const leftCtx: StepCtx = { ...ctx, connections: false, prefix: 'L-' };
  const rightCtx: StepCtx = {
    fields: ctx.fields,
    docs: ctx.docs,
    blocks: ctx.blocks,
    callMode,
    expandAll: !callMode,
    activeKey: rightCall.activeKey,
    results: rightCall.state.results,
    skipped: rightCall.skipped,
    onSelect: (k) => rightCall.setActive(k, false),
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
        {/*
          A click or a focus anywhere in a pane claims the keyboard for it. `onFocusCapture` as well
          as `onMouseDown` because tabbing into a pane is just as much a statement of intent as
          clicking it — and `aria-current` is what makes the claim visible to a screen reader, which
          otherwise has no way to know that ↓ is about to move in one pane and not the other.
        */}
        <div
          className={'pane' + (nav.activeScope === 'split-right' ? '' : ' pane-active')}
          aria-current={nav.activeScope !== 'split-right'}
          onMouseDown={() => nav.setActiveScope('split-left')}
          onFocusCapture={() => nav.setActiveScope('split-left')}
        >
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
        <div
          className={'pane' + (nav.activeScope === 'split-right' ? ' pane-active' : '')}
          aria-current={nav.activeScope === 'split-right'}
          onMouseDown={() => nav.setActiveScope('split-right')}
          onFocusCapture={() => nav.setActiveScope('split-right')}
        >
          <div className="pane-head">
            <b>{right.data?.title ?? ''}</b>
            {callMode && rightCall.activeKey ? (
              <span className="chip chip-gray">
                שלב {rightSteps.find((s) => s.key === rightCall.activeKey)?.num ?? ''}
              </span>
            ) : null}
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
