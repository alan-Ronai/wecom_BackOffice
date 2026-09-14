# W4 — Source Documents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every knowledge item a full, editable, versioned source document ("מקור האמת") stored as sanitized HTML, authored in-app with TipTap, importable from and exportable to Word, pushed to and pulled from WordPress, and fed into the existing suggestion pipeline on every save — without changing the working view automatically.

**Architecture:** HTML is the single canonical format (spec decision 1). `packages/shared` gains a pure allowlist sanitizer, the HTML→paragraph normalizer (moved from connectors), and an HTML→docx walker. The API gains a `sourcedocs` module (tables `source_documents`, `source_document_versions`, `assets`; migration 0033) whose `PUT` sanitizes, versions, rotates an etag and calls `SourceRevisionService.ingest`, so suggestions and W2's review flag follow exactly as for a Word upload. The WordPress connector pushes `source_documents.html` when present and writes inbound HTML back as a source version. The web app gets `SourceEditor`, `SourcePane`, `SourceHistory`, `ImportExportButtons`, `PaneModeToggle` and a `/edit/:id/source` route; W6 mounts them into the article and editor pages.

**Tech Stack:** TypeScript strict, Fastify 5 + fastify-type-provider-zod, pg 8, node-pg-migrate, pg-boss, `node-html-parser@^6.1.13`, `docx@9.7.1`, `mammoth@1.12.3`, `jszip` (tests), React 18 + `@tiptap/*@3.31.3`, TanStack Query 5, MSW 2, vitest 2, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-kb-wave4-prd-gaps-design.md` (§2.4, §3 Source documents, §5.1, §5.2, §6, §7). Contract: `docs/api/CONTRACTS-wave4.md` (W4 rows). Consumes W0 (`docs/superpowers/plans/2026-09-14-W0-wave4-contracts.md`).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root with `pnpm --filter <pkg> <script>`.
- Schemas only from `@wecom/shared` (W0's `SourceDocumentSchema`, `PutSourceDocumentBodySchema`, `SourceDocumentVersionSchema`, `SourceDocumentVersionsResponseSchema`, `AssetSchema`, `ASSET_MIMES`, `ASSET_MAX_BYTES`); never re-declare locally.
- Event name only `source_document.saved` (W0), built with `makeEvent`. Queue only `QUEUES.assetsGc` (W0).
- Source autosave routes are a W4-owned contract addition (coordinator decision 2026-09-14): `GET|PUT|DELETE /documents/:id/source/draft`, stored in the existing `drafts` table with `document_id = :id`, `draft_key = 'source:' + id`, `payload = { html }`. Their two schemas (`SourceDraftSchema`, `PutSourceDraftBodySchema`) are appended to `packages/shared/src/schemas/wave4.ts` (additive, ADR 0001).
- Migration for this lane: `apps/api/migrations/0033_source_documents.js`. No other migration number.
- Append-only shared files (spec §6): `apps/api/src/modules/index.ts` (one import + one list entry), `apps/web/src/routes.tsx` (route entries), `apps/web/src/api/keys.ts` (new keys), `packages/shared/src/format/index.ts` (new exports), `packages/shared/src/schemas/identity.ts` (one additive preference field). **Never** edit `app.ts`, `stage45.ts`, `Shell.tsx`, `Sidebar.tsx`, `ArticlePage.tsx`, `EditorPage.tsx`, `LibraryPage.tsx`.
- Sanitizer allowlist verbatim from spec §5.1: `h1 h2 h3 h4 p ul ol li table thead tbody tr th td img a strong em u s blockquote code pre br hr span bdi`; `img[src]` must match `^/api/v1/assets/[0-9a-f-]{36}$` (data: URIs rejected); `a[href]` http(s) only and gets `rel="noopener"`; `span[dir]`, `th/td[colspan|rowspan]`, `bdi[dir]`; everything else stripped (tags unwrapped, attributes dropped).
- Source kind for in-app-authored documents: `sources.kind = 'text'` (the check constraint allows `docx,wordpress,json,csv,text`; HTML authored in the platform is text-family content, and documents already linked to a `docx`/`wordpress` source keep that source).
- Assets: the whole acceptance rule is W0's `ASSET_MIMES` (`image/png, image/jpeg, image/gif, image/webp`); anything else is a 415 `UNSUPPORTED_ASSET`. No SVG path anywhere.
- Hebrew for user-facing strings, English for identifiers and logs. Commit after every task with the session's attribution lines.

## File structure

```
packages/shared/package.json                          (modify: deps node-html-parser ^6.1.13, docx 9.7.1; devDeps @types/node ^22.7.4, jszip ^3.10.1)
packages/shared/src/format/htmlParagraphs.ts          normalizeText, htmlToParagraphs, paragraphsText, htmlToText (moved from connectors + new)
packages/shared/src/format/sanitizeHtml.ts            sanitizeHtml(html) → string; SANITIZE_TAGS, ASSET_SRC_RE
packages/shared/src/format/htmlToDocx.ts              htmlToDocx(html, { resolveAsset }) → Promise<Uint8Array>
packages/shared/src/format/index.ts                   (modify: export the three files)
packages/shared/src/schemas/identity.ts               (modify: PreferencesSchema.paneMode)
packages/shared/src/schemas/wave4.ts                  (modify, append-only: SourceDraftSchema, PutSourceDraftBodySchema)
packages/shared/test/sanitizeHtml.test.ts, htmlParagraphs.test.ts, htmlToDocx.test.ts
packages/connectors/src/wordpress/html.ts             (modify: re-export moved functions, keep contentHash)
packages/connectors/src/contract.ts                   (modify: LibraryContent.assets?: AssetBytesResolver)
packages/connectors/src/wordpress/client.ts           (modify: uploadMedia)
packages/connectors/src/wordpress/connector.ts        (modify: push rewrites asset srcs via uploadMedia)
packages/connectors/test/wordpress-connector.test.ts  (modify: push-with-html + media upload test)
packages/connectors/test/helpers/wpStub.ts            (modify: /wp-json/wp/v2/media endpoint)
apps/api/package.json                                 (modify: mammoth 1.12.3)
apps/api/migrations/0033_source_documents.js
apps/api/src/modules/sourcedocs/repo.ts               get/put/versions/restore/etag, hash, text
apps/api/src/modules/sourcedocs/assets.ts             assets repo: put (ASSET_MIMES check, sha256 dedupe), get, gcUnreferenced
apps/api/src/modules/sourcedocs/import.ts             importDocx(buffer, assets) → html (mammoth)
apps/api/src/modules/sourcedocs/ingest.ts             ingestSourceHtml(app, documentId, html, actorId) — creates the 'text' source on demand and calls revisions.ingest
apps/api/src/modules/sourcedocs/routes.ts             all W4 routes incl. source draft GET/PUT/DELETE
apps/api/src/modules/sourcedocs/jobs.ts               assets.gc worker + weekly schedule
apps/api/src/modules/sourcedocs/index.ts              default export plugin (routes + jobs)
apps/api/src/modules/index.ts                         (modify: register sourcedocs)
apps/api/src/modules/connectors/sync.ts               (modify: reconcile writes inbound HTML as a source version; push uses source html)
apps/api/src/modules/connectors/documents-adapter.ts  (modify: getSourceHtml / putSourceFromRemote)
apps/api/test/sourcedocs.test.ts                      integration (routes, etag, ingest, import/export, assets, raw, gc)
apps/api/test/sourcedocs-import.test.ts               unit (mammoth on docx-builder output)
apps/api/test/connectors-sync.test.ts                 (modify: inbound HTML → source version; push uses html)
apps/api/test/sources/fixtures/docx-builder.ts        (modify: heading styles already supported; add `image` para)
apps/web/package.json                                 (modify: @tiptap/* 3.31.3)
apps/web/src/api/keys.ts                              (modify: source, sourceVersions, sourceVersion, sourceDraft)
apps/web/src/api/hooks/sourcedocs.ts                  useSourceDocument, useSaveSource, useSourceVersions, useSourceVersion, useRestoreSource, useImportDocx, exportDocxUrl, useUploadAsset, useSourceDraft, useSaveSourceDraft
apps/web/src/components/source/SourceEditor.tsx       TipTap editor + toolbar + autosave + save-version + conflict dialog
apps/web/src/components/source/SourcePane.tsx         read-only render, "ערוך מקור", raw download
apps/web/src/components/source/SourceHistory.tsx      versions list + restore
apps/web/src/components/source/ImportExportButtons.tsx
apps/web/src/components/source/PaneModeToggle.tsx     work / source / split, persisted in preferences
apps/web/src/components/source/SourceEditPage.tsx     route page for /edit/:id/source
apps/web/src/routes.tsx                               (modify: 'edit/:id/source')
apps/web/src/lib/prefs.ts                             (modify: DEFAULT_PREFERENCES.paneMode)
apps/web/test/setup.ts                                (modify: ProseMirror jsdom polyfills)
apps/web/test/msw/handlers.ts                         (modify: source routes)
apps/web/test/source/*.test.tsx
```

## Interfaces this lane consumes from other lanes (compile either way)

- W0: everything in Global Constraints; `app.events.publish(tx, makeEvent(...))`; `audit(tx, …)`.
- W2 (may not be merged): `PublishOptions.sourceVersion?: number` on `publishDocument`. W4 never passes it directly; instead `apps/api/src/modules/sourcedocs/repo.ts` exports `currentSourceVersion(q, documentId): Promise<number | null>` and W2's plan calls it from the publish route. Nothing in W4 depends on W2's columns; the one integration assertion on `source_review_needed` is guarded on column existence (Task 9).
- W6 mounts `PaneModeToggle`, `SourcePane`, `SourceHistory`, `ImportExportButtons` into `ArticlePage`/`EditorPage`.

---

### Task 1: Move the HTML→paragraph normalizer into shared; add `htmlToText`

**Files:**
- Create: `packages/shared/src/format/htmlParagraphs.ts`, `packages/shared/test/htmlParagraphs.test.ts`
- Modify: `packages/shared/package.json`, `packages/shared/src/format/index.ts`, `packages/connectors/src/wordpress/html.ts`

**Interfaces:**
- Consumes: `Paragraph` from `../schemas/pipeline.js`.
- Produces: `normalizeText(s)`, `htmlToParagraphs(html): Paragraph[]`, `paragraphsText(ps)`, `htmlToText(html): string` from `@wecom/shared`. `@wecom/connectors` keeps exporting `normalizeText`, `htmlToParagraphs`, `paragraphsText` (re-exports) and `contentHash` (unchanged, node:crypto stays in connectors).

- [ ] **Step 1: Add dependencies to shared**

In `packages/shared/package.json` set:
```json
  "dependencies": {
    "docx": "9.7.1",
    "node-html-parser": "^6.1.13",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^22.7.4",
    "jszip": "^3.10.1",
    "typescript": "^5.6.2",
    "vitest": "^2.1.1"
  }
```
Run: `pnpm install`

- [ ] **Step 2: Write the failing test**

`packages/shared/test/htmlParagraphs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, htmlToText, normalizeText } from '../src/index.js';

describe('htmlParagraphs', () => {
  it('normalizes entities and whitespace', () => {
    expect(normalizeText('a&nbsp;&amp;  b   c')).toBe('a & b c');
  });
  it('turns blocks into stable refs under headings', () => {
    const ps = htmlToParagraphs('<h2>שלב 1</h2><p>פתח CRM</p><ul><li>א</li><li>ב</li></ul><h2>שלב 2</h2><p>סיים</p>');
    expect(ps.map((p) => p.ref)).toEqual(['h2-1', 'h2-1.p-1', 'h2-1.ul-2', 'h2-2', 'h2-2.p-1']);
    expect(ps[0].heading).toBe('שלב 1');
    expect(ps[0].level).toBe(2);
    expect(ps[2].runs[0].t).toBe('• א\n• ב');
  });
  it('flattens tables row by row', () => {
    const ps = htmlToParagraphs('<table><tr><th>שדה</th><th>ערך</th></tr><tr><td>APN</td><td>internet</td></tr></table>');
    expect(ps[0].runs[0].t).toBe('שדה | ערך\nAPN | internet');
  });
  it('htmlToText joins block texts with newlines and drops refs', () => {
    expect(htmlToText('<h2>כותרת</h2><p>גוף <strong>מודגש</strong></p>')).toBe('כותרת\nגוף מודגש');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- htmlParagraphs`
Expected: FAIL — `htmlToParagraphs` is not exported from `../src/index.js`.

- [ ] **Step 4: Move the code**

Create `packages/shared/src/format/htmlParagraphs.ts` with the body of `packages/connectors/src/wordpress/html.ts` **minus** `contentHash` and the `node:crypto` import, importing `Paragraph` from `'../schemas/pipeline.js'`, and append:
```ts
/** Plain text of an HTML fragment: one line per block, inline markup dropped. Used for `source_documents.text` and search. */
export const htmlToText = (html: string): string =>
  htmlToParagraphs(html)
    .map((p) => p.runs.map((r) => r.t).join(''))
    .join('\n');
```
Replace `packages/connectors/src/wordpress/html.ts` with:
```ts
import { createHash } from 'node:crypto';
import { paragraphsText, type Paragraph } from '@wecom/shared';

// Moved to @wecom/shared (wave 4, W4): the normalizer is shared by the source editor, the
// sanitizer tests and the WordPress connector. Re-exported so existing imports keep working.
export { normalizeText, htmlToParagraphs, paragraphsText } from '@wecom/shared';

export const contentHash = (ps: Paragraph[]): string =>
  createHash('sha256').update(paragraphsText(ps), 'utf8').digest('hex');
```
Append to `packages/shared/src/format/index.ts`:
```ts
export * from './htmlParagraphs.js';
```

- [ ] **Step 5: Run shared + connectors tests**

Run: `pnpm --filter @wecom/shared build && pnpm --filter @wecom/shared test && pnpm --filter @wecom/connectors test`
Expected: PASS (`wordpress-html.test.ts` still green through the re-exports).

- [ ] **Step 6: Commit**

```bash
git add packages/shared packages/connectors/src/wordpress/html.ts pnpm-lock.yaml
git commit -m "refactor(shared): move HTML→paragraph normalizer into shared, add htmlToText"
```

---

### Task 2: Allowlist HTML sanitizer

**Files:**
- Create: `packages/shared/src/format/sanitizeHtml.ts`, `packages/shared/test/sanitizeHtml.test.ts`
- Modify: `packages/shared/src/format/index.ts`

**Interfaces:**
- Produces: `sanitizeHtml(html: string): string`, `SANITIZE_TAGS: ReadonlySet<string>`, `ASSET_SRC_RE = /^\/api\/v1\/assets\/[0-9a-f-]{36}$/`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/sanitizeHtml.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, ASSET_SRC_RE } from '../src/index.js';

const A = '/api/v1/assets/11111111-1111-4111-8111-111111111111';

describe('sanitizeHtml', () => {
  it('keeps the allowlisted structure', () => {
    const html = `<h2>כותרת</h2><p dir="rtl">טקסט <strong>מודגש</strong> <em>נטוי</em> <u>קו</u> <s>מחוק</s></p><ul><li>א</li></ul><ol><li>1</li></ol><table><thead><tr><th colspan="2">x</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table><blockquote>ציטוט</blockquote><pre><code>x</code></pre><hr><br>`;
    const out = sanitizeHtml(html);
    for (const tag of ['<h2>', '<strong>', '<em>', '<u>', '<s>', '<ul>', '<ol>', '<table>', '<thead>', '<tbody>', '<th colspan="2">', '<blockquote>', '<pre>', '<code>', '<hr>', '<br>'])
      expect(out).toContain(tag);
  });
  it('strips scripts, handlers, styles and unknown tags but keeps their text', () => {
    const out = sanitizeHtml(`<p onclick="x()" style="color:red">שלום<script>alert(1)</script><iframe src="x"></iframe><div>בתוך</div></p>`);
    expect(out).toBe('<p>שלוםבתוך</p>');
  });
  it('allows only asset images and rejects data URIs and remote images', () => {
    expect(sanitizeHtml(`<img src="${A}" alt="x">`)).toBe(`<img src="${A}" alt="x">`);
    expect(sanitizeHtml(`<img src="data:image/png;base64,AAAA">`)).toBe('');
    expect(sanitizeHtml(`<img src="https://evil/x.png">`)).toBe('');
    expect(ASSET_SRC_RE.test(A)).toBe(true);
  });
  it('allows http(s) links only and adds rel=noopener', () => {
    expect(sanitizeHtml('<a href="https://wecom.co.il/x">קישור</a>')).toBe('<a href="https://wecom.co.il/x" rel="noopener">קישור</a>');
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).toBe('<a rel="noopener">x</a>');
  });
  it('keeps dir on span and bdi, drops everything else', () => {
    expect(sanitizeHtml('<span dir="ltr" class="c" id="i">abc</span><bdi dir="ltr">x</bdi>')).toBe('<span dir="ltr">abc</span><bdi dir="ltr">x</bdi>');
  });
  it('escapes text nodes', () => {
    expect(sanitizeHtml('<p>a &lt; b &amp;&amp; c</p>')).toBe('<p>a &lt; b &amp;&amp; c</p>');
  });
  it('is idempotent', () => {
    const once = sanitizeHtml('<h1>x</h1><p><a href="http://a">b</a></p>');
    expect(sanitizeHtml(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- sanitizeHtml`
Expected: FAIL — `sanitizeHtml` not exported.

- [ ] **Step 3: Implement**

`packages/shared/src/format/sanitizeHtml.ts`:
```ts
import { parse, HTMLElement, NodeType, type Node } from 'node-html-parser';

/** Spec §5.1 allowlist. Anything else is unwrapped (its text kept) or, for void/embedded tags, dropped. */
export const SANITIZE_TAGS: ReadonlySet<string> = new Set([
  'h1', 'h2', 'h3', 'h4', 'p', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
  'img', 'a', 'strong', 'em', 'u', 's', 'blockquote', 'code', 'pre', 'br', 'hr', 'span', 'bdi',
]);
/** Tags whose whole subtree is dropped, text included. */
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'noscript', 'template', 'svg', 'math', 'link', 'meta']);
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
  if (node.nodeType === NodeType.TEXT_NODE) return escText((node as HTMLElement).rawText.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&nbsp;/g, ' '));
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
  const root = parse(html, { comment: false, blockTextElements: { script: true, style: true, pre: false } });
  return render(root);
}
```
Append to `format/index.ts`: `export * from './sanitizeHtml.js';`

- [ ] **Step 4: Run and verify pass**

Run: `pnpm --filter @wecom/shared test -- sanitizeHtml`
Expected: PASS (7 tests). If the "escapes text nodes" case differs by entity form, adjust the test expectation only if the output is still well-formed and idempotent — never widen the allowlist.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): allowlist HTML sanitizer for source documents"
```

---

### Task 3: HTML → docx exporter

**Files:**
- Create: `packages/shared/src/format/htmlToDocx.ts`, `packages/shared/test/htmlToDocx.test.ts`
- Modify: `packages/shared/src/format/index.ts`

**Interfaces:**
- Produces: `htmlToDocx(html: string, opts: { title?: string; resolveAsset: AssetBytesResolver }): Promise<Uint8Array>`, `type AssetBytesResolver = (assetId: string) => Promise<{ bytes: Uint8Array; mime: string; width?: number; height?: number } | null>`.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/htmlToDocx.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { htmlToDocx } from '../src/index.js';

const A = '11111111-1111-4111-8111-111111111111';
// 1x1 transparent PNG
const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
const resolveAsset = async (id: string) => (id === A ? { bytes: PNG, mime: 'image/png', width: 1, height: 1 } : null);
const docXml = async (buf: Uint8Array) => (await JSZip.loadAsync(buf)).file('word/document.xml')!.async('string');

describe('htmlToDocx', () => {
  it('emits headings, paragraphs, runs and links', async () => {
    const xml = await docXml(await htmlToDocx('<h1>כותרת</h1><p>טקסט <strong>מודגש</strong> <em>נטוי</em> <u>קו</u> <s>מחוק</s> <a href="https://x.y/z">קישור</a></p>', { resolveAsset }));
    expect(xml).toContain('w:val="Heading1"');
    expect(xml).toContain('כותרת');
    expect(xml).toContain('<w:b/>');
    expect(xml).toContain('<w:i/>');
    expect(xml).toContain('<w:u w:val="single"/>');
    expect(xml).toContain('<w:strike/>');
    expect(xml).toContain('w:hyperlink');
    expect(xml).toContain('w:bidi'); // RTL paragraphs
  });
  it('emits nested lists and tables', async () => {
    const xml = await docXml(await htmlToDocx('<ul><li>א<ul><li>ב</li></ul></li></ul><ol><li>1</li></ol><table><tr><th>ש</th><th>ע</th></tr><tr><td>a</td><td>b</td></tr></table>', { resolveAsset }));
    expect(xml).toContain('<w:numPr>');
    expect(xml).toContain('w:ilvl w:val="1"');
    expect(xml).toContain('<w:tbl>');
    expect((xml.match(/<w:tc>/g) ?? []).length).toBe(4);
  });
  it('embeds asset images and skips unknown ones', async () => {
    const buf = await htmlToDocx(`<p><img src="/api/v1/assets/${A}" alt="x"></p><p><img src="/api/v1/assets/22222222-2222-4222-8222-222222222222"></p>`, { resolveAsset });
    const zip = await JSZip.loadAsync(buf);
    const xml = await zip.file('word/document.xml')!.async('string');
    expect(xml).toContain('<w:drawing>');
    expect((xml.match(/<w:drawing>/g) ?? []).length).toBe(1);
    expect(Object.keys(zip.files).some((f) => f.startsWith('word/media/'))).toBe(true);
  });
  it('emits blockquote and code as styled paragraphs', async () => {
    const xml = await docXml(await htmlToDocx('<blockquote>ציטוט</blockquote><pre><code>let x = 1;</code></pre>', { resolveAsset }));
    expect(xml).toContain('w:val="Quote"');
    expect(xml).toContain('Courier New');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/shared test -- htmlToDocx`
