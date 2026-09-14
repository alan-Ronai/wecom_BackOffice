import { parse, HTMLElement, NodeType, type Node } from 'node-html-parser';
import {
  AlignmentType,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
  type IParagraphOptions,
  type IRunOptions,
} from 'docx';
import { ASSET_SRC_RE } from './sanitizeHtml.js';

export type AssetBytesResolver = (
  assetId: string,
) => Promise<{ bytes: Uint8Array; mime: string; width?: number; height?: number } | null>;

type Fmt = {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  code?: boolean;
  href?: string;
};
type Child = Paragraph | Table;

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
  h4: HeadingLevel.HEADING_4,
};
const BULLETS = 'kb-bullets';
const NUMBERS = 'kb-numbers';
const MAX_IMG_PX = 560;
const textOf = (n: Node) =>
  (n as HTMLElement).rawText
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');

function runOpts(f: Fmt, text: string): IRunOptions {
  return {
    text,
    bold: f.bold,
    italics: f.italics,
    strike: f.strike,
    rightToLeft: true,
    underline: f.underline ? { type: 'single' } : undefined,
    font: f.code ? 'Courier New' : undefined,
    style: f.href ? 'Hyperlink' : undefined,
  };
}

async function inlineRuns(
  nodes: Node[],
  f: Fmt,
  resolve: AssetBytesResolver,
): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
  const out: (TextRun | ExternalHyperlink | ImageRun)[] = [];
  for (const n of nodes) {
    if (n.nodeType === NodeType.TEXT_NODE) {
      const t = textOf(n);
      if (t) out.push(new TextRun(runOpts(f, t)));
      continue;
    }
    if (n.nodeType !== NodeType.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (tag === 'br') {
      out.push(new TextRun({ break: 1 }));
      continue;
    }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      const m = ASSET_SRC_RE.test(src) ? src.split('/').pop()! : null;
      const asset = m ? await resolve(m) : null;
      if (!asset) continue;
      const w = asset.width ?? MAX_IMG_PX;
      const h = asset.height ?? Math.round(MAX_IMG_PX * 0.66);
      const scale = w > MAX_IMG_PX ? MAX_IMG_PX / w : 1;
      const type = asset.mime === 'image/png' ? 'png' : asset.mime === 'image/gif' ? 'gif' : 'jpg';
      out.push(
        new ImageRun({
          type,
          data: asset.bytes,
          transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
          altText: { title: el.getAttribute('alt') ?? '', description: '', name: m! },
        }),
      );
      continue;
    }
    const next: Fmt = { ...f };
    if (tag === 'strong' || tag === 'b') next.bold = true;
    if (tag === 'em' || tag === 'i') next.italics = true;
    if (tag === 'u') next.underline = true;
    if (tag === 's') next.strike = true;
    if (tag === 'code') next.code = true;
    if (tag === 'a') {
      const href = el.getAttribute('href') ?? '';
      const children = await inlineRuns(el.childNodes, { ...next, href }, resolve);
      out.push(
        new ExternalHyperlink({
          link: href,
          children: children.filter((c): c is TextRun => c instanceof TextRun),
        }),
      );
      continue;
    }
    out.push(...(await inlineRuns(el.childNodes, next, resolve)));
  }
  return out;
}

const para = async (
  el: HTMLElement,
  resolve: AssetBytesResolver,
  extra: Partial<IParagraphOptions> = {},
  f: Fmt = {},
) =>
  new Paragraph({
    bidirectional: true,
    alignment: AlignmentType.RIGHT,
    ...extra,
    children: await inlineRuns(el.childNodes, f, resolve),
  });

