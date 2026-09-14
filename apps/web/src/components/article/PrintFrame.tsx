import type { Document } from '@wecom/shared';
import { CATS } from '../../lib/constants.js';
import { fmtDate } from '../../lib/format.js';

/**
 * Card 6b's print layout. Present in the DOM at all times but shown only by `@media print`, so
 * "הדפסה" (and the browser's own Ctrl P / "save as PDF") produce the same A4 page — a header
 * carrying the document and the version, and a footer carrying the date and where it came from.
 *
 * The version matters more than it looks: a printed procedure outlives the document it was
 * printed from, and an agent holding page 3 of v6 needs to be able to tell that it is stale.
 */
export function PrintFrame({ doc, steps }: { doc: Document; steps: number }) {
  return (
    <>
      <div className="print-head" aria-hidden="true">
        <b>{doc.title}</b>
        <span>
          {CATS[doc.category].label} · {steps} שלבים · v{doc.currentVersion}
        </span>
      </div>
      <div className="print-foot" aria-hidden="true">
        <span>הודפס {fmtDate(new Date().toISOString())}</span>
        <span>
          wecom · מאגר ידע פנימי · הגרסה החיה:{' '}
          <bdi className="lat" dir="ltr">
            /doc/{doc.id}
          </bdi>
        </span>
      </div>
    </>
  );
}