Expected: FAIL — `htmlToDocx` not exported.

- [ ] **Step 3: Implement**

`packages/shared/src/format/htmlToDocx.ts`:
```ts
import { parse, HTMLElement, NodeType, type Node } from 'node-html-parser';
import {
  AlignmentType, Document, ExternalHyperlink, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow,
  TextRun, WidthType, type IParagraphOptions, type IRunOptions,
} from 'docx';
import { ASSET_SRC_RE } from './sanitizeHtml.js';

export type AssetBytesResolver = (
  assetId: string,
) => Promise<{ bytes: Uint8Array; mime: string; width?: number; height?: number } | null>;

type Fmt = { bold?: boolean; italics?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string };
type Child = Paragraph | Table;

const HEADINGS: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1, h2: HeadingLevel.HEADING_2, h3: HeadingLevel.HEADING_3, h4: HeadingLevel.HEADING_4,
};
const BULLETS = 'kb-bullets';
const NUMBERS = 'kb-numbers';
const MAX_IMG_PX = 560;
const textOf = (n: Node) => (n as HTMLElement).rawText.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');

function runOpts(f: Fmt, text: string): IRunOptions {
  return {
    text, bold: f.bold, italics: f.italics, strike: f.strike, rightToLeft: true,
    underline: f.underline ? { type: 'single' } : undefined,
    font: f.code ? 'Courier New' : undefined,
    style: f.href ? 'Hyperlink' : undefined,
  };
}

async function inlineRuns(nodes: Node[], f: Fmt, resolve: AssetBytesResolver): Promise<(TextRun | ExternalHyperlink | ImageRun)[]> {
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
    if (tag === 'br') { out.push(new TextRun({ break: 1 })); continue; }
    if (tag === 'img') {
      const src = el.getAttribute('src') ?? '';
      const m = ASSET_SRC_RE.test(src) ? src.split('/').pop()! : null;
      const asset = m ? await resolve(m) : null;
      if (!asset) continue;
      const w = asset.width ?? MAX_IMG_PX;
      const h = asset.height ?? Math.round(MAX_IMG_PX * 0.66);
      const scale = w > MAX_IMG_PX ? MAX_IMG_PX / w : 1;
      const type = asset.mime === 'image/png' ? 'png' : asset.mime === 'image/gif' ? 'gif' : 'jpg';
      out.push(new ImageRun({ type, data: asset.bytes, transformation: { width: Math.round(w * scale), height: Math.round(h * scale) }, altText: { title: el.getAttribute('alt') ?? '', description: '', name: m! } }));
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
      out.push(new ExternalHyperlink({ link: href, children: children.filter((c): c is TextRun => c instanceof TextRun) }));
      continue;
    }
    out.push(...(await inlineRuns(el.childNodes, next, resolve)));
  }
  return out;
}

const para = async (el: HTMLElement, resolve: AssetBytesResolver, extra: Partial<IParagraphOptions> = {}, f: Fmt = {}) =>
  new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, ...extra, children: await inlineRuns(el.childNodes, f, resolve) });

async function blocks(nodes: Node[], resolve: AssetBytesResolver, listLevel = -1, listRef?: string): Promise<Child[]> {
  const out: Child[] = [];
  for (const n of nodes) {
    if (n.nodeType === NodeType.TEXT_NODE) {
      const t = textOf(n).trim();
      if (t) out.push(new Paragraph({ bidirectional: true, alignment: AlignmentType.RIGHT, children: [new TextRun({ text: t, rightToLeft: true })] }));
      continue;
    }
    if (n.nodeType !== NodeType.ELEMENT_NODE) continue;
    const el = n as HTMLElement;
    const tag = el.tagName.toLowerCase();
    if (HEADINGS[tag]) { out.push(await para(el, resolve, { heading: HEADINGS[tag] })); continue; }
    if (tag === 'p') { out.push(await para(el, resolve)); continue; }
    if (tag === 'blockquote') { out.push(await para(el, resolve, { style: 'Quote' })); continue; }
    if (tag === 'pre') { out.push(await para(el, resolve, {}, { code: true })); continue; }
    if (tag === 'hr') { out.push(new Paragraph({ border: { bottom: { style: 'single', size: 6, color: '999999' } }, children: [] })); continue; }
    if (tag === 'ul' || tag === 'ol') {
      const ref = tag === 'ul' ? BULLETS : NUMBERS;
      for (const li of el.childNodes.filter((c) => c.nodeType === NodeType.ELEMENT_NODE && (c as HTMLElement).tagName.toLowerCase() === 'li') as HTMLElement[]) {
        const nested = li.childNodes.filter((c) => c.nodeType === NodeType.ELEMENT_NODE && /^(ul|ol)$/i.test((c as HTMLElement).tagName));
        const inline = li.childNodes.filter((c) => !nested.includes(c));
        out.push(new Paragraph({ bidirectional: true, numbering: { reference: ref, level: Math.min(listLevel + 1, 8) }, children: await inlineRuns(inline, {}, resolve) }));
        out.push(...(await blocks(nested, resolve, listLevel + 1, ref)));
      }
      continue;
    }
    if (tag === 'table') {
      const rows: TableRow[] = [];
      for (const tr of el.querySelectorAll('tr')) {
        const cells: TableCell[] = [];
        for (const c of tr.childNodes.filter((x) => x.nodeType === NodeType.ELEMENT_NODE && /^(td|th)$/i.test((x as HTMLElement).tagName)) as HTMLElement[]) {
          const isHead = c.tagName.toLowerCase() === 'th';
          cells.push(new TableCell({ columnSpan: Number(c.getAttribute('colspan') ?? 1), rowSpan: Number(c.getAttribute('rowspan') ?? 1), children: [await para(c, resolve, {}, { bold: isHead })] }));
        }
        if (cells.length) rows.push(new TableRow({ children: cells, tableHeader: tr.querySelector('th') !== null }));
      }
      if (rows.length) out.push(new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, visuallyRightToLeft: true }));
      continue;
    }
    // unknown wrapper (div/span/…): descend
    out.push(...(await blocks(el.childNodes, resolve, listLevel, listRef)));
  }
  void listRef;
  return out;
}

/** Sanitized HTML → .docx bytes. Loss is limited to styling outside the sanitizer allowlist. */
export async function htmlToDocx(html: string, opts: { title?: string; resolveAsset: AssetBytesResolver }): Promise<Uint8Array> {
  const root = parse(html, { comment: false });
  const children = await blocks(root.childNodes, opts.resolveAsset);
  const doc = new Document({
    title: opts.title,
    styles: { default: { document: { run: { font: 'Arial', size: 22, rightToLeft: true } } } },
    numbering: {
      config: [
        { reference: BULLETS, levels: [0, 1, 2].map((level) => ({ level, format: 'bullet', text: '•', alignment: AlignmentType.RIGHT })) },
        { reference: NUMBERS, levels: [0, 1, 2].map((level) => ({ level, format: 'decimal', text: `%${level + 1}.`, alignment: AlignmentType.RIGHT })) },
      ],
    },
    sections: [{ properties: { bidi: true } as never, children }],
  });
  const buf = await Packer.toBuffer(doc);
  return new Uint8Array(buf);
}
```
Append to `format/index.ts`: `export * from './htmlToDocx.js';`

- [ ] **Step 4: Run and verify pass**

Run: `pnpm --filter @wecom/shared test -- htmlToDocx && pnpm --filter @wecom/shared typecheck`
Expected: PASS. If `docx@9.7.1` types differ for `sections[].properties.bidi` or `ImageRun.type`, fix against the installed `node_modules/docx/build/index.d.ts` rather than loosening the tests; the assertions target Word XML, not the library API.

- [ ] **Step 5: Commit**

```bash
git add packages/shared
git commit -m "feat(shared): HTML → docx exporter (headings, lists, tables, images, links)"
```

---

### Task 4: Migration 0033 — source documents, versions, assets, backfill

**Files:**
- Create: `apps/api/migrations/0033_source_documents.js`
- Modify: `apps/api/test/migrations.test.ts`

**Interfaces:**
- Produces tables: `source_documents(id, document_id unique → documents cascade, html, text, hash, current_version, etag, updated_by, updated_at, created_at)`, `source_document_versions(id, source_document_id → source_documents cascade, version, html, author_id → users, label, source_revision_id → source_revisions set null, created_at; unique (source_document_id, version))`, `assets(id, mime, bytes bytea, sha256 unique, size, width, height, created_by, created_at)`.

- [ ] **Step 1: Add the assertion to `migrations.test.ts`** (inside the existing `run('migrations', …)` block)

