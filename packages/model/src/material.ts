/**
 * What counts as a *change worth proposing on*.
 *
 * The eval set had no negative case, and the review it came out of names the consequence: the
 * thing that will bury the pilot's review queue is not a wrong suggestion, it is a correct
 * suggestion about a typo. A paragraph whose only difference is whitespace, punctuation, a
 * spelling fix, or a heading rename produced a suggestion from the rule engine and a prompt line
 * for the model, and nobody could measure it.
 *
 * The rule here is deliberately conservative — anything it is unsure about is material, because
 * a missed suggestion is recoverable by an editor and a queue nobody reads is not:
 *
 * - **numbers, latin runs and quoted strings are always material.** `5 → 6`, `nomic → bge`,
 *   `"sim block lbl" → "sim status"` are facts, and a fact that changed is a change. This is
 *   what keeps case `01` (a threshold) apart from a typo: the digits differ.
 * - a difference that survives whitespace/punctuation normalisation, changes no material token,
 *   adds or removes no word, and leaves every differing word recognisably the same word, is a
 *   **typo**.
 * - a revision whose paragraph texts are the same multiset before and after is a **reorder**.
 */
import { similarity } from '@wecom/shared';
import type { ParagraphDiff } from '@wecom/shared';

/** A spelling fix keeps the word recognisable; a replaced word does not. */
const TYPO_WORD_SIMILARITY = 0.6;

/**
 * `@wecom/shared`'s `similarity` is Dice over *word* bigrams — the right measure for two
 * paragraphs and useless for two words, where it degenerates to exact match (`ריענוו` vs
 * `ריענון` scores 0.000). Telling a typo from a different word is a character-level question,
 * so it gets a character-level Dice.
 */
export function charSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const k = s.slice(i, i + 2);
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  };
  const A = grams(a);
  const B = grams(b);
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) ?? 0);
  return (2 * inter) / (a.length - 1 + (b.length - 1));
}

