import type { Paragraph, Phase, Step } from '@wecom/shared';
import { paragraphText } from '@wecom/shared';
import type { ProposalContext, ProposedSuggestion } from './contract.js';

/**
 * Section grouping for the "new source, no matching document" path.
 *
 * The defect this replaces: every paragraph of a first import became its own
 * `new-card` suggestion, so one WordPress post fanned out into a card for the
 * `<h2>`, a card for the `<p>` and a card per `<li>`. `afterSuggestionsApplied`
 * then upserted the single `(connector, external_id)` sync link once per applied
 * card, so the last one won and its siblings were orphaned from sync and from
 * the source-document flow.
 *
 * A source is now read as a list of **sections** — a heading plus everything up
 * to the next heading of the same or higher level — and each section becomes one
 * card (or, for a connector-backed remote item, one phase of the single card that
 * item maps to).
 */

/** Hard cap on the steps one suggestion may carry, so a 400-paragraph source stays reviewable. */
export const MAX_STEPS = 50;
const MAX_TITLE = 48;

/** The synthetic level of the lead-in section of a source that starts without a heading:
 * higher than any real heading, so the first real heading closes it. */
const IMPLICIT_LEVEL = 99;

const stripRef = (ref: string) => ref.replace(/^§/, '');
const anchorOf = (ref: string) => '§' + stripRef(ref);

const sentences = (t: string) =>
  t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2);

const shortTitle = (text: string): string => {
  const one = (sentences(text)[0] ?? text).replace(/\s+/g, ' ').replace(/[.:]$/, '').trim();
  return one.length > MAX_TITLE ? one.slice(0, MAX_TITLE - 3) + '…' : one;
};

/**
 * `htmlToParagraphs` renders a `<ul>`/`<ol>` as ONE paragraph whose lines are
 * "• item" / "1. item"; a list is only recognised when *every* line is a bullet, so a
 * table (rendered as "a | b" lines) or a wrapped prose paragraph is left whole.
 */
const LIST_LINE = /^(?:•|\d+[.)])\s+(.+)$/;
const listItems = (text: string): string[] | null => {
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return null;
  const items = lines.map((l) => LIST_LINE.exec(l)?.[1]?.trim()).filter((x): x is string => !!x);
  return items.length === lines.length ? items : null;
};

/** One paragraph, or one list item lifted out of a list paragraph. */
export interface SectionItem {
  /** The paragraph this text came from ("h2-1.p-1"); several list items share one ref. */
  ref: string;
  text: string;
  list: boolean;
}

export interface Section {
  /** Heading text, or the source title for a source that has no headings. */
  title: string;
  /** The heading paragraph's ref, or the first paragraph's ref for a headless section. */
  ref: string;
  level: number;
  items: SectionItem[];
}

/**
 * Groups paragraphs into sections: a heading paragraph opens a section and holds it
 * until a heading of the same or a higher level (a *deeper* heading stays inside as a
 * step of its own). Content before the first heading — or a source with no headings at
 * all — forms one section named after the source.
 */
export function groupSections(paragraphs: Paragraph[], sourceTitle: string): Section[] {
  const out: Section[] = [];
  let cur: Section | undefined;
  const open = (title: string, ref: string, level: number): Section => {
    const s: Section = { title: title.trim() || sourceTitle, ref: stripRef(ref), level, items: [] };
    out.push(s);
    cur = s;
    return s;
  };
  for (const p of paragraphs) {
    if (p.isDeleted) continue;
    const text = paragraphText(p).trim();
    if (!text) continue;
    if (p.heading) {
      const level = p.level ?? 2;
      if (!cur || level <= cur.level) {
        open(p.heading, p.ref, level);
        continue;
      }
      cur.items.push({ ref: stripRef(p.ref), text: p.heading.trim(), list: false });
      continue;
    }
    const section = cur ?? open(sourceTitle, p.ref, IMPLICIT_LEVEL);
    const items = listItems(text);
    if (items) for (const t of items) section.items.push({ ref: stripRef(p.ref), text: t, list: true });
    else section.items.push({ ref: stripRef(p.ref), text, list: false });
  }
  // A heading with nothing under it is still content: it becomes its own single step.
  for (const s of out) if (!s.items.length) s.items.push({ ref: s.ref, text: s.title, list: false });
  return out;
}

