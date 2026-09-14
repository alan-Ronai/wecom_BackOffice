import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DOC_TYPE_LABELS, stripFmt } from '@wecom/shared';
import {
  useDocRefs,
  useDocument,
  useIsPinned,
  useRecordView,
  useTogglePin,
} from '../../api/hooks/documents.js';
import { useAddNote, useBlocks, useFields, useScripts } from '../../api/hooks/content.js';
import { useComments, usePresence, useTelemetry } from '../../api/hooks/collab.js';
import { useCan } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import { usePreferences, useSavePreferences } from '../../api/hooks/preferences.js';
import { useUiPrefs } from '../../api/hooks/uiPrefs.js';
import { cat } from '../../lib/constants.js';
import { copy } from '../../lib/format.js';
import { useHotkeys, type ActiveScope } from '../../lib/keys.js';
import { resolvedSteps } from '../../lib/steps.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useNav } from '../shell/navStore.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { LoadError } from '../ui/index.js';
import { useEntityDialogs } from '../library/dialogs.js';
import { DocBody, type StepCtx } from './StepView.js';
import { StepConnections } from './StepConnections.js';
import { Panel } from './Panel.js';
import { SplitView } from './SplitView.js';
import { useCall } from './useCall.js';
import { StepCollab } from './StepCollab.js';
import { QuickSwitch } from './QuickSwitch.js';
import { PrintFrame } from './PrintFrame.js';
import { TypeBadge } from '../taxonomy/TypeBadge.js';
import { useTopicView } from '../../api/hooks/taxonomy.js';
import { StatusChip } from '../governance/StatusChip.js';
import { SourceReviewBadge } from '../governance/SourceReviewBadge.js';
import { UnavailablePage } from '../governance/UnavailablePage.js';
import { FeedbackButton } from '../feedback/FeedbackButton.js';
import { PaneModeToggle, type PaneMode } from '../source/PaneModeToggle.js';
import { SourcePane } from '../source/SourcePane.js';
import { useSourceDocument } from '../../api/hooks/sourcedocs.js';
import type { FieldInfo } from '../../lib/format.js';
import type { ScriptRow } from '../../api/types.js';

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
  const prefs = usePreferences();
  const savePrefs = useSavePreferences();
  const recordView = useRecordView();
  const togglePin = useTogglePin();
  const isPinned = useIsPinned();
  const ui = useUiPrefs();
  const addNote = useAddNote(id ?? '');
  const comments = useComments(id);
  const scriptsQ = useScripts();
  const editors = usePresence(id);
  const track = useTelemetry();

  const doc = docQ.data;
  const steps = useMemo(() => resolvedSteps(doc, blocks.data), [doc, blocks.data]);
  // Stable identity: a fresh `[]` on every render busts <Fmt>'s useMemo for every step.
  const fields: FieldInfo[] = useMemo(() => fieldsQ.data ?? EMPTY_FIELDS, [fieldsQ.data]);
  // I10: resolved from this document's own links/related, not from page 1 of the library.
  const docRefs = useDocRefs(id);
  const callMode = prefs.data?.callMode !== false;
  const showPanel = prefs.data?.panel !== false;
  const call = useCall(doc, steps, callMode);
  const [summaryExtras, setSummaryExtras] = useState<string[]>([]);

  /**
   * W4 pane modes. `Preferences.paneMode` is optional (a row written before wave 4 has no such
   * key), so the effective default lives here; the toggle writes it back so the choice follows
   * the agent to the next machine.
   */
  const [paneMode, setPaneMode] = useState<PaneMode | null>(null);
  const source = useSourceDocument(id);
  const effectivePane: PaneMode = paneMode ?? prefs.data?.paneMode ?? 'work';
  /** W1: the topic view is what "previous / next in this topic" means (PRD §4). */
  const topicView = useTopicView(doc?.topics?.[0]);
  const topicNeighbours = useMemo(() => {
    const flat = (topicView.data?.groups ?? []).flatMap((g) => g.items);
    const i = flat.findIndex((x) => x.id === doc?.id);
    return {
      prev: i > 0 ? flat[i - 1]! : null,
      next: i >= 0 && i < flat.length - 1 ? flat[i + 1]! : null,
    };
  }, [topicView.data, doc?.id]);

  /**
   * 6b telemetry. Every event is buffered by `useTelemetry` and flushed in batches — an outcome
   * pick happens on a keypress mid-call, and one request per keypress is exactly the traffic this
   * app must not generate on a LAN VM that also runs the model.
   */
  const pickOutcome = useCallback(
    (key: string, res: Parameters<typeof call.pickOutcome>[1]) => {
      track({ kind: 'outcome', documentId: doc?.id, stepKey: key });
      call.pickOutcome(key, res);
    },
    [call, doc?.id, track],
  );

  /** The call summary plus anything the agent inserted from a script picker (6b). */
  const summary = [call.summaryText(), ...summaryExtras].join('\n');

  const completed = useRef('');
  useEffect(() => {
    if (!doc || !steps.length || call.done < steps.length) return;
    const tag = `${doc.id}:${steps.length}`;
    if (completed.current === tag) return;
    completed.current = tag;
    track({ kind: 'call_completed', documentId: doc.id });
  }, [doc, steps.length, call.done, track]);
  const [panelMobile, setPanelMobile] = useState(false);
  const [jumpBuf, setJumpBuf] = useState<string | null>(null);
  const jumpTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewed = useRef<string>('');

  useEffect(() => {
    if (!doc || viewed.current === doc.id) return;
    viewed.current = doc.id;
    recordView.mutate(doc.id);
    // Stamps the per-user last-seen map that drives the library's "השתנה מאז שצפיתי" indicator.
    // `recordView` is a global counter; this one is personal, which is the whole point (6a).
    ui.markSeen(doc.id);
  }, [doc, recordView, ui]);

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

  // I10: the pinned-ids query covers every document, not just the first 50 cards.
  const pinned = isPinned(doc?.id);

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
    if (s) {
      track({ kind: 'jump', documentId: doc?.id, stepKey: s.key });
      call.setActive(s.key);
    } else toast(`אין שלב ${buf}`, 'warn');
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
      pickOutcome(s.key, {
        kind: 'branch',
        idx: i,
        label: s.branch.options[i].label,
        goto: s.branch.options[i].goto,
      });
    else if (s.outcomes[i])
      pickOutcome(s.key, {
        kind: 'out',
        idx: i,
        label: stripFmt(s.outcomes[i].text),
        goto: s.outcomes[i].goto,
      });
  };

  // The left pane when the split is open on this document, the whole article otherwise. Passed
  // rather than inferred: for most of a call nothing here holds DOM focus, so a containment check
  // would silently disable call mode — see `lib/keys.ts#ActiveScope`.
  const pane: ActiveScope = nav.split?.left === doc?.id ? 'split-left' : 'article';
  const setActiveScope = nav.setActiveScope;
  useEffect(() => {
    setActiveScope(pane);
  }, [pane, setActiveScope]);

  useHotkeys(
    'article',
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
        void copy(summary);
        toast('הועתק ללוח', 'ok');
      },
      e: () => {
        if (doc && can('docs.edit', doc)) go(`/edit/${doc.id}`);
      },
      h: () => {
        if (doc) go(`/history/${doc.id}`);
      },
    },
    pane,
  );

  if (docQ.isPending) return <div className="route-loading">טוען…</div>;
  // Category scope is enforced per document, so "you may not see this" is a distinct outcome
  // from "this is gone" — telling an agent to check the trash for a document they simply lack
  // scope for sends them the wrong way.
  // W2: "exists but is not published for you" is its own answer — not 404, not 403.
  if (docQ.error instanceof ApiError && docQ.error.code === 'NOT_PUBLISHED') return <UnavailablePage />;
  if (docQ.error instanceof ApiError && docQ.error.status === 403)
    return (
      <div className="empty">
        <b>אין לך הרשאה למסמך הזה</b>הקטגוריה מחוץ להרשאות שלך · פנו למנהל הצוות
      </div>
    );
  if (docQ.isError) return <LoadError what="המסמך" error={docQ.error} />;
  if (!doc)
    return (
      <div className="empty">
        <b>המסמך לא נמצא</b>ייתכן שהועבר לסל המיחזור
      </div>
    );

  const active = steps.find((s) => s.key === call.activeKey);

  /**
   * Which scripts the "הסבר ללקוח" picker offers for a step: the ones already attached to this
   * document, then the ones tagged with its category. Falling back to everything would turn a
   * two-second pick mid-call into a scroll through the whole library of phrasings.
   */
  const scriptsFor = (stepKey: string): ScriptRow[] => {
    const all = scriptsQ.data ?? [];
    const step = steps.find((x) => x.key === stepKey);
    const scored = all.filter(
      (sc) =>
        sc.usedIn.some((u) => u.documentId === doc.id) ||
        sc.tags?.includes(doc.category) ||
        (step?.script ? sc.text.slice(0, 20) === step.script.slice(0, 20) : false),
    );
    return scored.length ? scored : all;
  };

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
    onOutcome: pickOutcome,
    onNote: (k) => void addNoteFor(k),
    onShowBlock: dialogs.showBlock,
    headBadges: (s) => {
      const n = (comments.data ?? []).filter((c) => c.stepKey === s.key && !c.resolvedAt).length;
      return n ? (
        <span className="chip chip-gray" title={`${n} תגובות פתוחות`}>
          💬 {n}
        </span>
      ) : null;
    },
    renderStepFeedback: (s) => (
      <FeedbackButton size="xs" documentId={doc.id} documentVersion={doc.currentVersion} stepKey={s.key} />
    ),
    renderFooter: (s) => (
      <StepCollab
        documentId={doc.id}
        stepKey={s.key}
        comments={comments.data ?? []}
        scripts={scriptsFor(s.key)}
        onInsertScript={(script) => {
          setSummaryExtras((prev) => [...prev, `תסריט: ${script.title}`]);
          void copy(script.text);
          toast('הנוסח הועתק ונוסף לסיכום', 'ok');
        }}
      />
    ),
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

  const workView = (
    <article className="doc">
      <div className="doc-head">
        <div className="meta">
          {doc.docType ? <TypeBadge docType={doc.docType} /> : null}
          <span className="chip chip-blue">
            {doc.kind === 'retention'
              ? 'שימור לקוחות'
              : `תפעולי – ${cat(doc.category).short}`}
          </span>
          <span className="chip chip-gray">v{doc.currentVersion}</span>
          <span className="chip chip-gray">{steps.length} שלבים</span>
          {/* Status and the source-review flag are editor information: a reader only ever sees
              published items, so a chip saying so would be noise. */}
          {can('docs.read_unpublished') ? <StatusChip status={doc.status} /> : null}
          {(doc.tags ?? []).map((t) => (
            <span
              key={t}
              className="chip chip-gray tag-chip"
              role="button"
              tabIndex={0}
              title={`סנן לפי ${t}`}
              onClick={() => go(`/library?tag=${encodeURIComponent(t)}`)}
            >
              #{t}
            </span>
          ))}
        </div>
        <h1>{doc.title}</h1>
        <p>{doc.description}</p>
        {topicNeighbours.prev || topicNeighbours.next ? (
          <div className="topic-nav" style={{ display: 'flex', gap: 8, marginTop: 8 }}>
            {topicNeighbours.prev ? (
              <button className="btn xs" onClick={() => go(`/doc/${topicNeighbours.prev!.id}`)}>
                → הקודם בנושא: {topicNeighbours.prev.title} ({DOC_TYPE_LABELS[topicNeighbours.prev.docType]})
              </button>
            ) : null}
            {topicNeighbours.next ? (
              <button className="btn xs" onClick={() => go(`/doc/${topicNeighbours.next!.id}`)}>
                הבא בנושא: {topicNeighbours.next.title} ({DOC_TYPE_LABELS[topicNeighbours.next.docType]}) ←
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
      <DocBody doc={doc} ctx={ctx} steps={steps} />
    </article>
  );

  const paneBody =
    effectivePane === 'source' ? (
      <SourcePane documentId={doc.id} canEdit={can('docs.edit', doc)} sourceId={doc.sourceId} />
    ) : effectivePane === 'split' ? (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, minWidth: 0 }}>
        {workView}
        <SourcePane documentId={doc.id} canEdit={can('docs.edit', doc)} sourceId={doc.sourceId} />
      </div>
    ) : (
      workView
    );

  /**
   * §5.1: the working view, the source document, or both side by side — with the source-review
   * flag *above* the switch rather than inside the working view's meta row. The flag is about
   * the source having changed, so it is exactly the reader who has switched to the source pane
   * who must still see it (and still be able to clear it).
   */
  const workOrSource = (
    <>
      {can('docs.edit', doc) ? (
        <div className="source-review-strip">
          <SourceReviewBadge doc={doc} />
        </div>
      ) : null}
      {paneBody}
    </>
  );

  const pct = Math.round((call.done / Math.max(1, steps.length)) * 100);
  const ai = steps.findIndex((s) => s.key === call.activeKey);
  const railSteps = steps.filter((s) => !s.phase.route || s.phase.id === active?.phase.id);
  const hidden = steps.length - railSteps.length;

  return (
    <>
      <PrintFrame doc={doc} steps={steps.length} />
      <div className="topbar h56">
        <Hamburger />
        <div className="crumb">
          <a role="button" tabIndex={0} onClick={() => go('/library')}>
            ספרייה
          </a>
          <span className="sep">/</span>
          <a role="button" tabIndex={0} onClick={() => go(`/library/${doc.category}`)}>
            {cat(doc.category).label}
          </a>
          <span className="sep">/</span>
          <b>{doc.title}</b>
        </div>
        <div className="actions">
          {editors.length ? (
            <span
              className="presence"
              aria-label={`${editors.map((e) => e.displayName).join(', ')} פתוחים כרגע`}
              title={editors.map((e) => e.displayName).join(', ')}
            >
              {editors.slice(0, 3).map((e) => (
                <span className="avatar sm" key={e.userId}>
                  {e.initials}
                </span>
              ))}
              {editors.length > 3 ? <span className="avatar sm more">+{editors.length - 3}</span> : null}
            </span>
          ) : null}
          <span
            className={'callpill' + (callMode ? '' : ' off')}
            title="מצב שיחה: ניווט במקלדת, מעקב תוצאות וסיכום לתיעוד"
            aria-label={callMode ? 'מצב שיחה פעיל · כבה' : 'מצב קריאה · הפעל מצב שיחה'}
            aria-pressed={callMode}
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
                aria-label="אפס מעקב שיחה"
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
          <FeedbackButton documentId={doc.id} documentVersion={doc.currentVersion} />
          <PaneModeToggle
            value={effectivePane}
            hasSource={!!source.data}
            onChange={(m) => {
              setPaneMode(m);
              savePrefs.mutate({
                ...(prefs.data ?? {
                  theme: null,
                  font: 'plex',
                  panel: true,
                  callMode: true,
                  sidebarExpanded: false,
                }),
                paneMode: m,
              });
            }}
          />
          <button className="btn sm" title="Ctrl P" onClick={() => window.print()}>
            🖨 הדפסה
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
        <QuickSwitch
          category={doc.category}
          currentId={doc.id}
          onPick={(c) => {
            track({ kind: 'jump', documentId: c.id });
            nav.openDoc(c.id, { title: c.title });
          }}
        />
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
            aria-label={`שלב ${s.num} מתוך ${steps.length} · ${stripFmt(s.title)}`}
            aria-current={s.key === call.activeKey}
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
                {workOrSource}
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
                        {summary}
                      </div>
                      <span
                        className="summary-copy"
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          void copy(summary);
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
