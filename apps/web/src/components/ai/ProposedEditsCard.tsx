import type { ProposedEditOp } from '@wecom/shared';
import { htmlToPlain, normalizeAnchor } from '../../lib/proposedEdits.js';

const KIND: Record<ProposedEditOp['kind'], string> = {
  replace: 'החלפה',
  insert: 'הוספה',
  delete: 'מחיקה',
};

/**
 * The hunks a reply proposed, inline in the chat. Nothing here writes: each button hands the
 * decision to the host, which posts it to `POST /ai/proposed-edits/:id/decide` (owner decision
 * §1.3 — the chat proposes, the user decides).
 */
export function ProposedEditsCard({
  ops,
  onAccept,
  onReject,
  onAcceptAll,
  disabled,
}: {
  ops: ProposedEditOp[];
  onAccept: (ids: string[]) => void;
  onReject: (ids: string[]) => void;
  onAcceptAll: () => void;
  disabled?: boolean;
}) {
  return (
    <section className="pe-card" role="region" aria-label="עריכות מוצעות">
      <div className="hd">
        <b>עריכות מוצעות במסמך המקור</b>
        <button
          type="button"
          className="btn xs primary"
          disabled={disabled || !ops.length}
          onClick={onAcceptAll}
        >
          קבל הכל
        </button>
      </div>
      <ol className="pe-ops">
        {ops.map((op) => (
          <li key={op.id} className={'pe-op ' + op.kind}>
            <span className="chip chip-gray">{KIND[op.kind]}</span>
            <span className="anchor" dir="ltr">
              {normalizeAnchor(op.anchor)}
            </span>
            <span className="pe-text">
              {op.before ? <del dir="rtl">{htmlToPlain(op.before)}</del> : null}
              {op.after ? <ins dir="rtl">{htmlToPlain(op.after)}</ins> : null}
            </span>
            <span className="pe-actions">
              <button type="button" className="btn xs" disabled={disabled} onClick={() => onReject([op.id])}>
                דחה
              </button>
              <button
                type="button"
                className="btn xs primary"
                disabled={disabled}
                onClick={() => onAccept([op.id])}
              >
                קבל
              </button>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
