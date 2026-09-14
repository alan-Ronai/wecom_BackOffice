import { useMemo, type ReactNode } from 'react';
import type { Block, CrmField, Document } from '@wecom/shared';
import { crmIn, stepText, stripFmt } from '@wecom/shared';
import type { ResolvedStep } from '../../lib/steps.js';
import { nextHints, type NextHint } from '../../lib/nextHint.js';
import type { CallResult } from '../../lib/callState.js';
import { Fmt } from '../Fmt.js';
import type { DocRef, FieldInfo } from '../../lib/format.js';

export interface StepCtx {
  activeKey?: string | null;
  results?: Record<string, CallResult>;
  skipped?: Set<string>;
  callMode?: boolean;
  expandAll?: boolean;
  connections?: boolean;
  prefix?: string;
  fields: FieldInfo[];
  docs: DocRef[];
  crmFields?: CrmField[];
  onSelect?: (key: string) => void;
  onOutcome?: (key: string, res: Omit<CallResult, 'ts'>) => void;
  onNote?: (key: string) => void;
  onShowBlock?: (id: string) => void;
  blocks?: Block[];
  renderConnections?: (step: ResolvedStep) => ReactNode;
  /**
   * 6b slots. `StepView` is shared by the article, the split panes and the editor preview, so the
   * collaboration strip (comments, the script picker) and the head badges are injected rather than
   * wired in — the editor preview must not start posting comments.
   */
  renderFooter?: (step: ResolvedStep) => ReactNode;
  /**
   * Named `render*` like its three siblings. These are render props — called as functions, never
   * mounted as `<Comp/>` — and the prefix is what tells a reader (and
   * `react/no-unstable-nested-components`) that an arrow returning JSX here is not a component
   * declared inside somebody's render.
   */
  renderHeadBadges?: (step: ResolvedStep) => ReactNode;
  /**
   * Wave 4 (§5.4): the per-step report entry point, next to "הערת נציג". A slot rather than a
   * flag for the same reason as the two above — the editor preview and the split panes render
   * `StepView` too, and neither should be able to file feedback on a step.
   */
  renderStepFeedback?: (step: ResolvedStep) => ReactNode;
}

const OUT_KBD = ['1', '2', '3'];

function stepHint(s: ResolvedStep, fieldNames: string[]): string {
  const bits: string[] = [];
  if (s.block) bits.push('בלוק משותף ⧉');
  if (s.actions.length) bits.push(`${s.actions.length} פעולות`);
  if (s.branch) bits.push('הסתעפות');
  if (s.script) bits.push('תסריט');
  if (s.extras?.stages) bits.push(`${s.extras.stages.length} שלבי שיחה`);
  if (crmIn(stepText(s, s.block), fieldNames).length) bits.unshift('CRM');
  return bits.join(' · ');
}

/**
 * Port of legacy KB.renderStep — shared by the article, the split panes and the editor preview.
 *
 * `hint` is A-1's per-step "what next", handed down by `DocBody` (which is the only caller that
 * knows the step *list*, and therefore the only one that can say where an outcome leads).
 */
