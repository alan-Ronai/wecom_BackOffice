import { createHash } from 'node:crypto';
import { parse, HTMLElement, NodeType } from 'node-html-parser';
import type { Paragraph } from '@wecom/shared';

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

/**
 * One Paragraph per block element. `ref` is the heading path plus a running
 * index inside that heading ("h2-1", "h2-1.p-2", "h2-1.h3-3.table-1"), so refs
 * stay stable across unrelated edits elsewhere in the document.
 */
export function htmlToParagraphs(html: string): Paragraph[] {
  const root = parse(html, { comment: false });
  const out: Paragraph[] = [];
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
      const p: Paragraph = { ref, runs: [{ t: text }] };
      if (isHeading) {
        p.heading = text;
        p.level = Number(tag[1]);
        path.push({ level: p.level, ref });
      }
      out.push(p);
    }
  };
  walk(root);
  return out;
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

export const contentHash = (ps: Paragraph[]): string =>
  createHash('sha256').update(paragraphsText(ps), 'utf8').digest('hex');
