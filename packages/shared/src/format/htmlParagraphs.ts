import { parse, HTMLElement, NodeType } from 'node-html-parser';
import type { Paragraph } from '../schemas/pipeline.js';

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#8211;': '–',
  '&#8212;': '—',
};

/** Decode the entities WordPress emits, fold NBSP and collapse whitespace. */
export const normalizeText = (s: string): string =>
  s
    .replace(/&#?\w+;/g, (e) => ENTITIES[e] ?? e)
    .replace(/[\u00a0\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const BLOCKS = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'table',
  'blockquote',
  'pre',
  'figure',
]);

function blockText(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol')
    return el
      .querySelectorAll('li')
      .filter((li) => li.parentNode === el)
      .map((li, i) => (tag === 'ol' ? i + 1 + '. ' : '• ') + normalizeText(li.text))
      .join('\n');
  if (tag === 'table')
    return el
      .querySelectorAll('tr')
      .map((tr) =>
        tr
          .querySelectorAll('th,td')
          .map((c) => normalizeText(c.text))
          .join(' | '),
      )
      .join('\n');
  return normalizeText(el.text);
}

/** One addressable block: the element, the ref `htmlToParagraphs` gives it, and its text. */
interface BlockRef {
  el: HTMLElement;
  ref: string;
  tag: string;
  text: string;
  isHeading: boolean;
}

/**
 * The single ref generator. `htmlToParagraphs`, `paragraphRefs` and `applyParagraphEdits` all
 * walk with it, so an anchor produced by one is resolvable by the others — which is the whole
 * premise of `ProposedEditOp.anchor` (wave 6, X2): the sanitizer strips `id` attributes, so
 * block order is the only thing there is to address a paragraph by.
 */
function walkBlocks(root: HTMLElement): BlockRef[] {
  const out: BlockRef[] = [];
  const path: { level: number; ref: string }[] = [];
  const counters = new Map<string, number>(); // parent ref -> running index
  const nextIndex = (parent: string) => {
    const n = (counters.get(parent) ?? 0) + 1;
    counters.set(parent, n);
    return n;
  };
  const walk = (node: HTMLElement) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      if (!tag) continue;
      if (!BLOCKS.has(tag)) {
        walk(el);
        continue;
      }
      const text = blockText(el);
      if (!text) continue;
      const isHeading = /^h[1-6]$/.test(tag);
      if (isHeading) {
        const level = Number(tag[1]);
        while (path.length && path[path.length - 1].level >= level) path.pop();
      }
      const parent = path.length ? path[path.length - 1].ref : '';
      const ref = (parent ? parent + '.' : '') + tag + '-' + nextIndex(parent);
      if (isHeading) path.push({ level: Number(tag[1]), ref });
      out.push({ el, ref, tag, text, isHeading });
    }
  };
  walk(root);
  return out;
}

/**
 * One Paragraph per block element. `ref` is the heading path plus a running
 * index inside that heading ("h2-1", "h2-1.p-2", "h2-1.h3-3.table-1"), so refs
 * stay stable across unrelated edits elsewhere in the document.
 */
export function htmlToParagraphs(html: string): Paragraph[] {
  return walkBlocks(parse(html, { comment: false })).map((b) => {
    const p: Paragraph = { ref: b.ref, runs: [{ t: b.text }] };
    if (b.isHeading) {
      p.heading = b.text;
      p.level = Number(b.tag[1]);
    }
    return p;
  });
}

/**
 * Wave 6 (X2). The anchors of an HTML fragment, in document order, without building the whole
 * `Paragraph` shape: what an edit proposal addresses its hunks to, and what the apply path
 * checks a hunk's `before` against.
 */
export const paragraphRefs = (html: string): { ref: string; tag: string; text: string }[] =>
  walkBlocks(parse(html, { comment: false })).map(({ ref, tag, text }) => ({ ref, tag, text }));

export interface ParagraphEdit {
  /** A ref from `paragraphRefs`. For `insert`, the block the new paragraph goes *after*. */
  ref: string;
  kind: 'replace' | 'insert' | 'delete';
  /** Plain text; ignored for `delete`. */
  text: string;
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Structured blocks cannot hold a plain-text rewrite without losing their structure. */
const STRUCTURED = new Set(['ul', 'ol', 'table']);

/**
 * Wave 6 (X2). Anchored, paragraph-level editing of an HTML fragment: everything not addressed
 * by an edit comes back byte-identical, which is what makes an accepted hunk reviewable as a
 * diff rather than as a whole-document rewrite.
 *
 * Refs are resolved against the *original* document for every edit, so a list of edits does not
 * have to reason about how the earlier ones renumbered things. A `replace` on a list or a table
 * becomes a `<p>`, because a plain-text rewrite has no rows or items to put back.
 *
 * Several `insert`s may share one anchor — `diffToOps` emits one op per added paragraph, all
 * anchored to the last echoed ref. Inserting each of them `afterend` of the *same* element would
 * write them out in reverse, so the anchor advances: the node an insert just wrote becomes the
 * anchor for the next insert on that ref, and the run lands in the order the reviewer approved.
 *
 * Unknown refs are ignored rather than thrown on: the caller (`ai/proposedEdits.ts`) has already
 * refused the hunks whose text moved, and a ref that resolves to nothing is not a reason to lose
 * the hunks that do.
 */
export function applyParagraphEdits(html: string, edits: readonly ParagraphEdit[]): string {
  const root = parse(html, { comment: false });
  const byRef = new Map(walkBlocks(root).map((b) => [b.ref, b]));
  /** ref -> the node the *next* insert on that anchor goes after (the last one written). */
  const insertCursor = new Map<string, HTMLElement>();
  for (const edit of edits) {
    const block = byRef.get(edit.ref);
    if (!block) continue;
    if (edit.kind === 'delete') {
      block.el.remove();
      continue;
    }
    const markup = escapeHtml(edit.text);
    if (edit.kind === 'insert') {
      const anchor = insertCursor.get(edit.ref) ?? block.el;
      anchor.insertAdjacentHTML('afterend', `<p>${markup}</p>`);
      const siblings = anchor.parentNode?.childNodes;
      const at = siblings ? siblings.indexOf(anchor) : -1;
      const written = at >= 0 ? siblings?.[at + 1] : undefined;
      if (written && written.nodeType === NodeType.ELEMENT_NODE)
        insertCursor.set(edit.ref, written as HTMLElement);
      continue;
    }
    if (STRUCTURED.has(block.tag)) {
      const replacement = parse(`<p>${markup}</p>`).firstChild;
      if (replacement) block.el.replaceWith(replacement);
    } else block.el.set_content(markup);
  }
  return root.toString();
}

export const paragraphsText = (ps: Paragraph[]): string =>
  ps
    .map(
      (p) =>
        p.ref +
        '\t' +
        p.runs
          .filter((r) => !r.del)
          .map((r) => r.t)
          .join(''),
    )
    .join('\n');

/** Plain text of an HTML fragment: one line per block, inline markup dropped. Used for `source_documents.text` and search. */
export const htmlToText = (html: string): string =>
  htmlToParagraphs(html)
    .map((p) => p.runs.map((r) => r.t).join(''))
    .join('\n');
