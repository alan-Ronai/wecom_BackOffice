import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { stripFmt } from '@wecom/shared';
import { useDocument, useDocuments, useRecordView, useTogglePin } from '../../api/hooks/documents.js';
import { useAddNote, useBlocks, useFields } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { CATS } from '../../lib/constants.js';
import { copy } from '../../lib/format.js';
import { useHotkeys } from '../../lib/keyboard.js';
import { resolvedSteps } from '../../lib/steps.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useNav } from '../shell/navStore.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { useEntityDialogs } from '../library/dialogs.js';
import { DocBody, type StepCtx } from './StepView.js';
import { StepConnections } from './StepConnections.js';
import { Panel } from './Panel.js';
import { SplitView } from './SplitView.js';
import { useCall } from './useCall.js';
import type { FieldInfo } from '../../lib/format.js';

/** Stable empty array so memoised children are not invalidated on every render (M1). */
const EMPTY_FIELDS: FieldInfo[] = [];

export function ArticlePage() {
  const { id, step: stepParam } = useParams<{ id: string; step?: string }>();
  const go = useNavigate();
  const nav = useNav();
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const dialogs = useEntityDialogs();

  const docQ = useDocument(id);
  const blocks = useBlocks();
  const fieldsQ = useFields();
  const cards = useDocuments({ sort: 'wave' });
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();
  const recordView = useRecordView();
  const togglePin = useTogglePin();
  const addNote = useAddNote(id ?? '');

  const doc = docQ.data;
  const steps = useMemo(() => resolvedSteps(doc, blocks.data), [doc, blocks.data]);
  // Stable identity: a fresh `[]` on every render busts <Fmt>'s useMemo for every step.
  const fields: FieldInfo[] = useMemo(() => fieldsQ.data ?? EMPTY_FIELDS, [fieldsQ.data]);
  const docRefs = useMemo(
    () => (cards.data?.items ?? []).map((c) => ({ id: c.id, title: c.title })),
    [cards.data],
  );
  const callMode = prefs.data?.callMode !== false;
  const showPanel = prefs.data?.panel !== false;
  const call = useCall(doc, steps, callMode);
  const [panelMobile, setPanelMobile] = useState(false);
  const [jumpBuf, setJumpBuf] = useState<string | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewed = useRef<string>('');

  useEffect(() => {
    if (!doc || viewed.current === doc.id) return;
    viewed.current = doc.id;
    recordView.mutate(doc.id);
  }, [doc, recordView]);

  useEffect(() => {
    if (doc) nav.setTitle(`/doc/${doc.id}`, doc.title);
  }, [doc, nav]);

  // A step in the URL wins over the stored progress (deep links from search / peek).
  const appliedParam = useRef<string>('');
  useEffect(() => {
    if (!stepParam || !steps.length) return;
    const tag = `${id}:${stepParam}`;
    if (appliedParam.current === tag) return;
    if (steps.some((s) => s.key === stepParam)) {
      appliedParam.current = tag;
      call.setActive(stepParam, false);
    }
  }, [stepParam, steps, id, call]);

  const pinned = cards.data?.items.find((c) => c.id === doc?.id)?.pinned ?? false;

  const addNoteFor = async (stepKey: string) => {
    const s = steps.find((x) => x.key === stepKey);
    const text = await modal.prompt(
      `הערת נציג · שלב ${s?.num ?? ''}`,
      'מה כדאי שנציגים אחרים ידעו בשלב הזה?',
      '',
      true,
    );
    if (!text?.trim()) return;
    await addNote.mutateAsync({ stepKey, text: text.trim() });
    toast('ההערה נוספה', 'ok');
  };

  const armJump = () => {
    setJumpBuf('');
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    jumpTimer.current = setTimeout(() => setJumpBuf(null), 1500);
  };
  const commitJump = (buf: string) => {
    if (jumpTimer.current) clearTimeout(jumpTimer.current);
    setJumpBuf(null);
    const s = steps.find((x) => x.num === buf);
    if (s) call.setActive(s.key);
    else toast(`אין שלב ${buf}`, 'warn');
  };

  const digit = (d: string) => {
    if (jumpBuf != null) {
      const next = jumpBuf + d;
      setJumpBuf(next);
      if (jumpTimer.current) clearTimeout(jumpTimer.current);
      jumpTimer.current = setTimeout(() => commitJump(next), 450);
      return;
    }
    // Legacy gated outcome selection on 1-3, and the keymap card still advertises 1-3.
    if (!/^[1-3]$/.test(d)) return;
    if (!callMode || !call.activeKey) return;
    const s = steps.find((x) => x.key === call.activeKey);
    if (!s) return;
    const i = Number(d) - 1;
    if (s.branch?.options[i])
      call.pickOutcome(s.key, {
        kind: 'branch',
        idx: i,
        label: s.branch.options[i].label,
        goto: s.branch.options[i].goto,
      });
    else if (s.outcomes[i])
      call.pickOutcome(s.key, {
        kind: 'out',
        idx: i,
        label: stripFmt(s.outcomes[i].text),
        goto: s.outcomes[i].goto,
      });
  };

  useHotkeys(
    {
      ArrowDown: (e) => {
        e.preventDefault();
        call.move(1);
      },
      ArrowUp: (e) => {
        e.preventDefault();
        call.move(-1);
      },
      Enter: () => {
        if (jumpBuf != null) commitJump(jumpBuf);
        else if (call.activeKey)
          document
            .getElementById(`step-${call.activeKey}`)
            ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      },
      g: () => armJump(),
      // 1-3 only, matching legacy and the keymap card below. `digit` doubles as the G-jump
      // buffer, so every digit still feeds a jump while one is armed.
      '0': () => digit('0'),
      '1': () => digit('1'),
      '2': () => digit('2'),
      '3': () => digit('3'),
      '4': () => digit('4'),
      '5': () => digit('5'),
      '6': () => digit('6'),
      '7': () => digit('7'),
      '8': () => digit('8'),
      '9': () => digit('9'),
      n: () => {
        if (call.activeKey) void addNoteFor(call.activeKey);
      },
      p: () => {
        if (doc) {
          togglePin.mutate({ id: doc.id, pinned: !pinned });
          toast(pinned ? 'הוסרה הצמדה' : '★ הוצמד');
        }
      },
      c: () => {
        void copy(call.summaryText());
        toast('הועתק ללוח', 'ok');
      },
      e: () => {
        if (doc && can('docs.edit', doc)) go(`/edit/${doc.id}`);
      },
      h: () => {
        if (doc) go(`/history/${doc.id}`);
      },
    },
    [call, doc, jumpBuf, pinned, can, steps, callMode],
  );

  if (docQ.isPending) return <div className="route-loading">טוען…</div>;
  // Category scope is enforced per document, so "you may not see this" is a distinct outcome
  // from "this is gone" — telling an agent to check the trash for a document they simply lack
  // scope for sends them the wrong way.
  if (docQ.error instanceof ApiError && docQ.error.status === 403)
    return (
      <div className="empty">
        <b>אין לך הרשאה למסמך הזה</b>הקטגוריה מחוץ להרשאות שלך · פנו למנהל הצוות
      </div>
    );
  if (!doc)
    return (
      <div className="empty">
        <b>המסמך לא נמצא</b>ייתכן שהועבר לסל המיחזור
      </div>
    );

  const active = steps.find((s) => s.key === call.activeKey);
  const ctx: StepCtx = {
    activeKey: call.activeKey,
    results: call.state.results,
    skipped: call.skipped,
    callMode,
    expandAll: !callMode,
    connections: true,
    fields,
    docs: docRefs,
    blocks: blocks.data,
    onSelect: (k) => call.setActive(k, false),
    onOutcome: call.pickOutcome,
    onNote: (k) => void addNoteFor(k),
    onShowBlock: dialogs.showBlock,
    renderConnections: (s) => (
      <StepConnections
        doc={doc}
        step={s}
        steps={steps}
        fields={fields}
        onOpenStep={(k) => call.setActive(k)}
      />
    ),
  };

  const pct = Math.round((call.done / Math.max(1, steps.length)) * 100);
  const ai = steps.findIndex((s) => s.key === call.activeKey);
  const railSteps = steps.filter((s) => !s.phase.route || s.phase.id === active?.phase.id);
  const hidden = steps.length - railSteps.length;

  return (
    <>
      <div className="topbar h56">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <a role="button" tabIndex={0} onClick={() => go(`/library/${doc.category}`)}>
            {CATS[doc.category].label}
          </a>
          <span className="sep">/</span>
          <b>{doc.title}</b>
        </div>
        <div className="actions">
          <span
            className={'callpill' + (callMode ? '' : ' off')}
            title="מצב שיחה: ניווט במקלדת, מעקב תוצאות וסיכום לתיעוד"
            role="button"
            tabIndex={0}
            onClick={() =>
              savePrefs.mutate({
                ...(prefs.data ?? {
                  theme: null,
                  font: 'plex',
                  panel: true,
                  callMode: true,
                  sidebarExpanded: false,
                }),
                callMode: !callMode,
              })
            }
          >
            <span className="pulse" />
            <span>{callMode ? `מצב שיחה · ${call.elapsed}` : 'מצב קריאה'}</span>
            {callMode && call.done ? (
              <span
                style={{ opacity: 0.7, cursor: 'pointer' }}
                title="אפס מעקב"
                role="button"
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  call.reset();
                }}
              >
                {' ↺'}
              </span>
            ) : null}
          </span>
          <button className="btn sm" onClick={() => window.print()}>
            הדפסה
          </button>
          <button className="btn sm" onClick={() => togglePin.mutate({ id: doc.id, pinned: !pinned })}>
            {pinned ? '★ מוצמד' : '☆ הצמד'}
          </button>
          {can('docs.edit', doc) ? (
            <button className="btn sm" title="E" onClick={() => go(`/edit/${doc.id}`)}>
              ✏️ ערוך
            </button>
          ) : null}
          <button className="btn sm" title="H" onClick={() => go(`/history/${doc.id}`)}>
            🕓 v{doc.currentVersion}
          </button>
          <button className="btn sm hamburger" onClick={() => setPanelMobile((v) => !v)}>
            קשרים
          </button>
        </div>
      </div>

      <div className="trail">
        <a role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => go('/library')}>
          ספרייה
        </a>
        <span>›</span>
        <a
          role="button"
          tabIndex={0}
          style={{ cursor: 'pointer' }}
          onClick={() => go(`/library/${doc.category}`)}
        >
          {CATS[doc.category].label}
        </a>
        <span>›</span>
        <span style={{ color: 'var(--text)', fontWeight: 500 }}>{doc.title}</span>
        {active ? (
          <>
            <span>›</span>
            <span className="cur">
              שלב {active.num} · {stripFmt(active.title)}
            </span>
          </>
        ) : null}
        <span className="src">
          {doc.sourceId ? `מקור: ${active?.sourceRef ?? doc.sourceRef ?? ''}` : 'נכתב בספרייה'}
        </span>
      </div>

      <div className="jumpstrip" data-testid="jumpstrip">
        {steps.map((s) => (
          <span
            key={s.key}
            className={
              'j' +
              (call.state.results[s.key]
                ? ' done'
                : s.key === call.activeKey
                  ? ' cur'
                  : call.skipped.has(s.key)
                    ? ' skip'
                    : '')
            }
            title={stripFmt(s.title)}
            role="button"
            tabIndex={0}
            onClick={() => call.setActive(s.key)}
          >
            {s.num}
          </span>
        ))}
        <span className={'hint' + (jumpBuf != null ? ' armed' : '')}>
          {call.skipped.size ? (
            <span>
              {call.skipped.size} דולג
              {active?.phase.route ? ` · מסלול ${active.phase.route}` : ''}
            </span>
          ) : null}
          <span>קפיצה לשלב </span>
          <kbd>{jumpBuf != null ? `G ${jumpBuf || '…'}` : 'G ואז מספר'}</kbd>
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
        {nav.split?.left === doc.id ? (
          <SplitView doc={doc} rightId={nav.split.right} ctx={ctx} steps={steps} />
        ) : (
          <div className={'doc-layout' + (showPanel ? '' : ' no-panel')}>
            <div className="doc-main">
              <div className={'doc-scroll' + (callMode ? '' : ' no-aside')}>
                <article className="doc">
                  <div className="doc-head">
                    <div className="meta">
                      <span className="chip chip-blue">
                        {doc.kind === 'retention' ? 'שימור לקוחות' : `תפעולי – ${CATS[doc.category].short}`}
                      </span>
                      <span className="chip chip-gray">v{doc.currentVersion}</span>
                      <span className="chip chip-gray">{steps.length} שלבים</span>
                    </div>
                    <h1>{doc.title}</h1>
                    <p>{doc.description}</p>
                  </div>
                  <DocBody doc={doc} ctx={ctx} steps={steps} />
                </article>
                {callMode ? (
                  <aside className="callaside">
                    <div className="card">
                      <div className="eyebrow" style={{ marginBottom: 10 }}>
                        מעקב שיחה
                      </div>
                      <div className="row">
                        <span>
                          שלב {ai + 1} מתוך {steps.length}
                        </span>
                        <span className="muted">{pct}%</span>
                      </div>
                      <div className="progress">
                        <i style={{ width: `${Math.max(pct, 4)}%` }} />
                      </div>
                      <div className="rail-list">
                        {railSteps.map((s) => (
                          <div
                            key={s.key}
                            className={
                              'rail-item' +
                              (call.state.results[s.key] ? ' done' : s.key === call.activeKey ? ' cur' : '')
                            }
                            role="button"
                            tabIndex={0}
                            onClick={() => call.setActive(s.key)}
                          >
                            <span className="d">{call.state.results[s.key] ? '✓' : s.num}</span>
                            <span className="t">{stripFmt(s.title)}</span>
                          </div>
                        ))}
                        {hidden ? <div className="rail-more">+ {hidden} שלבים לפי מסלול</div> : null}
                      </div>
                      <div className="keys">
                        <span>
                          <kbd>↑↓</kbd> מעבר שלב
                        </span>
                        <span>
                          <kbd>1-3</kbd> בחירת תוצאה
                        </span>
                        <span>
                          <kbd>N</kbd> הערה
                        </span>
                        <span>
                          <kbd>G</kbd> קפיצה לשלב
                        </span>
                      </div>
                    </div>
                    <div className="card">
                      <div className="eyebrow" style={{ marginBottom: 8 }}>
                        סיכום לתיעוד
                      </div>
                      <div className="summary" data-testid="summary">
                        {call.summaryText()}
                      </div>
                      <span
                        className="summary-copy"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          void copy(call.summaryText());
                          toast('הועתק ללוח', 'ok');
                        }}
                      >
                        העתק ל-CRM<kbd>C</kbd>
                      </span>
                    </div>
                  </aside>
                ) : null}
              </div>
            </div>
            {showPanel ? (
              <Panel
                doc={doc}
                steps={steps}
                fields={fields}
                activeKey={call.activeKey}
                results={call.state.results}
                onSelectStep={(k) => call.setActive(k)}
                onShowBlock={dialogs.showBlock}
                mobileOpen={panelMobile}
                onCloseMobile={() => setPanelMobile(false)}
              />
            ) : null}
          </div>
        )}
      </div>
    </>
  );
}
