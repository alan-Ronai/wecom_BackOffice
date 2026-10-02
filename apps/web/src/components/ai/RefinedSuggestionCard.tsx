import { SuggestionPayloadSchema, type SuggestionPayload } from '@wecom/shared';
import { payloadSummary } from '../sources/SuggestionCard.js';

/**
 * A suggestion the model rewrote (`refine_suggestion`). Like a proposed edit, it is a proposal:
 * the payload is shown and the user still has to apply it (§1.3).
 *
 * `editedPayload` arrives as `unknown` on the wire — the stream schema does not re-declare the
 * payload union — so it is parsed here, and a payload that does not match the contract renders as
 * a note rather than as a card with an apply button that would send nonsense.
 */
export const parseRefinedPayload = (value: unknown): SuggestionPayload | null => {
  const parsed = SuggestionPayloadSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
};

export function RefinedSuggestionCard({
  suggestionId,
  editedPayload,
  onApply,
}: {
  suggestionId: string;
  editedPayload: unknown;
  onApply?: (suggestionId: string, payload: SuggestionPayload) => void;
}) {
  const payload = parseRefinedPayload(editedPayload);
  return (
    <section className="rs-card" role="region" aria-label="הצעה מעודנת">
      <b>הצעה מעודנת</b>
      <div className="small">{payload ? payloadSummary(payload) : 'תשובת המערכת אינה תואמת את החוזה'}</div>
      {payload && onApply ? (
        <button type="button" className="btn xs primary" onClick={() => onApply(suggestionId, payload)}>
          החל על ההצעה
        </button>
      ) : null}
    </section>
  );
}