const PUNCT = /["'`״׳“”«»‚„.,;:!?()[\]{}\-–—…/\\|]+/g;
/** Whitespace-, punctuation- and case-insensitive. Hebrew has no case; the latin tokens do. */
export const normalisePlain = (t: string): string =>
  t
    .replace(PUNCT, ' ')
    // `\s` already covers the non-breaking space a docx paste brings with it.
    .replace(/\s+/gu, ' ')
    .trim()
    .toLowerCase();

const NUMBER = /\d+(?:[.,]\d+)?/g;
const LATIN = /[A-Za-z][A-Za-z0-9-]*/g;
const QUOTED = /["«'׳“”]([^"«»'׳“”]{2,60})["»'׳“”]/g;

/** Numbers, latin runs and quoted strings, sorted — the multiset whose change is always material. */
export const materialTokens = (t: string): string[] =>
  [
    ...(t.match(NUMBER) ?? []),
    ...(t.match(LATIN) ?? []).map((s) => s.toLowerCase()),
    ...[...t.matchAll(QUOTED)].map((m) => m[1].trim().toLowerCase()),
  ].sort();

const sameMultiset = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

const words = (t: string) => normalisePlain(t).split(' ').filter(Boolean);

/**
 * `before` and `after` say the same thing: identical once whitespace and punctuation are
 * normalised, or differing only in the spelling of words that are still the same words.
 */
export function isCosmetic(before: string, after: string): boolean {
  const b = normalisePlain(before);
  const a = normalisePlain(after);
  if (b === a) return true;
  if (!sameMultiset(materialTokens(before), materialTokens(after))) return false;
  const bw = words(before);
  const aw = words(after);
  // A word was added or removed: that is content, however small.
  if (bw.length !== aw.length) return false;
  return bw.every((w, i) => w === aw[i] || charSimilarity(w, aw[i]) >= TYPO_WORD_SIMILARITY);
}

const sentences = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

/**
 * The sentences of `after` a suggestion should be written from: the ones with no counterpart in
 * `before` (new content) *and* the ones whose counterpart differs materially (a changed value).
 *
 * The second half is what the rule engine was missing. On case `01` every sentence has a close
 * counterpart, so `addedSentences` returned nothing and the engine emitted an `update-step` whose
 * `addActions` was empty — a suggestion that names no action, scoring 1/1/**0**. Returning the
 * changed sentence instead is both a better suggestion and a truthful one.
 *
 * Empty means: nothing here is worth a suggestion.
 */
export function materialSentences(before: string, after: string): string[] {
  if (isCosmetic(before, after)) return [];
  const bs = sentences(before);
  const out: string[] = [];
  for (const s of sentences(after)) {
    const twin = bs.find((b) => b === s) ?? bs.slice().sort((x, y) => similarity(s, y) - similarity(s, x))[0];
    if (!twin) {
      out.push(s);
      continue;
    }
    if (twin === s) continue;
    if (similarity(s, twin) < 0.5 || !isCosmetic(twin, s)) out.push(s);
  }
  return out;
}

/** Quoted names this change swapped out of the known CRM field list and into an unknown one. */
export function renamedFields(
  before: string,
  after: string,
  known: ReadonlySet<string>,
): { from: string; to: string }[] {
  if (!known.size) return [];
  const q = (t: string) => [...t.matchAll(QUOTED)].map((m) => m[1].trim());
  const b = q(before);
  const a = q(after);
  const from = b.filter((x) => known.has(x.toLowerCase()) && !a.includes(x));
  const to = a.filter((x) => !known.has(x.toLowerCase()) && !b.includes(x));
  return from.length && to.length ? [{ from: from[0], to: to[0] }] : [];
}

/**
 * The paragraph's *only* material difference is a renamed CRM field. The `field-alert` is then
 * the whole suggestion: nothing new was said, a name was. A paragraph that both renames a field
 * and adds an instruction is not this, and gets both suggestions — two decisions, two people.
 */
export function isFieldRenameOnly(before: string, after: string, known: ReadonlySet<string>): boolean {
  const renamed = renamedFields(before, after, known);
  if (!renamed.length) return false;
  // Substitute the new name back and ask whether anything else moved.
  const repaired = after.split(renamed[0].to).join(renamed[0].from);
  return isCosmetic(before, repaired);
}

/** A heading anchor as `htmlToParagraphs` and the docx parser emit it. */
export const HEADING_REF = /^h\d+-\d+$/;
export const isHeadingRef = (ref: string): boolean => HEADING_REF.test(ref.replace(/^§/, ''));

/**
 * The revision moved paragraphs around and changed nothing: the multiset of normalised texts is
 * the same before and after. A reorder is a real edit of the source and no edit of the knowledge.
 */
export function isReorderOnly(diffs: ParagraphDiff[]): boolean {
  const moved = diffs.filter((d) => d.kind !== 'same');
  if (!moved.length) return false;
  const before = moved
    .map((d) => normalisePlain(d.before ?? ''))
    .filter(Boolean)
    .sort();
  const after = moved
    .map((d) => normalisePlain(d.after ?? ''))
    .filter(Boolean)
    .sort();
  return before.length > 1 && sameMultiset(before, after);
}

/**
 * The diffs worth showing a model, in order. A cosmetic change is dropped rather than shown and
 * argued about: the tokens are not free and the model is not the right place to decide that a
 * spelling fix is not a procedure change.
 */
export function materialDiffs(diffs: ParagraphDiff[]): ParagraphDiff[] {
  if (isReorderOnly(diffs)) return [];
  return diffs.filter((d) => {
    if (d.kind === 'same') return false;
    if (d.kind !== 'changed') return true;
    if (isHeadingRef(d.ref)) return false;
    return !isCosmetic(d.before ?? '', d.after ?? '');
  });
}