async function blocks(
  nodes: Node[],
  resolve: AssetBytesResolver,
  listLevel = -1,
  listRef?: string,
): Promise<Child[]> {
  const out: Child[] = [];
  for (const n of nodes) {
    if (n.nodeType === NodeType.TEXT_NODE) {
      const t = textOf(n).trim();
      if (t)
        out.push(
          new Paragraph({
            bidirectional: true,
            alignment: AlignmentType.RIGHT,
            children: [new TextRun({ text: t, rightToLeft: true })],
          }),
        );
      continue;
    }
    if (n.nodeType !== NodeType.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (HEADINGS[tag]) {
      out.push(await para(el, resolve, { heading: HEADINGS[tag] }));
      continue;
    }
    if (tag === 'p') {
      out.push(await para(el, resolve));
      continue;
    }
    if (tag === 'blockquote') {
      out.push(await para(el, resolve, { style: 'Quote' }));
      continue;
    }
    if (tag === 'pre') {
      out.push(await para(el, resolve, {}, { code: true }));
      continue;
    }
    if (tag === 'hr') {
      out.push(
        new Paragraph({
          border: { bottom: { style: 'single', size: 6, color: '999999' } },
          children: [],
        }),
      );
      continue;
    }
    if (tag === 'ul' || tag === 'ol') {
      const ref = tag === 'ul' ? BULLETS : NUMBERS;
      for (const li of el.childNodes.filter(
        (c) =>
          c.nodeType === NodeType.ELEMENT_NODE && (c as HTMLElement).tagName.toLowerCase() === 'li',
      ) as HTMLElement[]) {
        const nested = li.childNodes.filter(
          (c) =>
            c.nodeType === NodeType.ELEMENT_NODE && /^(ul|ol)$/i.test((c as HTMLElement).tagName),
        );
        const inline = li.childNodes.filter((c) => !nested.includes(c));
        out.push(
          new Paragraph({
            bidirectional: true,
            numbering: { reference: ref, level: Math.min(listLevel + 1, 8) },
            children: await inlineRuns(inline, {}, resolve),
          }),
        );
        out.push(...(await blocks(nested, resolve, listLevel + 1, ref)));
      }
      continue;
    }
    if (tag === 'table') {
      const rows: TableRow[] = [];
      for (const tr of el.querySelectorAll('tr')) {
        const cells: TableCell[] = [];
        for (const c of tr.childNodes.filter(
          (x) =>
            x.nodeType === NodeType.ELEMENT_NODE && /^(td|th)$/i.test((x as HTMLElement).tagName),
        ) as HTMLElement[]) {
          const isHead = c.tagName.toLowerCase() === 'th';
          cells.push(
            new TableCell({
              columnSpan: Number(c.getAttribute('colspan') ?? 1),
              rowSpan: Number(c.getAttribute('rowspan') ?? 1),
              children: [await para(c, resolve, {}, { bold: isHead })],
            }),
          );
        }
        if (cells.length)
          rows.push(new TableRow({ children: cells, tableHeader: tr.querySelector('th') !== null }));
      }
      if (rows.length)
        out.push(
          new Table({
            rows,
            width: { size: 100, type: WidthType.PERCENTAGE },
            visuallyRightToLeft: true,
          }),
        );
      continue;
    }
    // unknown wrapper (div/span/…): descend
    out.push(...(await blocks(el.childNodes, resolve, listLevel, listRef)));
  }
  void listRef;
  return out;
}

/** Sanitized HTML → .docx bytes. Loss is limited to styling outside the sanitizer allowlist. */
export async function htmlToDocx(
  html: string,
  opts: { title?: string; resolveAsset: AssetBytesResolver },
): Promise<Uint8Array> {
  const root = parse(html, { comment: false });
  const children = await blocks(root.childNodes, opts.resolveAsset);
  const doc = new Document({
    title: opts.title,
    styles: { default: { document: { run: { font: 'Arial', size: 22, rightToLeft: true } } } },
    numbering: {
      config: [
        {
          reference: BULLETS,
          levels: [0, 1, 2].map((level) => ({
            level,
            format: 'bullet',
            text: '•',
            alignment: AlignmentType.RIGHT,
          })),
        },
        {
          reference: NUMBERS,
          levels: [0, 1, 2].map((level) => ({
            level,
            format: 'decimal',
            text: `%${level + 1}.`,
            alignment: AlignmentType.RIGHT,
          })),
        },
      ],
    },
    sections: [{ properties: { bidi: true } as never, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
