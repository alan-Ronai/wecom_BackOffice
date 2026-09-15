import { useMemo, useState } from 'react';
import { plural, type StructuredEdit, type Suggestion, type SuggestionPayload } from '@wecom/shared';
import { useCan } from '../../api/hooks/me.js';
import { useDocument } from '../../api/hooks/documents.js';
import { useDecideSuggestion, useEditSuggestion, useSuggestions } from '../../api/hooks/pipeline.js';
import { useAcceptSuggestionParts, useStructuredEdit } from '../../api/hooks/suggestionsEdit.js';
import { useToast } from '../ui/Toast.js';
import { Empty, LoadError } from '../ui/index.js';
import { SuggestionCard } from '../sources/SuggestionCard.js';
import { rowsOf } from '../../lib/suggestionRows.js';
import { AffectsChips } from './AffectsChips.js';
import { StructuredEditDrawer } from './StructuredEditDrawer.js';

const pending = (n: number) =>
  plural(n, { one: 'הצעה אחת ממתינה', two: 'שתי הצעות ממתינות', many: '# הצעות ממתינות' });

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
}) {
  const can = useCan();
  const canReview = can('suggestions.review');
  const canApply = can('suggestions.apply');
  const toast = useToast();
  const doc = useDocument(documentId);
  const linkedSourceId = sourceId ?? doc.data?.sourceId ?? undefined;
  const list = useSuggestions(linkedSourceId ? { sourceId: linkedSourceId } : {});
  const decide = useDecideSuggestion();
  const edit = useEditSuggestion();
  const structured = useStructuredEdit();
  const acceptParts = useAcceptSuggestionParts();

  const [drawerFor, setDrawerFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, Set<string>>>({});

  const items: Suggestion[] = useMemo(() => list.data?.items ?? [], [list.data]);
  const open = items.find((s) => s.id === drawerFor) ?? null;
  const pendingCount = items.filter((s) => s.status === 'pending').length;

  if (list.isError) return <LoadError what="ההצעות" error={list.error} />;
  if (doc.data && !linkedSourceId) return <Empty title="לפריט זה אין מסמך מקור מקושר" />;
  if (list.isPending) return <div className="route-loading">טוען…</div>;
  if (!items.length) return <Empty title="אין הצעות פתוחות">כל השינויים במקור טופלו.</Empty>;

  const toggle = (id: string, rowId: string) =>
    setPicked((p) => {
      const next = new Set(p[id] ?? []);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
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

  return (
    <div className="suggestions-panel" dir="rtl">
      <header className="sp-head">
        <b>הצעות</b>
        <span className="small muted">{pending(pendingCount)}</span>
      </header>

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

      <ul className="sp-list">
        {items.map((s) => {
          const payload = s.editedPayload ?? s.payload;
          const rows = rowsOf(payload);
          const chosen = picked[s.id] ?? new Set<string>();
          return (
            <li key={s.id}>
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
                            checked={chosen.has(r.rowId)}
                            onChange={() => toggle(s.id, r.rowId)}
                          />
                          <span className="small muted">{r.label}: </span>
                          {r.value}
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
                        { id: s.id, parts: [...chosen] },
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
        })}
      </ul>

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
