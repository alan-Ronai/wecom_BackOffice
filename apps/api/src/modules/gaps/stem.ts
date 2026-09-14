/** The seven Hebrew one-letter prefixes (ו ה ב ל מ ש כ) that glue onto the next word. */
const PREFIXES = new Set(['ו', 'ה', 'ב', 'ל', 'מ', 'ש', 'כ']);
const NIQQUD = /[֑-ׇ]/g;
/** Gershayim and apostrophes sit *inside* Hebrew acronyms (חו"ל, צה"ל), so they vanish rather than split. */
const QUOTES = /['"׳״‘’“”]/g;
const PUNCT = /[^\p{L}\p{N}\s]/gu;

/**
 * A cheap, deterministic stem for clustering zero-result searches: "והחשבונית" and "חשבונית"
 * must be the same gap, or the same missing answer shows up as five separate rows.
 *
 * The prefix strip is applied to a fixed point rather than once. A single pass is not idempotent
 * ("ולהפעלת" → "להפעלת" still starts with a prefix letter), and `normalizeStem` is the *key* of a
 * `knowledge_gaps` row: a value that changes when it is normalised again would let the same gap be
 * detected as new. The guard is the same either way — a letter is only dropped while at least three
 * characters remain, so "של" survives whole. It is a heuristic, not a morphological analyser: a real
 * word that happens to open with a prefix letter ("שלום" → "לום") folds too, which costs a slightly
 * coarser cluster and never a wrong one, since the key is only ever compared with itself.
 */
export function normalizeStem(q: string): string {
  const strip = (w: string): string => {
    let out = w;
    while (out.length >= 4 && PREFIXES.has(out[0]!)) out = out.slice(1);
    return out;
  };
  return q
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(QUOTES, '')
    .replace(PUNCT, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(strip)
    .join(' ');
}
