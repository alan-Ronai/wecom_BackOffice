import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { EvalCaseSchema, type EvalCase, type EvalExpectation } from '@wecom/shared';
import type { FewShotExample, ProposalContext, ProposedSuggestion } from './contract.js';

/**
 * Wave 6 (X1), spec §1.9. "Did the model get better" was unanswerable: the only feedback was
 * the review queue, which mixes a prompt change with whatever the sources happened to contain
 * that week. This is the fixed board — a committed set of Hebrew cases, scored the same way
 * every time, so a tier or a prompt version is a number rather than an impression.
 *
 * Five scores, each 0..1 over the case:
 *
 * - `hitTarget`  — a suggestion pointed at the expected (document, step) / block / anchor.
 * - `hitType`    — that suggestion was also of the expected type. Only a matched target can
 *                  score here: a `deprecate-step` aimed at the wrong step is not half right.
 * - `contentOverlap` — the share of the expectation's `mustContain` strings and
 *                  `mustContainAny` groups that appear anywhere in the matched suggestion's
 *                  title, rationale or payload. Searching all three is deliberate: §1.6 asks
 *                  the model to name the impact in the *rationale*, so a case can assert on it.
 * - `precision`  — **C-I1, the counterweight.** The share of the answer's suggestions that
 *                  match an expectation, capped by the case's `maxItems`. Without it every
 *                  number this harness produced was an upper bound: a verified "shotgun" client
 *                  emitting one suggestion per (type × candidate target) with a keyword-stuffed
 *                  title scored 1.000/1.000/1.000 on all eight cases.
 * - `languageOk` — **C-I8.** 1 when no `title` or `rationale` contains CJK, Cyrillic, or a latin
 *                  word outside the allow-list. `qwen2.5:3b` code-switches into French, Russian,
 *                  Indonesian and Chinese under Hebrew load, that text reaches the editor's
 *                  queue, and no metric saw it.
 *
 * A case with **no** expectations is a negative case: the correct answer is silence, and all
 * five scores are 1 when nothing was emitted and 0 when anything was.
 */
export interface CaseScore {
  hitTarget: number;
  hitType: number;
  contentOverlap: number;
  precision: number;
  languageOk: number;
  /** How many suggestions carried non-Hebrew text. Summed, not averaged, by `aggregate`. */
  languageFailures: number;
}

/* ── Hebrew-aware content matching (the `mustContainAny` half) ───────────── */

/**
 * Hebrew attaches its definite article, conjunction and prepositions to the front of the word:
 * `ניתוקים` / `הניתוקים` / `וניתוקים` / `בניתוקים` are the same word, and a substring test
 * scores the second zero against the first. Stripping up to two leading clitics from every
 * Hebrew word on both sides makes `mustContain` fair to phrasing without making it fair to
 * facts — a number or a latin token has no clitics to strip.
 */
const CLITICS = 'בלהומשכ';
const HEB_WORD = /[֐-׿]+/g;
const stripClitics = (w: string): string => {
  let out = w;
  for (let i = 0; i < 2 && out.length > 2 && CLITICS.includes(out[0]); i++) out = out.slice(1);
  return out;
};
export const normaliseHebrew = (t: string): string =>
  t.toLowerCase().replace(HEB_WORD, (w) => stripClitics(w));

const haystack = (s: ProposedSuggestion): string =>
  normaliseHebrew([s.title, s.rationale, JSON.stringify(s.payload)].join(' '));

const contains = (hay: string, needle: string) => hay.includes(normaliseHebrew(needle));

/* ── C-I8: the language check ────────────────────────────────────────────── */

/**
 * Latin tokens a Hebrew answer legitimately contains: product names, protocols and the CRM
 * vocabulary the sources themselves are written in. A case may add its own (`allowLatin`).
 */
export const LATIN_ALLOW_LIST = [
  'speedtest',
  'wi-fi',
  'wifi',
  'sim',
  'esim',
  'crm',
  'apn',
] as const;

