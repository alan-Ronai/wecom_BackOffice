import JSZip from 'jszip';
import { XMLParser } from 'fast-xml-parser';
import { createHash } from 'node:crypto';
import type { Paragraph, Run } from '@wecom/shared';
import type { SourceContent } from '@wecom/connectors';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  preserveOrder: true,
  trimValues: false,
});

type Node = Record<string, unknown> & { ':@'?: Record<string, string> };
type Comment = { author: string; text: string; date?: string };

const REF_RE = /^\s*(\d+(?:\.\d+)*)\.?\s+/;
const MAX_HEADING = 80;

const kids = (n: Node, name: string): Node[] => (n[name] as Node[] | undefined) ?? [];
const nodeName = (n: Node) => Object.keys(n).find((k) => k !== ':@') ?? '';
const attr = (n: Node, a: string) => n[':@']?.[a];
const isoDate = (d?: string) => {
  if (!d) return undefined;
  const t = Date.parse(d);
  return isNaN(t) ? undefined : new Date(t).toISOString();
};

function collectRuns(
  nodes: Node[],
  out: Run[],
  flags: Partial<Run>,
  stats: { tracked: number },
  comments: { starts: string[] },
): void {
  for (const n of nodes) {
    const name = nodeName(n);
    const children = (n[name] as Node[]) ?? [];
    if (name === 'w:t' || name === 'w:delText') {
      const text = children.map((c) => String((c as Node)['#text'] ?? '')).join('');
      if (text) out.push({ t: text, ...flags });
      continue;
    }
    if (name === 'w:tab') {
      out.push({ t: '\t', ...flags });
      continue;
    }
    if (name === 'w:commentRangeStart') {
      const id = attr(n, '@w:id');
      if (id) comments.starts.push(id);
      continue;
    }
    if (name === 'w:ins' || name === 'w:moveTo') {
      stats.tracked++;
      collectRuns(
        children,
        out,
        { add: true, author: attr(n, '@w:author'), date: isoDate(attr(n, '@w:date')) },
        stats,
        comments,
      );
      continue;
    }
    if (name === 'w:del' || name === 'w:moveFrom') {
      stats.tracked++;
      collectRuns(
        children,
        out,
        { del: true, author: attr(n, '@w:author'), date: isoDate(attr(n, '@w:date')) },
        stats,
        comments,
      );
      continue;
    }
    if (
      name === 'w:r' ||
      name === 'w:hyperlink' ||
      name === 'w:smartTag' ||
      name === 'w:sdt' ||
      name === 'w:sdtContent'
    )
      collectRuns(children, out, flags, stats, comments);
  }
}

const mergeRuns = (runs: Run[]): Run[] =>
  runs.reduce<Run[]>((acc, r) => {
    const p = acc[acc.length - 1];
    if (p && !!p.add === !!r.add && !!p.del === !!r.del && p.author === r.author && p.date === r.date)
      p.t += r.t;
    else acc.push({ ...r });
    return acc;
  }, []);

const visibleText = (runs: Run[]) =>
  runs
    .filter((r) => !r.del)
    .map((r) => r.t)
    .join('');

function paragraphFrom(
  p: Node,
  stats: { tracked: number },
  commentMap: Map<string, Comment>,
  index: number,
): Paragraph {
  const body = (p['w:p'] as Node[]) ?? [];
  const pPr = body.find((c) => nodeName(c) === 'w:pPr');
  const styleNode = pPr ? kids(pPr, 'w:pPr').find((c) => nodeName(c) === 'w:pStyle') : undefined;
  const style = styleNode ? (attr(styleNode, '@w:val') ?? '') : '';
  const level = /^Heading(\d)$/.exec(style)?.[1];
  const runs: Run[] = [];
  const cm = { starts: [] as string[] };
  collectRuns(
    body.filter((c) => nodeName(c) !== 'w:pPr'),
    runs,
    {},
    stats,
    cm,
  );
  const merged = mergeRuns(runs);
  const text = visibleText(merged);
  const m = REF_RE.exec(text);
  const para: Paragraph = { ref: m ? m[1] : String(index + 1), runs: merged };
  if (level) {
    para.level = Number(level);
    para.heading = text.trim();
  } else if (m) {
    const rest = text.slice(m[0].length);
    const head = rest.split(/[.:](\s|$)/)[0];
    if (head && head.length <= MAX_HEADING) para.heading = head.trim();
  }
  if (merged.length && merged.every((r) => r.add)) para.isNew = true;
  if (merged.length && merged.every((r) => r.del)) para.isDeleted = true;
  const comments = cm.starts.map((id) => commentMap.get(id)).filter((c): c is Comment => !!c);
  if (comments.length) para.comments = comments;
  return para;
}

