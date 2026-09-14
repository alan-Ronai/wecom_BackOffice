/**
 * Hebrew-aware number formatting.
 *
 * A-3 (acceptance review §3, §7 item 13): the topic page read `1 פריטים`, the library header
 * `50 נושאים`, `/pinned` `1 נושאים`. In Hebrew that is the same mistake as writing "1 items" in
 * English — and a Hebrew-first product that makes it "reads as unfinished to exactly the audience
 * it is for". Every one of those strings was a template literal with a hard-coded plural noun, so
 * the fix has to be a helper the call sites go through, not a sweep of individual corrections.
 *
 * Hebrew has three counting forms worth distinguishing here:
 *
 * - **Singular** — `פריט אחד`, not `1 פריט`: the numeral is spelled, and it *follows* the noun.
 * - **Dual** — `שני פריטים`. Real Hebrew rarely writes `2 פריטים` for a standalone count; it says
 *   "two items". The dual is offered rather than imposed, because it only reads well where the
 *   phrase stands on its own — `בוצע על שני פריטים` is right, `שני מתוך 5` is not — so a call site
 *   that cannot take it simply omits `two` and gets the numeral form.
 * - **Plural** — `# פריטים`, with the digits in place of `#`.
 *
 * Deliberately not `Intl.PluralRules('he')`: it answers with a CLDR *category* (`one`, `two`,
 * `many`, `other`), which still leaves every call site to hold three or four strings and pick
 * between them. What the call sites need is the finished phrase, which is what this returns.
 */
export interface PluralForms {
  /** Exactly one, numeral spelled out and trailing: `פריט אחד`. */
  one: string;
  /** Exactly two, in the dual: `שני פריטים`. Omit where the surrounding phrase wants the digit. */
  two?: string;
  /** Everything else. `#` is replaced by the number. */
  many: string;
}

/**
 * The Hebrew count phrase for `n`.
 *
 * ```ts
 * plural(1, { one: 'פריט אחד', two: 'שני פריטים', many: '# פריטים' }); // 'פריט אחד'
 * plural(2, { one: 'פריט אחד', two: 'שני פריטים', many: '# פריטים' }); // 'שני פריטים'
 * plural(7, { one: 'פריט אחד', two: 'שני פריטים', many: '# פריטים' }); // '7 פריטים'
 * plural(0, { one: 'פריט אחד', many: '# פריטים' });                    // '0 פריטים'
 * ```
 *
 * Zero takes `many` — `0 פריטים` is correct Hebrew, and a screen that wants "אין פריטים" says so
 * itself rather than hiding an empty state inside a counter.
 */
export function plural(n: number, forms: PluralForms): string {
  const abs = Math.abs(n);
  const form = abs === 1 ? forms.one : abs === 2 && forms.two ? forms.two : forms.many;
  return form.replace(/#/g, String(n));
}