const CJK_OR_CYRILLIC = /[Ѐ-ӿ぀-ヿ一-鿿가-힯]/;
const LATIN_WORD = /[A-Za-z][A-Za-z0-9'-]*/g;

/** The offending fragments in one string, or `[]` when it is clean. */
export function languageOffences(text: string, allow: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const script = text.match(new RegExp(CJK_OR_CYRILLIC, 'g'));
  if (script) out.push(...new Set(script));
  for (const w of text.match(LATIN_WORD) ?? []) {
    // A single letter or anything carrying a digit is an identifier (`s8`, `4G`), not a word.
    if (w.length < 2 || /\d/.test(w)) continue;
    if (!allow.has(w.toLowerCase())) out.push(w);
  }
  return out;
}

/**
 * A latin word the *source* uses is not code-switching — it is the answer quoting its input, and
 * a CRM field is called `sim block lbl` whatever language the procedure is written in. So the
 * allow-list is the global one, plus this case's own vocabulary, plus whatever it declares.
 * What is left over is the thing the check is for: `champs`, `ubah`, `блок`, 鉴于.
 */
const allowFor = (c: EvalCase): Set<string> => {
  const corpus = [
    c.source.title,
    ...c.diffs.flatMap((d) => [d.before ?? '', d.after ?? '']),
    ...c.linkedSteps.flatMap((s) => [s.documentTitle, s.stepTitle, ...s.actions]),
    ...c.blocks.flatMap((b) => [b.title, ...b.actions]),
    ...c.fields.map((f) => f.name),
    ...c.expected.flatMap((e) => [...e.mustContain, ...e.mustContainAny.flat()]),
  ].join(' ');
  return new Set([
    ...LATIN_ALLOW_LIST,
    ...c.allowLatin.map((w) => w.toLowerCase()),
    ...(corpus.match(LATIN_WORD) ?? []).map((w) => w.toLowerCase()),
  ]);
};

/* ── scoring ─────────────────────────────────────────────────────────────── */

/** A suggestion matches an expectation's target when every named part agrees. */
const targets = (s: ProposedSuggestion, e: EvalExpectation): boolean =>
  (e.targetDocumentId === undefined || s.targetDocumentId === e.targetDocumentId) &&
  (e.targetStepKey === undefined || s.targetStepKey === e.targetStepKey) &&
  (e.targetBlockId === undefined || s.targetBlockId === e.targetBlockId) &&
  (e.anchor === undefined || s.anchor.replace(/^§/, '') === e.anchor.replace(/^§/, ''));

/** The share of an expectation's asserted content this suggestion reproduces. */
const share = (s: ProposedSuggestion, e: EvalExpectation): number => {
  const total = e.mustContain.length + e.mustContainAny.length;
  if (!total) return 1;
  const hay = haystack(s);
  const hits =
    e.mustContain.filter((m) => contains(hay, m)).length +
    e.mustContainAny.filter((group) => group.some((m) => contains(hay, m))).length;
  return hits / total;
};

/** For precision: this suggestion is one the case asked for, not an extra. */
const isWanted = (s: ProposedSuggestion, c: EvalCase): boolean =>
  c.expected.some((e) => targets(s, e) && s.type === e.type && share(s, e) > 0);

export function scoreCase(c: EvalCase, items: ProposedSuggestion[]): CaseScore {
  const allow = allowFor(c);
  const languageFailures = items.filter(
    (s) => languageOffences(s.title, allow).length || languageOffences(s.rationale, allow).length,
  ).length;
  const languageOk = languageFailures ? 0 : 1;

  /**
   * A negative case: the change deserves no suggestion, so silence is a perfect answer on every
   * axis and one suggestion is a total failure. Scoring it any other way would let a model that
   * proposes on noise hide behind the positive cases.
   */
  if (!c.expected.length) {
    const clean = items.length === 0 ? 1 : 0;
    return {
      hitTarget: clean,
      hitType: clean,
      contentOverlap: clean,
      precision: clean,
      languageOk,
      languageFailures,
    };
  }

  let target = 0;
  let type = 0;
  let overlap = 0;
  for (const e of c.expected) {
    const matched = items.filter((s) => targets(s, e));
    if (!matched.length) continue;
    target++;
    /**
     * Prefer a match of the right type — a suggestion of another type aimed at the same step is
     * not the one the case was written about — and among those the one that actually contains
     * the expected content.
     */
    const sameType = matched.filter((s) => s.type === e.type);
    if (sameType.length) type++;
    const pool = sameType.length ? sameType : matched;
    overlap += Math.max(...pool.map((s) => share(s, e)));
  }

  /**
   * C-I1. `extra` is every suggestion matching no expectation; `maxItems` then sets a ceiling
   * independent of identity, so a model that emits the right suggestion five times over is
   * still penalised.
   */
  const cap = c.maxItems ?? c.expected.length;
  const unwanted = items.filter((s) => !isWanted(s, c)).length;
  const extra = Math.max(unwanted, items.length - cap);
  const precision = items.length ? Math.max(0, 1 - extra / items.length) : 1;

  const n = c.expected.length;
  return {
    hitTarget: target / n,
    hitType: type / n,
    contentOverlap: overlap / n,
    precision,
    languageOk,
    languageFailures,
  };
}

/**
 * Mean of each rate over the run; an empty run is zeroes, not NaN. `languageFailures` is a
 * count and is summed — "0.375 code-switched suggestions" would mean nothing.
 */
export function aggregate(scores: CaseScore[]): CaseScore {
  if (!scores.length)
    return { hitTarget: 0, hitType: 0, contentOverlap: 0, precision: 0, languageOk: 0, languageFailures: 0 };
  const sum = (f: (s: CaseScore) => number) => scores.reduce((a, s) => a + f(s), 0) / scores.length;
  return {
    hitTarget: sum((s) => s.hitTarget),
    hitType: sum((s) => s.hitType),
    contentOverlap: sum((s) => s.contentOverlap),
    precision: sum((s) => s.precision),
    languageOk: sum((s) => s.languageOk),
    languageFailures: scores.reduce((a, s) => a + s.languageFailures, 0),
  };
}

/** Every `*.json` under `dir`, parsed through `EvalCaseSchema`, ordered by filename. */
export function loadCases(dir: string): EvalCase[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => EvalCaseSchema.parse(JSON.parse(readFileSync(join(dir, f), 'utf8'))));
}

