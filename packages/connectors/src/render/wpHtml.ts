import { escapeHtml, fmt, type Block, type Step } from '@wecom/shared';
import type { LibraryContent } from '../contract.js';

/**
 * Library text -> WordPress text. `fmt` keeps bold and drops CRM chips (noCrm),
 * but it also wraps Latin runs in the KB's `<bdi class="lat">` spans and escapes
 * quotes; WordPress is customer facing, so those are unwound to plain text.
 * Quotes are only unescaped in text positions — attributes use escapeHtml.
 */
const t = (s: string): string =>
  fmt(s, { fields: [], noCrm: true })
    .replace(/<bdi class="lat" dir="ltr">([^<]*)<\/bdi>/g, '$1')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

function renderStep(s: Step, blocks: Map<string, Block>): string {
  const b = s.blockId ? blocks.get(s.blockId) : undefined;
  const actions = b?.actions ?? s.actions;
  const outcomes = s.outcomes.length ? s.outcomes : (b?.outcomes ?? []);
  const script = s.script ?? b?.script;
  const parts: string[] = [
    `<h3 data-kb-step="${escapeHtml(s.key)}">${escapeHtml(s.num)}. ${t(s.title || b?.title || '')}</h3>`,
  ];
  if (s.description) parts.push(`<p>${t(s.description)}</p>`);
  const inner: string[] = [];
  if (actions.length) inner.push('<ul>' + actions.map((a) => `<li>${t(a.text)}</li>`).join('') + '</ul>');
  if (script) inner.push(`<blockquote class="kb-script">${t(script)}</blockquote>`);
  if (s.branch)
    inner.push(
      `<table class="kb-branch"><thead><tr><th colspan="2">${t(s.branch.q)}</th></tr></thead><tbody>` +
        s.branch.options.map((o) => `<tr><td>${t(o.label)}</td><td>${t(o.text)}</td></tr>`).join('') +
        '</tbody></table>',
    );
  if (outcomes.length) inner.push(`<p class="kb-outcomes">${outcomes.map((o) => t(o.text)).join(' · ')}</p>`);
  parts.push(b ? `<div data-kb-block="${escapeHtml(b.id)}">${inner.join('')}</div>` : inner.join(''));
  return parts.join('\n');
}

/** Deterministic, Gutenberg-compatible HTML for a library document. */
export function renderWpHtml(content: LibraryContent): string {
  const blocks = new Map(content.blocks.map((b) => [b.id, b]));
  const d = content.document;
  const out: string[] = [];
  if (d.description) out.push(`<p class="kb-description">${t(d.description)}</p>`);
  for (const ph of d.phases) {
    if (ph.label) out.push(`<h2>${t(ph.label)}</h2>`);
    for (const s of ph.steps) out.push(renderStep(s, blocks));
  }
  return out.join('\n') + '\n';
}
