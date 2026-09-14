import { parse, HTMLElement, NodeType, type Node } from 'node-html-parser';

/** Spec §5.1 allowlist. Anything else is unwrapped (its text kept) or, for void/embedded tags, dropped. */
export const SANITIZE_TAGS: ReadonlySet<string> = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'p',
  'ul',
  'ol',
  'li',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'img',
  'a',
  'strong',
  'em',
  'u',
  's',
  'blockquote',
  'code',
  'pre',
  'br',
  'hr',
  'span',
  'bdi',
]);
/** Tags whose whole subtree is dropped, text included. */
const DROP = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'svg',
  'math',
  'link',
  'meta',
]);
const VOID = new Set(['img', 'br', 'hr']);
export const ASSET_SRC_RE = /^\/api\/v1\/assets\/[0-9a-f-]{36}$/;
const HTTP_RE = /^https?:\/\//i;

const ATTRS: Record<string, (name: string, value: string) => string | null> = {
  img: (n, v) => (n === 'src' && ASSET_SRC_RE.test(v) ? v : n === 'alt' ? v : null),
  a: (n, v) => (n === 'href' && HTTP_RE.test(v) ? v : null),
  span: (n, v) => (n === 'dir' && (v === 'rtl' || v === 'ltr') ? v : null),
  bdi: (n, v) => (n === 'dir' && (v === 'rtl' || v === 'ltr') ? v : null),
  p: (n, v) => (n === 'dir' && (v === 'rtl' || v === 'ltr') ? v : null),
  th: (n, v) => ((n === 'colspan' || n === 'rowspan') && /^\d{1,2}$/.test(v) ? v : null),
  td: (n, v) => ((n === 'colspan' || n === 'rowspan') && /^\d{1,2}$/.test(v) ? v : null),
};

const escText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string) => escText(s).replace(/"/g, '&quot;');

function render(node: Node): string {
  if (node.nodeType === NodeType.TEXT_NODE)
    return escText(
      (node as HTMLElement).rawText
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&nbsp;/g, ' '),
    );
  if (node.nodeType !== NodeType.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName?.toLowerCase();
  if (!tag) return el.childNodes.map(render).join(''); // document root
  if (DROP.has(tag)) return '';
  const inner = el.childNodes.map(render).join('');
  if (!SANITIZE_TAGS.has(tag)) return inner; // unwrap
  const keep = ATTRS[tag];
  const attrs: string[] = [];
  if (keep)
    for (const [name, value] of Object.entries(el.attributes)) {
      const v = keep(name.toLowerCase(), value.trim());
      if (v !== null) attrs.push(` ${name.toLowerCase()}="${escAttr(v)}"`);
    }
  if (tag === 'img' && !attrs.some((a) => a.startsWith(' src='))) return '';
  if (tag === 'a') attrs.push(' rel="noopener"');
  const open = `<${tag}${attrs.join('')}>`;
  return VOID.has(tag) ? open : `${open}${inner}</${tag}>`;
}

/** Allowlist sanitizer for source documents and text-kind bodies. Deterministic and idempotent. */
export function sanitizeHtml(html: string): string {
  // `blockTextElements` replaces the parser default wholesale. Listing script/style/noscript with
  // `false` drops their raw text (we drop those tags anyway) and, by leaving `pre` out of the map,
  // keeps `<pre><code>…</code></pre>` parsed as real elements instead of one raw-text blob.
  const root = parse(html, {
    comment: false,
    blockTextElements: { script: false, noscript: false, style: false },
  });
  return render(root);
}
