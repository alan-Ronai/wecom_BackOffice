import { plural } from '@wecom/shared';

/**
 * The nouns this app counts, each written once (A-3, review §7 item 13).
 *
 * `plural()` in `@wecom/shared` knows the *rule*; this table knows the *words*. Keeping them apart
 * matters because the mistake the review found — `1 פריטים`, `1 נושאים`, `50 נושאים` — was not one
 * bad string, it was nineteen call sites each spelling its own plural inline. A named counter per
 * noun means a screen adds a count by calling `items(n)`, and there is exactly one place to fix if
 * the wording is ever wrong.
 *
 * The dual (`שני`/`שתי`) is supplied only for the nouns whose phrases stand alone as a count, which
 * is where Hebrew actually uses it. Where a count is embedded in a construction that wants the
 * digit — "N מתוך M", "עד N" — the call site uses the numeral directly rather than reaching here.
 *
 * Gender matters for the dual: `שני` for masculine (פריט, נושא, מסמך, משתמש), `שתי` for feminine
 * (גרסה, תוצאה, הצעה, הערה).
 */

/** פריט — a knowledge item. The review's headline example (`1 פריטים` on the topic page). */
export const items = (n: number): string =>
  plural(n, { one: 'פריט אחד', two: 'שני פריטים', many: '# פריטים' });

/** נושא — a topic, and what the library header calls its rows (`50 נושאים`, `1 נושאים`). */
export const topics = (n: number): string =>
  plural(n, { one: 'נושא אחד', two: 'שני נושאים', many: '# נושאים' });

/** מסמך — a document. */
export const documents = (n: number): string =>
  plural(n, { one: 'מסמך אחד', two: 'שני מסמכים', many: '# מסמכים' });

/** גרסה — a version (feminine). */
export const versions = (n: number): string =>
  plural(n, { one: 'גרסה אחת', two: 'שתי גרסאות', many: '# גרסאות' });

/** תוצאה — a search result (feminine). */
export const results = (n: number): string =>
  plural(n, { one: 'תוצאה אחת', two: 'שתי תוצאות', many: '# תוצאות' });

/** הצעה — a pipeline suggestion (feminine). */
export const suggestions = (n: number): string =>
  plural(n, { one: 'הצעה אחת', two: 'שתי הצעות', many: '# הצעות' });

/** הערה — an agent note (feminine). */
export const notes = (n: number): string => plural(n, { one: 'הערה אחת', two: 'שתי הערות', many: '# הערות' });

/** משתמש — a user account. */
export const users = (n: number): string =>
  plural(n, { one: 'משתמש אחד', two: 'שני משתמשים', many: '# משתמשים' });

/* wave 5 — the nouns the learning surface counts. */

/** שאלה — a quiz question (feminine). */
export const questions = (n: number): string =>
  plural(n, { one: 'שאלה אחת', two: 'שתי שאלות', many: '# שאלות' });

/** פריט — an entry in a briefing. The same noun as `items`, counted on a different screen. */
export const entries = (n: number): string => items(n);

/** פריט למידה — a briefing or a quiz, where the bare "פריט" would mean a knowledge item. */
export const learningItems = (n: number): string =>
  plural(n, { one: 'פריט למידה אחד', two: 'שני פריטי למידה', many: '# פריטי למידה' });

/** הקצאה — one item assigned to one person (feminine). */
export const assignments = (n: number): string =>
  plural(n, { one: 'הקצאה אחת', two: 'שתי הקצאות', many: '# הקצאות' });

/** רענון — a refresh assignment raised by a significant change. */
export const refreshes = (n: number): string =>
  plural(n, { one: 'רענון אחד', two: 'שני רענונים', many: '# רענונים' });

/** פער — a knowledge gap. */
export const gaps = (n: number): string => plural(n, { one: 'פער אחד', two: 'שני פערים', many: '# פערים' });

/** ניסיון — one attempt at a quiz. */
export const attempts = (n: number): string =>
  plural(n, { one: 'ניסיון אחד', two: 'שני ניסיונות', many: '# ניסיונות' });

/**
 * A count followed by a word that has to agree with it.
 *
 * Fixing `1 פריטים` and then writing `פריט אחד יועברו` swaps one grammatical error for a worse
 * one: in Hebrew the verb and the adjective inflect with the subject, so a sentence that counts
 * has *two* things to get right, not one. The counters above cover the noun phrase; this covers
 * everything that follows it.
 *
 * ```ts
 * counted(1, items, 'יועבר', 'יועברו'); // 'פריט אחד יועבר'
 * counted(2, items, 'יועבר', 'יועברו'); // 'שני פריטים יועברו'
 * ```
 *
 * The dual takes the plural agreement, which is what modern Hebrew does — only the noun phrase
 * itself carries a distinct dual form.
 */
export const counted = (n: number, noun: (n: number) => string, singular: string, plural_: string): string =>
  `${noun(n)} ${Math.abs(n) === 1 ? singular : plural_}`;