```ts
  it('creates the wave 4 source document tables and backfills from accepted revisions', async () => {
    const t = await pool.query("select table_name from information_schema.tables where table_schema='public' and table_name in ('source_documents','source_document_versions','assets') order by 1");
    expect(t.rows.map((r) => r.table_name)).toEqual(['assets', 'source_document_versions', 'source_documents']);
    const u = await pool.query("select indexname from pg_indexes where tablename='assets' and indexdef ilike '%unique%(sha256)%'");
    expect(u.rowCount).toBe(1);
  });
```
The backfill itself is asserted in `apps/api/test/sourcedocs.test.ts` (Task 9) because it needs seeded rows.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts`
Expected: FAIL — tables missing.

- [ ] **Step 3: Write the migration**

`apps/api/migrations/0033_source_documents.js`:
```js
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('source_documents', {
    id: id(pgm),
    document_id: { type: 'uuid', notNull: true, unique: true, references: 'documents', onDelete: 'cascade' },
    html: { type: 'text', notNull: true, default: '' },
    text: { type: 'text', notNull: true, default: '' },
    hash: 'text',
    current_version: { type: 'integer', notNull: true, default: 0 },
    etag: { type: 'text', notNull: true, default: pgm.func('gen_random_uuid()::text') },
    updated_by: { type: 'uuid', references: 'users' },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.createTable('source_document_versions', {
    id: id(pgm),
    source_document_id: { type: 'uuid', notNull: true, references: 'source_documents', onDelete: 'cascade' },
    version: { type: 'integer', notNull: true },
    html: { type: 'text', notNull: true },
    author_id: { type: 'uuid', references: 'users' },
    label: { type: 'text', notNull: true, default: '' },
    source_revision_id: { type: 'uuid', references: 'source_revisions', onDelete: 'set null' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('source_document_versions', 'source_document_versions_unique', { unique: ['source_document_id', 'version'] });
  pgm.createTable('assets', {
    id: id(pgm),
    mime: { type: 'text', notNull: true },
    bytes: { type: 'bytea', notNull: true },
    sha256: { type: 'text', notNull: true, unique: true },
    size: { type: 'integer', notNull: true },
    width: 'integer',
    height: 'integer',
    created_by: { type: 'uuid', references: 'users' },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  // Backfill: every document with a source gets a source document rendered from the latest accepted
  // revision's paragraphs (headings → <hN>, else <p>), as version 1 labelled "יובא מהמקור".
  pgm.sql(`
    with latest as (
      select distinct on (d.id) d.id as document_id, sr.id as revision_id, sr.paragraphs
      from documents d
      join source_revisions sr on sr.source_id = d.source_id and sr.accepted
      where d.source_id is not null and d.deleted_at is null
      order by d.id, sr.imported_at desc
    ), rendered as (
      select document_id, revision_id,
        string_agg(
          case when p->>'heading' is not null
            then '<h' || coalesce((p->>'level')::text, '2') || '>' || replace(replace(replace(coalesce(p->>'heading',''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</h' || coalesce((p->>'level')::text, '2') || '>'
            else '<p>' || replace(replace(replace((select string_agg(r->>'t', '') from jsonb_array_elements(p->'runs') r where coalesce((r->>'del')::text, '') = ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;') || '</p>'
          end, '' order by ord) as html,
        string_agg(coalesce(p->>'heading', (select string_agg(r->>'t', '') from jsonb_array_elements(p->'runs') r)), E'\\n' order by ord) as text
      from latest, jsonb_array_elements(paragraphs) with ordinality as x(p, ord)
      group by document_id, revision_id
    ), ins as (
      insert into source_documents(document_id, html, text, hash, current_version)
      select document_id, html, text, md5(html), 1 from rendered
      returning id, document_id
    )
    insert into source_document_versions(source_document_id, version, html, label, source_revision_id)
    select ins.id, 1, rendered.html, 'יובא מהמקור', rendered.revision_id
    from ins join rendered on rendered.document_id = ins.document_id
  `);
};
exports.down = (pgm) => {
  pgm.dropTable('assets');
  pgm.dropTable('source_document_versions');
  pgm.dropTable('source_documents');
};
```

- [ ] **Step 4: Run migration tests up and down**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/migrations.test.ts test/migrate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/migrations/0033_source_documents.js apps/api/test/migrations.test.ts
git commit -m "feat(api): migration 0033 — source documents, versions, assets, backfill"
```

---

### Task 5: Word import (mammoth → sanitized HTML, images → assets)

**Files:**
- Create: `apps/api/src/modules/sourcedocs/assets.ts`, `apps/api/src/modules/sourcedocs/import.ts`, `apps/api/test/sourcedocs-import.test.ts`
- Modify: `apps/api/package.json` (add `"mammoth": "1.12.3"` to dependencies), `apps/api/test/sources/fixtures/docx-builder.ts`

**Interfaces:**
- Produces:
  - `assets.ts`: `putAsset(q, { bytes: Buffer; mime: string; createdBy: string | null }): Promise<Asset>` (mime must be in W0's `ASSET_MIMES`, else `HttpError 415 UNSUPPORTED_ASSET`; `413 ASSET_TOO_LARGE`; sha256 dedupe → returns the existing row); `getAsset(q, id): Promise<{ mime: string; bytes: Buffer; size: number } | null>`; `assetUrl(id) = '/api/v1/assets/' + id`; `gcUnreferencedAssets(q): Promise<number>`.
  - `import.ts`: `importDocx(buffer: Buffer, deps: { putAsset: (bytes: Buffer, mime: string) => Promise<{ id: string }> }): Promise<{ html: string; messages: string[] }>`.
- Consumes: `sanitizeHtml`, `ASSET_MAX_BYTES`, `AssetSchema` type from `@wecom/shared`; `httpError` from `../../lib/http.js`.

- [ ] **Step 1: Extend the docx builder for images**

In `apps/api/test/sources/fixtures/docx-builder.ts` add to `DocxPara`: `image?: { png: Buffer }` and in `buildDocx`, when `p.image` is set, emit a paragraph with a `<w:drawing>` inline referencing relationship `rIdImg<n>`, add `word/media/image<n>.png` to the zip, write `word/_rels/document.xml.rels` listing each image relationship, and add a `Default Extension="png"` to `[Content_Types].xml`. Minimal inline drawing XML:
```ts
const drawingXml = (rId: string) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="95250" cy="95250"/><wp:docPr id="1" name="img"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="img"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rId}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="95250" cy="95250"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
```
and the rels file:
```ts
zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map((r) => `<Relationship Id="${r.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${r.file}"/>`).join('')}</Relationships>`);
```
The existing parser tests must stay green (they never set `image`).

- [ ] **Step 2: Write the failing unit test**

`apps/api/test/sourcedocs-import.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildDocx } from './sources/fixtures/docx-builder.js';
import { importDocx } from '../src/modules/sourcedocs/import.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('importDocx', () => {
  it('maps headings, paragraphs, tables and images to sanitized HTML with asset srcs', async () => {
    const buf = await buildDocx({
      paragraphs: [
        { style: 'Heading1', runs: [{ t: 'נוהל SIM' }] },
        { runs: [{ t: 'פתח את ה-CRM' }] },
        { table: [['שדה', 'ערך'], ['APN', 'internet']] },
        { image: { png: PNG } },
      ],
    });
    const put = async () => ({ id: '11111111-1111-4111-8111-111111111111' });
    const { html } = await importDocx(buf, { putAsset: put });
    expect(html).toContain('<h1>נוהל SIM</h1>');
    expect(html).toContain('<p>פתח את ה-CRM</p>');
    expect(html).toContain('<table>');
    expect(html).toContain('<td>APN</td>');
    expect(html).toContain('<img src="/api/v1/assets/11111111-1111-4111-8111-111111111111"');
    expect(html).not.toContain('data:');
  });
  it('rejects a non-docx buffer', async () => {
    await expect(importDocx(Buffer.from('nope'), { putAsset: async () => ({ id: 'x' }) })).rejects.toMatchObject({ statusCode: 400, code: 'BAD_DOCX' });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/sourcedocs-import.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement assets repo and import**

`apps/api/src/modules/sourcedocs/assets.ts`:
```ts
import { createHash } from 'node:crypto';
import type pg from 'pg';
import { ASSET_MAX_BYTES, ASSET_MIMES, type Asset } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient | Tx;
export const assetUrl = (id: string) => '/api/v1/assets/' + id;

/** PNG/JPEG/GIF/WebP dimensions from the header; null when unrecognised (the exporter then uses a default box). */
export function imageSize(bytes: Buffer, mime: string): { width: number; height: number } | null {
  if (mime === 'image/png' && bytes.length > 24) return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  if (mime === 'image/gif' && bytes.length > 10) return { width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  if (mime === 'image/jpeg') {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) return null;
      const marker = bytes[i + 1];
      const len = bytes.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7) };
      i += 2 + len;
    }
  }
  if (mime === 'image/webp' && bytes.length > 30 && bytes.toString('ascii', 12, 16) === 'VP8 ')
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  return null;
}

const toAsset = (r: Record<string, unknown>): Asset => ({
  id: r.id as string,
  url: assetUrl(r.id as string),
  mime: r.mime as Asset['mime'],
  size: r.size as number,
  width: (r.width as number | null) ?? null,
  height: (r.height as number | null) ?? null,
});

export async function putAsset(q: Q, a: { bytes: Buffer; mime: string; createdBy: string | null }): Promise<Asset> {
  if (!(ASSET_MIMES as readonly string[]).includes(a.mime))
    throw httpError(415, 'UNSUPPORTED_ASSET', 'סוג קובץ לא נתמך: מותרים PNG, JPEG, GIF, WebP');
  if (a.bytes.length > ASSET_MAX_BYTES) throw httpError(413, 'ASSET_TOO_LARGE', 'הקובץ גדול מ-10MB');
  if (!a.bytes.length) throw httpError(400, 'EMPTY_ASSET', 'קובץ ריק');
  const sha = createHash('sha256').update(a.bytes).digest('hex');
  const existing = await q.query('select id, mime, size, width, height from assets where sha256=$1', [sha]);
  if (existing.rowCount) return toAsset(existing.rows[0]);
  const dim = imageSize(a.bytes, a.mime);
  const r = await q.query(
    `insert into assets(mime, bytes, sha256, size, width, height, created_by) values ($1,$2,$3,$4,$5,$6,$7)
     on conflict (sha256) do update set size=excluded.size returning id, mime, size, width, height`,
    [a.mime, a.bytes, sha, a.bytes.length, dim?.width ?? null, dim?.height ?? null, a.createdBy],
  );
  return toAsset(r.rows[0]);
}

export async function getAsset(q: Q, id: string): Promise<{ mime: string; bytes: Buffer; size: number; width: number | null; height: number | null } | null> {
  const r = await q.query('select mime, bytes, size, width, height from assets where id=$1', [id]);
  if (!r.rowCount) return null;
  const x = r.rows[0];
  return { mime: x.mime, bytes: x.bytes as Buffer, size: x.size, width: x.width ?? null, height: x.height ?? null };
}

/** Deletes assets that no source document version and no text-kind body references. */
export async function gcUnreferencedAssets(q: Q): Promise<number> {
  const r = await q.query(`
    delete from assets a
    where not exists (select 1 from source_document_versions v where v.html like '%' || a.id::text || '%')
      and not exists (select 1 from source_documents s where s.html like '%' || a.id::text || '%')
      and not exists (select 1 from documents d where d.body_html like '%' || a.id::text || '%')
      and a.created_at < now() - interval '1 day'`);
  return r.rowCount ?? 0;
}
```
If `documents.body_html` does not exist yet (W1 not merged), the third `not exists` must not break boot: guard it — build the SQL after `select 1 from information_schema.columns where table_name='documents' and column_name='body_html'` and include the clause only when the column exists.

`apps/api/src/modules/sourcedocs/import.ts`:
```ts
import mammoth from 'mammoth';
import { sanitizeHtml } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import { assetUrl } from './assets.js';

const STYLE_MAP = [
  "p[style-name='Heading 1'] => h1:fresh",
  "p[style-name='Heading 2'] => h2:fresh",
  "p[style-name='Heading 3'] => h3:fresh",
  "p[style-name='Heading 4'] => h4:fresh",
  "p[style-name='heading 1'] => h1:fresh",
  "p[style-name='heading 2'] => h2:fresh",
  "p[style-name='Quote'] => blockquote:fresh",
];

/**
 * Word → sanitized HTML for the source document. The suggestion pipeline keeps using
 * `modules/sources/docx.ts` (tracked changes, comments, refs); this path only feeds the editor.
 */
export async function importDocx(
  buffer: Buffer,
  deps: { putAsset: (bytes: Buffer, mime: string) => Promise<{ id: string }> },
): Promise<{ html: string; messages: string[] }> {
  if (buffer.length < 4 || buffer.toString('ascii', 0, 2) !== 'PK') throw httpError(400, 'BAD_DOCX', 'הקובץ אינו מסמך Word תקין');
  let result: { value: string; messages: { message: string }[] };
  try {
    result = await mammoth.convertToHtml(
      { buffer },
      {
        styleMap: STYLE_MAP,
        convertImage: mammoth.images.imgElement(async (img) => {
          const bytes = Buffer.from(await img.readAsArrayBuffer());
          try {
            const { id } = await deps.putAsset(bytes, img.contentType);
            return { src: assetUrl(id) };
          } catch {
            return { src: '' }; // unsupported type → sanitizer drops the <img>
          }
        }),
      },
    );
  } catch (e) {
    throw httpError(400, 'BAD_DOCX', 'לא ניתן לקרוא את מסמך ה-Word: ' + (e instanceof Error ? e.message : String(e)));
  }
  return { html: sanitizeHtml(result.value), messages: result.messages.map((m) => m.message) };
}
```
`docx-builder.ts` paragraphs use `w:pStyle w:val="Heading1"`; mammoth resolves style **names**, not ids, unless a `styles.xml` exists. Add to the builder a `word/styles.xml` mapping ids `Heading1..4` to names `heading 1..4` (mammoth's built-in map already handles those names), and reference it in `[Content_Types].xml`:
```ts
zip.file('word/styles.xml', `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${[1,2,3,4].map((n) => `<w:style w:type="paragraph" w:styleId="Heading${n}"><w:name w:val="heading ${n}"/></w:style>`).join('')}</w:styles>`);
```

- [ ] **Step 5: Run and verify pass**

Run: `pnpm install && cd apps/api && pnpm vitest run test/sourcedocs-import.test.ts test/sources/docx.test.ts test/sources/parsers.test.ts`
Expected: PASS (existing parser tests untouched by the builder additions).

- [ ] **Step 6: Commit**

```bash
git add apps/api/package.json pnpm-lock.yaml apps/api/src/modules/sourcedocs/assets.ts apps/api/src/modules/sourcedocs/import.ts apps/api/test/sourcedocs-import.test.ts apps/api/test/sources/fixtures/docx-builder.ts
git commit -m "feat(api): Word import for source documents (mammoth → sanitized HTML, images → assets)"
```

---

### Task 6: `sourcedocs` module — repo, ingest hook, routes, gc job, registration

**Files:**
- Create: `apps/api/src/modules/sourcedocs/repo.ts`, `apps/api/src/modules/sourcedocs/ingest.ts`, `apps/api/src/modules/sourcedocs/routes.ts`, `apps/api/src/modules/sourcedocs/jobs.ts`, `apps/api/src/modules/sourcedocs/index.ts`
- Modify: `apps/api/src/modules/index.ts` (one import + one list entry), `apps/api/src/modules/sources/index.ts` (expose `revisions` on the app: `app.decorate('revisions', revisions)` — one line, so the sourcedocs module reaches `SourceRevisionService` without touching `app.ts`), `packages/shared/src/schemas/wave4.ts` (append `SourceDraftSchema`, `PutSourceDraftBodySchema`)
- Test: `apps/api/test/sourcedocs.test.ts` (Task 9 fills it; this task creates it with the first three cases)

**Interfaces:**
- Produces (`repo.ts`):
```ts
export interface SourceDocRow { documentId: string; html: string; text: string; version: number; etag: string; updatedById: string | null; updatedByName: string | null; updatedAt: string }
export async function getSourceDocument(q, documentId): Promise<SourceDocRow | null>
export async function saveSourceDocument(tx, documentId, input: { html: string; label?: string; authorId: string | null; sourceRevisionId?: string | null; ifMatch?: string }): Promise<SourceDocRow>   // sanitizes, versions, rotates etag; 412 ETAG_MISMATCH; 404 when the document does not exist
export async function listSourceVersions(q, documentId): Promise<SourceDocumentVersion[]>
export async function getSourceVersion(q, documentId, version): Promise<SourceDocRow | null>
export async function currentSourceVersion(q, documentId): Promise<number | null>      // consumed by W2's publish route
```
- Produces (`ingest.ts`): `ingestSourceHtml(app, documentId, html, actorId): Promise<{ revisionId: string; duplicate: boolean; sourceId: string }>` — finds `documents.source_id`; if null creates a `sources` row `{ kind: 'text', title: document title, externalId: 'sourcedoc:' + documentId }` via `app.revisions.createSource` and sets `documents.source_id`; builds `SourceContent { title, paragraphs: htmlToParagraphs(html), raw: html, hash: contentHash(paragraphs) }`; calls `app.revisions.ingest(sourceId, content, actorId, Buffer.from(html))`.
- Produces (shared, appended to `wave4.ts`): `SourceDraftSchema = z.object({ html: z.string(), updatedAt: IsoDateSchema })`, `PutSourceDraftBodySchema = z.object({ html: z.string().max(2_000_000) })`.
- Consumes: `htmlToParagraphs`, `htmlToText`, `sanitizeHtml`, `htmlToDocx` from `@wecom/shared`; `contentHash` from `@wecom/connectors`; `getDraft(q, draftKey, userId)`, `putDraft(tx, documentId, draftKey, userId, payload)`, `deleteDraft(tx, draftKey, userId)` from `../drafts/repo.js` (read that file for `DraftRow`: it carries `payload` and `updatedAt`); `withTransaction`, `audit`, `httpError`, `notFound`, `requireUser`, `hasScope`; `app.revisions: SourceRevisionService` (decorated in this task); `app.events`; `QUEUES.assetsGc`.

- [ ] **Step 1: Write the first failing integration tests**

`apps/api/test/sourcedocs.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, type TestDb } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth, minimalStructure } from './helpers/fixtures.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;

run('source documents', () => {
  let db: TestDb;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let editor: Awaited<ReturnType<typeof makeUser>>;
  let reader: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.ready();
    editor = await makeUser(db.pool, { name: 'עורכת' });
    reader = await makeUser(db.pool, { name: 'נציג', perms: ['docs.read'] });
    const created = await app.inject({
      method: 'POST', url: '/api/v1/documents', headers: auth(editor),
      payload: { title: 'נוהל בדיקה', description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' },
    });
    docId = created.json().id;
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/structure`, headers: { ...auth(editor), 'if-match': created.json().etag }, payload: minimalStructure });
  }, 120000);
  afterAll(async () => { await app?.close(); await db?.stop(); });

  it('answers 204 before any source exists', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source`, headers: auth(reader) });
    expect(r.statusCode).toBe(204);
  });

  it('PUT sanitizes, versions, rotates the etag and ingests a revision', async () => {
    const r = await app.inject({
      method: 'PUT', url: `/api/v1/documents/${docId}/source`, headers: auth(editor),
      payload: { html: '<h2>שלב 1</h2><p onclick="x()">פתח CRM<script>1</script></p>', label: 'טיוטה ראשונה' },
    });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.html).toBe('<h2>שלב 1</h2><p>פתח CRM</p>');
    expect(body.text).toBe('שלב 1\nפתח CRM');
    expect(body.version).toBe(1);
    expect(r.headers.etag).toBe(body.etag);
    const src = await db.pool.query('select source_id from documents where id=$1', [docId]);
    expect(src.rows[0].source_id).toBeTruthy();
    const kind = await db.pool.query('select kind, external_id from sources where id=$1', [src.rows[0].source_id]);
    expect(kind.rows[0]).toEqual({ kind: 'text', external_id: 'sourcedoc:' + docId });
    const revs = await db.pool.query('select count(*)::int n from source_revisions where source_id=$1', [src.rows[0].source_id]);
    expect(revs.rows[0].n).toBe(1);
    const vers = await db.pool.query('select version, label from source_document_versions v join source_documents s on s.id=v.source_document_id where s.document_id=$1', [docId]);
    expect(vers.rows).toEqual([{ version: 1, label: 'טיוטה ראשונה' }]);
  });

  it('412 on a stale If-Match, 200 on the current one', async () => {
    const cur = (await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source`, headers: auth(editor) })).json();
    const stale = await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source`, headers: { ...auth(editor), 'if-match': 'nope' }, payload: { html: '<p>x</p>' } });
    expect(stale.statusCode).toBe(412);
    expect(stale.json().code).toBe('ETAG_MISMATCH');
    const ok = await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source`, headers: { ...auth(editor), 'if-match': cur.etag }, payload: { html: '<p>גרסה 2</p>' } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().version).toBe(2);
    const reader403 = await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source`, headers: auth(reader), payload: { html: '<p>x</p>' } });
    expect(reader403.statusCode).toBe(403);
  });

  it('source draft: 204 when none, PUT stores per user under source:<id>, DELETE clears, and a version save clears it', async () => {
    const none = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor) });
    expect(none.statusCode).toBe(204);
    const put = await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor), payload: { html: '<p>טיוטה</p>' } });
    expect(put.statusCode).toBe(204);
    const got = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor) });
    expect(got.statusCode).toBe(200);
    expect(got.json().html).toBe('<p>טיוטה</p>');
    expect(typeof got.json().updatedAt).toBe('string');
    const row = await db.pool.query('select document_id, draft_key from drafts where user_id=$1 and draft_key=$2', [editor.id, 'source:' + docId]);
    expect(row.rows[0]).toEqual({ document_id: docId, draft_key: 'source:' + docId });
    // the step editor's own draft for the same document is untouched
    const stepDraft = await db.pool.query('select count(*)::int n from drafts where user_id=$1 and draft_key=$2', [editor.id, docId]);
    expect(stepDraft.rows[0].n).toBe(0);
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(reader) })).statusCode).toBe(403);
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source`, headers: auth(editor), payload: { html: '<p>גרסה 3</p>' } });
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor) })).statusCode).toBe(204);
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor), payload: { html: '<p>x</p>' } });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor) })).statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/draft`, headers: auth(editor) })).statusCode).toBe(204);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sourcedocs.test.ts`
Expected: FAIL — GET `/source` returns 404 (route missing).