export function StepView({ step, ctx, hint }: { step: ResolvedStep; ctx: StepCtx; hint?: NextHint }) {
  const cur = ctx.activeKey === step.key;
  const res = ctx.results?.[step.key];
  const done = !!res;
  const skipped = ctx.skipped?.has(step.key) ?? false;
  const open = cur || ctx.expandAll;
  const fieldNames = ctx.fields.map((f) => f.name);
  const optionCount = step.outcomes.length || step.branch?.options.length || 1;
  const crmNote = (text: string) => {
    const name = crmIn(text, fieldNames)[0];
    if (!name) return null;
    const f = ctx.fields.find((x) => x.name === name);
    const label = f?.status === 'renamed' ? 'שונה שם' : f?.status === 'new' ? 'חדש' : f ? 'תקין' : 'לא מוכר';
    return <span className="fnote">שדה CRM · {label}</span>;
  };

  return (
    <div
      className={
        'step' +
        (cur ? ' cur' : '') +
        (done ? ' done' : '') +
        (skipped ? ' skip' : '') +
        (step.tone === 'alert' ? ' alert' : '')
      }
      id={(ctx.prefix ?? 'step-') + step.key}
      data-step={step.key}
      data-block={step.blockId ?? undefined}
    >
      <div className={'n' + (step.num.length > 1 && /[א-ת]/.test(step.num) ? ' sub' : '')}>
        {done ? '✓' : step.num}
      </div>
      <div
        className="box"
        onClick={(e) => {
          if (
            ctx.onSelect &&
            !(e.target as HTMLElement).closest('.out,.bo,.note-add,.doc-link,.crm,.blockbar')
          )
            ctx.onSelect(step.key);
        }}
      >
        <div className="head">
          <Fmt className="t" text={step.title} fields={ctx.fields} docs={ctx.docs} noCrm />
          {step.hint ? <span className="h">{step.hint}</span> : null}
          {!open ? <span className="h">{stepHint(step, fieldNames)}</span> : null}
          {step.block ? (
            <span
              className="blockbar"
              title="בלוק משותף · לחץ לפרטים"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                ctx.onShowBlock?.(step.block!.id);
              }}
            >
              ⧉ בלוק משותף
            </span>
          ) : null}
          {step.blockMissing ? <span className="chip chip-red">בלוק חסר · בסל המיחזור</span> : null}
          {step.blockRefs.map((bid) => {
            const b = ctx.blocks?.find((x) => x.id === bid);
            return b ? (
              <span
                key={bid}
                className="blockbar ref"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  ctx.onShowBlock?.(bid);
                }}
              >
                ⧉ {b.title}
              </span>
            ) : null;
          })}
          {ctx.renderHeadBadges?.(step)}
          {/* A-1: the digits are advertised only where they do something. On a document whose
              steps carry no rule — the review drove one — the old unconditional hint told the
              agent to press keys that were inert. */}
          {cur && ctx.callMode && (!hint || hint.choices > 0) ? (
            <span className="k">↵ · {OUT_KBD.slice(0, Math.max(1, optionCount)).join(' / ')}</span>
          ) : null}
        </div>

        {open ? (
          <>
            {step.description ? (
              <Fmt as="div" className="desc" text={step.description} fields={ctx.fields} docs={ctx.docs} />
            ) : null}
            {step.extras?.signals ? (
              <div className="signals">
                {step.extras.signals.map((g) => (
                  <div key={g.label} className={g.tone === 'blue' ? 'blue' : ''}>
                    <div className="lbl">{g.label}</div>
                    <div className="pills">
                      {g.items.map((it) => (
                        <span className="pill" key={it}>
                          {it}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {step.script ? (
              <Fmt as="div" className="script" text={step.script} fields={ctx.fields} docs={ctx.docs} />
            ) : null}
            {step.actions.length ? (
              <div className="acts">
                {step.actions.map((a) => (
                  <div className="act" key={a.id}>
                    <span className="caret">›</span>
                    <span>
                      <Fmt text={a.text} fields={ctx.fields} docs={ctx.docs} />
                      {crmNote(a.text)}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {step.extras?.pillars ? (
              <div className="pillars">
                {step.extras.pillars.map((p) => (
                  <div key={p.label} className={p.tone ?? 'gray'}>
                    <b>{p.label}</b>
                    <Fmt text={p.text} fields={ctx.fields} docs={ctx.docs} />
                  </div>
                ))}
              </div>
            ) : null}
            {step.extras?.stages ? (
              <div className="stage-row">
                {step.extras.stages.map((st) => (
                  <div key={st.label}>
                    <div className="lbl">{st.label}</div>
                    {st.actions ? (
                      <div className="acts" style={{ marginTop: 0 }}>
                        {st.actions.map((a) => (
                          <div className="act" key={a}>
                            <span className="caret">›</span>
                            <Fmt text={a} fields={ctx.fields} docs={ctx.docs} />
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {st.script ? (
                      <Fmt
                        as="div"
                        className="script sm"
                        text={st.script}
                        fields={ctx.fields}
                        docs={ctx.docs}
                      />
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
            {step.extras?.objection ? (
              <div className="objection">
                <div className="q">
                  <span className="tag">לקוח</span>
                  <Fmt text={step.extras.objection.q} fields={ctx.fields} docs={ctx.docs} />
                </div>
                <div className="a">
                  <span className="tag rep" style={{ marginInlineEnd: 6 }}>
                    נציג
                  </span>
                  <Fmt text={step.extras.objection.a} fields={ctx.fields} docs={ctx.docs} />
                </div>
              </div>
            ) : null}
            {step.extras?.principles ? (
              <div className="principles">
                <div className="t">עקרונות-על לשיחה טובה</div>
                <ol>
                  {step.extras.principles.map((p) => (
                    <li key={p}>
                      <Fmt text={p} fields={ctx.fields} docs={ctx.docs} />
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}

            {step.branch ? (
              <div className="branch">
                <div className="q">
                  <i>?</i>
                  {step.branch.q}
                </div>
                {step.branch.options.map((o, i) => (
                  <div
                    key={`${o.label}-${i}`}
                    className={'bo' + (res?.kind === 'branch' && res.idx === i ? ' picked' : '')}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.onOutcome?.(step.key, { kind: 'branch', idx: i, label: o.label, goto: o.goto });
                    }}
                  >
                    <span className={'lbl ' + (o.kind ?? 'if')}>{o.label}</span>
                    <Fmt text={o.text} fields={ctx.fields} docs={ctx.docs} />
                    {ctx.callMode && cur ? <kbd style={{ marginInlineStart: 'auto' }}>{i + 1}</kbd> : null}
                  </div>
                ))}
              </div>
            ) : null}

            {/* `renderStepFeedback` is part of the condition, not just the contents: §5.4's
                per-step report button has to exist on a step that has no outcomes either. */}
            {step.outcomes.length || (ctx.callMode && cur) || ctx.renderStepFeedback ? (
              <div className="outs">
                {step.outcomes.map((o, i) => (
                  <span
                    key={`${o.text}-${i}`}
                    className={
                      'out ' + (o.kind ?? 'next') + (res?.kind === 'out' && res.idx === i ? ' picked' : '')
                    }
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.onOutcome?.(step.key, {
                        kind: 'out',
                        idx: i,
                        label: stripFmt(o.text),
                        goto: o.goto,
                      });
                    }}
                  >
                    <Fmt text={o.text} fields={ctx.fields} docs={ctx.docs} />
                    {ctx.callMode && cur && !step.branch ? <kbd>{i + 1}</kbd> : null}
                  </span>
                ))}
                {ctx.callMode && cur && ctx.onNote ? (
                  <span
                    className="note-add"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      ctx.onNote?.(step.key);
                    }}
                  >
                    ＋ הערת נציג<kbd>N</kbd>
                  </span>
                ) : null}
                {/* Not gated on `callMode && cur` like the two affordances above it: those are
                    keyboard hints that only mean something for the active step, while §5.4 asks
                    for the report button "per step" so an agent reports from where the problem is
                    without hunting for it. The slot is already `undefined` for the editor preview
                    and the split panes, so the callers that must not offer feedback still do not. */}
                {ctx.renderStepFeedback?.(step)}
              </div>
            ) : null}

            {/* A-1 (review §7 item 15): one line saying where the call goes from here — the next
                step, the steps the outcomes branch to, or "סיום השיחה". Under the outcomes, where
                the agent is looking when they decide, and derived from the document rather than
                from call state so it reads the same before anything is picked. */}
            {hint ? (
              <div className="next-hint" data-terminal={hint.terminal ? '' : undefined}>
                {hint.text}
              </div>
            ) : null}

            {cur && ctx.connections ? ctx.renderConnections?.(step) : null}
            {ctx.renderFooter?.(step)}
          </>
        ) : null}
      </div>
    </div>
  );
}

/** Port of legacy KB.renderDocBody. */
export function DocBody({ doc, ctx, steps }: { doc: Document; ctx: StepCtx; steps: ResolvedStep[] }) {
  // Computed here rather than per step: this is the one component that holds the whole ordered
  // list, which is what "where does outcome 2 lead" needs. One pass per body render.
  const hints = useMemo(() => nextHints(steps), [steps]);
  if (!steps.length)
    return (
      <div className="doc-body">
        <div className="empty">
          <b>המסמך עדיין ריק</b>הוסף שלבים בעורך
        </div>
      </div>
    );
  return (
    <div className="doc-body">
      {doc.phases.map((p) => (
        <div key={p.id}>
          {p.label ? (
            <div className="phase">
              <span className={'lbl' + (p.route ? ' route' : '')}>
                {(p.route ? (p.route === '1' ? '📍 ' : '🌐 ') : '') + p.label}
              </span>
              <span className="line" />
              {p.note ? <span className="chip chip-blue">{p.note}</span> : null}
            </div>
          ) : null}
          {p.steps.map((s) => {
            const resolved = steps.find((x) => x.key === s.key);
            return resolved ? <StepView key={s.key} step={resolved} ctx={ctx} hint={hints[s.key]} /> : null;
          })}
        </div>
      ))}
    </div>
  );
}
