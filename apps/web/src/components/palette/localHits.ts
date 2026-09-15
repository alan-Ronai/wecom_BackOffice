import type { DocumentCard, DocumentStatus } from '@wecom/shared';
import type { SearchHit } from '../../api/types.js';

/**
 * What the palette can answer with when the query is too short to send (`MIN_SEARCH_CHARS`).
 *
 * The one thing the palette must not do below the threshold is go blank: an agent mid-call types
 * two letters and has to see *something*. Everything here comes out of state the client already
 * holds — the document lists TanStack Query has cached, the `lastSeen` map in preferences, and the
 * `pinned` flag on the cards themselves — so a short query costs no request at all.
 *
 * Hits are shaped exactly like server hits (`type: 'document'`, `documentId`, `docType`, `world`)
 * so `hitLabel` labels them and `choose()` opens them through the same path as a real result. The
 * group labels are deliberately *not* the server's (`מסמכים`) — the rows are what is already
 * loaded, not what the search index would return, and the palette should not claim otherwise.
 */

/** The result box shows about six rows; three local sections at five each still fit a scroll. */
const CAP = 5;

export const LOCAL_GROUP_LABELS = {
  recent: 'מסמכים שנצפו לאחרונה',
  pinned: 'מסמכים מוצמדים',
  cached: 'מסמכים שכבר נטענו',
} as const;

/**
 * A local hit is a server hit plus the one thing the card knows and `GET /search` does not send:
 * the item's status (M5).
 *
 * It is a *client-side* field, deliberately not appended to `SearchHitSchema`: the search route
 * does not return it, and a contract field the API never fills is worse than no field. These rows
 * are built here, from cards this client already holds, so the status is simply carried along.
 */
export interface LocalHit extends SearchHit {
  status?: DocumentStatus;
}

export interface LocalGroup {
  label: string;
  hits: LocalHit[];
}

/**
 * M5 — `status` travels with the row.
 *
 * Without it "מסמכים שכבר נטענו" offered a draft and a published item as the same kind of thing:
 * identical row, identical chips, and the agent on a call cannot tell that the procedure they are
 * about to read has never been published. The cards carry the status; nothing was dropping it on
 * purpose, so the palette renders the same `StatusChip` the library card and the article header do.
 */
const toHit = (c: DocumentCard): LocalHit => ({
  type: 'document',
  id: c.id,
  documentId: c.id,
  title: c.title,
  snippet: '',
  // `meta` is the server's pre-rendered display string. There is nothing honest to put here, and
  // `hitLabel` reads the structured fields below in preference to it anyway.
  meta: '',
  score: 0,
  ...(c.docType ? { docType: c.docType } : {}),
  ...(c.worlds[0] ? { world: c.worlds[0] } : {}),
  ...(c.status ? { status: c.status } : {}),
});

/**
 * Local sections for `needle`, in the order the palette shows them. Empty for an empty needle —
 * with nothing typed there is nothing to filter, and the palette keeps its legacy empty state.
 */
export function localGroups(o: {
  cards: DocumentCard[];
  /** `documentId` → ISO timestamp of the last time this user opened it (`useUiPrefs`). */
  lastSeen: Record<string, string>;
  needle: string;
}): LocalGroup[] {
  const needle = o.needle.trim().toLowerCase();
  if (!needle) return [];
  const matched = o.cards.filter((c) => c.title.toLowerCase().includes(needle));

  const out: LocalGroup[] = [];
  // A document belongs to the first section that claims it, so nothing is offered twice.
  const used = new Set<string>();
  const push = (label: string, cards: DocumentCard[]): void => {
    const take = cards.filter((c) => !used.has(c.id)).slice(0, CAP);
    if (!take.length) return;
    for (const c of take) used.add(c.id);
    out.push({ label, hits: take.map(toHit) });
  };

  push(
    LOCAL_GROUP_LABELS.recent,
    matched
      .filter((c) => o.lastSeen[c.id])
      .sort((a, b) => (o.lastSeen[b.id] ?? '').localeCompare(o.lastSeen[a.id] ?? '')),
  );
  push(
    LOCAL_GROUP_LABELS.pinned,
    matched.filter((c) => c.pinned),
  );
  push(LOCAL_GROUP_LABELS.cached, matched);
  return out;
}