- [ ] **Step 3: Implement `repo.ts`**

```ts
import type pg from 'pg';
import { createHash } from 'node:crypto';
import { htmlToText, sanitizeHtml, type SourceDocumentVersion } from '@wecom/shared';
import { httpError } from '../../lib/http.js';
import type { Tx } from '../../lib/sql.js';

type Q = pg.Pool | pg.PoolClient | Tx;
export interface SourceDocRow {
  documentId: string; html: string; text: string; version: number; etag: string;
  updatedById: string | null; updatedByName: string | null; updatedAt: string;
}
const SELECT = `select s.document_id, s.html, s.text, s.current_version, s.etag, s.updated_by, u.display_name, s.updated_at
  from source_documents s left join users u on u.id=s.updated_by`;
const row = (r: Record<string, unknown>): SourceDocRow => ({
  documentId: r.document_id as string, html: r.html as string, text: r.text as string,
  version: r.current_version as number, etag: r.etag as string,
  updatedById: (r.updated_by as string) ?? null, updatedByName: (r.display_name as string) ?? null,
  updatedAt: (r.updated_at as Date).toISOString(),
});

export async function getSourceDocument(q: Q, documentId: string): Promise<SourceDocRow | null> {
  const r = await q.query(`${SELECT} where s.document_id=$1`, [documentId]);
  return r.rowCount ? row(r.rows[0]) : null;
}

export async function currentSourceVersion(q: Q, documentId: string): Promise<number | null> {
  const r = await q.query('select current_version from source_documents where document_id=$1', [documentId]);
  return r.rowCount ? (r.rows[0].current_version as number) : null;
}

/** Sanitize → upsert → version row → rotate etag. Caller owns the transaction, audit, ingest and event. */
export async function saveSourceDocument(
  tx: Tx, documentId: string,
  input: { html: string; label?: string; authorId: string | null; sourceRevisionId?: string | null; ifMatch?: string },
): Promise<SourceDocRow> {
  const doc = await tx.query('select id from documents where id=$1 and deleted_at is null', [documentId]);
  if (!doc.rowCount) throw httpError(404, 'NOT_FOUND', 'המסמך לא נמצא');
  const html = sanitizeHtml(input.html);
  const text = htmlToText(html);
  const hash = createHash('sha256').update(html, 'utf8').digest('hex');
  const cur = await tx.query('select id, etag, current_version from source_documents where document_id=$1 for update', [documentId]);
  if (cur.rowCount && input.ifMatch && input.ifMatch !== cur.rows[0].etag)
    throw httpError(412, 'ETAG_MISMATCH', 'מסמך המקור השתנה בינתיים — טען מחדש ונסה שוב');
  const version = (cur.rowCount ? (cur.rows[0].current_version as number) : 0) + 1;
  const up = cur.rowCount
    ? await tx.query(
        `update source_documents set html=$2, text=$3, hash=$4, current_version=$5, etag=gen_random_uuid()::text, updated_by=$6, updated_at=now()
         where document_id=$1 returning id`, [documentId, html, text, hash, version, input.authorId])
    : await tx.query(
        `insert into source_documents(document_id, html, text, hash, current_version, updated_by) values ($1,$2,$3,$4,$5,$6) returning id`,
        [documentId, html, text, hash, version, input.authorId]);
  await tx.query(
    `insert into source_document_versions(source_document_id, version, html, author_id, label, source_revision_id) values ($1,$2,$3,$4,$5,$6)`,
    [up.rows[0].id, version, html, input.authorId, input.label ?? '', input.sourceRevisionId ?? null]);
  return (await getSourceDocument(tx, documentId))!;
}

export async function listSourceVersions(q: Q, documentId: string): Promise<SourceDocumentVersion[]> {
  const r = await q.query(
    `select v.version, v.label, v.author_id, coalesce(u.display_name, 'מערכת') author_name, v.created_at, v.source_revision_id
     from source_document_versions v join source_documents s on s.id=v.source_document_id left join users u on u.id=v.author_id
     where s.document_id=$1 order by v.version desc`, [documentId]);
  return r.rows.map((x) => ({
    documentId, version: x.version as number, label: x.label as string, authorId: (x.author_id as string) ?? null,
    authorName: x.author_name as string, createdAt: (x.created_at as Date).toISOString(),
    sourceRevisionId: (x.source_revision_id as string) ?? null,
  }));
}

export async function getSourceVersion(q: Q, documentId: string, version: number): Promise<SourceDocRow | null> {
  const r = await q.query(
    `select s.document_id, v.html, v.author_id updated_by, u.display_name, v.created_at updated_at, v.version current_version, s.etag
     from source_document_versions v join source_documents s on s.id=v.source_document_id left join users u on u.id=v.author_id
     where s.document_id=$1 and v.version=$2`, [documentId, version]);
  if (!r.rowCount) return null;
  const x = r.rows[0];
  return { ...row({ ...x, text: htmlToText(x.html as string) }), version: x.current_version as number };
}
```

- [ ] **Step 4: Implement `ingest.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { htmlToParagraphs } from '@wecom/shared';
import { contentHash } from '@wecom/connectors';
import type { SourceRevisionService } from '../sources/revisions.js';

declare module 'fastify' {
  interface FastifyInstance { revisions: SourceRevisionService }
}

/**
 * Every source save enters the same pipeline as a Word upload or a WordPress pull:
 * a `source_revisions` row, `sources.sync_state = 'pending'`, a `pipeline.process` job.
 * Documents with no source yet get a `kind='text'` source owned by this document.
 */
export async function ingestSourceHtml(
  app: FastifyInstance, documentId: string, html: string, actorId: string | null,
): Promise<{ revisionId: string; duplicate: boolean; sourceId: string }> {
  const d = await app.db.query('select title, source_id from documents where id=$1 and deleted_at is null', [documentId]);
  if (!d.rowCount) throw Object.assign(new Error('document not found'), { statusCode: 404, code: 'NOT_FOUND' });
  let sourceId = d.rows[0].source_id as string | null;
  if (!sourceId) {
    sourceId = (await app.revisions.createSource({ kind: 'text', title: d.rows[0].title as string, externalId: 'sourcedoc:' + documentId }, actorId)).id;
    await app.db.query('update documents set source_id=$2 where id=$1 and source_id is null', [documentId, sourceId]);
  }
  const paragraphs = htmlToParagraphs(html);
  const r = await app.revisions.ingest(sourceId, { title: d.rows[0].title as string, paragraphs, raw: html, hash: contentHash(paragraphs) }, actorId, Buffer.from(html, 'utf8'));
  return { ...r, sourceId };
}
```
In `apps/api/src/modules/sources/index.ts`, after `const revisions = new SourceRevisionService(...)` add one line: `app.decorate('revisions', revisions);`. (`registerSourcesModule` is called on the `/api/v1` scope, and the sourcedocs routes are registered by `registerModules(v1)` on the same scope, so the decorator is visible — but `registerModules` runs **before** `registerSourcesModule` in `app.ts`. The sourcedocs routes therefore read `app.revisions` lazily inside handlers, never at registration time; Task 6 Step 5 shows this.)

- [ ] **Step 5: Implement `routes.ts`**

```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AssetSchema, IdSchema, PutSourceDocumentBodySchema, PutSourceDraftBodySchema, SourceDocumentSchema,
  SourceDocumentVersionsResponseSchema, SourceDraftSchema, htmlToDocx, makeEvent,
} from '@wecom/shared';
import { deleteDraft, getDraft, putDraft } from '../drafts/repo.js';
import { audit } from '../../lib/audit.js';
import { httpError, notFound } from '../../lib/http.js';
import { withTransaction } from '../../lib/sql.js';
import { requireUser } from '../../lib/user.js';
import * as repo from './repo.js';
import { getAsset, putAsset } from './assets.js';
import { importDocx } from './import.js';
import { ingestSourceHtml } from './ingest.js';

const Params = z.object({ id: IdSchema });
const VersionParams = z.object({ id: IdSchema, v: z.coerce.number().int().positive() });
const AssetParams = z.object({ id: IdSchema });
const RevParams = z.object({ id: IdSchema, rev: IdSchema });
const sourceDraftKey = (documentId: string) => 'source:' + documentId;

export default async function routes(app: FastifyInstance) {
  /** Shared by PUT, import and restore: save + audit + ingest + event, one transaction for the DB part. */
  async function saveAndIngest(req: Parameters<typeof requireUser>[0], documentId: string, html: string, label: string | undefined, action: string, ifMatch?: string) {
    const user = requireUser(req);
    const before = await repo.getSourceDocument(app.db, documentId);
    const saved = await withTransaction(app.db, async (tx) => {
      const s = await repo.saveSourceDocument(tx, documentId, { html, label, authorId: user.id, ifMatch });
      await audit(tx, { actorId: user.id, action, entityType: 'source_document', entityId: documentId,
        before: before ? { version: before.version } : null, after: { version: s.version, label: label ?? '' }, requestId: req.id, ip: req.ip });
      await app.events.publish(tx, makeEvent('source_document.saved', { documentId, version: s.version, actorId: user.id }));
      await deleteDraft(tx, sourceDraftKey(documentId), user.id); // a saved version supersedes this user's autosave
      return s;
    });
    // Outside the transaction: ingest has its own transaction and enqueues a job.
    const ing = await ingestSourceHtml(app, documentId, saved.html, user.id);
    if (!ing.duplicate)
      await app.db.query(`update source_document_versions v set source_revision_id=$3 from source_documents s
        where v.source_document_id=s.id and s.document_id=$1 and v.version=$2`, [documentId, saved.version, ing.revisionId]);
    return saved;
  }

  app.get('/documents/:id/source', {
    config: { requires: ['docs.read'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params, response: { 200: SourceDocumentSchema, 204: z.null() } },
  }, async (req, reply) => {
    requireUser(req);
    const s = await repo.getSourceDocument(app.db, (req.params as { id: string }).id);
    if (!s) return reply.code(204).send(null);
    reply.header('etag', s.etag);
    return s;
  });

  app.put('/documents/:id/source', {
    config: { requires: ['docs.edit'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params, body: PutSourceDocumentBodySchema, response: { 200: SourceDocumentSchema } },
  }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const body = req.body as z.infer<typeof PutSourceDocumentBodySchema>;
    const ifMatch = typeof req.headers['if-match'] === 'string' ? req.headers['if-match'] : undefined;
    const s = await saveAndIngest(req, id, body.html, body.label, 'sourcedocs.save', ifMatch);
    reply.header('etag', s.etag);
    return s;
  });

  /* ── source autosave (W4-owned contract addition) ─────────────────────── */
  app.get('/documents/:id/source/draft', {
    config: { requires: ['docs.edit'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params, response: { 200: SourceDraftSchema, 204: z.null() } },
  }, async (req, reply) => {
    const user = requireUser(req);
    const d = await getDraft(app.db, sourceDraftKey((req.params as { id: string }).id), user.id);
    if (!d) return reply.code(204).send(null);
    return { html: String((d.payload as { html?: unknown }).html ?? ''), updatedAt: d.updatedAt };
  });

  app.put('/documents/:id/source/draft', {
    config: { requires: ['docs.edit'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params, body: PutSourceDraftBodySchema },
  }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = req.body as z.infer<typeof PutSourceDraftBodySchema>;
    if (!(await app.db.query('select 1 from documents where id=$1 and deleted_at is null', [id])).rowCount) throw notFound('המסמך');
    await withTransaction(app.db, (tx) => putDraft(tx, id, sourceDraftKey(id), user.id, { html: body.html }));
    reply.code(204);
    return null;
  });

  app.delete('/documents/:id/source/draft', {
    config: { requires: ['docs.edit'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params },
  }, async (req, reply) => {
    const user = requireUser(req);
    await withTransaction(app.db, (tx) => deleteDraft(tx, sourceDraftKey((req.params as { id: string }).id), user.id));
    reply.code(204);
    return null;
  });

  app.get('/documents/:id/source/versions', {
    config: { requires: ['docs.read'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params, response: { 200: SourceDocumentVersionsResponseSchema } },
  }, async (req) => {
    requireUser(req);
    return { items: await repo.listSourceVersions(app.db, (req.params as { id: string }).id) };
  });

  app.get('/documents/:id/source/versions/:v', {
    config: { requires: ['docs.read'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: VersionParams, response: { 200: SourceDocumentSchema } },
  }, async (req) => {
    requireUser(req);
    const { id, v } = req.params as { id: string; v: number };
    const s = await repo.getSourceVersion(app.db, id, v);
    if (!s) throw notFound('גרסת המקור');
    return s;
  });

  app.post('/documents/:id/source/restore/:v', {
    config: { requires: ['docs.edit'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: VersionParams, response: { 200: SourceDocumentSchema } },
  }, async (req, reply) => {
    const { id, v } = req.params as { id: string; v: number };
    const old = await repo.getSourceVersion(app.db, id, v);
    if (!old) throw notFound('גרסת המקור');
    const s = await saveAndIngest(req, id, old.html, `שוחזר מגרסה ${v}`, 'sourcedocs.restore');
    reply.header('etag', s.etag);
    return s;
  });

  app.post('/documents/:id/source/import', {
    config: { requires: ['docs.edit'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params, response: { 200: SourceDocumentSchema } },
  }, async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    let file: { filename: string; buffer: Buffer } | null = null;
    for await (const part of req.parts()) if (part.type === 'file') file = { filename: part.filename, buffer: await part.toBuffer() };
    if (!file) throw httpError(400, 'NO_FILE', 'חסר קובץ');
    if (!/\.docx$/i.test(file.filename)) throw httpError(400, 'BAD_DOCX', 'יש להעלות קובץ .docx');
    const { html } = await importDocx(file.buffer, {
      putAsset: async (bytes, mime) => putAsset(app.db, { bytes, mime, createdBy: user.id }),
    });
    const s = await saveAndIngest(req, id, html, 'יובא מ-Word: ' + file.filename, 'sourcedocs.import');
    reply.header('etag', s.etag);
    return s;
  });

  app.get('/documents/:id/source/export.docx', {
    config: { requires: ['docs.read'], scope: 'document' },
    schema: { tags: ['sourcedocs'], params: Params },
  }, async (req, reply) => {
    requireUser(req);
    const { id } = req.params as { id: string };
    const s = await repo.getSourceDocument(app.db, id);
    if (!s) throw notFound('מסמך המקור');
    const title = (await app.db.query('select title from documents where id=$1', [id])).rows[0]?.title as string;
    const bytes = await htmlToDocx(s.html, {
      title,
      resolveAsset: async (assetId) => {
        const a = await getAsset(app.db, assetId);
        return a ? { bytes: new Uint8Array(a.bytes), mime: a.mime, width: a.width ?? undefined, height: a.height ?? undefined } : null;
      },
    });
    reply
      .header('content-type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('content-disposition', `attachment; filename="source.docx"; filename*=UTF-8''${encodeURIComponent(title)}.docx`)
      .header('cache-control', 'no-store');
    return reply.send(Buffer.from(bytes));
  });

  app.get('/sources/:id/revisions/:rev/raw', {
    config: { requires: ['docs.read'] },
    schema: { tags: ['sourcedocs'], params: RevParams },
  }, async (req, reply) => {
    requireUser(req);
    const { id, rev } = req.params as { id: string; rev: string };
    const r = await app.db.query(
      `select r.raw, s.ext, s.kind, s.title from source_revisions r join sources s on s.id=r.source_id where r.source_id=$1 and r.id=$2`, [id, rev]);
    if (!r.rowCount || !r.rows[0].raw) throw notFound('קובץ המקור');
    const ext = (r.rows[0].ext as string | null) ?? (r.rows[0].kind === 'docx' ? '.docx' : '.html');
    const type = ext === '.docx' ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : 'text/html; charset=utf-8';
    reply.header('content-type', type)
      .header('content-disposition', `attachment; filename="source${ext}"; filename*=UTF-8''${encodeURIComponent(r.rows[0].title as string)}${ext}`);
    return reply.send(r.rows[0].raw as Buffer);
  });

  app.post('/assets', {
    config: { requires: ['docs.edit'] },
    schema: { tags: ['sourcedocs'], response: { 200: AssetSchema } },
  }, async (req) => {
    const user = requireUser(req);
    let file: { mime: string; buffer: Buffer } | null = null;
    for await (const part of req.parts()) if (part.type === 'file') file = { mime: part.mimetype, buffer: await part.toBuffer() };
    if (!file) throw httpError(400, 'NO_FILE', 'חסר קובץ');
    return putAsset(app.db, { bytes: file.buffer, mime: file.mime, createdBy: user.id });
  });

  app.get('/assets/:id', {
    config: { requires: ['docs.read'] },
    schema: { tags: ['sourcedocs'], params: AssetParams },
  }, async (req, reply) => {
    requireUser(req);
    const a = await getAsset(app.db, (req.params as { id: string }).id);
    if (!a) throw notFound('הקובץ');
    reply.header('content-type', a.mime).header('content-length', String(a.size))
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff');
    return reply.send(a.bytes);
  });
}
```
`DraftRow.updatedAt`: if `getDraft` returns a `Date` rather than an ISO string, call `.toISOString()`; if `putDraft` expects the payload already stringified, follow the drafts repo — the goal is one `drafts` row `(user_id, 'source:<id>')` with `document_id = <id>`.

