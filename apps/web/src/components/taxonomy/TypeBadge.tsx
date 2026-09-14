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
 * `T · תסריט` — the doc type as text, where a chip does not fit (A-4, review §3).
 *
 * The feedback modal and drawer used to print `סוג T`: the bare storage code, in the one place an
 * agent is being asked to describe a problem. Every other surface in the app spells it out, and
 * two spellings inside one component family is how a product starts reading as unfinished.
 *
 * Takes a `string` rather than a `DocType` because the feedback payload carries whatever the API
 * stored; an unrecognised code degrades to itself instead of `T · undefined`.
 */
export const docTypeLabel = (code: string): string => {
  const label = DOC_TYPE_LABELS[code as DocType];
  return label ? `${code} · ${label}` : code;
};

/**
 * Worlds are admin-managed data now, so `CATS` is a display hint for the six seeded slugs
 * rather than an exhaustive map; anything else falls back to the slug itself. Both of these are
 * thin names over `cat()`, kept because "world label" reads better at the call site than a
 * table lookup does.
 */
export const worldShort = (slug: string): string => cat(slug).short;
export const worldLabel = (slug: string): string => cat(slug).label;
