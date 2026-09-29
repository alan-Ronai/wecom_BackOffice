import { useMemo, useState } from 'react';
import { plural, type StructuredEdit, type Suggestion, type SuggestionPayload } from '@wecom/shared';
import { useCan } from '../../api/hooks/me.js';
import { useDocument } from '../../api/hooks/documents.js';
import { useDecideSuggestion, useEditSuggestion, useSuggestions } from '../../api/hooks/pipeline.js';
import {
  useAcceptSuggestionParts,
  useStructuredEdit,
  useSuggestion,
} from '../../api/hooks/suggestionsEdit.js';
import { useToast } from '../ui/Toast.js';
import { Empty, LoadError } from '../ui/index.js';
import { SuggestionCard } from '../sources/SuggestionCard.js';
import { rowsOf, type SuggestionRow } from '../../lib/suggestionRows.js';
import { AffectsChips } from './AffectsChips.js';
import { StructuredEditDrawer } from './StructuredEditDrawer.js';

const pending = (n: number) =>
  plural(n, { one: 'הצעה אחת ממתינה', two: 'שתי הצעות ממתינות', many: '# הצעות ממתינות' });

/** What actually goes on the wire: the ticked rows plus every required row, in row order. */
const partsFor = (rows: SuggestionRow[], chosen: ReadonlySet<string>): string[] =>
  rows.filter((r) => r.required || chosen.has(r.rowId)).map((r) => r.rowId);

interface SourceGroup {
  sourceId: string;
  title: string;
  items: Suggestion[];
}

/**
 * Wave Y: the list grouped by the source each suggestion came from — the document's primary
 * source first, then the linked ones by title. Order within a group is the list's own (newest
 * first). A row the server sent without `sourceId` (an older API) joins the primary group.
 */
const bySource = (items: Suggestion[], primary: string | undefined): SourceGroup[] => {
  const map = new Map<string, SourceGroup>();
  for (const s of items) {
    const id = s.sourceId ?? primary ?? '';
    const g = map.get(id) ?? { sourceId: id, title: s.sourceTitle ?? '', items: [] };
    g.items.push(s);
    map.set(id, g);
  }
  return [...map.values()].sort((a, b) =>
    a.sourceId === primary ? -1 : b.sourceId === primary ? 1 : a.title.localeCompare(b.title, 'he'),
  );
};

/**
 * The workspace's middle pane: the suggestions raised against this item's source document, each
 * with what else it touches, a field-level editor and a partial apply.
 *
 * The existing `SuggestionCard` is reused as-is — accept / reject / reset and the one-line edit
 * are unchanged. What wave 6 adds sits underneath it: the `affects` chips (§1.6), "עריכה מפורטת"
 * (§1.8) and a row picker whose ticks become `POST /suggestions/:id/accept { parts }`.
 */
