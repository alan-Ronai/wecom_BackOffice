import type { Block, CrmField, DocRef, Document, Phase, Step } from '@wecom/shared';
import { crmIn } from '@wecom/shared';
import { allSteps } from '../../lib/steps.js';
import { Fmt } from '../Fmt.js';
import { uid } from '../../lib/editorModel.js';

type Patch = (mutate: (s: Step) => void) => void;

function GotoSelect({
  doc,
  value,
  onChange,
}: {
  doc: Document;
  value: string | undefined;
  onChange: (v: string | undefined) => void;
}) {
  return (
    <select
      className="goto"
      title="קפיצה לשלב"
      aria-label="קפיצה לשלב"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || undefined)}
    >
      <option value="">הבא</option>
      {allSteps(doc).map((s) => (
        <option key={s.key} value={s.key}>
          → {s.num} {s.title.slice(0, 18)}
        </option>
      ))}
    </select>
  );
}

/** Port of the legacy step editor box, including the shared-block header and the branch editor. */
export function StepEditor({
  doc,
  step,
  phase,
  selected,
  fields,
  blocks,
  docs,
  onSelect,
  onPatch,
  onMove,
  onDelete,
  onDrop,
  onDetach,
  onEditBlock,
}: {
  doc: Document;
  step: Step;
  phase: Phase;
  selected: boolean;
  fields: CrmField[];
  blocks: Block[];
  /** The corpus, for naming the target of a `[[doc:id]]` an action carries (G10). */
  docs: DocRef[];
  /** Receives whether Shift was held, so the page can extend a multi-step selection (6c). */
  onSelect: (shift: boolean) => void;
  onPatch: Patch;
  onMove: (dir: number) => void;
  onDelete: () => void;
  onDrop: (data: string) => void;
  onDetach: () => void;
  onEditBlock: (id: string) => void;
}) {
  const block = step.blockId ? blocks.find((b) => b.id === step.blockId) : undefined;
  const names = fields.map((f) => f.name);
  /**
   * G10 — an action's `[[doc:<uuid>]]` is unreadable in a raw text field, which is exactly why the
   * link picker exists. Naming the target beside the field is what makes the token reviewable
   * without leaving the editor.
   */
  const linkTarget = (text: string) => {
    const m = /\[\[doc:([\w-]+)/.exec(text);
    return m ? docs.find((d) => d.id === m[1]) : undefined;
  };

  return (
    <div className="estep" data-estep={step.key}>
      <span className="n">{step.num}</span>
      <div
        className={'ebox' + (step.blockId ? ' shared' : '') + (selected ? ' sel' : '')}
        onClick={(e) => onSelect(e.shiftKey)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('text/kb')) e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();
          onDrop(e.dataTransfer.getData('text/kb'));
        }}
      >
        <div className="hd">
          {step.blockId ? (
            <span className="shared-hd" style={{ flex: 1 }}>
              <span className="blockbar">⧉ בלוק משותף</span>
              <span className="t">{block?.title ?? 'בלוק חסר'}</span>
              <span>מקושר · שינוי כאן יעדכן את כל המסמכים</span>
              <span
                className="detach"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  onDetach();
                }}
              >
                נתק העתק
              </span>
              {block ? (
                <span
                  className="detach"
                  role="button"
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditBlock(block.id);
                  }}
                >
                  ערוך בלוק
                </span>
              ) : null}
            </span>
          ) : (
            <input
              className="t"
              type="text"
              placeholder="כותרת השלב"
              aria-label={`כותרת שלב ${step.num}`}
              value={step.title}
              onChange={(e) => onPatch((s) => void (s.title = e.target.value))}
            />
          )}
          <span
            className="mv"
            title="העלה"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onMove(-1);
            }}
          >
            ↑
          </span>
          <span
            className="mv"
            title="הורד"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onMove(1);
            }}
          >
            ↓
          </span>
          <span
            className="drag"
            draggable
            title="גרור לסידור מחדש"
            onDragStart={(e) => e.dataTransfer.setData('text/kb', 'move:' + step.key)}
          >
            ⋮⋮ גרור
          </span>
          <span
            className="del"
            title="מחק שלב"
            role="button"
            tabIndex={0}
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
          >
            ✕
          </span>
        </div>

        {step.blockId ? (
          <div className="shared-body">
            {block ? (
              <Fmt
                text={
                  block.kind === 'script'
                    ? (block.script ?? '')
                    : block.actions.map((a) => a.text).join(' · ')
                }
                fields={fields}
                docs={docs}
              />
            ) : (
              'הבלוק בסל המיחזור'
            )}
          </div>
        ) : (
          <>
            {step.description != null ? (
              <input
                type="text"
                // "·" and not "/": a slash between two Hebrew words is a bidi-neutral character
                // that can land on the wrong side of the run, and every other separator in the
                // editor is already the middle dot.
                placeholder="תיאור · הנחיה"
                aria-label="תיאור"
                style={{ fontSize: 12.5 }}
                value={step.description}
                onChange={(e) => onPatch((s) => void (s.description = e.target.value))}
              />
            ) : null}
            {step.actions.map((a, ai) => {
              const detected = crmIn(a.text, names);
              const target = linkTarget(a.text);
              return (
                <div className="eact" key={a.id}>
                  <span className="caret">›</span>
                  <input
                    type="text"
                    aria-label={`פעולה ${ai + 1} בשלב ${step.num}`}
                    placeholder="פעולה… (שדות CRM מזוהים אוטומטית, **מודגש**, [[doc:id]] קישור)"
                    value={a.text}
                    onChange={(e) => onPatch((s) => void (s.actions[ai].text = e.target.value))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        onPatch((s) => s.actions.splice(ai + 1, 0, { id: uid('a'), text: '' }));
                      }
                      if (e.key === 'Backspace' && !a.text && step.actions.length > 1) {
                        e.preventDefault();
                        onPatch((s) => s.actions.splice(ai, 1));
                      }
                    }}
                  />
                  <span className={'st' + (detected.length || target ? ' ok' : '')}>
                    {detected.length
                      ? 'שדה מזוהה ✓'
                      : target
                        ? `↗ ${target.title}`
                        : /"[^"]+"/.test(a.text)
                          ? 'ציטוט · לא שדה CRM'
                          : ''}
                  </span>
                  <span
                    className="x"
                    role="button"
                    tabIndex={0}
                    onClick={() => onPatch((s) => s.actions.splice(ai, 1))}
                  >
                    ✕
                  </span>
                </div>
              );
            })}
            {step.script != null ? (
              <div className="escript">
                <textarea
                  rows={2}
                  aria-label="תסריט שיחה"
                  placeholder="תסריט שיחה לנציג"
                  value={step.script}
                  onChange={(e) => onPatch((s) => void (s.script = e.target.value))}
                />
                <span
                  className="x small muted"
                  style={{ cursor: 'pointer' }}
                  role="button"
                  tabIndex={0}
                  onClick={() => onPatch((s) => delete s.script)}
                >
                  הסר תסריט
                </span>
              </div>
            ) : null}
            {step.branch ? (
              <div className="ebr">
                <div className="qrow">
                  <i
                    style={{
                      fontStyle: 'normal',
                      width: 18,
                      height: 18,
                      borderRadius: 5,
                      background: 'var(--navy)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: 11,
                    }}
                  >
                    ?
                  </i>
                  <input
                    type="text"
                    aria-label="שאלת ההסתעפות"
                    placeholder="השאלה (מה מוצג?)"
                    value={step.branch.q}
                    onChange={(e) => onPatch((s) => void (s.branch!.q = e.target.value))}
                  />
                  <span
                    className="x muted"
                    style={{ cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    onClick={() => onPatch((s) => delete s.branch)}
                  >
                    ✕
                  </span>
                </div>
                {step.branch.options.map((o, oi) => (
                  <div className="orow" key={oi}>
                    <select
                      aria-label="סוג"
                      value={o.kind}
                      onChange={(e) =>
                        onPatch((s) => void (s.branch!.options[oi].kind = e.target.value as 'if' | 'then'))
                      }
                    >
                      <option value="if">אם</option>
                      <option value="then">אז</option>
                    </select>
                    <input
                      className="l"
                      type="text"
                      aria-label="תנאי"
                      placeholder="תנאי"
                      value={o.label}
                      onChange={(e) => onPatch((s) => void (s.branch!.options[oi].label = e.target.value))}
                    />
                    <input
                      className="tx"
                      type="text"
                      aria-label="מה עושים"
                      placeholder="מה עושים"
                      value={o.text}
                      onChange={(e) => onPatch((s) => void (s.branch!.options[oi].text = e.target.value))}
                    />
                    <GotoSelect
                      doc={doc}
                      value={o.goto}
                      onChange={(v) => onPatch((s) => void (s.branch!.options[oi].goto = v))}
                    />
                    <span
                      className="x muted"
                      style={{ cursor: 'pointer' }}
                      role="button"
                      tabIndex={0}
                      onClick={() => onPatch((s) => s.branch!.options.splice(oi, 1))}
                    >
                      ✕
                    </span>
                  </div>
                ))}
                <div className="addrow">
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      onPatch((s) => s.branch!.options.push({ kind: 'if', label: '', text: '' }))
                    }
                  >
                    + אפשרות
                  </span>
                </div>
              </div>
            ) : null}
          </>
        )}

        {step.outcomes.map((o, oi) => (
          <div className="eout" key={oi}>
            <select
              aria-label="סוג תוצאה"
              value={o.kind}
              onChange={(e) =>
                onPatch((s) => void (s.outcomes[oi].kind = e.target.value as 'ok' | 'next' | 'alert'))
              }
            >
              <option value="ok">✓ סיום</option>
              <option value="next">→ המשך</option>
              <option value="alert">⚑ חריג</option>
            </select>
            <input
              type="text"
              aria-label="טקסט התוצאה"
              placeholder="טקסט התוצאה"
              value={o.text}
              onChange={(e) => onPatch((s) => void (s.outcomes[oi].text = e.target.value))}
            />
            <GotoSelect
              doc={doc}
              value={o.goto}
              onChange={(v) => onPatch((s) => void (s.outcomes[oi].goto = v))}
            />
            <span
              className="x"
              role="button"
              tabIndex={0}
              onClick={() => onPatch((s) => s.outcomes.splice(oi, 1))}
            >
              ✕
            </span>
          </div>
        ))}

        <div className="addrow">
          {!step.blockId ? (
            <span
              role="button"
              tabIndex={0}
              onClick={() => onPatch((s) => s.actions.push({ id: uid('a'), text: '' }))}
            >
              + פעולה
            </span>
          ) : null}
          <span
            role="button"
            tabIndex={0}
            onClick={() =>
              onPatch((s) => s.outcomes.push({ kind: s.outcomes.length ? 'next' : 'ok', text: '' }))
            }
          >
            + תוצאה
          </span>
          {!step.blockId ? (
            <>
              <span role="button" tabIndex={0} onClick={() => onDrop('basic:branch')}>
                + הסתעפות
              </span>
              <span role="button" tabIndex={0} onClick={() => onDrop('basic:script')}>
                + תסריט
              </span>
              <span role="button" tabIndex={0} onClick={() => onDrop('basic:description')}>
                + תיאור
              </span>
            </>
          ) : null}
        </div>
      </div>
      <span hidden>{phase.id}</span>
    </div>
  );
}