/** The committed case set's directory, resolved from this package rather than the cwd. */
export const EVAL_CASES_DIR = new URL('../eval/cases/', import.meta.url);

/**
 * One case as the pipeline would present it. `paragraphs` are synthesised from the diffs' own
 * text so `isNewSourcePath` behaves exactly as it does in production for a case with no linked
 * steps — a case must not accidentally test a path the pipeline never takes.
 *
 * A ref of the `h<level>-<n>` form (what `htmlToParagraphs` and the docx parser produce for a
 * heading) is rebuilt as a heading paragraph, because `groupSections` keys the whole new-source
 * path off `heading`/`level`: without it a three-section source would be scored as one section.
 *
 * C-M3: `brief`, `style`, `examples` and `maxContextChars` are carried through too. Four of the
 * wave's features were untested by the thing that exists to test them.
 */
const HEADING_REF = /^h(\d)-\d+$/;
export function contextForCase(c: EvalCase): ProposalContext {
  return {
    source: { id: c.id, title: c.source.title, singleDocument: c.source.singleDocument },
    diffs: c.diffs,
    paragraphs: c.diffs.map((d) => {
      const text = d.after ?? d.before ?? '';
      const h = HEADING_REF.exec(d.ref);
      return h
        ? { ref: d.ref, heading: text, level: Number(h[1]), runs: [{ t: text }] }
        : { ref: d.ref, runs: [{ t: text }] };
    }),
    linkedSteps: c.linkedSteps.map((s) => ({ ...s })),
    fields: c.fields,
    blocks: c.blocks,
    impact: c.impact,
    ...(c.brief ? { brief: c.brief } : {}),
    ...(c.style ? { style: c.style } : {}),
    ...(c.examples.length ? { examples: c.examples as unknown as FewShotExample[] } : {}),
    ...(c.maxContextChars ? { maxContextChars: c.maxContextChars } : {}),
  };
}
