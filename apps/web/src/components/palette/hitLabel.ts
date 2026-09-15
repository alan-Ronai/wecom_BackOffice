import { DOC_TYPE_LABELS } from '@wecom/shared';
import { cat, STATUS_LABEL } from '../../lib/constants.js';
import type { LocalHit } from './localHits.js';

/**
 * A-2 (review §3, §7 item 8) — what a search result is *called*.
 *
 * `GET /search` returns `meta` as a pre-rendered display string that leads with the ingest
 * filename: `topics.json · תמיכה טכנית · שלב 1 – מסנן`. The agent needs the knowledge item there,
 * not the file the seed came from. Wave 5 appends `docType`, `world` and `docTitle` to the hit for
 * exactly that, and this module turns the pair into what the row renders.
 *
 * Split out of `Palette.tsx` so the visible row, the `aria-label` the keyboard and a screen reader
 * get, and the tests all read the *same* label — the review's complaint was precisely that one
 * surface said something different from every other.
 */

/** The Hebrew word for what kind of thing was matched, for the announced label. */
const KIND_LABEL: Record<string, string> = {
  document: 'מסמך',
  step: 'שלב',
  block: 'בלוק משותף',
  field: 'שדה CRM',
  script: 'תסריט',
  action: 'פעולה',
};

/** `topics.json`, `intl-roaming.json`, `crm-fields.json`, `scripts.json` — all developer-facing. */
const INGEST_FILE = /\.json$/;

export interface HitLabel {
  /** Item type chip, when the hit is backed by a knowledge item. */
  docType: LocalHit['docType'];
  /** World slug for the chip, when known. */
  world: string | null;
  /**
   * The knowledge item the hit belongs to — shown only when it is not already the row's title,
   * which is the step case: `title` is the matched section, `item` is the document it is in.
   */
  item: string | null;
  /** Whatever `meta` still contributes: the phase, the shared block, the version. */
  rest: string[];
  /** One string for `aria-label`, so the keyboard hears what the eye reads. */
  aria: string;
}

export function hitLabel(hit: LocalHit): HitLabel {
  const worldLabel = hit.world ? cat(hit.world).label : null;
  const rest = hit.meta
    .split('·')
    .map((s) => s.trim())
    .filter(Boolean)
    // The ingest filename is the defect. The world label is dropped only when a world chip is
    // rendering it anyway — without the chip it is the most useful thing in the string.
    .filter((s) => !INGEST_FILE.test(s))
    .filter((s) => s !== worldLabel);

  // A document hit's `docTitle` *is* its title; repeating it would read as a stutter.
  const item = hit.docTitle && hit.docTitle !== hit.title ? hit.docTitle : null;

  const aria = [
    KIND_LABEL[hit.type] ?? hit.type,
    hit.title,
    hit.docType ? `${hit.docType} · ${DOC_TYPE_LABELS[hit.docType]}` : null,
    // M5. Only where a chip is rendered — `published` is the normal state and `StatusChip` draws
    // nothing for it, so announcing it would tell the keyboard something the eye is not told.
    hit.status && hit.status !== 'published' ? STATUS_LABEL[hit.status] : null,
    worldLabel,
    item,
    ...rest,
  ]
    .filter(Boolean)
    .join(' · ');

  return { docType: hit.docType, world: hit.world ?? null, item, rest, aria };
}