Append to `packages/shared/src/schemas/wave4.ts` (additive):
```ts
/* ── Source autosave (W4 contract addition) ────────────────────────────── */
export const SourceDraftSchema = z.object({ html: z.string(), updatedAt: IsoDateSchema });
export const PutSourceDraftBodySchema = z.object({ html: z.string().max(2_000_000) });
```
Multipart: `@fastify/multipart` is registered on the `/api/v1` scope in `app.ts` **after** `registerModules`, but plugins registered on the same scope are available to all routes of that scope once the scope is ready (`req.parts()` resolves at request time), exactly as `/sources/upload` relies on today. If the integration test shows `req.parts is not a function`, register `multipart` inside `sourcedocs/index.ts` with `fastify-plugin` semantics disabled (encapsulated), which is additive and safe.

- [ ] **Step 6: Implement `jobs.ts` and `index.ts`; register the module**

`jobs.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { QUEUES } from '../../plugins/boss.js';
import { gcUnreferencedAssets } from './assets.js';

/** Weekly: drop image assets no source version or text body references (kept ≥1 day so in-flight edits survive). */
export async function startSourcedocsJobs(app: FastifyInstance): Promise<void> {
  const boss = app.boss;
  if (!boss || app.config.NODE_ENV === 'test') return;
  await boss.work(QUEUES.assetsGc, async () => {
    const n = await gcUnreferencedAssets(app.db);
    app.log.info({ n }, 'assets gc');
  });
  try {
    await boss.schedule(QUEUES.assetsGc, '0 4 * * 0', {}, { tz: 'Asia/Jerusalem' });
  } catch (err) {
    app.log.warn({ err }, 'could not schedule assets.gc');
  }
}
```
`index.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import routes from './routes.js';
import { startSourcedocsJobs } from './jobs.js';

export default async function sourcedocs(app: FastifyInstance) {
  await app.register(routes);
  app.addHook('onReady', async () => { await startSourcedocsJobs(app); });
}
```
`apps/api/src/modules/index.ts` — add `import sourcedocs from './sourcedocs/index.js';` and append `sourcedocs` to the module list (one entry at the end).

- [ ] **Step 7: Run the integration tests and the OpenAPI contract**

Run: `pnpm --filter @wecom/shared build && cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sourcedocs.test.ts test/int/wiring.test.ts && pnpm openapi && cd ../.. && git diff --stat docs/api/openapi.json`
Expected: 4 tests PASS; the OpenAPI file gains the W4 routes (including the three `/source/draft` routes) only.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/schemas/wave4.ts apps/api/src/modules/sourcedocs apps/api/src/modules/index.ts apps/api/src/modules/sources/index.ts apps/api/test/sourcedocs.test.ts docs/api/openapi.json
git commit -m "feat(api): sourcedocs module — versioned HTML source documents, assets, import/export, ingest on save"
```

---

### Task 7: WordPress — push the source HTML (with media upload), pull inbound HTML as a source version

**Files:**
- Modify: `packages/connectors/src/contract.ts` (`LibraryContent.assets?: AssetBytesResolver`), `packages/connectors/src/wordpress/client.ts` (`uploadMedia`), `packages/connectors/src/wordpress/connector.ts` (`push` rewrites asset srcs), `packages/connectors/test/helpers/wpStub.ts` (media endpoint), `packages/connectors/test/wordpress-connector.test.ts`
- Modify: `apps/api/src/modules/connectors/sync.ts` (`DocumentsService` gains `getSourceHtml`, `putSourceFromRemote`; `pushLink`/`pushDocument` pass html + assets; `reconcile` writes inbound HTML), `apps/api/src/modules/connectors/documents-adapter.ts`, `apps/api/test/connectors-sync.test.ts`

**Interfaces:**
- Produces (connectors): `WpClient.uploadMedia(bytes: Uint8Array, mime: string, filename: string): Promise<{ id: number; source_url: string }>`; `LibraryContent.assets?: AssetBytesResolver` (type from `@wecom/shared`).
- Produces (api `DocumentsService`, additive): `getSourceHtml(documentId): Promise<string | null>`; `putSourceFromRemote(documentId, html, label): Promise<void>` (saves a source version with `authorId null` without triggering a second ingest — the connector path already ingests the revision).
- Existing tests fake `DocumentsService`; add the two methods to the fakes with `vi.fn()`.

- [ ] **Step 1: Failing connector test (push uses html and uploads media)**

Append to `packages/connectors/test/wordpress-connector.test.ts`:
```ts
  it('pushes source html, uploading asset images to wp/v2/media and rewriting src', async () => {
    const c = new WordPressConnector();
    const A = '11111111-1111-4111-8111-111111111111';
    const png = Uint8Array.from([137, 80, 78, 71]);
    const ref = await c.push(cfg(), 'posts:7', {
      document: docFixture() as Document,
      blocks: [] as Block[],
      html: `<h2>מקור</h2><p><img src="/api/v1/assets/${A}" alt="x"></p>`,
      assets: async (id) => (id === A ? { bytes: png, mime: 'image/png' } : null),
    });
    const put = stub.puts.find((p) => p.type === 'posts' && p.id === 7)!;
    expect((put.body as { content: string }).content).toContain('<h2>מקור</h2>');
    expect((put.body as { content: string }).content).toContain('http://wp/media/');
    expect((put.body as { content: string }).content).not.toContain('/api/v1/assets/');
    expect(stub.media.length).toBe(1);
    expect(stub.media[0].mime).toBe('image/png');
    expect(ref.externalId).toBe('posts:7');
  });
```
Extend `wpStub.ts`: add `media: { mime: string; size: number }[]` to `WpStub`; handle `POST /wp-json/wp/v2/media` (before the `m` regex check, since the path has no numeric id) by reading the raw body length and `content-type`, pushing `{ mime, size }`, and answering `201 { id: 500 + media.length, source_url: 'http://wp/media/' + (500 + media.length) + '.png' }`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/connectors test -- wordpress-connector`
Expected: FAIL — `stub.media` undefined / TypeScript error on `assets`.

- [ ] **Step 3: Implement in connectors**

`contract.ts` — import `type { AssetBytesResolver } from '@wecom/shared'` and add `assets?: AssetBytesResolver;` to `LibraryContent`.

`client.ts` — add:
```ts
  /** Uploads one binary to the media library; WordPress wants raw bytes + Content-Disposition, not JSON. */
  async uploadMedia(bytes: Uint8Array, mime: string, filename: string): Promise<{ id: number; source_url: string }> {
    const res = await this.fetchImpl(this.cfg.baseUrl + '/wp-json/wp/v2/media', {
      method: 'POST',
      headers: {
        authorization: this.headers().authorization,
        'content-type': mime,
        'content-disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`,
      },
      body: bytes,
    });
    if (!res.ok) throw new WpError(res.status, `WordPress POST media → ${res.status}`);
    return (await res.json()) as { id: number; source_url: string };
  }
```
`connector.ts` — replace the first line of `push` with:
```ts
    const client = this.client(cfg);
    let html = content.html && content.html.trim() ? content.html : renderWpHtml(content);
    if (content.assets) html = await this.rewriteAssets(client, html, content.assets);
```
(remove the later duplicate `const client = this.client(cfg);`) and add the method:
```ts
  private static ASSET_IMG = /<img([^>]*?)\ssrc="\/api\/v1\/assets\/([0-9a-f-]{36})"([^>]*)>/g;
  /** Every KB asset image becomes a WordPress media item; unknown assets are dropped rather than left broken. */
  private async rewriteAssets(client: WpClient, html: string, resolve: NonNullable<LibraryContent['assets']>): Promise<string> {
    const uploaded = new Map<string, string>();
    const ids = [...html.matchAll(WordPressConnector.ASSET_IMG)].map((m) => m[2]);
    for (const id of new Set(ids)) {
      const a = await resolve(id);
      if (!a) continue;
      const ext = a.mime === 'image/png' ? 'png' : a.mime === 'image/gif' ? 'gif' : a.mime === 'image/webp' ? 'webp' : 'jpg';
      const m = await client.uploadMedia(a.bytes, a.mime, `${id}.${ext}`);
      uploaded.set(id, m.source_url);
    }
    return html.replace(WordPressConnector.ASSET_IMG, (_all, pre: string, id: string, post: string) =>
      uploaded.has(id) ? `<img${pre} src="${uploaded.get(id)}"${post}>` : '');
  }
```

- [ ] **Step 4: Run connectors tests**

Run: `pnpm --filter @wecom/shared build && pnpm --filter @wecom/connectors test`
Expected: PASS.

- [ ] **Step 5: Failing API sync tests**

In `apps/api/test/connectors-sync.test.ts`, extend the fake `documents` service inside `setup()` with:
```ts
    getSourceHtml: vi.fn(async () => '<h2>מקור</h2><p>מהמערכת</p>'),
    putSourceFromRemote: vi.fn(async () => undefined),
```
and add two tests next to the existing reconcile cases (reuse `setup()`; look at how the existing "remote changed, local unchanged" case builds `svc` and `deps`):
```ts
  it('remote changed → ingests and writes the remote html as a source version', async () => {
    const { svc, deps } = setup({}, 'h1', 1);
    await svc.runConnector(C, null);
    expect(deps.revisions.ingest).toHaveBeenCalledTimes(1);
    expect(deps.documents.putSourceFromRemote).toHaveBeenCalledWith(D, expect.stringContaining('<p>'), 'מוורדפרס');
  });
  it('local changed → pushes the source html when present', async () => {
    const { svc, deps, connector } = setup({}, 'h0', 2);
    await svc.runConnector(C, null);
    expect(connector.push).toHaveBeenCalledWith(expect.anything(), 'posts:7', expect.objectContaining({ html: '<h2>מקור</h2><p>מהמערכת</p>' }));
  });