export function SuggestionsPanel({
  documentId,
  sourceId,
  onAskAbout,
  refined,
  onRefinedConsumed,
  embedded,
}: {
  /**
   * The item whose source this is. X6 mounts the panel on `/sources/:id` too, where the page has
   * a source but no single document, so it is optional: with an explicit `sourceId` the document
   * is only a fallback for finding one.
   */
  documentId?: string;
  sourceId?: string;
  onAskAbout?: (suggestionId: string) => void;
  /** A payload the chat refined, handed over by the workspace for the editor to accept. */
  refined?: { suggestionId: string; payload: SuggestionPayload } | null;
  onRefinedConsumed?: () => void;
  /**
   * Mounted inside a host that already draws the heading and the "no suggestions" state
   * (`SourcesPage`'s `<aside>`), so the panel draws neither: two headers and two empty states over
   * one list is the page telling the reader the same thing twice.
   */
  embedded?: boolean;
}) {
  const can = useCan();
  const canReview = can('suggestions.review');
  const canApply = can('suggestions.apply');
  const toast = useToast();
  const doc = useDocument(documentId);
  const primarySourceId = sourceId ?? doc.data?.sourceId ?? undefined;
  /*
   * Wave Y: on a document, every source linked to it — the primary `sourceId` plus each
   * `document_links.to_source_id` — not the primary alone, so a multi-source item shows all of its
   * pending work. An explicit `sourceId` (the `/sources/:id` mount) still means that one source.
   * Never unfiltered: a bare `/suggestions` asks for every suggestion in the system.
   */
  const list = useSuggestions(
    sourceId ? { sourceId } : documentId ? { documentId } : {},
    !!(sourceId || documentId),
  );
  const decide = useDecideSuggestion();
  const edit = useEditSuggestion();
  const structured = useStructuredEdit();
  const acceptParts = useAcceptSuggestionParts();

  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});

  const items: Suggestion[] = useMemo(() => list.data?.items ?? [], [list.data]);
  const inList = items.find((s) => s.id === drawerFor) ?? null;
  /*
   * The chat can hand back a refinement for a suggestion this pane's list does not hold — another
   * source, or one that has since moved out of the caller's world scope, for which
   * `GET /suggestions/:id` now answers 404. Fetching it is what turns "the button does nothing"
   * into either the drawer or a sentence saying why not.
   */
  const fetched = useSuggestion(drawerFor && !inList ? drawerFor : null);
  const open = inList ?? fetched.data ?? null;
  const unavailable = !!drawerFor && !open && !fetched.isPending;
  const pendingCount = items.filter((s) => s.status === 'pending').length;
  const groups = useMemo(() => bySource(items, primarySourceId), [items, primarySourceId]);

  if (list.isError) return <LoadError what="ההצעות" error={list.error} />;
  if (list.isPending) return <div className="route-loading">טוען…</div>;
  if (!items.length && !sourceId && doc.data && !doc.data.sourceId)
    return <Empty title="לפריט זה אין מסמך מקור מקושר" />;
  if (!items.length)
    return embedded ? null : <Empty title="אין הצעות פתוחות">כל השינויים במקור טופלו.</Empty>;

  /**
   * The quick picker obeys the same two rules as the drawer, because the server does:
   * `POST /suggestions/:id/accept { parts }` answers 400 `NOT_SPLITTABLE` for a selection that
   * cuts an atomic group (`rep-*`, `out-*`, `act-*`), and a required row is not optional. So a
   * tick moves its whole group, and required rows are ticked and locked rather than offered.
   */
  const toggle = (id: string, rows: SuggestionRow[], row: SuggestionRow) =>
    setPicked((p) => {
      const next = new Set(p[id] ?? []);
      const group = row.atomic ? rows.filter((r) => r.atomic === row.atomic) : [row];
      const on = !next.has(row.rowId);
      for (const r of group) {
        if (on) next.add(r.rowId);
        else next.delete(r.rowId);
      }
      return { ...p, [id]: next };
    });

  const save = (id: string, structuredEdit: StructuredEdit) => {
    structured.mutate(
      { id, edit: structuredEdit },
      {
        onSuccess: () => {
          toast('העריכה נשמרה', 'ok');
          setDrawerFor(null);
          onRefinedConsumed?.();
        },
        onError: (err: unknown) => toast(err instanceof Error ? err.message : 'לא ניתן לשמור', 'warn'),
      },
    );
  };

  const renderItem = (s: Suggestion) => {
    const payload = s.editedPayload ?? s.payload;
    const rows = rowsOf(payload);
    const chosen = picked[s.id] ?? new Set<string>();
    return (
      <li key={s.id} data-suggestion-id={s.id}>
        <SuggestionCard
          suggestion={s}
          canReview={canReview}
          canApply={canApply}
          onDecide={(decision) => decide.mutate({ id: s.id, decision })}
          onEdit={(text) => {
            const next: SuggestionPayload =
              payload.type === 'update-step'
                ? { ...payload, addActions: [text] }
                : payload.type === 'new-card'
                  ? { ...payload, title: text }
                  : payload;
            edit.mutate({ id: s.id, editedPayload: next });
          }}
        />
        <AffectsChips affects={s.affects} />
        {s.status === 'pending' ? (
          <div className="sp-actions">
            {canReview ? (
              <button type="button" className="btn xs" onClick={() => setDrawerFor(s.id)}>
                עריכה מפורטת
              </button>
            ) : null}
            {onAskAbout ? (
              <button type="button" className="btn xs" onClick={() => onAskAbout(s.id)}>
                שאל על ההצעה
              </button>
            ) : null}
          </div>
        ) : null}
        {s.status === 'pending' && canReview ? (
          <>
            <ul className="sug-rows">
              {rows.map((r) => (
                <li key={r.rowId}>
                  <label>
                    <input
                      type="checkbox"
                      checked={r.required || chosen.has(r.rowId)}
                      disabled={r.required}
                      onChange={() => toggle(s.id, rows, r)}
                    />
                    <span className="small muted">{r.label}: </span>
                    {r.value}
                    {r.required ? <span className="small muted"> · חובה</span> : null}
                    {r.atomic ? <span className="small muted"> · קבוצה אחת</span> : null}
                  </label>
                </li>
              ))}
            </ul>
            <button
              type="button"
              className="btn xs primary"
              disabled={!chosen.size || acceptParts.isPending}
              onClick={() =>
                acceptParts.mutate(
                  { id: s.id, parts: partsFor(rows, chosen) },
                  {
                    onSuccess: () => {
                      toast('השורות שנבחרו הוחלו', 'ok');
                      setPicked((p) => ({ ...p, [s.id]: new Set() }));
                    },
                    onError: (err: unknown) =>
                      toast(err instanceof Error ? err.message : 'לא ניתן להחיל', 'warn'),
                  },
                )
              }
            >
              החל חלקית
            </button>
          </>
        ) : null}
      </li>
    );
  };

  return (
    <div className="suggestions-panel" dir="rtl">
      {embedded ? null : (
        <header className="sp-head">
          <b>הצעות</b>
          <span className="small muted">{pending(pendingCount)}</span>
        </header>
      )}

      {refined ? (
        <div className="sp-refined" role="status">
          <span>התקבלה הצעה מעודנת מהצ׳אט</span>
          <button type="button" className="btn xs primary" onClick={() => setDrawerFor(refined.suggestionId)}>
            פתח בעורך
          </button>
          <button type="button" className="btn xs" onClick={() => onRefinedConsumed?.()}>
            התעלם
          </button>
        </div>
      ) : null}

      {groups.length > 1 ? (
        groups.map((g) => (
          <section key={g.sourceId} className="sp-group" aria-label={`הצעות מהמקור ${g.title}`}>
            <h3 className="sp-group-head">
              {g.title || 'מקור ללא שם'}
              {g.sourceId === primarySourceId ? <span className="small muted"> · מקור ראשי</span> : null}
              <span className="small muted">
                {' '}
                · {pending(g.items.filter((s) => s.status === 'pending').length)}
              </span>
            </h3>
            <ul className="sp-list">{g.items.map(renderItem)}</ul>
          </section>
        ))
      ) : (
        <ul className="sp-list">{items.map(renderItem)}</ul>
      )}

      {unavailable ? (
        /*
         * Not a crash and not a spinner: `GET /suggestions/:id` answers 404 both for a suggestion
         * that is gone and for one outside the caller's world scope, and the two are the same
         * sentence to the reader — the editor asked for something they cannot have.
         */
        <div className="sp-refined" role="status">
          <span>ההצעה אינה זמינה לך — ייתכן שהוסרה או שאינה בתחום ההרשאות שלך.</span>
          <button
            type="button"
            className="btn xs"
            onClick={() => {
              setDrawerFor(null);
              onRefinedConsumed?.();
            }}
          >
            סגור
          </button>
        </div>
      ) : null}

      {open ? (
        <StructuredEditDrawer
          suggestion={open}
          open
          prefill={refined && refined.suggestionId === open.id ? refined.payload : null}
          onClose={() => setDrawerFor(null)}
          onSave={(structuredEdit) => save(open.id, structuredEdit)}
        />
      ) : null}
    </div>
  );
}
