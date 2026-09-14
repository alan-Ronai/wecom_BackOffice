import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Block, Category, Document, Step } from '@wecom/shared';
import {
  useCreateDocument,
  useDocument,
  useDocuments,
  usePatchDocument,
  usePublish,
  useSaveStructure,
} from '../../api/hooks/documents.js';
import {
  NEW_DRAFT_ID,
  useBlocks,
  useDeleteNewDraft,
  useDraft,
  useFields,
  useSaveDraft,
} from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { ApiError } from '../../api/unwrap.js';
import { PRI } from '../../lib/constants.js';
import { ago, download } from '../../lib/format.js';
import { useHotkeys } from '../../lib/keys.js';
import { allSteps } from '../../lib/steps.js';
import {
  addAction,
  addBasic,
  addShared,
  checkList,
  deleteStep,
  deleteSteps,
  dropAt,
  duplicateSteps,
  moveStep,
  moveStepsToPhase,
  renumber,
  setStepsBlock,
  uid,
  type BasicType,
} from '../../lib/editorModel.js';
import { useEditorHistory } from '../../lib/editorHistory.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { useNav } from '../shell/navStore.js';
import { usePalette } from '../palette/paletteStore.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { BlockLibrary } from './BlockLibrary.js';
import { StepEditor } from './StepEditor.js';
import { DropZone } from './DropZone.js';
import { SidePane } from './SidePane.js';
import { useRequestReviewDialog } from '../review/RequestReview.js';
import { HistoryStrip } from './HistoryStrip.js';
import { StepSelectionBar } from './StepSelectionBar.js';
import { TemplateGallery } from './TemplateGallery.js';
import { SourceMap } from './SourceMap.js';
import { ConflictBanner } from './ConflictBanner.js';
import { ApiError as ApiErrorClass } from '../../api/unwrap.js';
import { MetadataPanel, type MetadataValue } from './MetadataPanel.js';
import { OwnerFields } from '../governance/OwnerFields.js';
import { ImportExportButtons } from '../source/ImportExportButtons.js';
import { RichText } from '../source/RichText.js';
import { PublishFeedbackPicker } from '../feedback/PublishFeedbackPicker.js';
import { useSourceDocument } from '../../api/hooks/sourcedocs.js';

const emptyDoc = (cat: Category): Document => ({
  id: 'new',
  slug: 'new-document',
  title: '',
  description: '',
  category: cat,
  wave: 2,
  priority: 'm',
  kind: 'steps',
  status: 'draft',
  currentVersion: 0,
  worlds: [cat],
  tags: [],
  topics: [],
  sourceReviewNeeded: false,
  phases: [{ id: uid('p'), label: 'שלב 1 – מסנן', steps: [] }],
  related: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

/**
 * The publish dialog's body: the version label, plus W3's picker of the reports this version
 * closes. `modal.open` takes a static node, so the state lives here and is reported upward
 * through the two callbacks rather than lifted into `doPublish`.
 */
/**
 * §5.3: text-kind (T/I) items edit `bodyHtml` with the same TipTap component in a compact mode.
 *
 * The raw-HTML textarea it replaces is still reachable behind "עריכת HTML", because there is a
 * real use for it (pasting a body out of another system), but it is no longer what a content
 * editor is handed by default — `PATCH /documents/:id` sanitizes `bodyHtml` against the §5.1
 * allowlist and says nothing about what it stripped, so hand-written markup fails silently.
 */
function BodyEditor({
  value,
  onChange,
  sourceLink,
}: {
  value: string;
  onChange: (html: string) => void;
  sourceLink?: ReactNode;
}) {
  const [rawHtml, setRawHtml] = useState(false);
  return (
    <div className="ed-body-html">
      <div className="ed-body-head">
        <span className="lbl">תוכן הפריט</span>
        <span className="grow" />
        <button
          type="button"
          className={'btn xs' + (rawHtml ? ' on' : '')}
          aria-pressed={rawHtml}
          onClick={() => setRawHtml((v) => !v)}
        >
          עריכת HTML
        </button>
      </div>
      {rawHtml ? (
        <textarea
          aria-label="תוכן הפריט (HTML)"
          rows={14}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <RichText value={value} onChange={onChange} compact />
      )}
      {sourceLink}
    </div>
  );
}

function PublishBody({
  documentId,
  defaultLabel,
  onLabel,
  onIds,
  onSubmit,
}: {
  documentId: string | null;
  defaultLabel: string;
  onLabel: (v: string) => void;
  onIds: (v: string[]) => void;
  onSubmit: () => void;
}) {
  const LABEL = 'מה השתנה? (מופיע בהיסטוריית הגרסאות)';
  const [label, setLabel] = useState(defaultLabel);
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    onLabel(label);
  }, [label, onLabel]);
  useEffect(() => {
    onIds(ids);
  }, [ids, onIds]);
  return (
    <div className="form" style={{ display: 'grid', gap: 10 }}>
      <label>
        {LABEL}
        <input
          type="text"
          aria-label={LABEL}
          value={label}
          autoFocus
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              onSubmit();
            }
          }}
        />
      </label>
      {/* Renders nothing when the item has no open reports, so mounting it is unconditional. */}
      {documentId ? <PublishFeedbackPicker documentId={documentId} value={ids} onChange={setIds} /> : null}
    </div>
  );
}