```
The connector fake's `fetch` must return `raw: '<h2>שלב</h2><p>x</p>'` in its `SourceContent` for the first test; add it where `fetch: vi.fn(async () => ({ title: 'מסמך', …` is defined. If `setup()` does not currently return `deps`/`connector`, make it return them (test-only change).

- [ ] **Step 6: Run to verify failure**

Run: `cd apps/api && pnpm vitest run test/connectors-sync.test.ts`
Expected: FAIL — `putSourceFromRemote` not called; `html: ''` pushed.

- [ ] **Step 7: Implement in the API**

`sync.ts` — extend `DocumentsService`:
```ts
  /** W4: the item's canonical HTML source, or null when it has none (fall back to the step render). */
  getSourceHtml(documentId: string): Promise<string | null>;
  /** W4: record an inbound remote body as a new source version (author null). Does not ingest — the caller already did. */
  putSourceFromRemote(documentId: string, html: string, label: string): Promise<void>;
```
In `reconcile`, the `remoteChanged && !localChanged` branch becomes:
```ts
    if (remoteChanged && !localChanged) {
      const content = await conn.fetch(cfg, r!.externalId);
      if (link.source_id) await this.d.revisions.ingest(link.source_id, content, actorId);
      if (content.raw) await this.d.documents.putSourceFromRemote(doc.id, content.raw, 'מוורדפרס');
      await this.d.repo.setLinkState(link.id, 'pending_import');
      result.imported++;
      return;
    }
```
Apply the same one-liner (`if (content.raw) await this.d.documents.putSourceFromRemote(doc.id, content.raw, 'מוורדפרס');`) in `resolveConflict`'s `'theirs'` branch after its `ingest` call. In `pushLink` and `pushDocument`, replace `{ document: doc, html: '', blocks }` with:
```ts
    const html = (await this.d.documents.getSourceHtml(doc.id)) ?? '';
    const ref = await conn.push(cfg, <externalId as today>, { document: doc, html, blocks, assets: this.d.assets });
```
and add `assets?: AssetBytesResolver` to `SyncDeps` (imported from `@wecom/shared`).

`documents-adapter.ts` — add to the returned object:
```ts
    getSourceHtml: async (id) => (await getSourceDocument(pool, id))?.html ?? null,
    putSourceFromRemote: (id, html, label) =>
      withTransaction(pool, async (tx) => { await saveSourceDocument(tx, id, { html, label, authorId: null }); }),
```
importing `getSourceDocument, saveSourceDocument` from `'../sourcedocs/repo.js'`. In `apps/api/src/modules/connectors/index.ts` (owned by L6/wave 3 — **additive only**): when constructing `SyncService`, pass
```ts
    assets: async (assetId) => {
      const a = await getAsset(app.db, assetId);
      return a ? { bytes: new Uint8Array(a.bytes), mime: a.mime, width: a.width ?? undefined, height: a.height ?? undefined } : null;
    },
```
importing `getAsset` from `'../sourcedocs/assets.js'`. This is one added property in an existing object literal; if wave 3 has restructured that file by merge time, W6 re-applies it.

- [ ] **Step 8: Run tests**

Run: `cd apps/api && pnpm vitest run test/connectors-sync.test.ts && RUN_INTEGRATION=1 pnpm vitest run test/connectors-sync.int.test.ts test/connectors-routes.test.ts`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/connectors apps/api/src/modules/connectors apps/api/test/connectors-sync.test.ts
git commit -m "feat(sync): WordPress pushes the HTML source with media upload; inbound edits become source versions"
```

---

### Task 8: Web — hooks, preferences field, MSW handlers, jsdom polyfills

**Files:**
- Modify: `apps/web/package.json`, `packages/shared/src/schemas/identity.ts` (one field), `apps/web/src/lib/prefs.ts`, `apps/web/src/api/keys.ts`, `apps/web/test/setup.ts`, `apps/web/test/msw/handlers.ts`, `apps/web/test/msw/fixtures.ts`
- Create: `apps/web/src/api/hooks/sourcedocs.ts`, `apps/web/test/api/sourcedocs-hooks.test.tsx`

**Interfaces:**
- Produces: `keys.source(id)`, `keys.sourceVersions(id)`, `keys.sourceVersion(id, v)`, `keys.sourceDraft(id)`; hooks `useSourceDocument(id)`, `useSaveSource(id)`, `useSourceVersions(id)`, `useSourceVersion(id, v)`, `useRestoreSource(id)`, `useImportDocx(id)`, `exportDocxUrl(id)`, `useUploadAsset()`, `useSourceDraft(id)`, `useSaveSourceDraft(id)`, `useDeleteSourceDraft(id)`; `Preferences.paneMode: 'work' | 'source' | 'split'` (default `'work'`).
- Draft storage: the dedicated W4 routes `GET|PUT|DELETE /documents/:id/source/draft` (Task 6). The step editor's `PUT /documents/:id/draft` is untouched.

- [ ] **Step 1: Dependencies and preference field**

`apps/web/package.json` dependencies add:
```json
    "@tiptap/react": "3.31.3",
    "@tiptap/starter-kit": "3.31.3",
    "@tiptap/extension-table": "3.31.3",
    "@tiptap/extension-table-row": "3.31.3",
    "@tiptap/extension-table-cell": "3.31.3",
    "@tiptap/extension-table-header": "3.31.3",
    "@tiptap/extension-image": "3.31.3",
    "@tiptap/extension-link": "3.31.3",
    "@tiptap/extension-underline": "3.31.3",
    "@tiptap/extension-text-align": "3.31.3"
```
`packages/shared/src/schemas/identity.ts` — add to `PreferencesSchema` (additive, defaulted):
```ts
  paneMode: z.enum(['work', 'source', 'split']).default('work'),
```
`apps/web/src/lib/prefs.ts` — add `paneMode: 'work'` to `DEFAULT_PREFERENCES`.
Run: `pnpm install && pnpm --filter @wecom/shared build && pnpm --filter @wecom/shared test -- api identity`
Expected: green (`PreferencesPutSchema = PreferencesSchema.partial()` picks the field up).

- [ ] **Step 2: Query keys**

Append inside `keys` in `apps/web/src/api/keys.ts` (before `admin`):
```ts
  source: (id: string) => ['source', id] as const,
  sourceVersions: (id: string) => ['sourceVersions', id] as const,
  sourceVersion: (id: string, v: number) => ['sourceVersion', id, v] as const,
  sourceDraft: (id: string) => ['sourceDraft', id] as const,
```

- [ ] **Step 3: Failing hooks test**

`apps/web/test/api/sourcedocs-hooks.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useSourceDocument, useSaveSource, useSourceVersions, useUploadAsset } from '../../src/api/hooks/sourcedocs.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';
import { ApiError } from '../../src/api/unwrap.js';

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

describe('sourcedocs hooks', () => {
  it('returns null for a document with no source (204)', async () => {
    const { result } = renderHook(() => useSourceDocument(fx.docBrowsing.id), { wrapper: wrap() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
  it('saves with the current etag and refreshes versions', async () => {
    const w = wrap();
    const save = renderHook(() => useSaveSource(fx.docBrowsing.id), { wrapper: w });
    await act(async () => { await save.result.current.mutateAsync({ html: '<p>x</p>', label: 'v1' }); });
    expect(state.sourceDocs.get(fx.docBrowsing.id)?.version).toBe(1);
    const vers = renderHook(() => useSourceVersions(fx.docBrowsing.id), { wrapper: w });
    await waitFor(() => expect(vers.result.current.data?.length).toBe(1));
  });
  it('surfaces 412 as ApiError ETAG_MISMATCH', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, { html: '<p>a</p>', text: 'a', version: 1, etag: 'e1', versions: [] });
    const save = renderHook(() => useSaveSource(fx.docBrowsing.id), { wrapper: wrap() });
    await expect(save.result.current.mutateAsync({ html: '<p>b</p>', etag: 'stale' })).rejects.toMatchObject({ status: 412, code: 'ETAG_MISMATCH' });
    expect(new ApiError(412, 'ETAG_MISMATCH', 'x').code).toBe('ETAG_MISMATCH');
  });
  it('uploads an asset and returns its url', async () => {
    const up = renderHook(() => useUploadAsset(), { wrapper: wrap() });
    const a = await up.result.current.mutateAsync(new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    expect(a.url).toMatch(/^\/api\/v1\/assets\//);
  });
});
```

- [ ] **Step 4: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- sourcedocs-hooks`
Expected: FAIL — module `hooks/sourcedocs` not found.

- [ ] **Step 5: MSW handlers and state**

In `apps/web/test/msw/handlers.ts` add to `State`:
```ts
  sourceDocs: Map<string, { html: string; text: string; version: number; etag: string; versions: { version: number; label: string; html: string }[] }>;
  assets: string[];
  sourceDrafts: Map<string, { html: string; updatedAt: string }>;
```
initialise them in `initial()` (`new Map()`, `[]`, `new Map()`), and add handlers (paths under `B`):
```ts
  http.get(`${B}/documents/:id/source`, ({ params }) => {
    const s = state.sourceDocs.get(String(params.id));
    if (!s) return new HttpResponse(null, { status: 204 });
    return HttpResponse.json({ documentId: params.id, html: s.html, text: s.text, version: s.version, etag: s.etag, updatedById: fx.me.user.id, updatedByName: fx.me.user.displayName, updatedAt: '2026-09-14T10:00:00.000Z' }, { headers: { etag: s.etag } });
  }),
  http.put(`${B}/documents/:id/source`, async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as { html: string; label?: string };
    const cur = state.sourceDocs.get(id);
    const ifMatch = request.headers.get('if-match');
    if (cur && ifMatch && ifMatch !== cur.etag) return HttpResponse.json({ code: 'ETAG_MISMATCH', message: 'stale' }, { status: 412 });
    const version = (cur?.version ?? 0) + 1;
    const next = { html: body.html, text: body.html.replace(/<[^>]+>/g, ''), version, etag: 'e' + version, versions: [...(cur?.versions ?? []), { version, label: body.label ?? '', html: body.html }] };
    state.sourceDocs.set(id, next);
    state.sourceDrafts.delete(id); // a saved version clears the autosave
    return HttpResponse.json({ documentId: id, html: next.html, text: next.text, version, etag: next.etag, updatedById: fx.me.user.id, updatedByName: fx.me.user.displayName, updatedAt: '2026-09-14T10:00:00.000Z' }, { headers: { etag: next.etag } });
  }),
  http.get(`${B}/documents/:id/source/versions`, ({ params }) => HttpResponse.json({ items: (state.sourceDocs.get(String(params.id))?.versions ?? []).map((v) => ({ documentId: params.id, version: v.version, label: v.label, authorId: fx.me.user.id, authorName: fx.me.user.displayName, createdAt: '2026-09-14T10:00:00.000Z', sourceRevisionId: null })).reverse() })),
  http.get(`${B}/documents/:id/source/versions/:v`, ({ params }) => {
    const v = state.sourceDocs.get(String(params.id))?.versions.find((x) => x.version === Number(params.v));
    if (!v) return HttpResponse.json({ code: 'NOT_FOUND', message: 'x' }, { status: 404 });
    return HttpResponse.json({ documentId: params.id, html: v.html, text: v.html.replace(/<[^>]+>/g, ''), version: v.version, etag: 'e' + v.version, updatedById: null, updatedByName: null, updatedAt: '2026-09-14T10:00:00.000Z' });
  }),
  http.post(`${B}/assets`, () => { const id = crypto.randomUUID(); state.assets.push(id); return HttpResponse.json({ id, url: '/api/v1/assets/' + id, mime: 'image/png', size: 3, width: null, height: null }); }),
  http.get(`${B}/documents/:id/source/draft`, ({ params }) => { const d = state.sourceDrafts.get(String(params.id)); return d ? HttpResponse.json(d) : new HttpResponse(null, { status: 204 }); }),
  http.put(`${B}/documents/:id/source/draft`, async ({ params, request }) => { const b = (await request.json()) as { html: string }; state.sourceDrafts.set(String(params.id), { html: b.html, updatedAt: new Date().toISOString() }); return new HttpResponse(null, { status: 204 }); }),
  http.delete(`${B}/documents/:id/source/draft`, ({ params }) => { state.sourceDrafts.delete(String(params.id)); return new HttpResponse(null, { status: 204 }); }),
```
Add to `apps/web/test/msw/fixtures.test.ts` a parse of the source GET/PUT responses against `SourceDocumentSchema` and the versions response against `SourceDocumentVersionsResponseSchema`, following the file's existing pattern.

- [ ] **Step 6: Implement the hooks**

`apps/web/src/api/hooks/sourcedocs.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Asset, SourceDocument, SourceDocumentVersion } from '@wecom/shared';
import { api, apiUpload, API_BASE } from '../client.js';
import { keys } from '../keys.js';
import { unwrap, unwrapMaybe } from '../unwrap.js';

export const useSourceDocument = (id: string | undefined) =>
  useQuery({
    queryKey: keys.source(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrapMaybe<SourceDocument>(await api.GET('/documents/{id}/source', { params: { path: { id: id! } } })),
  });

/** `etag` is the value from the last GET/PUT; the server answers 412 when it is stale. */
export const useSaveSource = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: { html: string; label?: string; etag?: string }) =>
      unwrap<SourceDocument>(
        await api.PUT('/documents/{id}/source', {
          params: { path: { id } },
          headers: v.etag ? { 'if-match': v.etag } : undefined,
          body: { html: v.html, ...(v.label ? { label: v.label } : {}) },
        }),
      ),
    onSuccess: (data) => {
      qc.setQueryData(keys.source(id), data);
      qc.removeQueries({ queryKey: keys.sourceDraft(id) }); // the server deleted the autosave row
      void qc.invalidateQueries({ queryKey: keys.sourceVersions(id) });
      void qc.invalidateQueries({ queryKey: keys.doc(id) }); // W2's sourceReviewNeeded flag
    },
  });
};

export const useSourceVersions = (id: string | undefined) =>
  useQuery({
    queryKey: keys.sourceVersions(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrap<{ items: SourceDocumentVersion[] }>(await api.GET('/documents/{id}/source/versions', { params: { path: { id: id! } } })).items,
  });

export const useSourceVersion = (id: string | undefined, v: number | undefined) =>
  useQuery({
    queryKey: keys.sourceVersion(id ?? '', v ?? -1),
    enabled: !!id && v != null,
    queryFn: async () => unwrap<SourceDocument>(await api.GET('/documents/{id}/source/versions/{v}', { params: { path: { id: id!, v: v! } } })),
  });

export const useRestoreSource = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: number) => unwrap<SourceDocument>(await api.POST('/documents/{id}/source/restore/{v}', { params: { path: { id, v } } })),
    onSuccess: (data) => { qc.setQueryData(keys.source(id), data); void qc.invalidateQueries({ queryKey: keys.sourceVersions(id) }); },
  });
};

export const useImportDocx = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return unwrap(await apiUpload<SourceDocument>(`/documents/${id}/source/import`, form));
    },
    onSuccess: (data) => { qc.setQueryData(keys.source(id), data); void qc.invalidateQueries({ queryKey: keys.sourceVersions(id) }); },
  });
};

export const exportDocxUrl = (id: string) => `${API_BASE}/documents/${id}/source/export.docx`;
export const rawRevisionUrl = (sourceId: string, revisionId: string) => `${API_BASE}/sources/${sourceId}/revisions/${revisionId}/raw`;

export const useUploadAsset = () =>
  useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return unwrap(await apiUpload<Asset>('/assets', form));
    },
  });

/** Autosave lives in the W4 `/source/draft` routes: per user, per document, cleared by a successful version save. */
export const useSourceDraft = (id: string | undefined) =>
  useQuery({
    queryKey: keys.sourceDraft(id ?? ''),
    enabled: !!id,
    queryFn: async () => unwrapMaybe<{ html: string; updatedAt: string }>(await api.GET('/documents/{id}/source/draft', { params: { path: { id: id! } } })),
  });
export const useSaveSourceDraft = (id: string) =>
  useMutation({
    mutationFn: async (html: string) => { unwrap(await api.PUT('/documents/{id}/source/draft', { params: { path: { id } }, body: { html } })); },
  });
export const useDeleteSourceDraft = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => { unwrap(await api.DELETE('/documents/{id}/source/draft', { params: { path: { id } } })); },
    onSuccess: () => qc.removeQueries({ queryKey: keys.sourceDraft(id) }),
  });
};
```
Generated client: `pnpm --filter @wecom/web generate:client` after Task 6's OpenAPI regen; the path keys above must exist in `src/api/schema.d.ts` (they do once `docs/api/openapi.json` carries the W4 routes). If `api.GET('/documents/{id}/source/export.docx')` typing complains about a binary response, do not call it through the client — `exportDocxUrl` is used as a plain `<a href>` (same-origin, cookie auth).

- [ ] **Step 7: jsdom polyfills for ProseMirror**

Append to `apps/web/test/setup.ts`:
```ts
// ProseMirror (TipTap) needs DOM APIs jsdom lacks.
if (!(globalThis as { ClipboardEvent?: unknown }).ClipboardEvent) (globalThis as { ClipboardEvent?: unknown }).ClipboardEvent = class extends Event {};
if (!(globalThis as { DragEvent?: unknown }).DragEvent) (globalThis as { DragEvent?: unknown }).DragEvent = class extends Event {};
if (!Range.prototype.getClientRects) {
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: [][Symbol.iterator] }) as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, bottom: 0, right: 0, width: 0, height: 0, toJSON: () => ({}) }) as DOMRect;
}
if (!document.elementFromPoint) document.elementFromPoint = () => null;
```

- [ ] **Step 8: Run**

Run: `pnpm --filter @wecom/web test -- sourcedocs-hooks fixtures`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/web/package.json pnpm-lock.yaml packages/shared/src/schemas/identity.ts apps/web/src/lib/prefs.ts apps/web/src/api/keys.ts apps/web/src/api/hooks/sourcedocs.ts apps/web/test
git commit -m "feat(web): source document hooks, paneMode preference, MSW handlers, ProseMirror jsdom polyfills"
```

---

### Task 9: Web — SourceEditor, SourcePane, SourceHistory, ImportExportButtons, PaneModeToggle, route

**Files:**
- Create: `apps/web/src/components/source/SourceEditor.tsx`, `SourcePane.tsx`, `SourceHistory.tsx`, `ImportExportButtons.tsx`, `PaneModeToggle.tsx`, `SourceEditPage.tsx`, `apps/web/test/source/SourceEditor.test.tsx`, `apps/web/test/source/SourcePane.test.tsx`, `apps/web/test/source/PaneModeToggle.test.tsx`
- Modify: `apps/web/src/routes.tsx` (one entry: `{ path: 'edit/:id/source', element: <SourceEditPage /> }` after `edit/:id`)

