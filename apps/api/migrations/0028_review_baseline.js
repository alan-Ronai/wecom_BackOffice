/**
 * Review baseline: what the reviewer was actually asked to look at.
 *
 * `POST /documents/:id/review-decision` locked the open `review_requests` row and published
 * whatever the document was *at that moment*. Nothing recorded the document at request time and
 * nothing compared it at decision time, so an author could push edits between "send to review"
 * and "approve" and the approval published them under the reviewer's name and label — in a
 * workflow whose entire purpose is that someone looked.
 *
 * Two columns rather than one. `base_version` is `documents.current_version`, which moves on
 * publish; `base_etag` is `documents.etag`, which `PUT /documents/:id/structure` regenerates on
 * every content write. A draft can be rewritten from top to bottom without its version moving,
 * so the version alone would have missed the most common case.
 *
 * Nullable, and the decision route treats `null` as "no baseline recorded": requests that were
 * already open when this migration ran keep working instead of becoming undecidable.
 */

exports.up = (pgm) => {
  pgm.addColumns('review_requests', {
    base_version: { type: 'integer' },
    base_etag: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('review_requests', ['base_version', 'base_etag']);
};
