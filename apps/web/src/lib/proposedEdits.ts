import type { ProposedEditOp } from '@wecom/shared';

/**
 * Client-side *preview* of a proposed-edit set, plus the anchor resolution the preview needs.
 *
 * The server is the one that applies hunks (`POST /ai/proposed-edits/:id/decide`, an ordinary
 * source save with `If-Match` on `baseSourceVersion`); nothing here writes. What it does is render
 * what the source would look like with a subset of the hunks accepted, which is what makes the
 * overlay a decision rather than a leap of faith.
 *
 * **Anchors are paragraph refs, never DOM ids.** `ProposedEditOp.anchor` is the ref
 * `htmlToParagraphs` produces — a heading path plus a running index inside it, `§h2-1.p-3` — and
 * it is resolved by walking the block elements of the document in order. It has to be: the source
 * sanitizer strips `id` attributes, so there is nothing in the HTML to look up. The walk below is
 * the same algorithm as `htmlToParagraphs` in `@wecom/shared`, over the DOM instead of
 * `node-html-parser`, so a ref computed on the server resolves to the same block here.
 */

const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'pre', 'figure']);

/** Strip tags and decode the entities the sanitizer emits — for diff previews and comparisons. */
export const htmlToPlain = (html: string): string =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ ‎‏]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** An anchor may be written `§h2-1.p-3` (the suggestion spelling) or bare; both resolve the same. */
export const normalizeAnchor = (anchor: string): string => anchor.replace(/^§/, '').trim();

const parseBody = (html: string): HTMLElement => {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  return doc.body;
};

export interface AnchoredBlock {
  ref: string;
  el: Element;
  text: string;
}

/**
 * Every block element of the fragment with the ref `htmlToParagraphs` would give it, in document
 * order. Blocks whose text is empty are skipped, exactly as the server-side walk skips them, or
 * the running indices would not line up.
 */
export const anchoredBlocks = (html: string): AnchoredBlock[] => anchoredBlocksOf(parseBody(html));

/** The walk itself, over a body that is already parsed (so `applyOps` mutates the same tree). */
function anchoredBlocksOf(body: Element): AnchoredBlock[] {
  const out: AnchoredBlock[] = [];
  const path: { level: number; ref: string }[] = [];
  const counters = new Map<string, number>();
  const nextIndex = (parent: string): number => {
    const n = (counters.get(parent) ?? 0) + 1;
    counters.set(parent, n);
    return n;
  };
  const walk = (node: Element): void => {
    for (const el of Array.from(node.children)) {
      const tag = el.tagName.toLowerCase();
      if (!BLOCKS.has(tag)) {
        walk(el);
        continue;
      }
      const text = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (!text) continue;
      const isHeading = /^h[1-6]$/.test(tag);
      if (isHeading) {
        const level = Number(tag[1]);
        while (path.length && path[path.length - 1]!.level >= level) path.pop();
      }
      const parent = path.length ? path[path.length - 1]!.ref : '';
      const ref = (parent ? parent + '.' : '') + tag + '-' + nextIndex(parent);
      out.push({ ref, el, text });
      if (isHeading) path.push({ level: Number(tag[1]), ref });
    }
  };
  walk(body);
  return out;
}

/** The plain text of the block an op points at, or `null` when the anchor no longer resolves. */
export const anchorText = (html: string, anchor: string): string | null =>
  anchoredBlocks(html).find((b) => b.ref === normalizeAnchor(anchor))?.text ?? null;

/** `before` may arrive as text or as the block's HTML; compare on the plain text either way. */
const sameText = (a: string, b: string): boolean => htmlToPlain(a) === htmlToPlain(b);

const fragmentOf = (html: string): Node[] => {
  const nodes = Array.from(parseBody(html).childNodes);
  if (nodes.some((n) => n.nodeType === 1)) return nodes;
  // Bare text (the common case for a model-written replacement) becomes a paragraph, so the
  // preview keeps the document's block structure.
  const p = parseBody('<p></p>').firstElementChild!;
  p.textContent = htmlToPlain(html);
  return [p];
};

/**
 * PREVIEW ONLY. Applies the accepted ops to `html` and returns the result.
 *
 * An op whose anchor no longer resolves, or whose `before` no longer matches the text at that
 * anchor, is skipped — that is the "source moved" case the server answers 409 `SOURCE_MOVED` for,
 * and silently applying it here would show a preview of something that cannot happen.
 */
export function applyOps(html: string, ops: ProposedEditOp[], accepted: ReadonlySet<string>): string {
  const body = parseBody(html);
  const index = new Map(
    anchoredBlocksOf(body).map((b) => [b.ref, b] as const),
  );
  let changed = false;
  for (const op of ops) {
    if (!accepted.has(op.id)) continue;
    const block = index.get(normalizeAnchor(op.anchor));
    if (!block || !block.el.isConnected) continue;
    if (op.before && !sameText(op.before, block.text)) continue;
    if (op.kind === 'insert') {
      const nodes = fragmentOf(op.after);
      let after: Node = block.el;
      for (const n of nodes) {
        after.parentNode?.insertBefore(n, after.nextSibling);
        after = n;
      }
      changed = true;
    } else if (op.kind === 'delete') {
      block.el.remove();
      changed = true;
    } else {
      const nodes = fragmentOf(op.after);
      if (!nodes.length) continue;
      const parent = block.el.parentNode;
      if (!parent) continue;
      for (const n of nodes) parent.insertBefore(n, block.el);
      block.el.remove();
      changed = true;
    }
  }
  return changed ? body.innerHTML : html;
}
