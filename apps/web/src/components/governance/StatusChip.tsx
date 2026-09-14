import type { DocumentStatus } from '@wecom/shared';
import { STATUS_LABEL } from '../../lib/constants.js';

/**
 * Chip tone per status. `published` is deliberately `null`: it is the normal state, and a chip on
 * every card would say nothing. Everything else is an exception the reader must notice.
 */
const TONE: Record<DocumentStatus, string | null> = {
  draft: 'chip-amber',
  review: 'chip-amber',
  published: null,
  partial: 'chip-amber',
  invalid: 'chip-red',
  archived: 'chip-gray',
};

/** One status chip for cards, the article header and search rows. Renders nothing for `published`. */
export function StatusChip({ status }: { status: DocumentStatus }) {
  const tone = TONE[status];
  if (!tone) return null;
  return (
    <span className={`chip ${tone}`} data-status={status}>
      {STATUS_LABEL[status]}
    </span>
  );
}