function walkBody(
  nodes: Node[],
  out: Paragraph[],
  stats: { tracked: number },
  commentMap: Map<string, Comment>,
): void {
  for (const n of nodes) {
    const name = nodeName(n);
    if (name === 'w:p') out.push(paragraphFrom(n, stats, commentMap, out.length));
    else if (name === 'w:tbl')
      for (const tr of kids(n, 'w:tbl').filter((c) => nodeName(c) === 'w:tr')) {
        const cells = kids(tr, 'w:tr')
          .filter((c) => nodeName(c) === 'w:tc')
          .map((tc) => {
            const ps: Paragraph[] = [];
            walkBody(kids(tc, 'w:tc'), ps, stats, commentMap);
            return ps
              .map((p) => visibleText(p.runs))
              .join(' ')
              .trim();
          });
        out.push({ ref: String(out.length + 1), runs: [{ t: cells.join(' | ') }] });
      }
    else if (name === 'w:sdt' || name === 'w:sdtContent' || name === 'w:body')
      walkBody((n[name] as Node[]) ?? [], out, stats, commentMap);
  }
}

function parseComments(xml: string | null): Map<string, Comment> {
  const map = new Map<string, Comment>();
  if (!xml) return map;
  const root = parser.parse(xml) as Node[];
  const comments = root.flatMap((n) => (nodeName(n) === 'w:comments' ? kids(n, 'w:comments') : []));
  for (const c of comments) {
    if (nodeName(c) !== 'w:comment') continue;
    const ps: Paragraph[] = [];
    walkBody(kids(c, 'w:comment'), ps, { tracked: 0 }, new Map());
    map.set(attr(c, '@w:id') ?? '', {
      author: attr(c, '@w:author') ?? '',
      text: ps
        .map((p) => p.runs.map((r) => r.t).join(''))
        .join('\n')
        .trim(),
      date: isoDate(attr(c, '@w:date')),
    });
  }
  return map;
}

/** Stable content fingerprint: refs plus each run's text and add/del flags. */
export const contentHash = (paragraphs: Paragraph[]): string =>
  createHash('sha256')
    .update(JSON.stringify(paragraphs.map((p) => [p.ref, p.runs.map((r) => [r.t, !!r.add, !!r.del])])))
    .digest('hex');

export async function parseDocx(buffer: Buffer): Promise<SourceContent> {
  const zip = await JSZip.loadAsync(buffer);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml)
    throw Object.assign(new Error('not a docx: word/document.xml missing'), {
      statusCode: 400,
      code: 'UNSUPPORTED_FILE',
    });
  const commentMap = parseComments((await zip.file('word/comments.xml')?.async('string')) ?? null);
  const root = parser.parse(docXml) as Node[];
  const stats = { tracked: 0 };
  const paragraphs: Paragraph[] = [];
  walkBody(
    root.flatMap((n) => (nodeName(n) === 'w:document' ? kids(n, 'w:document') : [])),
    paragraphs,
    stats,
    commentMap,
  );
  const nonEmpty = paragraphs.filter((p) => p.runs.some((r) => r.t.trim()));
  const core = await zip.file('docProps/core.xml')?.async('string');
  const title =
    /<dc:title>([^<]*)<\/dc:title>/.exec(core ?? '')?.[1] ??
    nonEmpty.find((p) => p.level)?.heading ??
    'מסמך ללא שם';
  return {
    title,
    paragraphs: nonEmpty,
    hash: contentHash(nonEmpty),
    meta: { trackedChanges: stats.tracked, comments: commentMap.size },
  };
}