**Interfaces (W6 mounts these):**
```ts
// PaneModeToggle — persisted through usePreferences/useSavePreferences (apps/web/src/api/hooks/preferences.ts)
export type PaneMode = 'work' | 'source' | 'split';
export function PaneModeToggle(props: { value: PaneMode; onChange: (m: PaneMode) => void; hasSource: boolean }): JSX.Element;
// SourcePane — read-only render for the article page
export function SourcePane(props: { documentId: string; canEdit: boolean; sourceId?: string | null; latestRevisionId?: string | null }): JSX.Element;
// SourceHistory — versions list with restore (editors)
export function SourceHistory(props: { documentId: string; canEdit: boolean }): JSX.Element;
// ImportExportButtons — import .docx (editors) / export .docx (everyone)
export function ImportExportButtons(props: { documentId: string; canEdit: boolean; hasSource: boolean }): JSX.Element;
// SourceEditor — full editor used by SourceEditPage
export function SourceEditor(props: { documentId: string; onSaved?: (v: number) => void }): JSX.Element;
```
- Consumes: hooks from Task 8; `useToast` from `components/ui/Toast.js`; `useModal` from `components/ui/Modal.js` (read the file: it exports a `ModalApi` with `confirm`/`prompt`/`open`; use `prompt` for the version label and `confirm` for the etag conflict — no new dialog component is needed, so nothing is extracted from `EditorPage.tsx`); `useMe`/`can` from `api/hooks/me.ts` (read it for the exact `can(permission)` signature).

- [ ] **Step 1: Failing component tests**