/**
 * One phase per section, steps numbered continuously across the whole suggestion so a
 * multi-phase card still has unique `step_key`s (`suggestions.applyOne` → `nextKey`).
 * Each step keeps its own paragraph ref in `sourceRef`, which is what makes the next
 * import map paragraph → step instead of proposing the card again.
 */
export function buildPhases(sections: Section[], phaseLabel?: string): Phase[] {
  const phases: Phase[] = [];
  let n = 0;
  for (const s of sections) {
    const steps: Step[] = [];
    for (const it of s.items) {
      if (n >= MAX_STEPS) break;
      n++;
      steps.push({
        key: 's' + n,
        num: String(n),
        title: shortTitle(it.text),
        actions: [{ id: 'a1', text: it.text }],
        outcomes: [{ kind: 'next', text: '→ המשך לשלב ' + (n + 1), goto: 's' + (n + 1) }],
        blockRefs: [],
        deps: [],
        sourceRef: anchorOf(it.ref),
      });
    }
    if (steps.length) phases.push({ id: 'p' + (phases.length + 1), label: phaseLabel ?? s.title, steps });
  }
  const last = phases[phases.length - 1]?.steps.at(-1);
  if (last) last.outcomes = [{ kind: 'ok', text: '✓ הסתדר – סיום' }];
  return phases;
}

const categoryOf = (text: string) =>
  /חו"ל|נדידה/.test(text)
    ? 'intl'
    : /חיוב|חשבונית/.test(text)
      ? 'billing'
      : /שימור|נטישה/.test(text)
        ? 'ops'
        : 'tech';

const card = (o: {
  anchor: string;
  title: string;
  text: string;
  phases: Phase[];
  rationale: string;
}): ProposedSuggestion => {
  const steps = o.phases.reduce((n, p) => n + p.steps.length, 0);
  return {
    anchor: o.anchor,
    type: 'new-card',
    title: o.title,
    targetDocumentId: null,
    targetStepKey: null,
    targetBlockId: null,
    payload: {
      type: 'new-card',
      title: o.title,
      description: o.text.slice(0, 120),
      category: categoryOf(o.text),
      wave: 2,
      priority: 'm',
      phases: o.phases,
    },
    confidence: Math.min(0.85, 0.5 + steps * 0.05),
    rationale: o.rationale,
  };
};

/**
 * The "new source, no match" path: nothing in the library is anchored to this source
 * yet (`linkedSteps` is empty) and the revision carries at least one real change. Every
 * other shape — a source whose paragraphs already feed steps — keeps the update-suggestion
 * behaviour untouched.
 */
export const isNewSourcePath = (ctx: ProposalContext): boolean =>
  ctx.linkedSteps.length === 0 && ctx.paragraphs.length > 0 && ctx.diffs.some((d) => d.kind !== 'same');

/**
 * One `new-card` per section — or, when the source is a single remote item
 * (`source.singleDocument`: one WordPress post, one JSON/CSV row-group), exactly one card
 * whose phases are those sections, so the item maps to one document, one sync link and one
 * source document.
 */
export function sectionCards(ctx: ProposalContext): ProposedSuggestion[] {
  const sections = groupSections(ctx.paragraphs, ctx.source.title);
  if (!sections.length) return [];
  if (ctx.source.singleDocument) {
    const text = sections.flatMap((s) => s.items.map((i) => i.text)).join(' ');
    return [
      card({
        anchor: anchorOf(sections[0].ref),
        title: ctx.source.title,
        text,
        phases: buildPhases(sections),
        rationale: 'פריט מרוחק חדש ללא מסמך מתאים: ' + sections.length + ' סעיפים אוחדו לכרטיס אחד.',
      }),
    ];
  }
  return sections.map((s) =>
    card({
      anchor: anchorOf(s.ref),
      title: s.title,
      text: s.items.map((i) => i.text).join(' '),
      phases: buildPhases([s], 'שלבי הטיפול'),
      rationale: 'סעיף חדש ' + s.ref + ' ללא שלב מקושר.',
    }),
  );
}

/**
 * Holds the section rule whatever produced `items`: on the new-source path the model's own
 * `new-card` suggestions are replaced by the section cards (a language model that emits one
 * card per paragraph would re-create the fan-out), while everything else it proposed is kept.
 */
export function enforceSectionCards(ctx: ProposalContext, items: ProposedSuggestion[]): ProposedSuggestion[] {
  if (!isNewSourcePath(ctx)) return items;
  return [...sectionCards(ctx), ...items.filter((i) => i.type !== 'new-card')];
}