export function EditorPage() {
  const { id = 'new' } = useParams<{ id: string }>();
  const isNew = id === 'new';
  /**
   * `/edit/new?title=…` — the analytics "צור פריט" shortcut on a zero-result search term. It was
   * navigating with the term and the editor was ignoring it, so the editor retyped the words the
   * page had just shown them: exactly the friction §5.6 named the shortcut to remove.
   */
  const [searchParams] = useSearchParams();
  const seedTitle = isNew ? (searchParams.get('title') ?? '') : '';
  const go = useNavigate();
  const can = useCan();
  const modal = useModal();
  const palette = usePalette();
  const toast = useToast();
  // Claims the keyboard for the editor while it is mounted. The registry resolves scope order from
  // this rather than from mount order, so `Escape` reaches the editor's selection before the shell.
  const { setActiveScope } = useNav();
  useEffect(() => {
    setActiveScope('editor');
  }, [setActiveScope]);

  const published = useDocument(isNew ? undefined : id);
  /**
   * `/edit/new` now has a real, server-side draft (`/drafts/new/:draftId`). It used to live only
   * in React state, so a refresh, a crash or moving to another machine lost everything typed into
   * a new knowledge item — the one place in the app where "autosaved" was not true.
   */
  const draft = useDraft(isNew ? NEW_DRAFT_ID : id, isNew);
  const blocks = useBlocks();
  const fields = useFields();
  const cards = useDocuments({ sort: 'wave' });
  const autosave = useSaveDraft(isNew ? NEW_DRAFT_ID : id, 600, isNew);
  const dropNewDraft = useDeleteNewDraft(NEW_DRAFT_ID);
  const publish = usePublish();
  const patch = usePatchDocument(id);
  const saveStructure = useSaveStructure(id);
  const create = useCreateDocument();
  const requestReview = useRequestReviewDialog();
  /** Only for "is there a source document?" — the pane itself lives on the article and `/source`. */
  const source = useSourceDocument(isNew ? undefined : id);

  const [doc, setDoc] = useState<Document | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  /** Shift-click extends from `selected` to the clicked step (6c). */
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);
  const [pane, setPane] = useState<'steps' | 'source'>('steps');
  const [conflict, setConflict] = useState<{ who: string | null } | null>(null);
  /** A fresh `/edit/new` offers the template gallery until something is actually typed. */
  const [pickedStart, setPickedStart] = useState(false);
  const history = useEditorHistory();
  const seeded = useRef('');

  useEffect(() => {
    if (seeded.current === id) return;
    // The draft query must settle before seeding in *both* modes — seeding early is what
    // silently discarded a saved draft (I5), and a new document now has one too.
    if (draft.isPending) return;
    const fromDraft = draft.data?.payload as Document | undefined;
    if (isNew) {
      seeded.current = id;
      // A resumed draft keeps its steps; a fresh one starts with a single empty step.
      const fresh = addBasic(emptyDoc('tech'), 'step', null, null);
      if (seedTitle) fresh.title = seedTitle;
      const base = fromDraft ?? fresh;
      setDoc(structuredClone(base));
      setSelected(allSteps(base)[0]?.key ?? null);
      history.reset(base, 'נטען');
      // A resumed draft already has content; only a genuinely fresh one gets the gallery.
      if (fromDraft) setPickedStart(true);
      return;
    }
    if (published.isPending) return;
    const base = fromDraft ?? published.data;
    if (!base) return;
    seeded.current = id;
    setDoc(structuredClone(base));
    setSelected(allSteps(base)[0]?.key ?? null);
    history.reset(base, 'נטען');
  }, [id, isNew, seedTitle, draft.data, draft.isPending, published.data, published.isPending, history]);

  const update = useCallback(
    (next: Document, label = 'שינוי') => {
      setDoc(next);
      setDirty(true);
      history.push(next, label);
      autosave.save(next as unknown as Record<string, unknown>);
    },
    [autosave, history],
  );

  /**
   * Undo/redo restore the document **without** pushing a new history entry — otherwise undoing
   * would append a state and make redo unreachable — but they do autosave, because the draft on
   * the server has to match what is on screen.
   */
  const restore = useCallback(
    (next: Document | null) => {
      if (!next) return;
      setDoc(next);
      setDirty(true);
      setMulti(new Set());
      autosave.save(next as unknown as Record<string, unknown>);
    },
    [autosave],
  );

  useEffect(() => {
    if (!autosave.saving && autosave.lastSavedAt) setDirty(false);
  }, [autosave.saving, autosave.lastSavedAt]);

  const patchStep = useCallback(
    (key: string, mutate: (s: Step) => void) => {
      if (!doc) return;
      const next = structuredClone(doc);
      const target = next.phases.flatMap((p) => p.steps).find((s) => s.key === key);
      if (!target) return;
      mutate(target);
      update(next);
    },
    [doc, update],
  );

  const usage = useMemo(() => {
    const map: Record<string, number> = {};
    for (const c of cards.data?.items ?? []) if (c.hasSharedBlocks) map.all = (map.all ?? 0) + 1;
    for (const b of blocks.data ?? [])
      map[b.id] = allSteps(doc ?? undefined).filter((s) => s.blockId === b.id).length;
    return map;
  }, [blocks.data, cards.data, doc]);

  const checks = useMemo(
    () => (doc ? checkList(doc, fields.data ?? [], blocks.data ?? [], doc.related) : []),
    [doc, fields.data, blocks.data],
  );

  /**
   * `MetadataPanel` is controlled on exactly the five fields `PATCH /documents/:id` accepts, so
   * the mapping to and from the working document is the whole mount.
   */
  const metadata: MetadataValue = useMemo(
    () => ({
      docType: doc?.docType ?? 'O',
      category: doc?.category ?? 'tech',
      worlds: (doc?.worlds ?? []).filter((w) => w !== doc?.category),
      topics: doc?.topics ?? [],
      tags: doc?.tags ?? [],
    }),
    [doc],
  );
  const onMetadata = useCallback(
    (v: MetadataValue) => {
      if (!doc) return;
      update(
        {
          ...doc,
          docType: v.docType,
          category: v.category,
          // The primary world is always first and always present (`orderWorlds` on the API side).
          worlds: [v.category, ...v.worlds.filter((w) => w !== v.category)],
          topics: v.topics,
          tags: v.tags,
        },
        'מטא-דאטה',
      );
    },
    [doc, update],
  );

  const leave = useCallback(() => go(isNew ? '/library' : `/doc/${id}`), [go, id, isNew]);
  // `Shell` also binds Escape (palette → drawer → split). Without this guard both handlers fire
  // and closing the palette inside the editor also navigated away, discarding the draft.
  /** Shift-click selects a contiguous run between the anchor and the clicked step. */
  const selectStep = useCallback(
    (key: string, shift: boolean) => {
      if (!doc || !shift) {
        setSelected(key);
        setMulti(new Set());
        return;
      }
      const order = allSteps(doc).map((x) => x.key);
      const a = order.indexOf(selected ?? key);
      const b = order.indexOf(key);
      if (a < 0 || b < 0) return;
      const [from, to] = a <= b ? [a, b] : [b, a];
      setMulti(new Set(order.slice(from, to + 1)));
    },
    [doc, selected],
  );

  useHotkeys('editor', {
    // `useHotkeys` lower-cases bare keys, so Ctrl Shift Z arrives here as `ctrl+z` with the
    // shift flag set — one binding covers both directions. Ctrl Y is the Windows habit.
    'ctrl+z': (e) => {
      e.preventDefault();
      restore(e.shiftKey ? history.redo() : history.undo());
    },
    'ctrl+y': (e) => {
      e.preventDefault();
      restore(history.redo());
    },
    Escape: () => {
      if (multi.size) {
        setMulti(new Set());
        return;
      }
      // A modal or the palette is in front of the editor and is not the editor's to close, so
      // decline and let the global scope handle it.
      if (modal.count !== 0 || palette.state.open) return false;
      leave();
    },
    // `R` rather than `r`: `useHotkeys` normalises bare keys to lower case, so only the
    // un-normalised fallback matches — which is exactly the Shift R the keymap advertises.
    R: () => {
      if (!isNew && doc && can('docs.edit', doc)) requestReview({ id, title: doc.title });
    },
  });

  /**
   * 412 means someone else published while this editor was open. Neither outcome is safe to pick
   * automatically — the draft stays on the server and the banner offers reload or diff — so the
   * publish stops here rather than retrying with a fresh etag, which would silently clobber them.
   */
  const onConflict = (e: unknown): boolean => {
    if (!(e instanceof ApiErrorClass) || (e.status !== 412 && e.status !== 428)) return false;
    setConflict({ who: draft.data?.otherEditors?.[0]?.name ?? null });
    return true;
  };

  const doPublish = async () => {
    if (!doc) return;
    const bad = checks.find(([k]) => k === 'bad');
    if (bad) {
      toast(bad[1], 'warn');
      return;
    }
    const partial = checks.some(([, t]) => t.includes('ריק'));
    const nextV = (published.data?.currentVersion ?? 0) + 1;
    const box = { label: isNew ? 'פריט ידע חדש' : '', ids: [] as string[] };
    const ok = await new Promise<boolean>((resolve) => {
      let dispose = () => {};
      const submit = () => {
        resolve(true);
        dispose();
      };
      dispose = modal.open({
        title: `פרסום v${nextV}`,
        body: (
          <PublishBody
            documentId={isNew ? null : id}
            defaultLabel={box.label}
            onLabel={(v) => (box.label = v)}
            onIds={(v) => (box.ids = v)}
            onSubmit={submit}
          />
        ),
        buttons: [
          { label: 'ביטול', onClick: () => resolve(false) },
          { label: 'אישור', cls: 'primary', onClick: () => resolve(true) },
        ],
      });
    });
    if (!ok) return;
    const label = box.label;
    const clean = renumber(doc);
    clean.phases.forEach((p) =>
      p.steps.forEach((s) => {
        s.actions = s.actions.filter((a) => a.text.trim());
      }),
    );
    let targetId = id;
    if (isNew) {
      const created = await create.mutateAsync({
        title: clean.title,
        description: clean.description,
        category: clean.category,
        wave: clean.wave,
        priority: clean.priority,
        kind: clean.kind,
        phases: clean.phases,
        docType: clean.docType,
        tags: clean.tags,
        worlds: clean.worlds,
        topics: clean.topics,
        ...(clean.kind === 'text' ? { bodyHtml: clean.bodyHtml ?? '' } : {}),
      });
      targetId = created.id;
      // The new-document draft has served its purpose; leaving it behind would make the next
      // "✚ פריט ידע חדש" resume a document that has already been published.
      await dropNewDraft.mutateAsync().catch(() => {});
    } else {
      // PATCH rotates the document's etag, so the structure save must use the etag the PATCH
      // *returned* — `published.data.etag` is stale by then, and a stale precondition is a 412.
      const patched = await patch.mutateAsync({
        title: clean.title,
        description: clean.description,
        category: clean.category,
        wave: clean.wave,
        priority: clean.priority,
        docType: clean.docType,
        tags: clean.tags,
        worlds: clean.worlds,
        topics: clean.topics,
        ownerId: clean.ownerId ?? null,
        editorId: clean.editorId ?? null,
        ...(clean.kind === 'text' ? { bodyHtml: clean.bodyHtml ?? '' } : {}),
      });
      const etag = patched.etag ?? published.data?.etag;
      if (!etag) {
        toast('לא ניתן לשמור: חסר מזהה גרסה (etag) · רעננו ונסו שוב', 'warn');
        return;
      }
      try {
        await saveStructure.mutateAsync({ phases: clean.phases, related: clean.related, etag });
      } catch (e) {
        if (onConflict(e)) return;
        throw e;
      }
    }
    // `targetId` — not `id` — so creating a knowledge item actually publishes the new document
    // instead of POSTing to the literal path segment `new`.
    const { version } = await publish.mutateAsync({
      id: targetId,
      label: label || 'פורסם',
      markPartial: partial,
      ...(box.ids.length ? { resolveFeedbackIds: box.ids } : {}),
    });
    toast(`פורסם v${version} · הכרטיס בספרייה עודכן`, 'ok');
    go(`/doc/${targetId}`);
  };

  // "שלח לסקירה" is back, on the real route this time: `POST /documents/:id/request-review`
  // (stage-5 contract). I6 removed the old control because it PATCHed an empty body and toasted
  // success while persisting nothing. It is only offered for a document that exists — there is
  // nothing to review about an unsaved `/edit/new`.

  // Without this the editor spins forever when the document query fails — which it now does for
  // any document outside the user's category scope (403), not just for a genuinely missing one.
  if (published.isError) {
    const denied = published.error instanceof ApiError && published.error.status === 403;
    return (
      <div className="empty">
        <b>{denied ? 'אין לך הרשאה לערוך את המסמך הזה' : 'לא ניתן לטעון את המסמך'}</b>
        {denied ? 'הקטגוריה מחוץ להרשאות שלך · פנו למנהל הצוות' : 'נסו לרענן · אם התקלה חוזרת פנו ל-IT'}
      </div>
    );
  }
  if (!doc) return <div className="route-loading">טוען…</div>;

  // The draft envelope reports who else holds a draft on this document; the API already excludes
  // the current user from the list.
  const otherEditors = draft.data?.otherEditors ?? [];
  const anotherEditor = otherEditors.length > 0;
  const nextV = (published.data?.currentVersion ?? 0) + 1;
  const applyBasic = (t: BasicType) => update(addBasic(doc, t, selected, selected), 'שלב חדש');
  const applyShared = (b: Block) => update(addShared(doc, b, null), `בלוק · ${b.title}`);
  const showGallery = isNew && !pickedStart && !doc.title.trim();

  const applyTemplate = (t: { name: string; kind: Document['kind']; phases: Document['phases'] }) => {
    setPickedStart(true);
    const next = renumber({ ...doc, kind: t.kind, phases: structuredClone(t.phases) });
    setSelected(allSteps(next)[0]?.key ?? null);
    update(next, `תבנית · ${t.name}`);
  };

  const bulkOnSelection = (fn: () => Document, label: string) => {
    update(fn(), label);
    setMulti(new Set());
  };

  return (
    <div className="ed-layout">
      <BlockLibrary
        blocks={blocks.data ?? []}
        usage={usage}
        onBasic={applyBasic}
        onShared={applyShared}
        onPreset={(t) => update(addAction(doc, selected, t))}
        onNewBlock={() => go('/blocks')}
      />
      <div className="ed-main">
        <div className="topbar h56">
          <Hamburger />
          <button className="btn ghost sm" title="חזרה" onClick={leave}>
            →
          </button>
          <input
            className="title-in"
            type="text"
            placeholder="שם פריט הידע…"
            aria-label="שם פריט הידע"
            value={doc.title}
            onChange={(e) => update({ ...doc, title: e.target.value }, 'שם הפריט')}
          />
          <span className="chip chip-amber">
            {published.data ? `טיוטה על v${published.data.currentVersion}` : 'טיוטה'}
          </span>
          {anotherEditor ? (
            <span className="chip chip-red">{otherEditors.map((e) => e.name).join(', ')} עורך/ת במקביל</span>
          ) : null}
          <span className={'saved' + (dirty ? ' dirty' : '')}>
            <span className="dot" />
            <span>
              {dirty ? 'שומר…' : autosave.lastSavedAt ? `נשמר · ${ago(autosave.lastSavedAt)}` : 'טרם נשמר'}
            </span>
          </span>
          <HistoryStrip
            history={history}
            onUndo={() => restore(history.undo())}
            onRedo={() => restore(history.redo())}
            onJump={(i) => restore(history.jump(i))}
          />
          <div className="actions">
            {isNew ? (
              <button className="btn sm" onClick={() => setPickedStart(false)}>
                תבניות
              </button>
            ) : null}
            {doc.sourceId ? (
              <button
                className="btn sm"
                aria-pressed={pane === 'source'}
                onClick={() => setPane((p) => (p === 'source' ? 'steps' : 'source'))}
              >
                מיפוי מקור ↔ שלבים
              </button>
            ) : null}
            {!isNew ? (
              <ImportExportButtons
                documentId={id}
                canEdit={can('docs.edit', doc)}
                hasSource={!!source.data}
              />
            ) : null}
            {!isNew ? (
              <Link className="btn sm" to={`/edit/${id}/source`}>
                ערוך מקור
              </Link>
            ) : null}
            <button
              className="btn sm"
              onClick={() => download(`${doc.title || 'knowledge-item'}.json`, JSON.stringify(doc, null, 2))}
            >
              ייצוא JSON
            </button>
            {!isNew && can('docs.edit', doc) ? (
              <button
                className="btn sm"
                title="Shift R"
                onClick={() => requestReview({ id, title: doc.title })}
              >
                📤 שלח לסקירה
              </button>
            ) : null}
            {can('docs.publish', doc) ? (
              <button className="btn primary sm" onClick={() => void doPublish()}>
                פרסם v{nextV}
              </button>
            ) : null}
          </div>
        </div>

        <div className="ed-body">
          {conflict ? (
            <ConflictBanner
              who={conflict.who}
              onReload={() => {
                setConflict(null);
                seeded.current = '';
                void published.refetch();
                void draft.refetch();
              }}
              onShowDiff={() => go(`/history/${id}`)}
              onDismiss={() => setConflict(null)}
            />
          ) : null}

          {showGallery ? (
            <TemplateGallery onPick={applyTemplate} onBlank={() => setPickedStart(true)} />
          ) : null}

          {pane === 'source' ? (
            <SourceMap
              doc={doc}
              selectedKey={selected}
              onSelectStep={setSelected}
              onAssignRef={(key, ref) =>
                patchStep(key, (st) => {
                  st.sourceRef = ref;
                })
              }
            />
          ) : null}

          <div className="ed-fields" hidden={pane === 'source'}>
            {/* W1 owns the primary world, extra worlds, topics, type and tags — the old free-text
                "קטגוריה" select and the disabled "קובץ יעד" hint are both subsumed by it. */}
            <MetadataPanel value={metadata} onChange={onMetadata} disabled={!can('docs.edit', doc)} />
            <OwnerFields doc={doc} onChange={(patch) => update({ ...doc, ...patch }, 'אחריות')} />
            <label>
              גל כתיבה
              <select
                aria-label="גל כתיבה"
                value={doc.wave}
                onChange={(e) => update({ ...doc, wave: Number(e.target.value) as 1 | 2 | 3 }, 'גל')}
              >
                {[1, 2, 3].map((w) => (
                  <option key={w} value={w}>
                    גל {w}
                  </option>
                ))}
              </select>
            </label>
            <label>
              שכיחות
              <select
                aria-label="שכיחות"
                value={doc.priority}
                onChange={(e) =>
                  update({ ...doc, priority: e.target.value as Document['priority'] }, 'עדיפות')
                }
              >
                {Object.entries(PRI).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <input
            className="ed-desc"
            type="text"
            aria-label="תיאור קצר"
            placeholder="תיאור קצר לנציגים (מוצג בכרטיס)"
            value={doc.description}
            onChange={(e) => update({ ...doc, description: e.target.value }, 'תיאור')}
          />

          {/* A type-T (text) item has no steps: its content is one HTML body, which is what
              the `/scripts` adapters read back. Everything below — the phase editor, the drop
              zone and the permissions strip — is the steps editor and does not apply. */}
          {doc.kind === 'text' ? (
            <BodyEditor
              value={doc.bodyHtml ?? ''}
              onChange={(html) => update({ ...doc, bodyHtml: html }, 'תוכן')}
              sourceLink={
                !isNew ? (
                  <span className="muted">
                    לעריכה עשירה יותר, עם גרסאות וייבוא מ-Word:{' '}
                    <Link to={`/edit/${id}/source`}>מסמך המקור</Link>
                  </span>
                ) : null
              }
            />
          ) : (
            <>
              {pane === 'steps' &&
                doc.phases.map((p, pi) => (
                  <div key={p.id}>
                    <div className="ed-phase">
                      <input
                        type="text"
                        aria-label={`שם קבוצת שלבים ${pi + 1}`}
                        placeholder="שם השלב (למשל: שלב 1 – מסנן)"
                        value={p.label}
                        onChange={(e) => {
                          const next = structuredClone(doc);
                          next.phases[pi].label = e.target.value;
                          update(next);
                        }}
                      />
                      <span className="line" />
                      {doc.phases.length > 1 ? (
                        <span
                          className="x"
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            const next = structuredClone(doc);
                            next.phases.splice(pi, 1);
                            update(renumber(next));
                          }}
                        >
                          ✕
                        </span>
                      ) : null}
                    </div>
                    {p.steps.map((s) => (
                      <StepEditor
                        key={s.key}
                        doc={doc}
                        step={s}
                        phase={p}
                        selected={selected === s.key || multi.has(s.key)}
                        fields={fields.data ?? []}
                        blocks={blocks.data ?? []}
                        onSelect={(shift) => selectStep(s.key, shift)}
                        onPatch={(m) => patchStep(s.key, m)}
                        onMove={(dir) => update(moveStep(doc, s.key, dir), `הזזת שלב ${s.num}`)}
                        onDelete={() => update(deleteStep(doc, s.key), `מחיקת שלב ${s.num}`)}
                        onDrop={(data) => update(dropAt(doc, data, s.key, blocks.data ?? []), 'גרירה')}
                        onDetach={() =>
                          patchStep(s.key, (st) => {
                            const b = blocks.data?.find((x) => x.id === st.blockId);
                            if (b) {
                              st.actions = structuredClone(b.actions);
                              st.title = st.title || b.title;
                              if (b.script) st.script = b.script;
                            }
                            delete st.blockId;
                          })
                        }
                        onEditBlock={() => go('/blocks')}
                      />
                    ))}
                  </div>
                ))}

              <DropZone
                onCommand={(cmd) => {
                  if (cmd.kind === 'basic') applyBasic(cmd.value as BasicType);
                  else if (cmd.kind === 'shared') {
                    const b = blocks.data?.find((x) => x.id === cmd.value);
                    if (b) applyShared(b);
                  } else if (cmd.kind === 'phase') {
                    const next = structuredClone(doc);
                    next.phases.push({ id: uid('p'), label: 'קבוצה חדשה', steps: [] });
                    update(next);
                  } else if (cmd.kind === 'title') {
                    const withStep = addBasic(doc, 'step', null, null);
                    const last = allSteps(withStep).at(-1);
                    if (last) {
                      const next = structuredClone(withStep);
                      const t = next.phases.flatMap((p) => p.steps).find((s) => s.key === last.key);
                      if (t) t.title = cmd.value;
                      update(next);
                    }
                  }
                }}
                onDrop={(data) => update(dropAt(doc, data, null, blocks.data ?? []))}
                blocks={blocks.data ?? []}
              />

              <div className="perm">
                <b>הרשאות</b>
                <span className="chip chip-navy">עורכים</span>
                <span className="chip">מנהלי צוות – פרסום</span>
                <span className="chip">נציגים – הערות בלבד</span>
                <span className="hist">גרסה נוכחית: v{published.data?.currentVersion ?? 0}</span>
                <button
                  className="btn xs"
                  onClick={() => {
                    const next = structuredClone(doc);
                    next.phases.push({ id: uid('p'), label: 'קבוצה חדשה', steps: [] });
                    update(next);
                  }}
                >
                  + קבוצת שלבים
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <StepSelectionBar
        count={multi.size}
        phases={doc.phases}
        blocks={blocks.data ?? []}
        onMoveToPhase={(pid) => bulkOnSelection(() => moveStepsToPhase(doc, multi, pid), 'הזזת שלבים')}
        onDuplicate={() => bulkOnSelection(() => duplicateSteps(doc, multi), 'שכפול שלבים')}
        onSetBlock={(b) =>
          bulkOnSelection(() => setStepsBlock(doc, multi, b), b ? 'בלוק משותף' : 'ניתוק בלוק')
        }
        onDelete={() => bulkOnSelection(() => deleteSteps(doc, multi), `מחיקת ${multi.size} שלבים`)}
        onClear={() => setMulti(new Set())}
      />

      <SidePane
        doc={doc}
        published={published.data}
        checks={checks}
        fields={fields.data ?? []}
        blocks={blocks.data ?? []}
      />
    </div>
  );
}