`apps/web/test/source/PaneModeToggle.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PaneModeToggle } from '../../src/components/source/PaneModeToggle.js';

describe('PaneModeToggle', () => {
  it('offers the three modes and disables source/split without a source', () => {
    const onChange = vi.fn();
    render(<PaneModeToggle value="work" onChange={onChange} hasSource={false} />);
    expect(screen.getByRole('button', { name: 'תצוגת עבודה' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'מקור' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'מפוצל' })).toBeDisabled();
  });
  it('emits the picked mode', () => {
    const onChange = vi.fn();
    render(<PaneModeToggle value="work" onChange={onChange} hasSource />);
    fireEvent.click(screen.getByRole('button', { name: 'מפוצל' }));
    expect(onChange).toHaveBeenCalledWith('split');
  });
});
```
`apps/web/test/source/SourcePane.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { SourcePane } from '../../src/components/source/SourcePane.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

describe('SourcePane', () => {
  it('shows an empty state with an edit call-to-action for editors when no source exists', async () => {
    renderWithProviders(<SourcePane documentId={fx.docBrowsing.id} canEdit />);
    expect(await screen.findByText('אין עדיין מסמך מקור לפריט זה')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'צור מסמך מקור' })).toHaveAttribute('href', `/edit/${fx.docBrowsing.id}/source`);
  });
  it('renders sanitized html read-only and offers raw download when a revision exists', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, { html: '<h2>מקור</h2><p>גוף</p>', text: 'מקור\nגוף', version: 3, etag: 'e3', versions: [] });
    renderWithProviders(<SourcePane documentId={fx.docBrowsing.id} canEdit={false} sourceId="s1" latestRevisionId="r1" />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'מקור' })).toBeInTheDocument());
    expect(screen.queryByRole('link', { name: 'ערוך מקור' })).toBeNull();
    expect(screen.getByRole('link', { name: 'הורד קובץ מקור' })).toHaveAttribute('href', expect.stringContaining('/sources/s1/revisions/r1/raw'));
    expect(screen.getByText('גרסת מקור 3')).toBeInTheDocument();
  });
});
```
`apps/web/test/source/SourceEditor.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, fireEvent, act } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { SourceEditor } from '../../src/components/source/SourceEditor.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

describe('SourceEditor', () => {
  it('loads the current html, saves a version with a label and reports the new version', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, { html: '<p>התחלה</p>', text: 'התחלה', version: 1, etag: 'e1', versions: [] });
    const onSaved = vi.fn();
    renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} onSaved={onSaved} />);
    const editor = await screen.findByRole('textbox');
    await waitFor(() => expect(editor.textContent).toContain('התחלה'));
    fireEvent.click(screen.getByRole('button', { name: 'שמור גרסה' }));
    const label = await screen.findByLabelText('תיאור הגרסה');
    fireEvent.change(label, { target: { value: 'עדכון נוהל' } });
    fireEvent.click(screen.getByRole('button', { name: 'שמור' }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(2));
    expect(state.sourceDocs.get(fx.docBrowsing.id)?.versions.at(-1)?.label).toBe('עדכון נוהל');
  });
  it('shows the conflict dialog on 412 and reloads on confirm', async () => {
    state.sourceDocs.set(fx.docBrowsing.id, { html: '<p>א</p>', text: 'א', version: 1, etag: 'e1', versions: [] });
    renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} />);
    await screen.findByRole('textbox');
    // someone else saved meanwhile
    state.sourceDocs.set(fx.docBrowsing.id, { html: '<p>ב</p>', text: 'ב', version: 2, etag: 'e2', versions: [] });
    fireEvent.click(screen.getByRole('button', { name: 'שמור גרסה' }));
    fireEvent.click(await screen.findByRole('button', { name: 'שמור' }));
    expect(await screen.findByText('מסמך המקור השתנה בינתיים')).toBeInTheDocument();
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'טען מחדש' })); });
    await waitFor(() => expect(screen.getByRole('textbox').textContent).toContain('ב'));
  });
  it('autosaves a draft after typing', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    state.sourceDocs.set(fx.docBrowsing.id, { html: '<p>x</p>', text: 'x', version: 1, etag: 'e1', versions: [] });
    renderWithProviders(<SourceEditor documentId={fx.docBrowsing.id} />);
    const editor = await screen.findByRole('textbox');
    fireEvent.input(editor, { target: { textContent: 'xy' } });
    await act(async () => { vi.advanceTimersByTime(3500); });
    await waitFor(() => expect(state.sourceDrafts.get(fx.docBrowsing.id)?.html).toContain('xy'));
    vi.useRealTimers();
  });
});
```
The renderWithProviders helper wraps in `MemoryRouter` + `QueryClientProvider` only; the editor uses `useModal`/`useToast`, so `render.tsx` must also wrap `ModalProvider` and `ToastProvider` if it does not already (read `apps/web/test/render.tsx` and `apps/web/src/main.tsx`; if the providers are missing from the helper, add them there — that file is test scaffolding, not a shell component).

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- source/`
Expected: FAIL — components not found.

- [ ] **Step 3: Implement `PaneModeToggle.tsx`**

```tsx
export type PaneMode = 'work' | 'source' | 'split';
const MODES: { id: PaneMode; label: string; needsSource: boolean }[] = [
  { id: 'work', label: 'תצוגת עבודה', needsSource: false },
  { id: 'source', label: 'מקור', needsSource: true },
  { id: 'split', label: 'מפוצל', needsSource: true },
];
/** Article pane switch. Persisted by the caller through `Preferences.paneMode`. */
export function PaneModeToggle({ value, onChange, hasSource }: { value: PaneMode; onChange: (m: PaneMode) => void; hasSource: boolean }) {
  return (
    <div className="seg" role="group" aria-label="מצב תצוגה">
      {MODES.map((m) => (
        <button key={m.id} type="button" className={'seg-btn' + (value === m.id ? ' on' : '')} aria-pressed={value === m.id}
          disabled={m.needsSource && !hasSource} onClick={() => onChange(m.id)}>
          {m.label}
        </button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Implement `SourcePane.tsx`**

```tsx
import { Link } from 'react-router-dom';
import { rawRevisionUrl, useSourceDocument } from '../../api/hooks/sourcedocs.js';
import { Empty, LoadError } from '../ui/index.js';
import { ImportExportButtons } from './ImportExportButtons.js';

/** Read-only view of the HTML source. The HTML is sanitized server-side on every save, so it is rendered as-is. */
export function SourcePane({ documentId, canEdit, sourceId, latestRevisionId }: { documentId: string; canEdit: boolean; sourceId?: string | null; latestRevisionId?: string | null }) {
  const q = useSourceDocument(documentId);
  if (q.isPending) return <div className="muted">טוען מקור…</div>;
  if (q.error) return <LoadError what="מסמך המקור" error={q.error} />;
  if (!q.data)
    return (
      <Empty title="אין עדיין מסמך מקור לפריט זה">
        {canEdit ? <Link className="btn" to={`/edit/${documentId}/source`}>צור מסמך מקור</Link> : null}
        <ImportExportButtons documentId={documentId} canEdit={canEdit} hasSource={false} />
      </Empty>
    );
  return (
    <section className="source-pane" dir="rtl">
      <header className="source-pane-head">
        <span className="muted">גרסת מקור {q.data.version}{q.data.updatedByName ? ` · ${q.data.updatedByName}` : ''}</span>
        <span className="grow" />
        {canEdit ? <Link className="btn" to={`/edit/${documentId}/source`}>ערוך מקור</Link> : null}
        <ImportExportButtons documentId={documentId} canEdit={canEdit} hasSource />
        {sourceId && latestRevisionId ? <a className="btn ghost" href={rawRevisionUrl(sourceId, latestRevisionId)}>הורד קובץ מקור</a> : null}
      </header>
      <article className="prose source-html" dangerouslySetInnerHTML={{ __html: q.data.html }} />
    </section>
  );
}
```

- [ ] **Step 5: Implement `ImportExportButtons.tsx` and `SourceHistory.tsx`**

`ImportExportButtons.tsx`:
```tsx
import { useRef } from 'react';
import { exportDocxUrl, useImportDocx } from '../../api/hooks/sourcedocs.js';
import { useToast } from '../ui/Toast.js';

export function ImportExportButtons({ documentId, canEdit, hasSource }: { documentId: string; canEdit: boolean; hasSource: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  const importM = useImportDocx(documentId);
  const toast = useToast();
  return (
    <>
      {canEdit ? (
        <>
          <button type="button" className="btn ghost" disabled={importM.isPending} onClick={() => input.current?.click()}>
            {importM.isPending ? 'מייבא…' : 'ייבוא מ-Word'}
          </button>
          <input ref={input} type="file" accept=".docx" hidden aria-label="קובץ Word לייבוא"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try { const s = await importM.mutateAsync(f); toast(`יובא כגרסת מקור ${s.version}`, 'ok'); }
              catch (err) { toast(err instanceof Error ? err.message : 'הייבוא נכשל', 'warn'); }
            }} />
        </>
      ) : null}
      {hasSource ? <a className="btn ghost" href={exportDocxUrl(documentId)} download>ייצוא ל-Word</a> : null}
    </>
  );
}
```
`SourceHistory.tsx`:
```tsx
import { useState } from 'react';
import { useRestoreSource, useSourceVersion, useSourceVersions } from '../../api/hooks/sourcedocs.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';
import { fmtDate } from '../../lib/format.js';

export function SourceHistory({ documentId, canEdit }: { documentId: string; canEdit: boolean }) {
  const versions = useSourceVersions(documentId);
  const [open, setOpen] = useState<number | null>(null);
  const preview = useSourceVersion(documentId, open ?? undefined);
  const restore = useRestoreSource(documentId);
  const modal = useModal();
  const toast = useToast();
  if (!versions.data?.length) return <div className="muted">אין גרסאות מקור</div>;
  return (
    <div className="source-history" dir="rtl">
      <ul className="version-list">
        {versions.data.map((v) => (
          <li key={v.version} className={open === v.version ? 'on' : ''}>
            <button type="button" className="linklike" onClick={() => setOpen(v.version)}>
              גרסה {v.version} · {v.label || 'ללא תיאור'} · {v.authorName} · {fmtDate(v.createdAt)}
            </button>
            {canEdit && v.version !== versions.data![0].version ? (
              <button type="button" className="btn ghost sm" onClick={async () => {
                if (!(await modal.confirm('שחזור גרסת מקור', `לשחזר את גרסה ${v.version} כגרסה חדשה?`, 'שחזר'))) return;
                await restore.mutateAsync(v.version);
                toast('הגרסה שוחזרה', 'ok');
              }}>שחזר</button>
            ) : null}
          </li>
        ))}
      </ul>
      {preview.data ? <article className="prose source-html" dangerouslySetInnerHTML={{ __html: preview.data.html }} /> : null}
    </div>
  );
}
```
(`fmtDate`: check `apps/web/src/lib/format.ts` for the actual date helper name and use it; if none exists, use `new Date(v.createdAt).toLocaleString('he-IL')` inline.)

- [ ] **Step 6: Implement `SourceEditor.tsx`**

```tsx
import { useCallback, useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import Image from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import { useDeleteSourceDraft, useSaveSource, useSaveSourceDraft, useSourceDocument, useSourceDraft, useUploadAsset } from '../../api/hooks/sourcedocs.js';
import { ApiError } from '../../api/unwrap.js';
import { useModal } from '../ui/Modal.js';
import { useToast } from '../ui/Toast.js';

const AUTOSAVE_MS = 3000;

export function SourceEditor({ documentId, onSaved }: { documentId: string; onSaved?: (v: number) => void }) {
  const doc = useSourceDocument(documentId);
  const draft = useSourceDraft(documentId);
  const save = useSaveSource(documentId);
  const saveDraft = useSaveSourceDraft(documentId);
  const dropDraft = useDeleteSourceDraft(documentId);
  const upload = useUploadAsset();
  const modal = useModal();
  const toast = useToast();
  const etag = useRef<string | undefined>(undefined);
  const [dirty, setDirty] = useState(false);
  const timer = useRef<number | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3, 4] } }),
      Underline,
      Link.configure({ openOnClick: false, autolink: true, protocols: ['http', 'https'], HTMLAttributes: { rel: 'noopener' } }),
      Image.configure({ allowBase64: false }),
      Table.configure({ resizable: false }), TableRow, TableHeader, TableCell,
      TextAlign.configure({ types: ['heading', 'paragraph'], defaultAlignment: 'right' }),
    ],
    editorProps: {
      attributes: { dir: 'rtl', class: 'prose source-html', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'מסמך המקור' },
      handlePaste: (_view, event) => handleFiles(event.clipboardData?.files),
      handleDrop: (_view, event) => handleFiles(event.dataTransfer?.files),
    },
    onUpdate: () => {
      setDirty(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => { saveDraft.mutate(editor?.getHTML() ?? ''); }, AUTOSAVE_MS);
    },
  });

  function handleFiles(files?: FileList | null): boolean {
    if (!files?.length || !editor) return false;
    const images = [...files].filter((f) => f.type.startsWith('image/'));
    if (!images.length) return false;
    void (async () => {
      for (const f of images) {
        try { const a = await upload.mutateAsync(f); editor.chain().focus().setImage({ src: a.url, alt: f.name }).run(); }
        catch (err) { toast(err instanceof Error ? err.message : 'העלאת התמונה נכשלה', 'warn'); }
      }
    })();
    return true;
  }

  // Load: draft (if newer) wins over the server html; the user is told.
  useEffect(() => {
    if (!editor || doc.isPending || draft.isPending) return;
    etag.current = doc.data?.etag;
    const serverHtml = doc.data?.html ?? '';
    const d = draft.data;
    if (d && d.html && d.html !== serverHtml && (!doc.data || d.updatedAt > doc.data.updatedAt)) {
      editor.commands.setContent(d.html, { emitUpdate: false });
      setDirty(true);
      toast('נטענה טיוטה שלא נשמרה כגרסה', '');
    } else editor.commands.setContent(serverHtml, { emitUpdate: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, doc.isPending, draft.isPending]);

  const reload = useCallback(async () => {
    const fresh = await doc.refetch();
    etag.current = fresh.data?.etag;
    editor?.commands.setContent(fresh.data?.html ?? '', { emitUpdate: false });
    setDirty(false);
  }, [doc, editor]);

  async function saveVersion() {
    if (!editor) return;
    const label = await modal.prompt('שמירת גרסת מקור', 'תיאור הגרסה', '');
    if (label === null) return;
    try {
      const s = await save.mutateAsync({ html: editor.getHTML(), label: label || undefined, etag: etag.current });
      etag.current = s.etag;
      editor.commands.setContent(s.html, { emitUpdate: false }); // server-sanitized
      setDirty(false);
      void dropDraft; // the server cleared the autosave inside the save transaction; the hook stays for explicit "בטל טיוטה"
      toast(`נשמרה גרסת מקור ${s.version}`, 'ok');
      onSaved?.(s.version);
    } catch (err) {
      if (err instanceof ApiError && err.status === 412) {
        if (await modal.confirm('מסמך המקור השתנה בינתיים', 'עורך אחר שמר גרסה חדשה. לטעון מחדש? השינויים שלך נשמרים כטיוטה.', 'טען מחדש')) await reload();
        return;
      }
      toast(err instanceof Error ? err.message : 'השמירה נכשלה', 'warn');
    }
  }

  if (!editor) return null;
  const B = ({ on, label, run }: { on?: boolean; label: string; run: () => void }) => (
    <button type="button" className={'tb' + (on ? ' on' : '')} aria-pressed={!!on} onClick={run}>{label}</button>
  );
  return (
    <div className="source-editor" dir="rtl">
      <div className="toolbar" role="toolbar" aria-label="עיצוב">
        <B label="מודגש" on={editor.isActive('bold')} run={() => editor.chain().focus().toggleBold().run()} />
        <B label="נטוי" on={editor.isActive('italic')} run={() => editor.chain().focus().toggleItalic().run()} />
        <B label="קו תחתון" on={editor.isActive('underline')} run={() => editor.chain().focus().toggleUnderline().run()} />
        <B label="קו חוצה" on={editor.isActive('strike')} run={() => editor.chain().focus().toggleStrike().run()} />
        <span className="vsep" />
        {[1, 2, 3, 4].map((l) => <B key={l} label={`כותרת ${l}`} on={editor.isActive('heading', { level: l })} run={() => editor.chain().focus().toggleHeading({ level: l as 1 | 2 | 3 | 4 }).run()} />)}
        <span className="vsep" />
        <B label="תבליטים" on={editor.isActive('bulletList')} run={() => editor.chain().focus().toggleBulletList().run()} />
        <B label="מספור" on={editor.isActive('orderedList')} run={() => editor.chain().focus().toggleOrderedList().run()} />
        <B label="ציטוט" on={editor.isActive('blockquote')} run={() => editor.chain().focus().toggleBlockquote().run()} />
        <B label="קוד" on={editor.isActive('codeBlock')} run={() => editor.chain().focus().toggleCodeBlock().run()} />
        <span className="vsep" />
        <B label="טבלה" run={() => editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: true }).run()} />
        <B label="הוסף שורה" run={() => editor.chain().focus().addRowAfter().run()} />
        <B label="הוסף עמודה" run={() => editor.chain().focus().addColumnAfter().run()} />
        <B label="מחק טבלה" run={() => editor.chain().focus().deleteTable().run()} />
        <span className="vsep" />
        <B label="קישור" on={editor.isActive('link')} run={async () => {
          const href = await modal.prompt('קישור', 'כתובת (http/https)', editor.getAttributes('link').href ?? '');
          if (href === null) return;
          if (!href) editor.chain().focus().unsetLink().run();
          else if (/^https?:\/\//i.test(href)) editor.chain().focus().setLink({ href }).run();
          else toast('כתובת חייבת להתחיל ב-http:// או https://', 'warn');
        }} />
        <label className="tb">תמונה<input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onChange={(e) => { handleFiles(e.target.files); e.target.value = ''; }} /></label>
        <span className="grow" />
        <span className="muted">{dirty ? 'שינויים לא שמורים' : doc.data ? `גרסת מקור ${doc.data.version}` : 'מסמך חדש'}</span>
        <button type="button" className="btn primary" disabled={save.isPending} onClick={saveVersion}>שמור גרסה</button>
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
```
`modal.prompt` renders its input with the label passed as the second argument; the test queries `getByLabelText('תיאור הגרסה')` and clicks the modal's confirm button labelled `שמור` — read `Modal.tsx` `PromptBody` and `prompt()` to confirm the label wiring and the confirm button text; if the confirm button text is fixed (e.g. `אישור`), change the test to that text rather than the component.

- [ ] **Step 7: Implement `SourceEditPage.tsx` and the route**

```tsx
import { Link, useParams } from 'react-router-dom';
import { useDocument } from '../../api/hooks/documents.js';
import { SourceEditor } from './SourceEditor.js';
import { SourceHistory } from './SourceHistory.js';
import { ImportExportButtons } from './ImportExportButtons.js';
import { useMe } from '../../api/hooks/me.js';

export function SourceEditPage() {
  const { id = '' } = useParams();
  const doc = useDocument(id);
  const me = useMe();
  const canEdit = !!me.data?.permissions.includes('docs.edit');
  return (
    <div className="page source-edit-page" dir="rtl">
      <header className="page-head">
        <h1>מקור הידע · {doc.data?.title ?? '…'}</h1>
        <span className="grow" />
        <ImportExportButtons documentId={id} canEdit={canEdit} hasSource />
        <Link className="btn ghost" to={`/edit/${id}`}>לעורך תצוגת העבודה</Link>
        <Link className="btn ghost" to={`/doc/${id}`}>לתצוגת הנציג</Link>
      </header>
      <SourceEditor documentId={id} />
      <details className="source-history-wrap"><summary>היסטוריית גרסאות מקור</summary><SourceHistory documentId={id} canEdit={canEdit} /></details>
    </div>
  );
}
```
(`useMe` shape: read `apps/web/src/api/hooks/me.ts`; if it exposes `can(perm)` use that instead of `permissions.includes`.) In `apps/web/src/routes.tsx` add after `{ path: 'edit/:id', element: <EditorPage /> },`:
```tsx
      { path: 'edit/:id/source', element: <SourceEditPage /> },
```
with the import `import { SourceEditPage } from './components/source/SourceEditPage.js';`.

- [ ] **Step 8: Run web tests and typecheck**

Run: `pnpm --filter @wecom/web test -- source/ && pnpm --filter @wecom/web typecheck`
Expected: PASS. If TipTap's `setContent` second argument differs in 3.31 (`{ emitUpdate }` object vs boolean), follow the installed typings.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/components/source apps/web/src/routes.tsx apps/web/test/source apps/web/test/render.tsx
git commit -m "feat(web): source editor (TipTap), source pane, history, import/export, pane-mode toggle, /edit/:id/source"
```

---

### Task 10: Remaining API integration tests (import/export, assets, raw, backfill, gc, W2 flag)

**Files:**
- Modify: `apps/api/test/sourcedocs.test.ts`

- [ ] **Step 1: Append the tests** (same `run('source documents', …)` block, after Task 6's cases)

```ts
  it('imports a docx and exports it back with the heading present', async () => {
    const { buildDocx } = await import('./sources/fixtures/docx-builder.js');
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const docx = await buildDocx({ paragraphs: [{ style: 'Heading1', runs: [{ t: 'נוהל מיובא' }] }, { table: [['א', 'ב']] }, { image: { png } }] });
    const FormData = (await import('form-data')).default;
    const form = new FormData();
    form.append('file', docx, { filename: 'n.docx', contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const imp = await app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/source/import`, headers: { ...auth(editor), ...form.getHeaders() }, payload: form.getBuffer() });
    expect(imp.statusCode).toBe(200);
    expect(imp.json().html).toContain('<h1>נוהל מיובא</h1>');
    expect(imp.json().html).toMatch(/<img src="\/api\/v1\/assets\/[0-9a-f-]{36}"/);
    const exp = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/export.docx`, headers: auth(reader) });
    expect(exp.statusCode).toBe(200);
    expect(exp.headers['content-type']).toContain('wordprocessingml');
    const JSZip = (await import('jszip')).default;
    const xml = await (await JSZip.loadAsync(exp.rawPayload)).file('word/document.xml')!.async('string');
    expect(xml).toContain('נוהל מיובא');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('<w:drawing>');
  });

  it('assets: 415 for a mime outside ASSET_MIMES, 413 oversize, dedupes by sha256, serves immutable bytes', async () => {
    const FormData = (await import('form-data')).default;
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const post = async (buf: Buffer, type: string) => {
      const f = new FormData(); f.append('file', buf, { filename: 'x', contentType: type });
      return app.inject({ method: 'POST', url: '/api/v1/assets', headers: { ...auth(editor), ...f.getHeaders() }, payload: f.getBuffer() });
    };
    expect((await post(Buffer.from('<svg/>'), 'image/svg+xml')).statusCode).toBe(415);
    expect((await post(Buffer.alloc(10 * 1024 * 1024 + 1), 'image/png')).statusCode).toBe(413);
    const a = await post(png, 'image/png'); const b = await post(png, 'image/png');
    expect(a.statusCode).toBe(200);
    expect(b.json().id).toBe(a.json().id);
    expect(a.json()).toMatchObject({ mime: 'image/png', width: 1, height: 1 });
    const get = await app.inject({ method: 'GET', url: a.json().url, headers: auth(reader) });
    expect(get.statusCode).toBe(200);
    expect(get.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(Buffer.from(get.rawPayload).equals(png)).toBe(true);
    expect((await post(png, 'image/png').then(() => app.inject({ method: 'POST', url: '/api/v1/assets', headers: auth(reader), payload: {} }))).statusCode).toBe(403);
  });

  it('serves the raw upload of a revision', async () => {
    const src = (await db.pool.query('select source_id from documents where id=$1', [docId])).rows[0].source_id;
    const rev = (await db.pool.query('select id from source_revisions where source_id=$1 order by imported_at desc limit 1', [src])).rows[0].id;
    const r = await app.inject({ method: 'GET', url: `/api/v1/sources/${src}/revisions/${rev}/raw`, headers: auth(reader) });
    expect(r.statusCode).toBe(200);
    expect(r.headers['content-disposition']).toContain('attachment');
    expect(r.body).toContain('<h1>נוהל מיובא</h1>');
  });

  it('marks the document for source review when W2 is present', async () => {
    const col = await db.pool.query("select 1 from information_schema.columns where table_name='documents' and column_name='source_review_needed'");
    if (!col.rowCount) return; // W2 not merged yet
    await app.inject({ method: 'PUT', url: `/api/v1/documents/${docId}/source`, headers: auth(editor), payload: { html: '<p>שינוי נוסף</p>' } });
    const r = await db.pool.query('select source_review_needed from documents where id=$1', [docId]);
    expect(r.rows[0].source_review_needed).toBe(true);
  });

  it('restores an older source version as a new version', async () => {
    const r = await app.inject({ method: 'POST', url: `/api/v1/documents/${docId}/source/restore/1`, headers: auth(editor) });
    expect(r.statusCode).toBe(200);
    expect(r.json().html).toBe('<h2>שלב 1</h2><p>פתח CRM</p>');
    const list = await app.inject({ method: 'GET', url: `/api/v1/documents/${docId}/source/versions`, headers: auth(reader) });
    expect(list.json().items[0].label).toBe('שוחזר מגרסה 1');
  });

  it('gc deletes only unreferenced assets older than a day', async () => {
    const { gcUnreferencedAssets } = await import('../src/modules/sourcedocs/assets.js');
    await db.pool.query(`insert into assets(mime, bytes, sha256, size, created_at) values ('image/png', '\\x00', 'orphan', 1, now() - interval '2 days')`);
    const before = (await db.pool.query('select count(*)::int n from assets')).rows[0].n;
    const n = await gcUnreferencedAssets(db.pool);
    expect(n).toBe(1);
    expect((await db.pool.query('select count(*)::int n from assets')).rows[0].n).toBe(before - 1);
  });

  it('backfill: a document with an accepted docx revision gets a source document on migration', async () => {
    // The migration already ran; verify against a seeded document that has a source (seed.test.ts seeds one) or create one:
    const s = await db.pool.query(`insert into sources(kind, title) values ('docx','נוהל ישן') returning id`);
    const d = await app.inject({ method: 'POST', url: '/api/v1/documents', headers: auth(editor), payload: { title: 'ישן', description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps' } });
    await db.pool.query('update documents set source_id=$2 where id=$1', [d.json().id, s.rows[0].id]);
    await db.pool.query(`insert into source_revisions(source_id, hash, paragraphs, accepted) values ($1,'h',$2,true)`, [s.rows[0].id, JSON.stringify([{ ref: '1', heading: 'כותרת', level: 2, runs: [{ t: 'כותרת' }] }, { ref: '1.1', runs: [{ t: 'גוף' }] }])]);
    // Re-run only the backfill SQL by calling the migration's up() against a throwaway pgm shim is heavier than it is worth;
    // instead assert the SQL the migration uses produces the expected HTML for this row:
    const { readFileSync } = await import('node:fs');
    const sql = /pgm\.sql\(`([\s\S]*?)`\)/.exec(readFileSync('migrations/0033_source_documents.js', 'utf8'))![1];
    await db.pool.query(sql.replace(/\\\\n/g, '\\n'));
    const r = await db.pool.query('select html from source_documents where document_id=$1', [d.json().id]);
    expect(r.rows[0].html).toBe('<h2>כותרת</h2><p>גוף</p>');
  });
```

- [ ] **Step 2: Run the full API suite**

Run: `cd apps/api && RUN_INTEGRATION=1 pnpm vitest run test/sourcedocs.test.ts && pnpm test && RUN_INTEGRATION=1 pnpm test:int`
Expected: all green. The `form-data` dev dependency is already present.

- [ ] **Step 3: Commit**

```bash
git add apps/api/test/sourcedocs.test.ts
git commit -m "test(api): source documents — import/export, assets, raw download, restore, gc, backfill, W2 flag"
```

---

### Task 11: Lane report

- [ ] **Step 1: Full green gate**

Run: `pnpm -r test && cd apps/api && RUN_INTEGRATION=1 pnpm test:int && cd ../web && pnpm typecheck`
Expected: green.

- [ ] **Step 2: Write `.superpowers/sdd/program/W4-report.md`** with: commits, the mount points W6 must perform (`PaneModeToggle` + `SourcePane`/`SourceHistory` in `ArticlePage` header/body; `ImportExportButtons` + link to `/edit/:id/source` in `EditorPage` header; a "מקור" badge on library cards when `useSourceDocument` is not null is **not** wanted — the card stays as is), the note that W6 wires `currentSourceVersion(tx, id)` into the publish route, and the shared-file touches made (`modules/index.ts`, `sources/index.ts` one decorator line, `connectors/index.ts` one `assets` property, `routes.tsx`, `keys.ts`, `format/index.ts`, `identity.ts` one field, `wave4.ts` two appended schemas).

- [ ] **Step 3: Commit**

```bash
git add .superpowers/sdd/program/W4-report.md
git commit -m "docs(w4): lane report"
```

---

## Self-review

- **Spec coverage.** §2.4 tables and backfill → Task 4. §3 W4 routes → Task 6 (all ten plus the three `/source/draft` routes) — `GET /sources/:id/revisions/:rev/raw` included. §5.1 editor (TipTap extensions, RTL, sanitizer allowlist, images → assets, docx import/export, autosave, "שמור גרסה", etag dialog) → Tasks 2, 3, 5, 8, 9. §5.1 pane modes → `PaneModeToggle` + `paneMode` preference (Tasks 8, 9); W6 mounts. §5.2 save → version → ingest → suggestions → flag → Task 6 (`ingestSourceHtml`), flag asserted conditionally in Task 10; publish linkage exposed as `currentSourceVersion` for W2. WordPress push of source HTML with media, inbound HTML as a source version → Task 7. `assets.gc` weekly → Task 6. Isolation rules → Global Constraints; the three one-line touches outside this lane's files (`sources/index.ts`, `connectors/index.ts`, `render.tsx`) are called out.
- **Placeholders.** None: every code step is complete; the two "read the file and adapt" notes (Modal confirm label, `useMe` shape, `fmtDate`) name the file and the fallback.
- **Type consistency.** `SourceDocRow` fields equal `SourceDocumentSchema` (`documentId, html, text, version, etag, updatedById, updatedByName, updatedAt`). `AssetBytesResolver` is defined once in shared (Task 3) and consumed by `LibraryContent.assets`, `SyncDeps.assets`, `htmlToDocx`. `putAsset` returns W0's `Asset` shape (`id, url, mime, size, width, height`). `saveSourceDocument` throws the same `412 ETAG_MISMATCH` code the web hook test and editor rely on. `ingestSourceHtml` returns `{ revisionId, duplicate, sourceId }` and Task 6's route uses exactly those. Hook names in Task 8 match their imports in Task 9.
- **Coordinator decisions applied (2026-09-14):** SVG is out — the only asset rule is membership in W0's `ASSET_MIMES`; source autosave uses the W4-owned `GET|PUT|DELETE /documents/:id/source/draft` routes on the `drafts` table (`document_id = id`, `draft_key = 'source:' + id`, `payload = { html }`), cleared by a successful `PUT /documents/:id/source`; `currentSourceVersion` stays exported and W6 wires it into the publish route after merge.
