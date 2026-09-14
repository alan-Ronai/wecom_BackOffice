import type { Category, DocumentStatus } from '@wecom/shared';
import type { MenuItem } from '../library/CardMenu.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { useCan } from '../../api/hooks/me.js';
import { useSetStatus, type SettableStatus } from '../../api/hooks/governance.js';

/** The slice of a document (or card) the status actions need. */
export type StatusMenuDoc = { id: string; status: DocumentStatus; category: Category };

/**
 * Which hand-set status is offered from which current one. `published`/`partial` can be pulled out
 * of circulation; an item already out of circulation can be re-worked ('draft') or filed away.
 * Publishing is never here — that stays with the publish route and its own permission.
 */
const ACTIONS: { status: SettableStatus; label: string; from: DocumentStatus[] }[] = [
  { status: 'invalid', label: 'סמן כלא בתוקף', from: ['published', 'partial', 'archived'] },
  { status: 'archived', label: 'העבר לארכיון', from: ['published', 'partial', 'invalid'] },
  { status: 'draft', label: 'החזר לטיוטה', from: ['invalid', 'archived'] },
];

/**
 * Builds the status items for the card ⋯ menu. Returns `[]` when the user cannot publish this
 * document, so a caller can spread the result unconditionally.
 */
export function useStatusMenuItems(): (doc: StatusMenuDoc) => MenuItem[] {
  const can = useCan();
  const modal = useModal();
  const toast = useToast();
  const set = useSetStatus();
  return (doc) => {
    if (!can('docs.publish', doc)) return [];
    return ACTIONS.filter((a) => a.from.includes(doc.status)).map((a) => ({
      label: a.label,
      run: async () => {
        // A status change is an editorial decision; §5.5 requires the reason on the audit row.
        const reason = await modal.prompt(a.label, 'סיבה', '', true);
        if (!reason?.trim()) return;
        try {
          await set.mutateAsync({ id: doc.id, status: a.status, reason: reason.trim() });
          toast('הסטטוס עודכן', 'ok');
        } catch {
          toast('עדכון הסטטוס נכשל', 'warn');
        }
      },
    }));
  };
}

/** The same actions as inline buttons, for the article header (no kebab there). */
export function StatusActions({ doc }: { doc: StatusMenuDoc }) {
  const items = useStatusMenuItems()(doc);
  if (!items.length) return null;
  return (
    <span className="status-actions">
      {items.map((it) => (
        <button key={it.label} type="button" className="btn sm" onClick={() => it.run()}>
          {it.label}
        </button>
      ))}
    </span>
  );
}
