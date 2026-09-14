import { DOC_TYPE_LABELS, type DocType } from '@wecom/shared';
import { cat } from '../../lib/constants.js';

/** One chip per PRD item type; colour by type so agents tell diagnosis from operation at a glance. */
const TONE: Record<DocType, string> = {
  M: 'chip-blue',
  R: 'chip-green',
  O: 'chip-gray',
  E: 'chip-red',
  S: 'chip-purple',
  T: 'chip-amber',
  I: 'chip-gray',
};

export function TypeBadge({ docType, compact = false }: { docType: DocType; compact?: boolean }) {
  return (
    <span
      className={`chip type-badge ${TONE[docType]}`}
      title={DOC_TYPE_LABELS[docType]}
      data-doctype={docType}
    >
      <b>{docType}</b>
      {compact ? null : (
        <>
          <span aria-hidden="true">·</span>
          {/* Own element, not a text run next to the separator, so a test (and a screen reader)
              can address the label on its own. */}
          <span className="type-label">{DOC_TYPE_LABELS[docType]}</span>
        </>
      )}
    </span>
  );
}

/**
 * Worlds are admin-managed data now, so `CATS` is a display hint for the six seeded slugs
 * rather than an exhaustive map; anything else falls back to the slug itself. Both of these are
 * thin names over `cat()`, kept because "world label" reads better at the call site than a
 * table lookup does.
 */
export const worldShort = (slug: string): string => cat(slug).short;
export const worldLabel = (slug: string): string => cat(slug).label;
