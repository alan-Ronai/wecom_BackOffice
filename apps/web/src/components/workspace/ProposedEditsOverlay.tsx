import { useMemo, useState } from 'react';
import { plural, type DecideProposedEditsResult, type ProposedEdits } from '@wecom/shared';
import { useDecideProposedEdits } from '../../api/hooks/ai.js';
import { useSourceDocument } from '../../api/hooks/sourcedocs.js';
import { useCan } from '../../api/hooks/me.js';
import { useToast } from '../ui/Toast.js';
import { ApiError } from '../../api/unwrap.js';
import { anchorText, applyOps, htmlToPlain, normalizeAnchor } from '../../lib/proposedEdits.js';

const KIND: Record<string, string> = { replace: 'החלפה', insert: 'הוספה', delete: 'מחיקה' };
const acceptedPhrase = (n: number) =>
  plural(n, { one: 'אחת מתקבלת', two: 'שתיים מתקבלות', many: '# מתקבלות' });
const rejectedPhrase = (n: number) => plural(n, { one: 'אחת נדחית', two: 'שתיים נדחות', many: '# נדחות' });

/**
 * The hunk overlay above the source editor.
 *
 * Every hunk is a tri-state row: accepted, rejected, or untouched. "אשר החלטות" is explicit about
 * what happens to the untouched ones — they are rejected, because a decision that silently leaves
 * hunks pending is not a decision, and the server's `decide` is one atomic save either way.
 *
 * The preview is rendered client-side by `applyOps`; the *apply* is the server's, with `If-Match`
 * on the base version the event carried. A 409 means the source moved under the proposal, and the
 * only honest answer is to drop the overlay and ask for a fresh one.
 */
export function ProposedEditsOverlay({
  documentId,
  proposed,
  onDecided,
  onDismiss,
}: {
  documentId: string;
  proposed: ProposedEdits | null;
  onDecided: (result: DecideProposedEditsResult) => void;
  onDismiss: () => void;
}) {
  const can = useCan();
  const mayEdit = can('docs.edit') && can('ai.chat');
  const source = useSourceDocument(documentId);
  const decide = useDecideProposedEdits(documentId);
  const toast = useToast();
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [rejected, setRejected] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState(false);

  const ops = useMemo(() => proposed?.ops ?? [], [proposed]);
  const html = source.data?.html ?? '';
  const previewHtml = useMemo(() => applyOps(html, ops, accepted), [html, ops, accepted]);

  if (!proposed) return null;

  const mark = (id: string, as: 'accept' | 'reject') => {
    setAccepted((s) => {
      const n = new Set(s);
      if (as === 'accept') n.add(id);
      else n.delete(id);
      return n;
    });
    setRejected((s) => {
      const n = new Set(s);
      if (as === 'reject') n.add(id);
      else n.delete(id);
      return n;
    });
  };

  const run = (body: { accept: string[] | 'all'; reject: string[] | 'all' }) =>
    decide.mutate(
      { id: proposed.id, ...body },
      {
        onSuccess: (result) => {
          toast(
            result.resultingSourceVersion
              ? `מסמך המקור עודכן · גרסה ${result.resultingSourceVersion}`
              : 'ההצעות נדחו',
            'ok',
          );
          onDecided(result);
        },
        onError: (err: unknown) => {
          if (err instanceof ApiError && err.status === 409)
            toast('מסמך המקור השתנה בינתיים — טען מחדש והצע שוב', 'warn');
          else toast(err instanceof Error ? err.message : 'לא ניתן להחיל את העריכות', 'warn');
          onDismiss();
        },
      },
    );

  const rejectAll = ops.filter((o) => !accepted.has(o.id)).map((o) => o.id);

  return (
    <section className="pe-overlay" role="region" aria-label="עריכות מוצעות במסמך">
      <div className="hd">
        <b>עריכות מוצעות במסמך המקור</b>
        <span className="small muted">על גרסה {proposed.baseSourceVersion}</span>
        <span className="grow" />
        <button type="button" className="btn xs" aria-pressed={preview} onClick={() => setPreview((v) => !v)}>
          תצוגה מקדימה
        </button>
        {mayEdit ? (
          <button
            type="button"
            className="btn xs primary"
            disabled={decide.isPending || !ops.length}
            onClick={() => run({ accept: 'all', reject: [] })}
          >
            קבל הכל
          </button>
        ) : null}
      </div>

      <ol className="pe-ops">
        {ops.map((op) => {
          const stale = op.before ? anchorText(html, op.anchor) !== htmlToPlain(op.before) : false;
          return (
            <li
              key={op.id}
              className={
                'pe-op ' +
                op.kind +
                (accepted.has(op.id) ? ' accepted' : '') +
                (rejected.has(op.id) ? ' rejected' : '')
              }
            >
              <span className="chip chip-gray">{KIND[op.kind]}</span>
              <span className="anchor" dir="ltr">
                {normalizeAnchor(op.anchor)}
              </span>
              <span className="pe-text">
                {op.before ? <del dir="rtl">{htmlToPlain(op.before)}</del> : null}
                {op.after ? <ins dir="rtl">{htmlToPlain(op.after)}</ins> : null}
                {stale ? <span className="small muted"> · הטקסט במקור השתנה</span> : null}
              </span>
              {mayEdit ? (
                <span className="pe-actions">
                  <button
                    type="button"
                    className="btn xs"
                    aria-pressed={rejected.has(op.id)}
                    onClick={() => mark(op.id, 'reject')}
                  >
                    דחה
                  </button>
                  <button
                    type="button"
                    className="btn xs primary"
                    aria-pressed={accepted.has(op.id)}
                    onClick={() => mark(op.id, 'accept')}
                  >
                    קבל
                  </button>
                </span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {preview ? (
        <div
          className="prose source-html pe-preview"
          dir="rtl"
          aria-label="תצוגה מקדימה של המקור"
          /* Server-sanitized source plus server-produced hunks — the trust level `SourcePane`
             already renders at. */
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />
      ) : null}

      <div className="ft">
        {mayEdit ? null : <span className="small muted">אין הרשאה להחיל עריכות במסמך המקור</span>}
        <button type="button" className="btn xs" onClick={onDismiss}>
          בטל
        </button>
        {mayEdit ? (
          <button
            type="button"
            className="btn xs primary"
            disabled={decide.isPending || !ops.length}
            onClick={() => run({ accept: [...accepted], reject: rejectAll })}
          >
            {`אשר החלטות (${acceptedPhrase(accepted.size)}, ${rejectedPhrase(rejectAll.length)})`}
          </button>
        ) : null}
      </div>
    </section>
  );
}
