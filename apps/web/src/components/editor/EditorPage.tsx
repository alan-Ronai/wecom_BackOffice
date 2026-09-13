import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Block, Category, Document, Step } from '@wecom/shared';
import {
  useCreateDocument,
  useDocument,
  useDocuments,
  usePatchDocument,
  usePublish,
  useSaveStructure,
} from '../../api/hooks/documents.js';
import { useBlocks, useDraft, useFields, useSaveDraft } from '../../api/hooks/content.js';
import { useCan } from '../../api/hooks/me.js';
import { CATS, CAT_KEYS, PRI, SOURCE_FILES } from '../../lib/constants.js';
import { ago, download } from '../../lib/format.js';
import { useHotkeys } from '../../lib/keyboard.js';
import { allSteps } from '../../lib/steps.js';
import {
  addAction,
  addBasic,
  addShared,
  checkList,
  deleteStep,
  dropAt,
  moveStep,
  renumber,
  uid,
  type BasicType,
} from '../../lib/editorModel.js';
import { Hamburger } from '../shell/MobileDrawer.js';
import { usePalette } from '../palette/paletteStore.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { BlockLibrary } from './BlockLibrary.js';
import { StepEditor } from './StepEditor.js';
import { DropZone } from './DropZone.js';
import { SidePane } from './SidePane.js';

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
  phases: [{ id: uid('p'), label: 'שלב 1 – מסנן', steps: [] }],
  related: [],
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

export function EditorPage() {
  const { id = 'new' } = useParams<{ id: string }>();
  const isNew = id === 'new';
  const go = useNavigate();
  const can = useCan();
  const modal = useModal();
  const palette = usePalette();
  const toast = useToast();

  const published = useDocument(isNew ? undefined : id);
  const draft = useDraft(isNew ? undefined : id);
  const blocks = useBlocks();
  const fields = useFields();
  const cards = useDocuments({ sort: 'wave' });
  const autosave = useSaveDraft(id);
  const publish = usePublish();
  const patch = usePatchDocument(id);
  const saveStructure = useSaveStructure(id);
  const create = useCreateDocument();

  const [doc, setDoc] = useState<Document | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const seeded = useRef('');

  useEffect(() => {
    if (seeded.current === id) return;
    if (isNew) {
      seeded.current = id;
      setDoc(addBasic(emptyDoc('tech'), 'step', null, null));
      return;
    }
    // Both queries must settle first: the document usually wins the race, and seeding from it
    // early silently discarded a saved draft (and with it the user's unsaved work).
    if (draft.isPending || published.isPending) return;
    const fromDraft = draft.data?.payload as Document | undefined;
    const base = fromDraft ?? published.data;
    if (!base) return;
    seeded.current = id;
    setDoc(structuredClone(base));
    setSelected(allSteps(base)[0]?.key ?? null);
  }, [id, isNew, draft.data, draft.isPending, published.data, published.isPending]);

  const update = useCallback(
    (next: Document) => {
      setDoc(next);
      setDirty(true);
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

  const leave = useCallback(() => go(isNew ? '/library' : `/doc/${id}`), [go, id, isNew]);
  // `Shell` also binds Escape (palette → drawer → split). Without this guard both handlers fire
  // and closing the palette inside the editor also navigated away, discarding the draft.
  useHotkeys(
    { Escape: () => modal.count === 0 && !palette.state.open && leave() },
    [leave, modal.count, palette.state.open],
  );

  const doPublish = async () => {
    if (!doc) return;
    const bad = checks.find(([k]) => k === 'bad');
    if (bad) {
      toast(bad[1], 'warn');
      return;
    }
    const partial = checks.some(([, t]) => t.includes('ריק'));
    const nextV = (published.data?.currentVersion ?? 0) + 1;
    const label = await modal.prompt(
      `פרסום v${nextV}`,
      'מה השתנה? (מופיע בהיסטוריית הגרסאות)',
      isNew ? 'פריט ידע חדש' : '',
    );
    if (label == null) return;
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
      });
      targetId = created.id;
    } else {
      await patch.mutateAsync({
        title: clean.title,
        description: clean.description,
        category: clean.category,
        wave: clean.wave,
        priority: clean.priority,
      });
      await saveStructure.mutateAsync({
        phases: clean.phases,
        related: clean.related,
        etag: published.data?.etag,
      });
    }
    // `targetId` — not `id` — so creating a knowledge item actually publishes the new document
    // instead of POSTing to the literal path segment `new`.
    const { version } = await publish.mutateAsync({
      id: targetId,
      label: label || 'פורסם',
      markPartial: partial,
    });
    toast(`פורסם v${version} · הכרטיס בספרייה עודכן`, 'ok');
    go(`/doc/${targetId}`);
  };

  // "בקש סקירה" used to PATCH an empty body and toast success. `PatchDocumentBodySchema` has no
  // `status` field and the API publishes no review transition, so nothing was persisted and no
  // reviewer was notified. The control is removed until such a route exists.

  if (!doc) return <div className="route-loading">טוען…</div>;

  // The draft envelope reports who else holds a draft on this document; the API already excludes
  // the current user from the list.
  const otherEditors = draft.data?.otherEditors ?? [];
  const anotherEditor = otherEditors.length > 0;
  const nextV = (published.data?.currentVersion ?? 0) + 1;
  const applyBasic = (t: BasicType) => update(addBasic(doc, t, selected, selected));
  const applyShared = (b: Block) => update(addShared(doc, b, null));

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
            onChange={(e) => update({ ...doc, title: e.target.value })}
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
          <div className="actions">
            <button
              className="btn sm"
              onClick={() => download(`${doc.title || 'knowledge-item'}.json`, JSON.stringify(doc, null, 2))}
            >
              ייצוא JSON
            </button>
            {can('docs.publish', doc) ? (
              <button className="btn primary sm" onClick={() => void doPublish()}>
                פרסם v{nextV}
              </button>
            ) : null}
          </div>
        </div>

        <div className="ed-body">
          <div className="ed-fields">
            <label>
              קטגוריה
              <select
                aria-label="קטגוריה"
                value={doc.category}
                onChange={(e) => update({ ...doc, category: e.target.value as Category })}
              >
                {CAT_KEYS.map((c) => (
                  <option key={c} value={c}>
                    {CATS[c].icon} {CATS[c].label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              גל כתיבה
              <select
                aria-label="גל כתיבה"
                value={doc.wave}
                onChange={(e) => update({ ...doc, wave: Number(e.target.value) as 1 | 2 | 3 })}
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
                onChange={(e) => update({ ...doc, priority: e.target.value as Document['priority'] })}
              >
                {Object.entries(PRI).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              קובץ יעד
              <select
                className="mono"
                aria-label="קובץ יעד"
                value={doc.category === 'intl' ? 'intl' : 'topics'}
                disabled
              >
                {SOURCE_FILES.filter((s) => s.kind === 'docs').map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.file}
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
            onChange={(e) => update({ ...doc, description: e.target.value })}
          />

          {doc.phases.map((p, pi) => (
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
                  selected={selected === s.key}
                  fields={fields.data ?? []}
                  blocks={blocks.data ?? []}
                  onSelect={() => setSelected(s.key)}
                  onPatch={(m) => patchStep(s.key, m)}
                  onMove={(dir) => update(moveStep(doc, s.key, dir))}
                  onDelete={() => update(deleteStep(doc, s.key))}
                  onDrop={(data) => update(dropAt(doc, data, s.key, blocks.data ?? []))}
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
        </div>
      </div>

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
