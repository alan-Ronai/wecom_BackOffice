export type FieldStatus = 'ok' | 'renamed' | 'new' | 'retired' | 'unknown';
export interface FieldInfo {
  name: string;
  status: FieldStatus;
  path?: string;
  renamedTo?: string;
}
export interface DocRef {
  id: string;
  title: string;
  code?: string;
}
export interface FmtOptions {
  fields: FieldInfo[];
  docs?: DocRef[];
  noCrm?: boolean;
}

export const escapeHtml = (s: unknown): string =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );

const LATIN_RE = /[A-Za-z][A-Za-z0-9+\-/.]*(?:[ ][A-Za-z0-9+\-/.]+)*|\d+(?:[.:]\d+)+|\d+s\b/g;
const CODE_RE = /\b([RMOE]-\d{2}|T-\d{2})\b/g;
const LINK_RE = /\[\[doc:([\w-]+)(?:\|([^\]]+))?\]\]/;
const BOLD_RE = /\*\*([^*]+)\*\*/;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function fmtPlain(text: string): string {
  let out = '',
    last = 0;
  const s = String(text);
  LATIN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LATIN_RE.exec(s))) {
    out += escapeHtml(s.slice(last, m.index));
    const tok = m[0];
    if (/^[A-Za-z]$/.test(tok) && !/[A-Za-z]/.test(s[m.index + 1] ?? '')) out += escapeHtml(tok);
    else out += '<bdi class="lat" dir="ltr">' + escapeHtml(tok) + '</bdi>';
    last = m.index + tok.length;
  }
  return out + escapeHtml(s.slice(last));
}

export function crmChip(field: FieldInfo, extra?: string): string {
  const isLatin = /^[A-Za-z]/.test(field.name);
  const title =
    field.status === 'renamed'
      ? 'שדה CRM · שונה שם ל-' + (field.renamedTo ?? '')
      : field.status === 'new'
        ? 'שדה CRM · חדש'
        : field.status === 'unknown'
          ? 'שדה CRM · לא מוכר'
          : 'שדה CRM · תקין · ' + (field.path ?? '');
  return (
    `<span class="crm ${isLatin ? '' : 'rtl '}${field.status}" data-crm="${escapeHtml(field.name)}" title="${escapeHtml(title)}">${escapeHtml(field.name)}<i class="dot"></i></span>` +
    (extra ? `<span class="fnote">${escapeHtml(extra)}</span>` : '')
  );
}

export function crmIn(text: string, fieldNames: string[]): string[] {
  const t = String(text ?? '');
  return [...fieldNames].sort((a, b) => b.length - a.length).filter((n) => t.includes(n));
}

export const stripFmt = (t: unknown): string =>
  String(t ?? '')
    .replace(/\*\*/g, '')
    .replace(/\[\[doc:[\w-]+(?:\|([^\]]+))?\]\]/g, (_m, l: string | undefined) => l ?? '');

type Part = { kind: 'text'; t: string } | { kind: 'bold' | 'crm' | 'link' | 'code'; m: RegExpExecArray };

export function fmt(text: unknown, opts: FmtOptions): string {
  if (text == null) return '';
  const s = String(text);
  const names = opts.fields.map((f) => f.name).sort((a, b) => b.length - a.length);
  const nameRe = names.length && !opts.noCrm ? new RegExp('(' + names.map(escapeRe).join('|') + ')') : null;
  const parts: Part[] = [];
  let rest = s;
  while (rest.length) {
    const cands: { i: number; len: number; kind: Part['kind']; m: RegExpExecArray }[] = [];
    const lm = LINK_RE.exec(rest);
    if (lm) cands.push({ i: lm.index, len: lm[0].length, kind: 'link', m: lm });
    const bm = BOLD_RE.exec(rest);
    if (bm) cands.push({ i: bm.index, len: bm[0].length, kind: 'bold', m: bm });
    if (nameRe) {
      const cm = nameRe.exec(rest);
      if (cm) cands.push({ i: cm.index, len: cm[0].length, kind: 'crm', m: cm });
    }
    CODE_RE.lastIndex = 0;
    const km = CODE_RE.exec(rest);
    if (km) cands.push({ i: km.index, len: km[0].length, kind: 'code', m: km });
    if (!cands.length) {
      parts.push({ kind: 'text', t: rest });
      break;
    }
    cands.sort((a, b) => a.i - b.i || b.len - a.len);
    const c = cands[0];
    if (c.i > 0) parts.push({ kind: 'text', t: rest.slice(0, c.i) });
    parts.push({ kind: c.kind, m: c.m } as Part);
    rest = rest.slice(c.i + c.len);
  }
  const docs = opts.docs ?? [];
  return parts
    .map((p) => {
      if (p.kind === 'text') return fmtPlain(p.t);
      if (p.kind === 'bold') return '<b>' + fmt(p.m[1], opts) + '</b>';
      if (p.kind === 'crm') {
        const f = opts.fields.find((x) => x.name === p.m[1]) ?? { name: p.m[1], status: 'unknown' as const };
        return crmChip(f);
      }
      if (p.kind === 'link') {
        const d = docs.find((x) => x.id === p.m[1]);
        const label = p.m[2] ?? d?.title ?? p.m[1];
        return `<a class="doc-link" data-doc="${escapeHtml(p.m[1])}">${escapeHtml(label)}</a>`;
      }
      const d = docs.find((x) => x.code === p.m[1]);
      const code = `<bdi class="lat" dir="ltr">${escapeHtml(p.m[1])}</bdi>`;
      return d ? `<a class="doc-link" data-doc="${escapeHtml(d.id)}">${code}</a>` : code;
    })
    .join('');
}
