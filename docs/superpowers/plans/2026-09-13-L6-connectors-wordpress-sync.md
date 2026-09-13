# L6 — Connectors & WordPress Two-Way Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the connector contract real: a WordPress connector (read, write, webhooks), a read-only JSON/CSV connector for static data files, an encrypted connector registry in the API, and a `SyncService` that keeps WordPress and the library in parity through the review queue (remote-only → suggestions, local-only → push, both → conflict resolved by a lead).

**Architecture:** `packages/connectors` gains `wordpress/` (REST client, HTML↔paragraph conversion, deterministic HTML renderer, HMAC webhook parsing) and `json/` (row → card mapping). Connectors never touch the database. `apps/api/src/modules/connectors` owns the `connectors` and `sync_links` tables, AES-256-GCM config encryption, CRUD/test/run/webhook routes, the `SyncService` state machine, pg-boss jobs `connector.run` (cron per connector) and `connector.webhook`, and emits `sync.completed` / `sync.conflict`. Remote changes enter the L5 pipeline through `SourceRevisionService.ingest(sourceId, content, actorId)`.

**Tech Stack:** Node 22, TypeScript strict, zod 3, node-html-parser 6, undici fetch (built-in), node:crypto (sha256, AES-256-GCM, HMAC), pg-boss 10, Fastify 5 + fastify-type-provider-zod, vitest 2, @testcontainers/postgresql, PHP 7.4+ for the WordPress plugin.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` §6 contract 5 and §8 (stage 3); L0 plan `docs/superpowers/plans/2026-09-13-L0-contracts-and-scaffold.md` Tasks 4, 6, 11, 13, 14 define every imported name.

## Global Constraints

- Contract names are fixed by L0 and must be used verbatim: `Connector<C>`, `ConnectorInfo`, `ConnectorRegistry`, `RemoteItem`, `SourceContent`, `LibraryContent`, `RemoteRef`, `RemoteChange` (from `@wecom/connectors`); `Paragraph`, `Run`, `Document`, `Block`, `Step`, `makeEvent` (from `@wecom/shared`).
- Conflict policy (spec §2): review queue, never auto-overwrite; auto-apply only when exactly one side changed since the last sync.
- Connector configs are encrypted at rest with AES-256-GCM using the 32-byte hex key in env `CONNECTOR_KEY`; plaintext config never appears in logs, audit rows, or API responses (responses return `configMasked`).
- Every mutating route declares `config: { requires: ['connectors.manage'] }` (L3 middleware); `sync-links/:id/resolve` requires `suggestions.apply`.
- Webhook route is unauthenticated but rejects any request whose `X-KB-Signature` is not a valid HMAC-SHA256 of the raw body with the connector's `webhookSecret`.
- User-facing strings in Hebrew, logs and identifiers in English. Commit after every task with the session's attribution lines.

## File structure produced by this plan

```
packages/connectors/
  package.json                       (+ node-html-parser dependency)
  src/index.ts                       (+ exports wordpress, json, render)
  src/wordpress/config.ts            WpConfigSchema, WpConfig
  src/wordpress/html.ts              htmlToParagraphs(html): Paragraph[], normalizeText, contentHash
  src/wordpress/client.ts            WpClient: listPosts, getPost, createPost, updatePost (fetch + Basic auth)
  src/wordpress/connector.ts         WordPressConnector implements Connector<WpConfig>
  src/wordpress/webhook.ts           signBody, verifySignature, parseWebhookBody
  src/render/wpHtml.ts               renderWpHtml(content: LibraryContent): string
  src/json/config.ts                 JsonConfigSchema (path/inline rows, mapping)
  src/json/connector.ts              JsonFileConnector implements Connector<JsonConfig> (read-only)
  test/helpers/wpStub.ts             startWpStub(): { url, posts, puts, close }
  test/wordpress-html.test.ts, test/wordpress-connector.test.ts, test/wordpress-webhook.test.ts,
  test/wpHtml-render.test.ts, test/json-connector.test.ts
deploy/wp-plugin/kb-sync.php         WordPress plugin: save_post → HMAC-signed webhook
apps/api/
  migrations/0008_connectors.js      connectors + sync_links tables
  src/config.ts                      (+ CONNECTOR_KEY)
  src/modules/connectors/crypto.ts   encryptConfig, decryptConfig
  src/modules/connectors/repo.ts     ConnectorsRepo (CRUD, links, baselines)
  src/modules/connectors/registry.ts buildRegistry(): ConnectorRegistry with wordpress + json registered
  src/modules/connectors/sync.ts     SyncService (state machine)
  src/modules/connectors/routes.ts   /connectors/*, /sync-links/:id/resolve
  src/modules/connectors/jobs.ts     registerConnectorJobs(boss, deps)
  src/modules/connectors/index.ts    plugin wiring
  test/connectors-crypto.test.ts, test/connectors-sync.test.ts (unit, fakes),
  test/connectors-sync.int.test.ts (testcontainers), test/connectors-routes.test.ts
```

Interfaces this plan consumes from other lanes (code against them; in tests use fakes):

```ts
// L5 (apps/api/src/modules/sources/revisions.ts)
interface SourceRevisionService { ingest(sourceId: string, content: SourceContent, actorId: string | null): Promise<{ revisionId: string; changed: boolean }> }
// L2 (apps/api/src/modules/content/documents.ts)
interface DocumentsService { getById(id: string): Promise<Document | null>; getVersionSnapshot(id: string, version: number): Promise<Document | null>; getBlocksFor(doc: Document): Promise<Block[]>; ensureSourceForConnector(connectorId: string, externalId: string, title: string): Promise<{ sourceId: string }> }
// L2 (apps/api/src/modules/events/bus.ts)
interface EventBus { publish(event: Event): void }
// L3 route option: config: { requires: Permission[] }
```


## Cross-lane reconciliation (authoritative — added after the eight plans were reviewed together)

These names win over anything else in this file. They are the L0-owned contract for runtime glue (ADR 0001).

- **Job queues**: import `QUEUES` from `apps/api/src/plugins/boss.ts` (owned by L1) and never spell queue names inline. Catalogue: `pipeline.process` (L5, concurrency 1), `sources.watch` (L5), `connector.run` (L6, one cron schedule per connector, job key = connector id), `connector.webhook` (L6), `identity.sync` (L3), `trash.purge` (L2), `search.reindex` (L2), `system.backup-check` (L1). The decorator is `app.boss: PgBoss | null`; there is no `plugins/jobs.ts`.
- **Audit**: low-level `audit(tx, { actorId, action, entityType, entityId, before, after, requestId, ip }): Promise<string>` lives in `apps/api/src/lib/audit.ts` (owned by L2; L3 creates it with this exact signature only if L2 has not landed). L3's auth plugin additionally decorates the convenience wrapper `app.audit(req, action, entityType, entityId, before, after)` which fills `actorId = req.user?.id ?? null`, `requestId = req.id`, `ip = req.ip` and runs on `app.db`. L6 uses the wrapper; L2/L5 use the low-level function inside their transactions.
- **Events**: `app.events: EventBus` from `apps/api/src/lib/events.ts` (L2) with `publish(tx, event)` where `event = makeEvent(name, payload)` from `@wecom/shared`. No lane creates `plugins/events.ts`.
- **Auth**: `apps/api/src/plugins/auth.ts` (L3) sets `req.user: AuthUser = { id, displayName, roles, permissions: Set<string>, categoryScopes: string[] | null, sessionId }` (`displayName` is an additive field L3 includes) and enforces route `config: { requires: Permission[], scope?: 'document' }`. No lane adds a `requires()` preHandler or `plugins/authz.ts`; until L3 lands, tests use the `x-test-user` header plugin from L2 (`apps/api/test/helpers/fakeAuth.ts`) or `buildApp({ testUser })` — both must set the same `AuthUser` shape.
- **Module registration**: every `/api/v1` module registers inside the single `v1` callback in `apps/api/src/app.ts` via `registerModules(v1)` from `apps/api/src/modules/index.ts` (L2); other lanes add one line there.
- **For this lane**: `app.audit(req, …)` is provided by L3 (see above); keep the temporary no-op shim only behind `if (!app.hasDecorator('audit'))`. Schedule with `QUEUES.connectorRun` (job singleton key = connector id) and `QUEUES.connectorWebhook`; `SourceRevisionService.ingest(sourceId, content, actorId, raw?)` is L5's signature (`raw` optional).

---

### Task 1: WordPress config schema and connector skeleton with a stub WordPress server

**Files:**
- Modify: `packages/connectors/package.json` (add `"node-html-parser": "^6.1.13"`)
- Create: `packages/connectors/src/wordpress/config.ts`, `packages/connectors/src/wordpress/client.ts`, `packages/connectors/src/wordpress/connector.ts`, `packages/connectors/test/helpers/wpStub.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/test/wordpress-connector.test.ts`

**Interfaces:**
- Produces: `WpConfigSchema` (zod) and `WpConfig = { baseUrl: string; username: string; applicationPassword: string; postTypes: string[]; categoryMap: Record<string, string>; webhookSecret: string }`; `WpClient` with `listPosts(type, { modifiedAfter?, page, perPage }): Promise<{ items: WpPost[]; totalPages: number }>`, `getPost(type, id): Promise<WpPost>`, `createPost(type, body): Promise<WpPost>`, `updatePost(type, id, body): Promise<WpPost>`; `WpPost = { id: number; title: { rendered: string }; content: { rendered: string }; modified_gmt: string; link: string; status: string; categories?: number[] }`; `WordPressConnector` with `describe()` → `{ id: 'wordpress', name: 'WordPress', capabilities: { read: true, write: true, webhooks: true, identity: false } }`; stub helper `startWpStub(seed: WpPost[]): Promise<{ url: string; posts: Map<string, WpPost>; puts: { type: string; id: number | null; body: unknown }[]; close(): Promise<void> }>`.

- [ ] **Step 1: Write the failing test**

`packages/connectors/test/wordpress-connector.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WordPressConnector, WpConfigSchema } from '../src/index.js';
import { startWpStub, type WpStub } from './helpers/wpStub.js';

let stub: WpStub;
beforeAll(async () => {
  stub = await startWpStub([
    { id: 7, title: { rendered: 'איטיות גלישה' }, content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' }, modified_gmt: '2025-06-12T10:00:00', link: 'http://wp/7', status: 'publish' },
  ]);
});
afterAll(async () => { await stub.close(); });

const cfg = () => WpConfigSchema.parse({ baseUrl: stub.url, username: 'kb', applicationPassword: 'xxxx yyyy', postTypes: ['posts'], categoryMap: {}, webhookSecret: 's3cret' });

describe('WordPressConnector basics', () => {
  it('describes capabilities', () => {
    expect(new WordPressConnector().describe()).toEqual({ id: 'wordpress', name: 'WordPress', capabilities: { read: true, write: true, webhooks: true, identity: false } });
  });
  it('validates config', () => {
    expect(WpConfigSchema.safeParse({ baseUrl: 'not-a-url' }).success).toBe(false);
    expect(cfg().postTypes).toEqual(['posts']);
  });
  it('tests the connection with basic auth', async () => {
    const r = await new WordPressConnector().testConnection(cfg());
    expect(r.ok).toBe(true);
    expect(stub.lastAuth).toBe('Basic ' + Buffer.from('kb:xxxx yyyy').toString('base64'));
  });
  it('reports a failed connection', async () => {
    const r = await new WordPressConnector().testConnection({ ...cfg(), baseUrl: 'http://127.0.0.1:1' });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/חיבור/);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @wecom/connectors test -- wordpress-connector`
Expected: FAIL (`WordPressConnector` not exported).

- [ ] **Step 3: Implement the stub server**

`packages/connectors/test/helpers/wpStub.ts`:
```ts
import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface WpPost { id: number; title: { rendered: string }; content: { rendered: string }; modified_gmt: string; link: string; status: string; categories?: number[] }
export interface WpStub { url: string; posts: Map<string, WpPost>; puts: { type: string; id: number | null; body: unknown }[]; lastAuth: string | null; close(): Promise<void> }

export async function startWpStub(seed: WpPost[]): Promise<WpStub> {
  const posts = new Map<string, WpPost>(seed.map((p) => ['posts:' + p.id, p]));
  const puts: WpStub['puts'] = [];
  let lastAuth: string | null = null;
  let nextId = 1000;
  const server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization ?? null;
    const url = new URL(req.url ?? '/', 'http://x');
    const m = /^\/wp-json\/wp\/v2\/(\w+)(?:\/(\d+))?$/.exec(url.pathname);
    const json = (code: number, body: unknown, headers: Record<string, string> = {}) => { res.writeHead(code, { 'content-type': 'application/json', ...headers }); res.end(JSON.stringify(body)); };
    if (url.pathname === '/wp-json/') return json(200, { name: 'stub', namespaces: ['wp/v2'] });
    if (!m) return json(404, { code: 'rest_no_route' });
    const [, type, id] = m;
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      if (req.method === 'GET' && !id) {
        const perPage = Number(url.searchParams.get('per_page') ?? 10), page = Number(url.searchParams.get('page') ?? 1);
        const after = url.searchParams.get('modified_after');
        const all = [...posts.entries()].filter(([k]) => k.startsWith(type + ':')).map(([, p]) => p).filter((p) => !after || p.modified_gmt > after).sort((a, b) => a.id - b.id);
        const totalPages = Math.max(1, Math.ceil(all.length / perPage));
        return json(200, all.slice((page - 1) * perPage, page * perPage), { 'x-wp-totalpages': String(totalPages), 'x-wp-total': String(all.length) });
      }
      if (req.method === 'GET' && id) { const p = posts.get(type + ':' + id); return p ? json(200, p) : json(404, { code: 'rest_post_invalid_id' }); }
      if (req.method === 'POST') {
        const body = JSON.parse(raw || '{}') as { title?: string; content?: string; status?: string };
        const pid = id ? Number(id) : nextId++;
        const prev = posts.get(type + ':' + pid);
        const p: WpPost = { id: pid, title: { rendered: body.title ?? prev?.title.rendered ?? '' }, content: { rendered: body.content ?? prev?.content.rendered ?? '' }, modified_gmt: new Date().toISOString().slice(0, 19), link: 'http://wp/' + pid, status: body.status ?? 'publish' };
        posts.set(type + ':' + pid, p); puts.push({ type, id: id ? pid : null, body });
        return json(id ? 200 : 201, p);
      }
      json(405, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return { url, posts, puts, get lastAuth() { return lastAuth; }, close: () => new Promise((r) => server.close(() => r())) };
}
```

- [ ] **Step 4: Implement config, client and connector skeleton**

`packages/connectors/src/wordpress/config.ts`:
```ts
import { z } from 'zod';
export const WpConfigSchema = z.object({
  baseUrl: z.string().url().transform((u) => u.replace(/\/+$/, '')),
  username: z.string().min(1),
  applicationPassword: z.string().min(1),
  postTypes: z.array(z.string().min(1)).min(1).default(['posts']),
  categoryMap: z.record(z.string()).default({}),   // WP category slug → KB category (sim|tech|billing|plans|intl|ops)
  webhookSecret: z.string().min(8),
});
export type WpConfig = z.infer<typeof WpConfigSchema>;
```

`packages/connectors/src/wordpress/client.ts`:
```ts
import type { WpConfig } from './config.js';
export interface WpPost { id: number; title: { rendered: string }; content: { rendered: string }; modified_gmt: string; link: string; status: string; categories?: number[] }
export class WpError extends Error { constructor(public status: number, message: string) { super(message); } }

export class WpClient {
  constructor(private cfg: WpConfig, private fetchImpl: typeof fetch = fetch) {}
  private headers() { return { authorization: 'Basic ' + Buffer.from(this.cfg.username + ':' + this.cfg.applicationPassword).toString('base64'), 'content-type': 'application/json' }; }
  private async req<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const res = await this.fetchImpl(this.cfg.baseUrl + path, { method, headers: this.headers(), body: body === undefined ? undefined : JSON.stringify(body) });
    if (!res.ok) throw new WpError(res.status, `WordPress ${method} ${path} → ${res.status}`);
    return { data: (await res.json()) as T, headers: res.headers };
  }
  async ping(): Promise<void> { await this.req('GET', '/wp-json/'); }
  async listPosts(type: string, o: { modifiedAfter?: string; page: number; perPage: number }): Promise<{ items: WpPost[]; totalPages: number }> {
    const q = new URLSearchParams({ per_page: String(o.perPage), page: String(o.page), status: 'publish,draft', context: 'edit', _fields: 'id,title,content,modified_gmt,link,status,categories' });
    if (o.modifiedAfter) q.set('modified_after', o.modifiedAfter);
    const { data, headers } = await this.req<WpPost[]>('GET', `/wp-json/wp/v2/${type}?${q}`);
    return { items: data, totalPages: Number(headers.get('x-wp-totalpages') ?? 1) };
  }
  async getPost(type: string, id: number): Promise<WpPost> { return (await this.req<WpPost>('GET', `/wp-json/wp/v2/${type}/${id}?context=edit`)).data; }
  async createPost(type: string, body: { title: string; content: string; status: string }): Promise<WpPost> { return (await this.req<WpPost>('POST', `/wp-json/wp/v2/${type}`, body)).data; }
  async updatePost(type: string, id: number, body: { title: string; content: string }): Promise<WpPost> { return (await this.req<WpPost>('POST', `/wp-json/wp/v2/${type}/${id}`, body)).data; }
}
```

`packages/connectors/src/wordpress/connector.ts` (skeleton; `listRemote`, `fetch`, `push`, `parseWebhook` are filled in Tasks 3, 4, 6, 7):
```ts
import type { Connector, ConnectorInfo, LibraryContent, RemoteChange, RemoteItem, RemoteRef, SourceContent } from '../contract.js';
import { WpConfigSchema, type WpConfig } from './config.js';
import { WpClient } from './client.js';

export class WordPressConnector implements Connector<WpConfig> {
  configSchema = WpConfigSchema;
  constructor(private fetchImpl: typeof fetch = fetch) {}
  protected client(cfg: WpConfig) { return new WpClient(cfg, this.fetchImpl); }
  describe(): ConnectorInfo { return { id: 'wordpress', name: 'WordPress', capabilities: { read: true, write: true, webhooks: true, identity: false } }; }
  async testConnection(cfg: WpConfig): Promise<{ ok: boolean; message: string }> {
    try { await this.client(cfg).ping(); return { ok: true, message: 'החיבור ל-WordPress תקין' }; }
    catch (e) { return { ok: false, message: 'החיבור נכשל: ' + (e instanceof Error ? e.message : String(e)) }; }
  }
  async listRemote(_cfg: WpConfig, _since?: string): Promise<RemoteItem[]> { throw new Error('not implemented'); }
  async fetch(_cfg: WpConfig, _externalId: string): Promise<SourceContent> { throw new Error('not implemented'); }
  async push(_cfg: WpConfig, _externalId: string | null, _content: LibraryContent): Promise<RemoteRef> { throw new Error('not implemented'); }
  async parseWebhook(_cfg: WpConfig, _headers: Record<string, string>, _body: unknown): Promise<RemoteChange[]> { throw new Error('not implemented'); }
}
```

`packages/connectors/src/index.ts` — add:
```ts
export * from './wordpress/config.js';
export * from './wordpress/client.js';
export * from './wordpress/connector.js';
```

- [ ] **Step 5: Run the test**

Run: `pnpm install && pnpm --filter @wecom/connectors test -- wordpress-connector`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/connectors && git commit -m "feat(connectors): wordpress config, client and connector skeleton with stub server"
```

---

### Task 2: HTML → paragraphs conversion and content hash

**Files:**
- Create: `packages/connectors/src/wordpress/html.ts`
- Modify: `packages/connectors/src/index.ts` (export)
- Test: `packages/connectors/test/wordpress-html.test.ts`

**Interfaces:**
- Produces: `htmlToParagraphs(html: string): Paragraph[]` — one `Paragraph` per block element; `ref` = heading path + index (`"h2-1"`, `"h2-1.p-2"`, `"h2-1.ul-3"`), headings carry `heading` and `level`; `normalizeText(s: string): string` (collapse whitespace, decode entities, trim); `contentHash(paragraphs: Paragraph[]): string` (sha256 hex of `ref\ttext` lines).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { htmlToParagraphs, contentHash, normalizeText } from '../src/index.js';
import { paragraphText } from '@wecom/shared';

const html = `
<h2>4. איטיות גלישה</h2>
<p>בקש מהלקוח להריץ <strong>Speedtest</strong>. מעל 6&nbsp;מגה – תקין.</p>
<ul><li>נתונים סלולריים – להדליק</li><li>Wi-Fi – לכבות</li></ul>
<h3>4.11 ריענון SIM</h3>
<table><tr><td>אם</td><td>ניצל 100%</td></tr></table>
<!-- wp:paragraph --><p>  </p><!-- /wp:paragraph -->
`;

describe('htmlToParagraphs', () => {
  it('produces stable refs by heading path', () => {
    const ps = htmlToParagraphs(html);
    expect(ps.map((p) => p.ref)).toEqual(['h2-1', 'h2-1.p-1', 'h2-1.ul-2', 'h2-1.h3-3', 'h2-1.h3-3.table-1']);
    expect(ps[0]).toMatchObject({ heading: '4. איטיות גלישה', level: 2 });
  });
  it('flattens lists and tables, decodes entities, drops empty blocks', () => {
    const ps = htmlToParagraphs(html);
    expect(paragraphText(ps[1])).toBe('בקש מהלקוח להריץ Speedtest. מעל 6 מגה – תקין.');
    expect(paragraphText(ps[2])).toBe('• נתונים סלולריים – להדליק\n• Wi-Fi – לכבות');
    expect(paragraphText(ps[4])).toBe('אם | ניצל 100%');
  });
  it('hashes deterministically and changes on edits', () => {
    const a = contentHash(htmlToParagraphs(html));
    expect(a).toMatch(/^[a-f0-9]{64}$/);
    expect(contentHash(htmlToParagraphs(html.replace('6&nbsp;מגה', '5&nbsp;מגה')))).not.toBe(a);
    expect(contentHash(htmlToParagraphs(html + '\n\n'))).toBe(a);
  });
  it('normalizes whitespace', () => { expect(normalizeText('  a \n\t b  ')).toBe('a b'); });
});
```

- [ ] **Step 2: Run to verify it fails** — `pnpm --filter @wecom/connectors test -- wordpress-html` → FAIL.

- [ ] **Step 3: Implement `html.ts`**

```ts
import { createHash } from 'node:crypto';
import { parse, HTMLElement, NodeType } from 'node-html-parser';
import type { Paragraph } from '@wecom/shared';

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&#8211;': '–', '&#8212;': '—' };
export const normalizeText = (s: string): string =>
  s.replace(/&#?\w+;/g, (e) => ENTITIES[e] ?? e).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

const BLOCKS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'table', 'blockquote', 'pre', 'figure']);

function blockText(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  if (tag === 'ul' || tag === 'ol') return el.querySelectorAll(':scope > li').map((li, i) => (tag === 'ol' ? i + 1 + '. ' : '• ') + normalizeText(li.text)).join('\n');
  if (tag === 'table') return el.querySelectorAll('tr').map((tr) => tr.querySelectorAll('th,td').map((c) => normalizeText(c.text)).join(' | ')).join('\n');
  return normalizeText(el.text);
}

export function htmlToParagraphs(html: string): Paragraph[] {
  const root = parse(html, { comment: false });
  const out: Paragraph[] = [];
  const path: { level: number; ref: string }[] = [];
  const counters = new Map<string, number>();       // parent ref → running index
  const nextIndex = (parent: string) => { const n = (counters.get(parent) ?? 0) + 1; counters.set(parent, n); return n; };
  const walk = (node: HTMLElement) => {
    for (const child of node.childNodes) {
      if (child.nodeType !== NodeType.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName?.toLowerCase();
      if (!tag) continue;
      if (!BLOCKS.has(tag)) { walk(el); continue; }
      const text = blockText(el);
      if (!text) continue;
      const isHeading = /^h[1-6]$/.test(tag);
      if (isHeading) { const level = Number(tag[1]); while (path.length && path[path.length - 1].level >= level) path.pop(); }
      const parent = path.length ? path[path.length - 1].ref : '';
      const ref = (parent ? parent + '.' : '') + tag + '-' + nextIndex(parent);
      const p: Paragraph = { ref, runs: [{ t: text }] };
      if (isHeading) { p.heading = text; p.level = Number(tag[1]); path.push({ level: p.level, ref }); }
      out.push(p);
    }
  };
  walk(root);
  return out;
}

export const paragraphsText = (ps: Paragraph[]): string => ps.map((p) => p.ref + '\t' + p.runs.filter((r) => !r.del).map((r) => r.t).join('')).join('\n');
export const contentHash = (ps: Paragraph[]): string => createHash('sha256').update(paragraphsText(ps), 'utf8').digest('hex');
```

Add `export * from './wordpress/html.js';` to `src/index.ts`.

- [ ] **Step 4: Run the test** — PASS (4 tests).
- [ ] **Step 5: Commit** — `git add packages/connectors && git commit -m "feat(connectors): html to paragraphs with stable refs and content hash"`.

---

### Task 3: `listRemote` with pagination and `modified_after`

**Files:**
- Modify: `packages/connectors/src/wordpress/connector.ts`
- Test: `packages/connectors/test/wordpress-connector.test.ts` (append)

**Interfaces:**
- Produces: `listRemote(cfg, since?)` → `RemoteItem[]` with `externalId = "<type>:<id>"`, `kind = type`, `hash = contentHash(htmlToParagraphs(content))`, `updatedAt = modified_gmt + 'Z'`, `url = link`; iterates every `postTypes` entry and every page (`per_page=100`).

- [ ] **Step 1: Append the failing test**

```ts
describe('listRemote', () => {
  it('walks all pages of every post type and filters by since', async () => {
    for (let i = 1; i <= 150; i++) stub.posts.set('pages:' + i, { id: i, title: { rendered: 'עמוד ' + i }, content: { rendered: '<p>תוכן ' + i + '</p>' }, modified_gmt: i > 120 ? '2025-07-01T00:00:00' : '2025-05-01T00:00:00', link: 'http://wp/p' + i, status: 'publish' });
    const c = new WordPressConnector();
    const all = await c.listRemote({ ...cfg(), postTypes: ['posts', 'pages'] });
    expect(all.length).toBe(151);
    expect(all[0]).toMatchObject({ externalId: 'posts:7', kind: 'posts', updatedAt: '2025-06-12T10:00:00Z', url: 'http://wp/7' });
    expect(all[0].hash).toMatch(/^[a-f0-9]{64}$/);
    const recent = await c.listRemote({ ...cfg(), postTypes: ['pages'] }, '2025-06-01T00:00:00Z');
    expect(recent.length).toBe(30);
  });
});
```

- [ ] **Step 2: Run** — FAIL (`not implemented`).

- [ ] **Step 3: Implement**

Replace the `listRemote` method:
```ts
  async listRemote(cfg: WpConfig, since?: string): Promise<RemoteItem[]> {
    const client = this.client(cfg);
    const out: RemoteItem[] = [];
    for (const type of cfg.postTypes) {
      for (let page = 1; ; page++) {
        const { items, totalPages } = await client.listPosts(type, { modifiedAfter: since?.replace(/Z$/, ''), page, perPage: 100 });
        for (const p of items) out.push({ externalId: `${type}:${p.id}`, title: normalizeText(p.title.rendered), hash: contentHash(htmlToParagraphs(p.content.rendered)), updatedAt: p.modified_gmt + 'Z', kind: type, url: p.link });
        if (page >= totalPages) break;
      }
    }
    return out;
  }
```
with imports `import { contentHash, htmlToParagraphs, normalizeText } from './html.js';`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add packages/connectors && git commit -m "feat(connectors): wordpress listRemote with pagination"`.

---

### Task 4: `fetch` → `SourceContent`

**Files:**
- Modify: `packages/connectors/src/wordpress/connector.ts`
- Test: append to `wordpress-connector.test.ts`

**Interfaces:**
- Produces: `fetch(cfg, externalId)` → `{ title, paragraphs, raw: html, hash, meta: { type, id, link, status, modifiedAt, categories } }`; throws `WpError(404)` for unknown ids; `externalId` must match `/^\w+:\d+$/`.

- [ ] **Step 1: Append the failing test**

```ts
describe('fetch', () => {
  it('returns normalized paragraphs, raw html, hash and meta', async () => {
    const c = new WordPressConnector();
    const s = await c.fetch(cfg(), 'posts:7');
    expect(s.title).toBe('איטיות גלישה');
    expect(s.paragraphs.map((p) => p.ref)).toEqual(['h2-1', 'h2-1.p-1']);
    expect(s.raw).toContain('<h2>');
    expect(s.hash).toBe((await c.listRemote(cfg()))[0].hash);
    expect(s.meta).toMatchObject({ type: 'posts', id: 7, link: 'http://wp/7', status: 'publish' });
  });
  it('rejects malformed ids and missing posts', async () => {
    await expect(new WordPressConnector().fetch(cfg(), 'bad')).rejects.toThrow(/externalId/);
    await expect(new WordPressConnector().fetch(cfg(), 'posts:999')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
  static parseExternalId(externalId: string): { type: string; id: number } {
    const m = /^(\w+):(\d+)$/.exec(externalId);
    if (!m) throw new Error('invalid externalId: ' + externalId);
    return { type: m[1], id: Number(m[2]) };
  }
  async fetch(cfg: WpConfig, externalId: string): Promise<SourceContent> {
    const { type, id } = WordPressConnector.parseExternalId(externalId);
    const p = await this.client(cfg).getPost(type, id);
    const paragraphs = htmlToParagraphs(p.content.rendered);
    return { title: normalizeText(p.title.rendered), paragraphs, raw: p.content.rendered, hash: contentHash(paragraphs), meta: { type, id, link: p.link, status: p.status, modifiedAt: p.modified_gmt + 'Z', categories: p.categories ?? [] } };
  }
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(connectors): wordpress fetch to SourceContent"` (after `git add packages/connectors`).

---

### Task 5: Deterministic WordPress HTML renderer

**Files:**
- Create: `packages/connectors/src/render/wpHtml.ts`
- Modify: `packages/connectors/src/index.ts` (export)
- Test: `packages/connectors/test/wpHtml-render.test.ts`

**Interfaces:**
- Produces: `renderWpHtml(content: LibraryContent): string` — Gutenberg-compatible HTML: phases as `<h2>`, steps as `<h3 data-kb-step="s1">`, actions `<ul>`, outcomes `<p class="kb-outcomes">`, branches `<table class="kb-branch">`, scripts `<blockquote class="kb-script">`, shared blocks inlined inside `<div data-kb-block="<blockId>">`; `fmt` from `@wecom/shared` is used with `noCrm: true` and no docs (WordPress is customer-facing, CRM chips are stripped to plain text). Round-trip guarantee: `htmlToParagraphs(renderWpHtml(c))` yields one paragraph per rendered block with every action text preserved.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { renderWpHtml, htmlToParagraphs } from '../src/index.js';
import { paragraphText, type Document, type Block } from '@wecom/shared';

const BLOCK = '33333333-3333-4333-8333-333333333333';
const block: Block = { id: BLOCK, slug: 'sim-refresh', title: 'ריענון SIM', kind: 'step', actions: [{ id: 'b1', text: 'CRM ← sim block lbl ← שמור' }, { id: 'b2', text: 'בקש מהלקוח לאתחל מכשיר' }], outcomes: [], currentVersion: 2, updatedAt: '2025-06-12T00:00:00.000Z' };
const doc = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'browsing', title: 'איטיות גלישה', description: 'נוהל דיבאג', category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7, related: [],
  createdAt: '2025-06-12T00:00:00.000Z', updatedAt: '2025-06-12T00:00:00.000Z',
  phases: [{ id: 'p1', label: 'שלב 1 – מסנן', steps: [
    { key: 's1', num: '1', title: 'בדיקת חסימה', actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה **"גלישה בארץ"**' }], outcomes: [{ kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' }], blockRefs: [], deps: [] },
    { key: 's2', num: '2', title: 'סיום חבילה', actions: [], outcomes: [], branch: { q: 'מה מוצג?', options: [{ kind: 'if', label: 'ניצל 100%', text: 'הצע חבילה' }, { kind: 'then', label: 'פעילה', text: 'המשך' }] }, script: '"מה מוצג?"', blockRefs: [], deps: [] },
    { key: 's3', num: '3', title: 'ריענון SIM', blockId: BLOCK, actions: [], outcomes: [], blockRefs: [], deps: [] },
  ] }],
} as unknown as Document;

describe('renderWpHtml', () => {
  it('is deterministic and structured', () => {
    const html = renderWpHtml({ document: doc, html: '', blocks: [block] });
    expect(html).toBe(renderWpHtml({ document: doc, html: '', blocks: [block] }));
    expect(html).toContain('<h2>שלב 1 – מסנן</h2>');
    expect(html).toContain('<h3 data-kb-step="s1">1. בדיקת חסימה</h3>');
    expect(html).toContain('<li>פתח CRM ↗ שדה <b>"גלישה בארץ"</b></li>');
    expect(html).toContain('<table class="kb-branch">');
    expect(html).toContain('<blockquote class="kb-script">"מה מוצג?"</blockquote>');
    expect(html).toContain(`<div data-kb-block="${BLOCK}">`);
    expect(html).toContain('<li>בקש מהלקוח לאתחל מכשיר</li>');
    expect(html).not.toContain('class="crm');
  });
  it('round-trips through htmlToParagraphs', () => {
    const ps = htmlToParagraphs(renderWpHtml({ document: doc, html: '', blocks: [block] }));
    const text = ps.map(paragraphText).join('\n');
    expect(text).toContain('• פתח CRM ↗ שדה "גלישה בארץ"');
    expect(text).toContain('ניצל 100% | הצע חבילה');
    expect(ps.find((p) => p.heading === '3. ריענון SIM')).toBeDefined();
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement `render/wpHtml.ts`**

```ts
import { escapeHtml, fmt, type Block, type Step } from '@wecom/shared';
import type { LibraryContent } from '../contract.js';

const t = (s: string) => fmt(s, { fields: [], noCrm: true });   // bold + bidi isolation only

function renderStep(s: Step, blocks: Map<string, Block>): string {
  const b = s.blockId ? blocks.get(s.blockId) : undefined;
  const actions = b?.actions ?? s.actions;
  const outcomes = s.outcomes.length ? s.outcomes : (b?.outcomes ?? []);
  const script = s.script ?? b?.script;
  const parts: string[] = [`<h3 data-kb-step="${escapeHtml(s.key)}">${escapeHtml(s.num)}. ${t(s.title || b?.title || '')}</h3>`];
  if (s.description) parts.push(`<p>${t(s.description)}</p>`);
  const inner: string[] = [];
  if (actions.length) inner.push('<ul>' + actions.map((a) => `<li>${t(a.text)}</li>`).join('') + '</ul>');
  if (script) inner.push(`<blockquote class="kb-script">${t(script)}</blockquote>`);
  if (s.branch) inner.push(`<table class="kb-branch"><thead><tr><th colspan="2">${t(s.branch.q)}</th></tr></thead><tbody>` + s.branch.options.map((o) => `<tr><td>${t(o.label)}</td><td>${t(o.text)}</td></tr>`).join('') + '</tbody></table>');
  if (outcomes.length) inner.push(`<p class="kb-outcomes">${outcomes.map((o) => t(o.text)).join(' · ')}</p>`);
  parts.push(b ? `<div data-kb-block="${escapeHtml(b.id)}">${inner.join('')}</div>` : inner.join(''));
  return parts.join('\n');
}

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
```

Add `export * from './render/wpHtml.js';` to `src/index.ts`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add packages/connectors && git commit -m "feat(connectors): deterministic wordpress html renderer"`.

---

### Task 6: `push` (create or update) with category mapping

**Files:**
- Modify: `packages/connectors/src/wordpress/connector.ts`
- Test: append to `wordpress-connector.test.ts`

**Interfaces:**
- Produces: `push(cfg, externalId | null, content)` → `RemoteRef { externalId: "<type>:<id>", url, hash, updatedAt }`; when `externalId` is null creates a post of type `cfg.postTypes[0]` with `status: 'publish'`; body `content` is `content.html` if non-empty else `renderWpHtml(content)`; `hash` is computed from the HTML that was sent (so the baseline matches what `listRemote` will report).

- [ ] **Step 1: Append the failing test**

```ts
describe('push', () => {
  const content = () => ({ document: { ...(JSON.parse(JSON.stringify(docFixture)) as Document), title: 'מסמך חדש' }, html: '', blocks: [] as Block[] });
  it('creates a new post when externalId is null', async () => {
    const ref = await new WordPressConnector().push(cfg(), null, content());
    expect(ref.externalId).toMatch(/^posts:\d+$/);
    const put = stub.puts[stub.puts.length - 1];
    expect(put).toMatchObject({ type: 'posts', id: null });
    expect((put.body as { title: string }).title).toBe('מסמך חדש');
    expect((put.body as { content: string }).content).toContain('<h3 data-kb-step=');
    expect(ref.hash).toBe(contentHash(htmlToParagraphs((put.body as { content: string }).content)));
  });
  it('updates an existing post', async () => {
    const ref = await new WordPressConnector().push(cfg(), 'posts:7', { ...content(), html: '<p>ידני</p>' });
    expect(ref.externalId).toBe('posts:7');
    expect(stub.posts.get('posts:7')?.content.rendered).toBe('<p>ידני</p>');
  });
});
```
(Add at the top of the test file `import { contentHash, htmlToParagraphs } from '../src/index.js'; import type { Document, Block } from '@wecom/shared';` and a `docFixture` constant equal to the `doc` object from Task 5's test.)

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
  async push(cfg: WpConfig, externalId: string | null, content: LibraryContent): Promise<RemoteRef> {
    const html = content.html && content.html.trim() ? content.html : renderWpHtml(content);
    const client = this.client(cfg);
    const post = externalId
      ? await (async () => { const { type, id } = WordPressConnector.parseExternalId(externalId); return { type, post: await client.updatePost(type, id, { title: content.document.title, content: html }) }; })()
      : await (async () => { const type = cfg.postTypes[0]; return { type, post: await client.createPost(type, { title: content.document.title, content: html, status: 'publish' }) }; })();
    return { externalId: `${post.type}:${post.post.id}`, url: post.post.link, hash: contentHash(htmlToParagraphs(html)), updatedAt: post.post.modified_gmt + 'Z' };
  }
```
Import `renderWpHtml` from `../render/wpHtml.js`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add packages/connectors && git commit -m "feat(connectors): wordpress push (create/update)"`.

---

### Task 7: Webhook HMAC parsing and the WordPress plugin

**Files:**
- Create: `packages/connectors/src/wordpress/webhook.ts`, `deploy/wp-plugin/kb-sync.php`, `deploy/wp-plugin/README.md`
- Modify: `packages/connectors/src/wordpress/connector.ts`, `packages/connectors/src/index.ts`
- Test: `packages/connectors/test/wordpress-webhook.test.ts`

**Interfaces:**
- Produces: `signBody(secret: string, rawBody: string): string` (hex HMAC-SHA256), `verifySignature(secret, rawBody, signature): boolean` (timing-safe), `WebhookBodySchema = { event: 'save_post' | 'delete_post', post_type: string, post_id: number, modified_gmt: string }`; `parseWebhook(cfg, headers, body)` where `body` is `{ raw: string }` (the API passes the raw request body so the signature can be checked) → `RemoteChange[]` (`kind: 'deleted'` for `delete_post`, else `'updated'`); throws `Error('invalid signature')` otherwise.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { signBody, verifySignature, WordPressConnector, WpConfigSchema } from '../src/index.js';

const cfg = WpConfigSchema.parse({ baseUrl: 'http://wp', username: 'u', applicationPassword: 'p', postTypes: ['posts'], webhookSecret: 'topsecret1' });
const raw = JSON.stringify({ event: 'save_post', post_type: 'posts', post_id: 7, modified_gmt: '2025-06-12T10:00:00' });

describe('webhook', () => {
  it('signs and verifies', () => {
    const sig = signBody('topsecret1', raw);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySignature('topsecret1', raw, sig)).toBe(true);
    expect(verifySignature('topsecret1', raw + ' ', sig)).toBe(false);
    expect(verifySignature('topsecret1', raw, 'zz')).toBe(false);
  });
  it('parses a signed save_post into a RemoteChange', async () => {
    const changes = await new WordPressConnector().parseWebhook(cfg, { 'x-kb-signature': signBody('topsecret1', raw) }, { raw });
    expect(changes).toEqual([{ externalId: 'posts:7', kind: 'updated', at: '2025-06-12T10:00:00Z' }]);
  });
  it('rejects a bad signature', async () => {
    await expect(new WordPressConnector().parseWebhook(cfg, { 'x-kb-signature': 'nope' }, { raw })).rejects.toThrow(/invalid signature/);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`webhook.ts`:
```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
export const signBody = (secret: string, rawBody: string): string => createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
export function verifySignature(secret: string, rawBody: string, signature: string | undefined): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const a = Buffer.from(signBody(secret, rawBody), 'hex'), b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
export const WebhookBodySchema = z.object({ event: z.enum(['save_post', 'delete_post']), post_type: z.string().min(1), post_id: z.number().int().positive(), modified_gmt: z.string() });
```

In `connector.ts`:
```ts
  async parseWebhook(cfg: WpConfig, headers: Record<string, string>, body: unknown): Promise<RemoteChange[]> {
    const raw = (body as { raw?: string })?.raw ?? '';
    const sig = headers['x-kb-signature'] ?? headers['X-KB-Signature'];
    if (!verifySignature(cfg.webhookSecret, raw, sig)) throw new Error('invalid signature');
    const b = WebhookBodySchema.parse(JSON.parse(raw));
    return [{ externalId: `${b.post_type}:${b.post_id}`, kind: b.event === 'delete_post' ? 'deleted' : 'updated', at: b.modified_gmt.endsWith('Z') ? b.modified_gmt : b.modified_gmt + 'Z' }];
  }
```
Export `webhook.js` from `src/index.ts`.

`deploy/wp-plugin/kb-sync.php`:
```php
<?php
/**
 * Plugin Name: KB Sync
 * Description: Notifies the wecom knowledge platform when a post is saved or deleted (HMAC-signed webhook).
 * Version: 1.0.0
 */
if (!defined('ABSPATH')) exit;

define('KB_SYNC_OPTION', 'kb_sync_settings');

function kb_sync_settings() {
  $s = get_option(KB_SYNC_OPTION, []);
  return ['url' => $s['url'] ?? '', 'secret' => $s['secret'] ?? '', 'types' => $s['types'] ?? 'post,page'];
}

function kb_sync_send($event, $post_id, $post) {
  $s = kb_sync_settings();
  if (!$s['url'] || !$s['secret']) return;
  $types = array_map('trim', explode(',', $s['types']));
  if (!in_array($post->post_type, $types, true)) return;
  if (wp_is_post_revision($post_id) || wp_is_post_autosave($post_id)) return;
  $rest_type = $post->post_type === 'post' ? 'posts' : ($post->post_type === 'page' ? 'pages' : $post->post_type);
  $body = wp_json_encode(['event' => $event, 'post_type' => $rest_type, 'post_id' => (int) $post_id, 'modified_gmt' => str_replace(' ', 'T', $post->post_modified_gmt)]);
  $sig = hash_hmac('sha256', $body, $s['secret']);
  wp_remote_post($s['url'], ['timeout' => 5, 'blocking' => false, 'headers' => ['Content-Type' => 'application/json', 'X-KB-Signature' => $sig], 'body' => $body]);
}

add_action('save_post', function ($post_id, $post, $update) { if ($post->post_status === 'publish' || $post->post_status === 'draft') kb_sync_send('save_post', $post_id, $post); }, 10, 3);
add_action('before_delete_post', function ($post_id, $post) { kb_sync_send('delete_post', $post_id, $post); }, 10, 2);

add_action('admin_menu', function () {
  add_options_page('KB Sync', 'KB Sync', 'manage_options', 'kb-sync', function () {
    if (isset($_POST['kb_sync']) && check_admin_referer('kb_sync_save')) {
      update_option(KB_SYNC_OPTION, ['url' => esc_url_raw($_POST['kb_sync']['url']), 'secret' => sanitize_text_field($_POST['kb_sync']['secret']), 'types' => sanitize_text_field($_POST['kb_sync']['types'])]);
      echo '<div class="updated"><p>Saved.</p></div>';
    }
    $s = kb_sync_settings();
    echo '<div class="wrap"><h1>KB Sync</h1><form method="post">'; wp_nonce_field('kb_sync_save');
    echo '<table class="form-table"><tr><th>Webhook URL</th><td><input name="kb_sync[url]" class="regular-text" value="' . esc_attr($s['url']) . '" placeholder="https://kb.lan/api/v1/connectors/&lt;id&gt;/webhook"></td></tr>';
    echo '<tr><th>Shared secret</th><td><input name="kb_sync[secret]" class="regular-text" value="' . esc_attr($s['secret']) . '"></td></tr>';
    echo '<tr><th>Post types</th><td><input name="kb_sync[types]" class="regular-text" value="' . esc_attr($s['types']) . '"></td></tr></table>';
    submit_button('Save'); echo '</form></div>';
  });
});
```

`deploy/wp-plugin/README.md`: three lines — copy the folder to `wp-content/plugins/kb-sync`, activate, set the webhook URL (`/api/v1/connectors/<connectorId>/webhook`) and the same secret entered in the KB connector config.

- [ ] **Step 4: Run** — PASS. Also run `php -l deploy/wp-plugin/kb-sync.php` if PHP is installed (Expected: "No syntax errors").
- [ ] **Step 5: Commit** — `git add packages/connectors deploy/wp-plugin && git commit -m "feat(connectors): signed wordpress webhook parsing and wp plugin"`.

---

### Task 8: Read-only JSON/CSV file connector (static data files → cards)

**Files:**
- Create: `packages/connectors/src/json/config.ts`, `packages/connectors/src/json/connector.ts`
- Modify: `packages/connectors/src/index.ts`
- Test: `packages/connectors/test/json-connector.test.ts`

**Interfaces:**
- Produces: `JsonConfigSchema = { path: string (absolute file path on the server) | undefined; inline?: string; format: 'json' | 'csv'; mapping: { title: string; description?: string; category?: string; wave?: string; priority?: string; steps?: string /* column with newline-separated steps */; id?: string } }`; `JsonFileConnector implements Connector<JsonConfig>` with `capabilities { read: true, write: false, webhooks: false, identity: false }`; `listRemote` → one `RemoteItem` per row (`externalId = mapping.id column value or row index`, `hash` of the row JSON); `fetch(cfg, externalId)` → `SourceContent` whose paragraphs are `h2-1` (title), `h2-1.p-1` (description), `h2-1.p-<n>` per step line, `meta: { row, category, wave, priority }`; `push` rejects with `Error('read-only connector')`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { JsonFileConnector, JsonConfigSchema } from '../src/index.js';
import { paragraphText } from '@wecom/shared';

const rows = [{ id: 'T-41', title: 'דיבאג נטישה', desc: 'זיהוי לקוח מאותת', cat: 'ops', wave: 1, pri: 'hh', steps: 'זיהוי סימנים\nפתיחת שיחה' }, { id: 'T-19', title: 'Hotspot לא עובד', desc: '', cat: 'tech', wave: 2, pri: 'm', steps: '' }];
const cfg = JsonConfigSchema.parse({ inline: JSON.stringify(rows), format: 'json', mapping: { id: 'id', title: 'title', description: 'desc', category: 'cat', wave: 'wave', priority: 'pri', steps: 'steps' } });

describe('JsonFileConnector', () => {
  it('lists rows as remote items', async () => {
    const items = await new JsonFileConnector().listRemote(cfg);
    expect(items.map((i) => i.externalId)).toEqual(['T-41', 'T-19']);
    expect(items[0].title).toBe('דיבאג נטישה');
  });
  it('fetches a row as paragraphs with meta', async () => {
    const s = await new JsonFileConnector().fetch(cfg, 'T-41');
    expect(s.paragraphs.map((p) => [p.ref, paragraphText(p)])).toEqual([['h2-1', 'דיבאג נטישה'], ['h2-1.p-1', 'זיהוי לקוח מאותת'], ['h2-1.p-2', 'זיהוי סימנים'], ['h2-1.p-3', 'פתיחת שיחה']]);
    expect(s.meta).toMatchObject({ category: 'ops', wave: 1, priority: 'hh' });
  });
  it('parses csv with a header row', async () => {
    const csv = JsonConfigSchema.parse({ inline: 'title,cat\n"בירור חיוב",billing\n', format: 'csv', mapping: { title: 'title', category: 'cat' } });
    const items = await new JsonFileConnector().listRemote(csv);
    expect(items).toHaveLength(1);
    expect((await new JsonFileConnector().fetch(csv, items[0].externalId)).meta).toMatchObject({ category: 'billing' });
  });
  it('is read-only', async () => {
    await expect(new JsonFileConnector().push(cfg, null, {} as never)).rejects.toThrow(/read-only/);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`json/config.ts`:
```ts
import { z } from 'zod';
export const JsonConfigSchema = z.object({
  path: z.string().min(1).optional(),
  inline: z.string().optional(),
  format: z.enum(['json', 'csv']),
  mapping: z.object({ id: z.string().optional(), title: z.string().min(1), description: z.string().optional(), category: z.string().optional(), wave: z.string().optional(), priority: z.string().optional(), steps: z.string().optional() }),
}).refine((c) => c.path || c.inline, { message: 'path or inline is required' });
export type JsonConfig = z.infer<typeof JsonConfigSchema>;
```

`json/connector.ts`:
```ts
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { Paragraph } from '@wecom/shared';
import type { Connector, ConnectorInfo, LibraryContent, RemoteItem, RemoteRef, SourceContent } from '../contract.js';
import { JsonConfigSchema, type JsonConfig } from './config.js';

type Row = Record<string, unknown>;
const hash = (s: string) => createHash('sha256').update(s, 'utf8').digest('hex');

export function parseCsv(text: string): Row[] {
  const lines = text.replace(/\r/g, '').split('\n').filter((l) => l.trim().length);
  const split = (l: string) => { const out: string[] = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map((c) => c.trim()); };
  const head = split(lines[0] ?? '');
  return lines.slice(1).map((l) => Object.fromEntries(split(l).map((v, i) => [head[i] ?? String(i), v])));
}

export class JsonFileConnector implements Connector<JsonConfig> {
  configSchema = JsonConfigSchema;
  describe(): ConnectorInfo { return { id: 'json', name: 'קובץ JSON / CSV', capabilities: { read: true, write: false, webhooks: false, identity: false } }; }
  private async rows(cfg: JsonConfig): Promise<Row[]> {
    const text = cfg.inline ?? (await readFile(cfg.path as string, 'utf8'));
    if (cfg.format === 'csv') return parseCsv(text);
    const j = JSON.parse(text) as unknown;
    const arr = Array.isArray(j) ? j : (j as { rows?: unknown[]; topics?: unknown[]; docs?: unknown[] }).rows ?? (j as { topics?: unknown[] }).topics ?? (j as { docs?: unknown[] }).docs ?? [];
    return arr as Row[];
  }
  private idOf(cfg: JsonConfig, row: Row, i: number) { const v = cfg.mapping.id ? row[cfg.mapping.id] : undefined; return v == null || v === '' ? 'row-' + (i + 1) : String(v); }
  async testConnection(cfg: JsonConfig) { try { const n = (await this.rows(cfg)).length; return { ok: true, message: `נקראו ${n} שורות` }; } catch (e) { return { ok: false, message: 'הקובץ לא נקרא: ' + (e instanceof Error ? e.message : String(e)) }; } }
  async listRemote(cfg: JsonConfig): Promise<RemoteItem[]> {
    const rows = await this.rows(cfg);
    return rows.map((r, i) => ({ externalId: this.idOf(cfg, r, i), title: String(r[cfg.mapping.title] ?? ''), hash: hash(JSON.stringify(r)), updatedAt: new Date(0).toISOString(), kind: cfg.format }));
  }
  async fetch(cfg: JsonConfig, externalId: string): Promise<SourceContent> {
    const rows = await this.rows(cfg);
    const i = rows.findIndex((r, idx) => this.idOf(cfg, r, idx) === externalId);
    if (i < 0) throw new Error('row not found: ' + externalId);
    const r = rows[i]; const m = cfg.mapping;
    const title = String(r[m.title] ?? '');
    const paragraphs: Paragraph[] = [{ ref: 'h2-1', heading: title, level: 2, runs: [{ t: title }] }];
    let n = 1;
    const desc = m.description ? String(r[m.description] ?? '') : '';
    if (desc) paragraphs.push({ ref: 'h2-1.p-' + n++, runs: [{ t: desc }] });
    const steps = m.steps ? String(r[m.steps] ?? '').split(/\n+/).map((s) => s.trim()).filter(Boolean) : [];
    for (const s of steps) paragraphs.push({ ref: 'h2-1.p-' + n++, runs: [{ t: s }] });
    return { title, paragraphs, hash: hash(JSON.stringify(r)), meta: { row: i, category: m.category ? r[m.category] : undefined, wave: m.wave ? Number(r[m.wave]) || undefined : undefined, priority: m.priority ? r[m.priority] : undefined } };
  }
  async push(_cfg: JsonConfig, _externalId: string | null, _content: LibraryContent): Promise<RemoteRef> { throw new Error('read-only connector'); }
}
```
Export both from `src/index.ts`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add packages/connectors && git commit -m "feat(connectors): read-only json/csv file connector"`.

---

### Task 9: API migration for connectors + sync links, and AES-256-GCM config encryption

**Files:**
- Create: `apps/api/migrations/0008_connectors.js`, `apps/api/src/modules/connectors/crypto.ts`
- Modify: `apps/api/src/config.ts` (add `CONNECTOR_KEY: z.string().regex(/^[0-9a-f]{64}$/)`, default in test/dev to `'00'.repeat(32)`)
- Test: `apps/api/test/connectors-crypto.test.ts`, extend `apps/api/test/migrations.test.ts` table list with `connectors`, `sync_links`

**Interfaces:**
- Produces: `encryptConfig(keyHex: string, obj: unknown): Buffer` (12-byte IV ‖ 16-byte tag ‖ ciphertext), `decryptConfig<T>(keyHex: string, buf: Buffer): T`; tables:
  - `connectors(id uuid pk, type text, name text, config_encrypted bytea, enabled bool default true, schedule text default '*/15 * * * *', last_run_at timestamptz, last_status text, health jsonb default '{}', created_at, updated_at, created_by uuid)`
  - `sync_links(id uuid pk, document_id uuid → documents cascade, connector_id uuid → connectors cascade, external_id text, source_id uuid → sources, base_remote_hash text, base_local_version int, remote_url text, last_synced_at timestamptz, state text default 'synced' check in (synced,pending_import,pending_push,conflict), conflict jsonb, unique(connector_id, external_id), unique(document_id, connector_id))`

- [ ] **Step 1: Write the failing tests**

`apps/api/test/connectors-crypto.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { encryptConfig, decryptConfig } from '../src/modules/connectors/crypto.js';
const key = 'ab'.repeat(32);
describe('connector config encryption', () => {
  it('round-trips and is non-deterministic', () => {
    const a = encryptConfig(key, { applicationPassword: 'xxxx yyyy', baseUrl: 'http://wp' });
    const b = encryptConfig(key, { applicationPassword: 'xxxx yyyy', baseUrl: 'http://wp' });
    expect(a.equals(b)).toBe(false);
    expect(decryptConfig(key, a)).toEqual({ applicationPassword: 'xxxx yyyy', baseUrl: 'http://wp' });
  });
  it('fails on tampering or wrong key', () => {
    const a = encryptConfig(key, { x: 1 }); a[a.length - 1] ^= 0xff;
    expect(() => decryptConfig(key, a)).toThrow();
    expect(() => decryptConfig('cd'.repeat(32), encryptConfig(key, { x: 1 }))).toThrow();
  });
});
```
In `migrations.test.ts`, add `'connectors', 'sync_links'` to the expected table list and change the `down` count to 8.

- [ ] **Step 2: Run** — `pnpm --filter @wecom/api test -- connectors-crypto` → FAIL.

- [ ] **Step 3: Implement**

`crypto.ts`:
```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
const keyOf = (hex: string) => { if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('CONNECTOR_KEY must be 32 bytes hex'); return Buffer.from(hex, 'hex'); };
export function encryptConfig(keyHex: string, obj: unknown): Buffer {
  const iv = randomBytes(12); const c = createCipheriv('aes-256-gcm', keyOf(keyHex), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}
export function decryptConfig<T = unknown>(keyHex: string, buf: Buffer): T {
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), enc = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', keyOf(keyHex), iv); d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8')) as T;
}
```

`0008_connectors.js`:
```js
const id = (pgm) => ({ type: 'uuid', primaryKey: true, default: pgm.func('gen_random_uuid()') });
exports.up = (pgm) => {
  pgm.createTable('connectors', { id: id(pgm), type: { type: 'text', notNull: true }, name: { type: 'text', notNull: true }, config_encrypted: { type: 'bytea', notNull: true }, enabled: { type: 'boolean', notNull: true, default: true }, schedule: { type: 'text', notNull: true, default: '*/15 * * * *' }, last_run_at: 'timestamptz', last_status: 'text', health: { type: 'jsonb', notNull: true, default: '{}' }, created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, created_by: { type: 'uuid', references: 'users' } });
  pgm.addConstraint('sources', 'sources_connector_fk', { foreignKeys: { columns: 'connector_id', references: 'connectors', onDelete: 'set null' } });
  pgm.createTable('sync_links', { id: id(pgm), document_id: { type: 'uuid', notNull: true, references: 'documents', onDelete: 'cascade' }, connector_id: { type: 'uuid', notNull: true, references: 'connectors', onDelete: 'cascade' }, external_id: { type: 'text', notNull: true }, source_id: { type: 'uuid', references: 'sources', onDelete: 'set null' }, base_remote_hash: 'text', base_local_version: { type: 'integer', notNull: true, default: 0 }, remote_url: 'text', last_synced_at: 'timestamptz', state: { type: 'text', notNull: true, default: 'synced', check: "state in ('synced','pending_import','pending_push','conflict')" }, conflict: 'jsonb', created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') }, updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') } });
  pgm.addConstraint('sync_links', 'sync_links_remote_unique', { unique: ['connector_id', 'external_id'] });
  pgm.addConstraint('sync_links', 'sync_links_document_unique', { unique: ['document_id', 'connector_id'] });
};
exports.down = (pgm) => { pgm.dropTable('sync_links'); pgm.dropConstraint('sources', 'sources_connector_fk'); pgm.dropTable('connectors'); };
```

`config.ts`: add `CONNECTOR_KEY: z.string().regex(/^[0-9a-f]{64}$/i).default('00'.repeat(32))` (production deploy sets a real key; L1's `.env.example` documents `openssl rand -hex 32`).

- [ ] **Step 4: Run** — `pnpm --filter @wecom/api test -- connectors-crypto` PASS; `pnpm --filter @wecom/api test:int -- migrations` PASS.
- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): connectors and sync_links tables, config encryption"`.

---

### Task 10: Connectors repository, registry and CRUD/test/run/webhook routes

**Files:**
- Create: `apps/api/src/modules/connectors/repo.ts`, `apps/api/src/modules/connectors/registry.ts`, `apps/api/src/modules/connectors/routes.ts`, `apps/api/src/modules/connectors/index.ts`
- Modify: `apps/api/src/app.ts` (register `connectorsModule` under `/api/v1`), `packages/shared/src/schemas/api.ts` (add `ConnectorSchema`, `ConnectorCreateBodySchema`, `ConnectorPatchBodySchema`, `SyncLinkSchema`, `SyncResolveBodySchema` — additive, allowed by ADR 0001)
- Test: `apps/api/test/connectors-routes.test.ts` (uses `buildApp` with a testcontainers pool; L3's auth middleware is stubbed by injecting `app.decorateRequest('user', ...)` through the `testUser` option described below)

**Interfaces:**
- Produces:
```ts
// shared/schemas/api.ts (additive)
ConnectorSchema = { id, type: string, name, enabled: boolean, schedule: string, lastRunAt: string|null, lastStatus: string|null, health: Record<string, unknown>, configMasked: Record<string, unknown>, capabilities: { read, write, webhooks, identity } }
ConnectorCreateBodySchema = { type: string, name: string, config: Record<string, unknown>, schedule?: string, enabled?: boolean }
ConnectorPatchBodySchema = ConnectorCreateBodySchema.partial()
SyncLinkSchema = { id, documentId, documentTitle, connectorId, externalId, remoteUrl: string|null, state, baseRemoteHash: string|null, baseLocalVersion: number, lastSyncedAt: string|null, conflict: unknown|null }
SyncResolveBodySchema = { resolution: 'ours' | 'theirs' | 'merged', merged?: Document }
// repo.ts
class ConnectorsRepo { constructor(db: Pool, keyHex: string); list(); get(id); create(body, actorId); update(id, patch); remove(id); config<T>(id): Promise<T>; setRun(id, status, health); links(connectorId); linkByRemote(connectorId, externalId); linkByDocument(connectorId, documentId); upsertLink(link); setLinkState(id, state, conflict?); }
// registry.ts
buildRegistry(): ConnectorRegistry   // registers new WordPressConnector(), new JsonFileConnector()
```
- Routes: `GET /connectors`, `POST /connectors`, `GET /connectors/:id`, `PATCH /connectors/:id`, `DELETE /connectors/:id`, `POST /connectors/:id/test`, `POST /connectors/:id/run` (enqueues `connector.run`, returns `{ jobId }`), `POST /connectors/:id/webhook` (raw body; enqueues `connector.webhook`; 401 on bad signature), `GET /connectors/:id/links`. Test-only hook: `buildApp({ testUser: { id, permissions } })` sets `req.user` when L3's plugin is absent (remove once L3 lands — note in code).

- [ ] **Step 1: Write the failing route test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { buildApp } from '../src/app.js';
import { signBody } from '@wecom/connectors';
import { startWpStub, type WpStub } from '../../../packages/connectors/test/helpers/wpStub.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('connector routes', () => {
  let c: StartedPostgreSqlContainer, pool: pg.Pool, app: Awaited<ReturnType<typeof buildApp>>, stub: WpStub, userId: string;
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    await runner({ databaseUrl: c.getConnectionUri(), dir: 'migrations', direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined });
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    userId = (await pool.query("insert into users(subject, source, display_name) values ('t', 'local', 'בודק') returning id")).rows[0].id;
    stub = await startWpStub([]);
    app = await buildApp({ config: { DATABASE_URL: c.getConnectionUri(), NODE_ENV: 'test' }, pool, testUser: { id: userId, permissions: ['connectors.manage', 'suggestions.apply'] } });
  }, 180000);
  afterAll(async () => { await app.close(); await stub.close(); await c.stop(); });

  const body = () => ({ type: 'wordpress', name: 'אתר תמיכה', config: { baseUrl: stub.url, username: 'kb', applicationPassword: 'pw', postTypes: ['posts'], categoryMap: {}, webhookSecret: 'topsecret1' } });

  it('creates, masks secrets, tests, lists, patches and deletes', async () => {
    const created = await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() });
    expect(created.statusCode).toBe(201);
    const conn = created.json();
    expect(conn.configMasked.applicationPassword).toBe('••••');
    expect(conn.configMasked.baseUrl).toBe(stub.url);
    expect(conn.capabilities.write).toBe(true);
    const test = await app.inject({ method: 'POST', url: `/api/v1/connectors/${conn.id}/test` });
    expect(test.json().ok).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/api/v1/connectors' })).json().items).toHaveLength(1);
    const patched = await app.inject({ method: 'PATCH', url: `/api/v1/connectors/${conn.id}`, payload: { name: 'שם חדש', enabled: false } });
    expect(patched.json()).toMatchObject({ name: 'שם חדש', enabled: false });
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/connectors/${conn.id}` })).statusCode).toBe(204);
  });
  it('rejects invalid config for the connector type', async () => {
    const r = await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: { ...body(), config: { baseUrl: 'nope' } } });
    expect(r.statusCode).toBe(400);
  });
  it('accepts a signed webhook and rejects an unsigned one', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const raw = JSON.stringify({ event: 'save_post', post_type: 'posts', post_id: 7, modified_gmt: '2025-06-12T10:00:00' });
    const ok = await app.inject({ method: 'POST', url: `/api/v1/connectors/${conn.id}/webhook`, payload: raw, headers: { 'content-type': 'application/json', 'x-kb-signature': signBody('topsecret1', raw) } });
    expect(ok.statusCode).toBe(202);
    const bad = await app.inject({ method: 'POST', url: `/api/v1/connectors/${conn.id}/webhook`, payload: raw, headers: { 'content-type': 'application/json', 'x-kb-signature': 'ff'.repeat(32) } });
    expect(bad.statusCode).toBe(401);
  });
  it('forbids without permission', async () => {
    const noPerm = await buildApp({ config: { DATABASE_URL: c.getConnectionUri(), NODE_ENV: 'test' }, pool, testUser: { id: userId, permissions: ['docs.read'] } });
    expect((await noPerm.inject({ method: 'GET', url: '/api/v1/connectors' })).statusCode).toBe(403);
    await noPerm.close();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @wecom/api test:int -- connectors-routes` → FAIL.

- [ ] **Step 3: Implement**

Additions to `packages/shared/src/schemas/api.ts`:
```ts
export const ConnectorCapabilitiesSchema = z.object({ read: z.boolean(), write: z.boolean(), webhooks: z.boolean(), identity: z.boolean() });
export const ConnectorSchema = z.object({ id: IdSchema, type: z.string(), name: z.string(), enabled: z.boolean(), schedule: z.string(), lastRunAt: IsoDateSchema.nullable(), lastStatus: z.string().nullable(), health: z.record(z.unknown()), configMasked: z.record(z.unknown()), capabilities: ConnectorCapabilitiesSchema });
export const ConnectorCreateBodySchema = z.object({ type: z.string().min(1), name: z.string().min(1).max(80), config: z.record(z.unknown()), schedule: z.string().regex(/^(\S+\s+){4}\S+$/).optional(), enabled: z.boolean().optional() });
export const ConnectorPatchBodySchema = ConnectorCreateBodySchema.partial();
export const SyncLinkStateSchema = z.enum(['synced', 'pending_import', 'pending_push', 'conflict']);
export const SyncLinkSchema = z.object({ id: IdSchema, documentId: IdSchema, documentTitle: z.string(), connectorId: IdSchema, externalId: z.string(), remoteUrl: z.string().nullable(), state: SyncLinkStateSchema, baseRemoteHash: z.string().nullable(), baseLocalVersion: z.number().int(), lastSyncedAt: IsoDateSchema.nullable(), conflict: z.unknown().nullable() });
export const SyncResolveBodySchema = z.object({ resolution: z.enum(['ours', 'theirs', 'merged']), merged: DocumentSchema.optional() });
```

`repo.ts`:
```ts
import type pg from 'pg';
import { decryptConfig, encryptConfig } from './crypto.js';

export interface ConnectorRow { id: string; type: string; name: string; enabled: boolean; schedule: string; last_run_at: Date | null; last_status: string | null; health: Record<string, unknown>; config_encrypted: Buffer }
export interface SyncLinkRow { id: string; document_id: string; connector_id: string; external_id: string; source_id: string | null; base_remote_hash: string | null; base_local_version: number; remote_url: string | null; last_synced_at: Date | null; state: 'synced' | 'pending_import' | 'pending_push' | 'conflict'; conflict: unknown | null }
const SECRET_KEYS = /password|secret|token|key/i;
export const maskConfig = (c: Record<string, unknown>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, SECRET_KEYS.test(k) ? '••••' : v]));

export class ConnectorsRepo {
  constructor(private db: pg.Pool, private keyHex: string) {}
  async list(): Promise<ConnectorRow[]> { return (await this.db.query<ConnectorRow>('select * from connectors order by created_at')).rows; }
  async get(id: string): Promise<ConnectorRow | null> { return (await this.db.query<ConnectorRow>('select * from connectors where id=$1', [id])).rows[0] ?? null; }
  async create(b: { type: string; name: string; config: Record<string, unknown>; schedule?: string; enabled?: boolean }, actorId: string | null): Promise<ConnectorRow> {
    const r = await this.db.query<ConnectorRow>('insert into connectors(type,name,config_encrypted,schedule,enabled,created_by) values ($1,$2,$3,coalesce($4,\'*/15 * * * *\'),coalesce($5,true),$6) returning *', [b.type, b.name, encryptConfig(this.keyHex, b.config), b.schedule ?? null, b.enabled ?? null, actorId]);
    return r.rows[0];
  }
  async update(id: string, p: { name?: string; config?: Record<string, unknown>; schedule?: string; enabled?: boolean }): Promise<ConnectorRow | null> {
    const r = await this.db.query<ConnectorRow>('update connectors set name=coalesce($2,name), config_encrypted=coalesce($3,config_encrypted), schedule=coalesce($4,schedule), enabled=coalesce($5,enabled), updated_at=now() where id=$1 returning *', [id, p.name ?? null, p.config ? encryptConfig(this.keyHex, p.config) : null, p.schedule ?? null, p.enabled ?? null]);
    return r.rows[0] ?? null;
  }
  async remove(id: string): Promise<boolean> { return ((await this.db.query('delete from connectors where id=$1', [id])).rowCount ?? 0) > 0; }
  config<T = Record<string, unknown>>(row: ConnectorRow): T { return decryptConfig<T>(this.keyHex, row.config_encrypted); }
  async setRun(id: string, status: string, health: Record<string, unknown>): Promise<void> { await this.db.query('update connectors set last_run_at=now(), last_status=$2, health=$3 where id=$1', [id, status, health]); }
  async links(connectorId: string): Promise<(SyncLinkRow & { document_title: string })[]> { return (await this.db.query('select l.*, d.title as document_title from sync_links l join documents d on d.id=l.document_id where l.connector_id=$1 order by d.title', [connectorId])).rows; }
  async linkById(id: string): Promise<SyncLinkRow | null> { return (await this.db.query<SyncLinkRow>('select * from sync_links where id=$1', [id])).rows[0] ?? null; }
  async linkByRemote(connectorId: string, externalId: string): Promise<SyncLinkRow | null> { return (await this.db.query<SyncLinkRow>('select * from sync_links where connector_id=$1 and external_id=$2', [connectorId, externalId])).rows[0] ?? null; }
  async linkByDocument(connectorId: string, documentId: string): Promise<SyncLinkRow | null> { return (await this.db.query<SyncLinkRow>('select * from sync_links where connector_id=$1 and document_id=$2', [connectorId, documentId])).rows[0] ?? null; }
  async upsertLink(l: { documentId: string; connectorId: string; externalId: string; sourceId?: string | null; baseRemoteHash: string | null; baseLocalVersion: number; remoteUrl?: string | null; state: SyncLinkRow['state'] }): Promise<SyncLinkRow> {
    const r = await this.db.query<SyncLinkRow>(`insert into sync_links(document_id,connector_id,external_id,source_id,base_remote_hash,base_local_version,remote_url,state,last_synced_at) values ($1,$2,$3,$4,$5,$6,$7,$8,now())
      on conflict (connector_id, external_id) do update set document_id=excluded.document_id, source_id=coalesce(excluded.source_id, sync_links.source_id), base_remote_hash=excluded.base_remote_hash, base_local_version=excluded.base_local_version, remote_url=coalesce(excluded.remote_url, sync_links.remote_url), state=excluded.state, conflict=null, last_synced_at=now(), updated_at=now() returning *`,
      [l.documentId, l.connectorId, l.externalId, l.sourceId ?? null, l.baseRemoteHash, l.baseLocalVersion, l.remoteUrl ?? null, l.state]);
    return r.rows[0];
  }
  async setLinkState(id: string, state: SyncLinkRow['state'], conflict: unknown | null = null): Promise<void> { await this.db.query('update sync_links set state=$2, conflict=$3, updated_at=now() where id=$1', [id, state, conflict]); }
}
```

`registry.ts`:
```ts
import { ConnectorRegistry, JsonFileConnector, WordPressConnector } from '@wecom/connectors';
export function buildRegistry(): ConnectorRegistry { const r = new ConnectorRegistry(); r.register(new WordPressConnector()); r.register(new JsonFileConnector()); return r; }
```

`routes.ts`:
```ts
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { ConnectorCreateBodySchema, ConnectorPatchBodySchema, ConnectorSchema, IdSchema, SyncLinkSchema, SyncResolveBodySchema, paginated } from '@wecom/shared';
import { ConnectorsRepo, maskConfig, type ConnectorRow, type SyncLinkRow } from './repo.js';
import type { ConnectorRegistry } from '@wecom/connectors';
import type { SyncService } from './sync.js';

const toApi = (row: ConnectorRow, repo: ConnectorsRepo, reg: ConnectorRegistry) => ({
  id: row.id, type: row.type, name: row.name, enabled: row.enabled, schedule: row.schedule, lastRunAt: row.last_run_at?.toISOString() ?? null, lastStatus: row.last_status, health: row.health,
  configMasked: maskConfig(repo.config(row)), capabilities: reg.get(row.type).describe().capabilities,
});
const linkToApi = (l: SyncLinkRow & { document_title?: string }) => ({ id: l.id, documentId: l.document_id, documentTitle: l.document_title ?? '', connectorId: l.connector_id, externalId: l.external_id, remoteUrl: l.remote_url, state: l.state, baseRemoteHash: l.base_remote_hash, baseLocalVersion: l.base_local_version, lastSyncedAt: l.last_synced_at?.toISOString() ?? null, conflict: l.conflict ?? null });

export default async function routes(app: FastifyInstance, opts: { repo: ConnectorsRepo; registry: ConnectorRegistry; sync: SyncService; enqueue: (name: string, data: unknown) => Promise<string> }) {
  const { repo, registry, sync } = opts;
  const manage = { requires: ['connectors.manage'] as const };
  const params = z.object({ id: IdSchema });

  app.get('/connectors', { config: manage, schema: { tags: ['connectors'], response: { 200: paginated(ConnectorSchema) } } }, async () => { const rows = await repo.list(); return { items: rows.map((r) => toApi(r, repo, registry)), total: rows.length, page: 1, pageSize: rows.length }; });
  app.post('/connectors', { config: manage, schema: { tags: ['connectors'], body: ConnectorCreateBodySchema, response: { 201: ConnectorSchema } } }, async (req, reply) => {
    const conn = registry.get(req.body.type);
    const parsed = conn.configSchema.safeParse(req.body.config);
    if (!parsed.success) return reply.status(400).send({ code: 'INVALID_CONFIG', message: 'הגדרות המחבר אינן תקינות', details: parsed.error.flatten(), requestId: req.id });
    const row = await repo.create({ ...req.body, config: parsed.data as Record<string, unknown> }, req.user?.id ?? null);
    await app.audit(req, 'connectors.create', 'connector', row.id, null, { type: row.type, name: row.name });
    return reply.status(201).send(toApi(row, repo, registry));
  });
  app.get('/connectors/:id', { config: manage, schema: { params, response: { 200: ConnectorSchema } } }, async (req, reply) => { const row = await repo.get(req.params.id); if (!row) return reply.status(404).send({ code: 'NOT_FOUND', message: 'מחבר לא נמצא', requestId: req.id }); return toApi(row, repo, registry); });
  app.patch('/connectors/:id', { config: manage, schema: { params, body: ConnectorPatchBodySchema, response: { 200: ConnectorSchema } } }, async (req, reply) => {
    const row = await repo.get(req.params.id); if (!row) return reply.status(404).send({ code: 'NOT_FOUND', message: 'מחבר לא נמצא', requestId: req.id });
    let config: Record<string, unknown> | undefined;
    if (req.body.config) { const parsed = registry.get(row.type).configSchema.safeParse({ ...repo.config(row), ...req.body.config }); if (!parsed.success) return reply.status(400).send({ code: 'INVALID_CONFIG', message: 'הגדרות המחבר אינן תקינות', details: parsed.error.flatten(), requestId: req.id }); config = parsed.data as Record<string, unknown>; }
    const updated = await repo.update(row.id, { name: req.body.name, schedule: req.body.schedule, enabled: req.body.enabled, config });
    await app.audit(req, 'connectors.update', 'connector', row.id, { name: row.name, enabled: row.enabled }, { name: updated!.name, enabled: updated!.enabled });
    return toApi(updated!, repo, registry);
  });
  app.delete('/connectors/:id', { config: manage, schema: { params } }, async (req, reply) => { const ok = await repo.remove(req.params.id); if (!ok) return reply.status(404).send({ code: 'NOT_FOUND', message: 'מחבר לא נמצא', requestId: req.id }); await app.audit(req, 'connectors.delete', 'connector', req.params.id, null, null); return reply.status(204).send(); });
  app.post('/connectors/:id/test', { config: manage, schema: { params, response: { 200: z.object({ ok: z.boolean(), message: z.string() }) } } }, async (req, reply) => { const row = await repo.get(req.params.id); if (!row) return reply.status(404).send({ code: 'NOT_FOUND', message: 'מחבר לא נמצא', requestId: req.id }); const res = await registry.get(row.type).testConnection(repo.config(row) as never); await repo.setRun(row.id, res.ok ? 'test-ok' : 'test-failed', { lastTest: res }); return res; });
  app.post('/connectors/:id/run', { config: manage, schema: { params, response: { 202: z.object({ jobId: z.string() }) } } }, async (req, reply) => { const row = await repo.get(req.params.id); if (!row) return reply.status(404).send({ code: 'NOT_FOUND', message: 'מחבר לא נמצא', requestId: req.id }); const jobId = await opts.enqueue('connector.run', { connectorId: row.id, actorId: req.user?.id ?? null }); return reply.status(202).send({ jobId }); });
  app.get('/connectors/:id/links', { config: manage, schema: { params, response: { 200: paginated(SyncLinkSchema) } } }, async (req) => { const rows = await repo.links(req.params.id); return { items: rows.map(linkToApi), total: rows.length, page: 1, pageSize: rows.length }; });

  // webhook: raw body, signature verified by the connector, no session required
  app.post('/connectors/:id/webhook', { config: { public: true, rawBody: true }, schema: { params } }, async (req, reply) => {
    const row = await repo.get(req.params.id); if (!row || !row.enabled) return reply.status(404).send({ code: 'NOT_FOUND', message: 'מחבר לא נמצא', requestId: req.id });
    const conn = registry.get(row.type); if (!conn.parseWebhook) return reply.status(400).send({ code: 'NO_WEBHOOKS', message: 'המחבר אינו תומך ב-webhook', requestId: req.id });
    try {
      const changes = await conn.parseWebhook(repo.config(row) as never, req.headers as Record<string, string>, { raw: req.rawBody ?? '' });
      const jobId = await opts.enqueue('connector.webhook', { connectorId: row.id, changes });
      return reply.status(202).send({ jobId, changes: changes.length });
    } catch (e) { return reply.status(401).send({ code: 'BAD_SIGNATURE', message: 'חתימה שגויה', requestId: req.id }); }
  });

  app.post('/sync-links/:id/resolve', { config: { requires: ['suggestions.apply'] as const }, schema: { params, body: SyncResolveBodySchema, response: { 200: SyncLinkSchema } } }, async (req, reply) => {
    const link = await repo.linkById(req.params.id); if (!link) return reply.status(404).send({ code: 'NOT_FOUND', message: 'קישור סנכרון לא נמצא', requestId: req.id });
    const updated = await sync.resolveConflict(link, req.body, req.user?.id ?? null);
    await app.audit(req, 'sync.resolve', 'sync_link', link.id, { state: link.state }, { state: updated.state, resolution: req.body.resolution });
    return linkToApi(updated);
  });
}
```
Notes for the implementer: `app.audit(req, action, entityType, entityId, before, after)` and `req.user` come from L3's plugin; until it lands, `index.ts` decorates a no-op `audit` and the `testUser` shim, and `config.public`/`config.rawBody` are honoured by a tiny local `onRequest` hook that (a) returns 403 when `config.requires` isn't satisfied by `req.user.permissions`, (b) captures `req.rawBody` via `app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => { req.rawBody = body as string; try { done(null, JSON.parse(body as string)); } catch { done(null, {}); } })`. Put this shim in `index.ts` behind `if (!app.hasDecorator('audit'))` so it disappears when L3 registers first.

`index.ts`:
```ts
import fp from 'fastify-plugin';
import { ConnectorsRepo } from './repo.js';
import { buildRegistry } from './registry.js';
import { SyncService } from './sync.js';
import routes from './routes.js';
import { registerConnectorJobs } from './jobs.js';

export default fp(async (app, opts: { enqueue?: (name: string, data: unknown) => Promise<string> }) => {
  const repo = new ConnectorsRepo(app.db, app.config.CONNECTOR_KEY);
  const registry = buildRegistry();
  const sync = new SyncService({ repo, registry, db: app.db, revisions: app.services.revisions, documents: app.services.documents, events: app.events });
  const enqueue = opts.enqueue ?? (async (name, data) => app.boss.send(name, data as object) as Promise<string>);
  app.decorate('connectors', { repo, registry, sync });
  await app.register(routes, { repo, registry, sync, enqueue });
  if (app.boss) await registerConnectorJobs(app.boss, { repo, registry, sync, events: app.events, log: app.log });
});
```
(`app.services.revisions`, `app.services.documents`, `app.events`, `app.boss` are the decorators L5, L2 and L1/L2 add; in tests they're injected via `buildApp` options `services`, `events`, and `boss: null`.)

- [ ] **Step 4: Run** — PASS (4 tests).
- [ ] **Step 5: Commit** — `git add apps/api packages/shared docs/api && git commit -m "feat(api): connectors repo, registry, routes and signed webhook intake"` (run `pnpm openapi` first so `docs/api/openapi.json` is updated).

---

### Task 11: `SyncService` state machine (unit tests with fakes)

**Files:**
- Create: `apps/api/src/modules/connectors/sync.ts`
- Test: `apps/api/test/connectors-sync.test.ts`

**Interfaces:**
- Produces:
```ts
interface SyncDeps { repo: ConnectorsRepo; registry: ConnectorRegistry; db: Pool; revisions: SourceRevisionService; documents: DocumentsService; events: EventBus }
class SyncService {
  constructor(deps: SyncDeps)
  runConnector(connectorId: string, actorId: string | null): Promise<{ imported: number; pushed: number; conflicts: number; linked: number }>
  handleRemoteChanges(connectorId: string, changes: RemoteChange[]): Promise<void>       // webhook path: same rules, only for listed ids
  pushDocument(connectorId: string, documentId: string, actorId: string | null): Promise<RemoteRef>   // called by L2 after publish when a link exists (hook name: documents.onPublished)
  resolveConflict(link: SyncLinkRow, body: { resolution: 'ours' | 'theirs' | 'merged'; merged?: Document }, actorId: string | null): Promise<SyncLinkRow>
  afterSuggestionsApplied(sourceId: string, newVersion: number): Promise<void>            // called by L5 after applying accepted suggestions for a source → baseline update
}
```
- Decision table for each `sync_link` on a run (remote item `r`, link `l`, document `d`):
  - `remoteChanged = r.hash !== l.base_remote_hash`; `localChanged = d.current_version !== l.base_local_version`
  - neither → state `synced`
  - remote only → `revisions.ingest(l.source_id, fetch(r), actorId)` → state `pending_import` (suggestions are what the editor sees)
  - local only → `push` → baselines = pushed hash / current version → `synced`
  - both → state `conflict`, `conflict = { base: versionSnapshot(l.base_local_version), remote: fetch(r).paragraphs, local: d, remoteHash: r.hash }`, emit `sync.conflict`
  - remote items with no link → create source + link in state `pending_import` and ingest (new content becomes `new-card` suggestions; the link is completed when the suggestion is applied, via `afterSuggestionsApplied`)
  - `resolveConflict`: `ours` → push local, baselines updated; `theirs` → ingest remote as revision and mark link `pending_import`, base_local_version = current; `merged` → `documents.replaceStructure(id, merged, actorId, label)` then push, baselines updated.

- [ ] **Step 1: Write the failing unit test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '../src/modules/connectors/sync.js';
import type { SyncLinkRow, ConnectorsRepo } from '../src/modules/connectors/repo.js';
import { ConnectorRegistry, type Connector } from '@wecom/connectors';

const C = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', D = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', S = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const doc = (v: number) => ({ id: D, title: 'מסמך', currentVersion: v, phases: [], related: [], slug: 'd', description: '', category: 'tech', wave: 1, priority: 'm', kind: 'steps', status: 'published', createdAt: '', updatedAt: '' });
const remote = (hash: string) => ({ externalId: 'posts:7', title: 'מסמך', hash, updatedAt: '2025-07-01T00:00:00Z', kind: 'posts', url: 'http://wp/7' });

function setup(link: Partial<SyncLinkRow>, remoteHash: string, localVersion: number) {
  const linkRow: SyncLinkRow = { id: 'l1', document_id: D, connector_id: C, external_id: 'posts:7', source_id: S, base_remote_hash: 'h0', base_local_version: 1, remote_url: null, last_synced_at: null, state: 'synced', conflict: null, ...link };
  const connector: Connector<unknown> = {
    describe: () => ({ id: 'wordpress', name: 'WP', capabilities: { read: true, write: true, webhooks: true, identity: false } }), configSchema: {} as never,
    testConnection: vi.fn(), listRemote: vi.fn(async () => [remote(remoteHash)]),
    fetch: vi.fn(async () => ({ title: 'מסמך', paragraphs: [{ ref: 'h2-1', runs: [{ t: 'x' }] }], hash: remoteHash })),
    push: vi.fn(async () => ({ externalId: 'posts:7', hash: 'pushed', updatedAt: '2025-07-02T00:00:00Z' })),
  };
  const registry = new ConnectorRegistry(); registry.register(connector);
  const repo = { get: vi.fn(async () => ({ id: C, type: 'wordpress', name: 'wp', enabled: true, schedule: '', last_run_at: null, last_status: null, health: {}, config_encrypted: Buffer.alloc(0) })), config: vi.fn(() => ({})), links: vi.fn(async () => [linkRow]), linkByRemote: vi.fn(async () => linkRow), upsertLink: vi.fn(async (l) => ({ ...linkRow, ...l, state: l.state })), setLinkState: vi.fn(), setRun: vi.fn() } as unknown as ConnectorsRepo;
  const revisions = { ingest: vi.fn(async () => ({ revisionId: 'r1', changed: true })) };
  const documents = { getById: vi.fn(async () => doc(localVersion)), getVersionSnapshot: vi.fn(async () => doc(1)), getBlocksFor: vi.fn(async () => []), ensureSourceForConnector: vi.fn(async () => ({ sourceId: S })), replaceStructure: vi.fn(async () => doc(localVersion + 1)) };
  const events = { publish: vi.fn() };
  const svc = new SyncService({ repo, registry, db: {} as never, revisions: revisions as never, documents: documents as never, events });
  return { svc, connector, repo, revisions, documents, events };
}

describe('SyncService.runConnector', () => {
  it('does nothing when neither side changed', async () => {
    const { svc, revisions, connector } = setup({}, 'h0', 1);
    const r = await svc.runConnector(C, null);
    expect(r).toEqual({ imported: 0, pushed: 0, conflicts: 0, linked: 0 });
    expect(revisions.ingest).not.toHaveBeenCalled(); expect(connector.push).not.toHaveBeenCalled();
  });
  it('imports when only remote changed', async () => {
    const { svc, revisions, repo, events } = setup({}, 'h1', 1);
    const r = await svc.runConnector(C, 'u1');
    expect(r.imported).toBe(1);
    expect(revisions.ingest).toHaveBeenCalledWith(S, expect.objectContaining({ hash: 'h1' }), 'u1');
    expect(repo.setLinkState).toHaveBeenCalledWith('l1', 'pending_import');
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ name: 'sync.completed', payload: expect.objectContaining({ imported: 1, conflicts: 0 }) }));
  });
  it('pushes when only local changed and rebases', async () => {
    const { svc, connector, repo } = setup({}, 'h0', 3);
    const r = await svc.runConnector(C, null);
    expect(r.pushed).toBe(1);
    expect(connector.push).toHaveBeenCalledWith({}, 'posts:7', expect.objectContaining({ document: expect.objectContaining({ id: D }) }));
    expect(repo.upsertLink).toHaveBeenCalledWith(expect.objectContaining({ baseRemoteHash: 'pushed', baseLocalVersion: 3, state: 'synced' }));
  });
  it('flags a conflict when both changed and never pushes', async () => {
    const { svc, connector, repo, events, revisions } = setup({}, 'h1', 3);
    const r = await svc.runConnector(C, null);
    expect(r.conflicts).toBe(1);
    expect(connector.push).not.toHaveBeenCalled(); expect(revisions.ingest).not.toHaveBeenCalled();
    expect(repo.setLinkState).toHaveBeenCalledWith('l1', 'conflict', expect.objectContaining({ remoteHash: 'h1', base: expect.objectContaining({ currentVersion: 1 }), local: expect.objectContaining({ currentVersion: 3 }) }));
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ name: 'sync.conflict', payload: { connectorId: C, documentId: D, externalId: 'posts:7' } }));
  });
  it('links and ingests unknown remote items', async () => {
    const { svc, repo, revisions, documents } = setup({}, 'h0', 1);
    (repo.links as ReturnType<typeof vi.fn>).mockResolvedValue([]); (repo.linkByRemote as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    const r = await svc.runConnector(C, null);
    expect(r.linked).toBe(1);
    expect(documents.ensureSourceForConnector).toHaveBeenCalledWith(C, 'posts:7', 'מסמך');
    expect(revisions.ingest).toHaveBeenCalledWith(S, expect.anything(), null);
  });
});

describe('SyncService.resolveConflict', () => {
  it('ours → push and rebase', async () => {
    const { svc, connector, repo } = setup({ state: 'conflict' }, 'h1', 3);
    const link = (await repo.links(C))[0];
    const out = await svc.resolveConflict(link, { resolution: 'ours' }, 'u1');
    expect(connector.push).toHaveBeenCalled(); expect(out.state).toBe('synced');
  });
  it('theirs → ingest remote, pending_import', async () => {
    const { svc, revisions, repo } = setup({ state: 'conflict' }, 'h1', 3);
    const link = (await repo.links(C))[0];
    await svc.resolveConflict(link, { resolution: 'theirs' }, 'u1');
    expect(revisions.ingest).toHaveBeenCalled(); expect(repo.setLinkState).toHaveBeenCalledWith('l1', 'pending_import');
  });
  it('merged → replace structure then push', async () => {
    const { svc, documents, connector } = setup({ state: 'conflict' }, 'h1', 3);
    const link = { id: 'l1', document_id: D, connector_id: C, external_id: 'posts:7', source_id: S, base_remote_hash: 'h0', base_local_version: 1, remote_url: null, last_synced_at: null, state: 'conflict' as const, conflict: null };
    await svc.resolveConflict(link, { resolution: 'merged', merged: doc(3) as never }, 'u1');
    expect(documents.replaceStructure).toHaveBeenCalledWith(D, expect.objectContaining({ id: D }), 'u1', 'מיזוג סנכרון WordPress');
    expect(connector.push).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @wecom/api test -- connectors-sync` → FAIL.

- [ ] **Step 3: Implement `sync.ts`**

```ts
import type pg from 'pg';
import type { Connector, ConnectorRegistry, RemoteChange, RemoteItem, RemoteRef, SourceContent } from '@wecom/connectors';
import { makeEvent, type Block, type Document, type Event } from '@wecom/shared';
import type { ConnectorsRepo, SyncLinkRow } from './repo.js';

export interface SourceRevisionService { ingest(sourceId: string, content: SourceContent, actorId: string | null): Promise<{ revisionId: string; changed: boolean }> }
export interface DocumentsService {
  getById(id: string): Promise<Document | null>;
  getVersionSnapshot(id: string, version: number): Promise<Document | null>;
  getBlocksFor(doc: Document): Promise<Block[]>;
  ensureSourceForConnector(connectorId: string, externalId: string, title: string): Promise<{ sourceId: string }>;
  replaceStructure(id: string, doc: Document, actorId: string | null, label: string): Promise<Document>;
}
export interface EventBus { publish(e: Event): void }
export interface SyncDeps { repo: ConnectorsRepo; registry: ConnectorRegistry; db: pg.Pool; revisions: SourceRevisionService; documents: DocumentsService; events: EventBus }
export interface RunResult { imported: number; pushed: number; conflicts: number; linked: number }

export class SyncService {
  constructor(private d: SyncDeps) {}

  private async connectorFor(connectorId: string): Promise<{ conn: Connector<unknown>; cfg: unknown }> {
    const row = await this.d.repo.get(connectorId); if (!row) throw new Error('connector not found: ' + connectorId);
    return { conn: this.d.registry.get(row.type), cfg: this.d.repo.config(row) };
  }

  async runConnector(connectorId: string, actorId: string | null): Promise<RunResult> {
    const { conn, cfg } = await this.connectorFor(connectorId);
    const result: RunResult = { imported: 0, pushed: 0, conflicts: 0, linked: 0 };
    const remote = await conn.listRemote(cfg);
    const links = await this.d.repo.links(connectorId);
    const byExternal = new Map(links.map((l) => [l.external_id, l]));
    for (const r of remote) {
      const link = byExternal.get(r.externalId);
      if (!link) { await this.linkNew(connectorId, conn, cfg, r, actorId); result.linked++; continue; }
      await this.reconcile(conn, cfg, link, r, actorId, result);
      byExternal.delete(r.externalId);
    }
    // links whose remote item disappeared (deleted in WordPress) stay in place; a lead sees them in the parity report
    for (const l of byExternal.values()) if (l.state !== 'conflict') await this.reconcile(conn, cfg, l, null, actorId, result);
    await this.d.repo.setRun(connectorId, 'ok', { lastRun: result });
    this.d.events.publish(makeEvent('sync.completed', { connectorId, imported: result.imported, pushed: result.pushed, conflicts: result.conflicts }));
    return result;
  }

  private async linkNew(connectorId: string, conn: Connector<unknown>, cfg: unknown, r: RemoteItem, actorId: string | null) {
    const { sourceId } = await this.d.documents.ensureSourceForConnector(connectorId, r.externalId, r.title);
    const content = await conn.fetch(cfg, r.externalId);
    await this.d.revisions.ingest(sourceId, content, actorId);
    // no document yet: the link row is created by afterSuggestionsApplied when the new-card suggestion is applied
  }

  private async reconcile(conn: Connector<unknown>, cfg: unknown, link: SyncLinkRow, r: RemoteItem | null, actorId: string | null, result: RunResult) {
    const doc = await this.d.documents.getById(link.document_id); if (!doc) return;
    const remoteChanged = !!r && r.hash !== link.base_remote_hash;
    const localChanged = doc.currentVersion !== link.base_local_version;
    if (!remoteChanged && !localChanged) { if (link.state !== 'synced') await this.d.repo.setLinkState(link.id, 'synced'); return; }
    if (remoteChanged && !localChanged) {
      const content = await conn.fetch(cfg, r!.externalId);
      if (link.source_id) await this.d.revisions.ingest(link.source_id, content, actorId);
      await this.d.repo.setLinkState(link.id, 'pending_import'); result.imported++; return;
    }
    if (!remoteChanged && localChanged) {
      if (!conn.describe().capabilities.write) { await this.d.repo.setLinkState(link.id, 'pending_push'); return; }
      await this.pushLink(conn, cfg, link, doc); result.pushed++; return;
    }
    const base = await this.d.documents.getVersionSnapshot(doc.id, link.base_local_version);
    const content = await conn.fetch(cfg, r!.externalId);
    await this.d.repo.setLinkState(link.id, 'conflict', { base, remote: content.paragraphs, local: doc, remoteHash: r!.hash, remoteUpdatedAt: r!.updatedAt, detectedAt: new Date().toISOString() });
    this.d.events.publish(makeEvent('sync.conflict', { connectorId: link.connector_id, documentId: doc.id, externalId: link.external_id }));
    result.conflicts++;
  }

  private async pushLink(conn: Connector<unknown>, cfg: unknown, link: SyncLinkRow, doc: Document): Promise<RemoteRef> {
    const blocks = await this.d.documents.getBlocksFor(doc);
    const ref = await conn.push(cfg, link.external_id, { document: doc, html: '', blocks });
    await this.d.repo.upsertLink({ documentId: doc.id, connectorId: link.connector_id, externalId: ref.externalId, sourceId: link.source_id, baseRemoteHash: ref.hash, baseLocalVersion: doc.currentVersion, remoteUrl: ref.url ?? null, state: 'synced' });
    return ref;
  }

  async pushDocument(connectorId: string, documentId: string, _actorId: string | null): Promise<RemoteRef> {
    const { conn, cfg } = await this.connectorFor(connectorId);
    const doc = await this.d.documents.getById(documentId); if (!doc) throw new Error('document not found');
    const existing = await this.d.repo.linkByDocument(connectorId, documentId);
    const link: SyncLinkRow = existing ?? { id: '', document_id: documentId, connector_id: connectorId, external_id: '', source_id: null, base_remote_hash: null, base_local_version: 0, remote_url: null, last_synced_at: null, state: 'pending_push', conflict: null };
    if (existing && existing.state === 'conflict') throw new Error('link in conflict; resolve first');
    const blocks = await this.d.documents.getBlocksFor(doc);
    const ref = await conn.push(cfg, existing ? existing.external_id : null, { document: doc, html: '', blocks });
    await this.d.repo.upsertLink({ documentId, connectorId, externalId: ref.externalId, sourceId: link.source_id, baseRemoteHash: ref.hash, baseLocalVersion: doc.currentVersion, remoteUrl: ref.url ?? null, state: 'synced' });
    return ref;
  }

  async handleRemoteChanges(connectorId: string, changes: RemoteChange[]): Promise<void> {
    const { conn, cfg } = await this.connectorFor(connectorId);
    const result: RunResult = { imported: 0, pushed: 0, conflicts: 0, linked: 0 };
    for (const ch of changes) {
      const link = await this.d.repo.linkByRemote(connectorId, ch.externalId);
      if (ch.kind === 'deleted') { if (link) await this.d.repo.setLinkState(link.id, 'pending_push', { remoteDeleted: true, at: ch.at }); continue; }
      const items = await conn.listRemote(cfg, new Date(Date.parse(ch.at) - 60_000).toISOString());
      const r = items.find((i) => i.externalId === ch.externalId) ?? (await (async () => { const c = await conn.fetch(cfg, ch.externalId); return { externalId: ch.externalId, title: c.title, hash: c.hash, updatedAt: ch.at, kind: '' } as RemoteItem; })());
      if (!link) { await this.linkNew(connectorId, conn, cfg, r, null); result.linked++; } else await this.reconcile(conn, cfg, link, r, null, result);
    }
    this.d.events.publish(makeEvent('sync.completed', { connectorId, imported: result.imported, pushed: result.pushed, conflicts: result.conflicts }));
  }

  async resolveConflict(link: SyncLinkRow, body: { resolution: 'ours' | 'theirs' | 'merged'; merged?: Document }, actorId: string | null): Promise<SyncLinkRow> {
    const { conn, cfg } = await this.connectorFor(link.connector_id);
    const doc = await this.d.documents.getById(link.document_id); if (!doc) throw new Error('document not found');
    if (body.resolution === 'ours') { await this.pushLink(conn, cfg, link, doc); return (await this.d.repo.linkByRemote(link.connector_id, link.external_id))!; }
    if (body.resolution === 'theirs') {
      const content = await conn.fetch(cfg, link.external_id);
      if (link.source_id) await this.d.revisions.ingest(link.source_id, content, actorId);
      await this.d.repo.upsertLink({ documentId: doc.id, connectorId: link.connector_id, externalId: link.external_id, sourceId: link.source_id, baseRemoteHash: content.hash, baseLocalVersion: doc.currentVersion, state: 'pending_import' });
      await this.d.repo.setLinkState(link.id, 'pending_import');
      return (await this.d.repo.linkByRemote(link.connector_id, link.external_id))!;
    }
    if (!body.merged) throw new Error('merged document required');
    const merged = await this.d.documents.replaceStructure(doc.id, body.merged, actorId, 'מיזוג סנכרון WordPress');
    await this.pushLink(conn, cfg, link, merged);
    return (await this.d.repo.linkByRemote(link.connector_id, link.external_id))!;
  }

  /** L5 calls this after applying accepted suggestions from a connector-backed source. */
  async afterSuggestionsApplied(sourceId: string, documentId: string, newVersion: number): Promise<void> {
    const rows = await this.d.db.query<{ id: string; connector_id: string; external_id: string }>('select s.connector_id, s.external_id, l.id from sources s left join sync_links l on l.source_id=s.id where s.id=$1', [sourceId]);
    const row = rows.rows[0]; if (!row || !row.connector_id) return;
    const { conn, cfg } = await this.connectorFor(row.connector_id);
    const content = await conn.fetch(cfg, row.external_id);
    await this.d.repo.upsertLink({ documentId, connectorId: row.connector_id, externalId: row.external_id, sourceId, baseRemoteHash: content.hash, baseLocalVersion: newVersion, state: 'synced' });
  }
}
```

- [ ] **Step 4: Run** — PASS (8 tests).
- [ ] **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): sync service state machine with review-queue conflict rules"`.

---

### Task 12: Sync integration test against Postgres and the WordPress stub

**Files:**
- Test: `apps/api/test/connectors-sync.int.test.ts`
- Modify (test support only): `apps/api/test/helpers/seedDoc.ts` — inserts a minimal document with one version (uses raw SQL against the L0 tables so this test doesn't depend on L2's services being finished; `DocumentsService` is a small SQL-backed implementation local to the helper, matching the interface in Task 11)

**Interfaces:**
- Consumes: tables from L0 0003/0005 and Task 9; `SyncService`; `startWpStub`.

- [ ] **Step 1: Write the failing integration test**

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import pg from 'pg';
import { runner } from 'node-pg-migrate';
import { SyncService } from '../src/modules/connectors/sync.js';
import { ConnectorsRepo } from '../src/modules/connectors/repo.js';
import { buildRegistry } from '../src/modules/connectors/registry.js';
import { startWpStub, type WpStub } from '../../../packages/connectors/test/helpers/wpStub.js';
import { seedDocument, sqlDocumentsService, memoryRevisions } from './helpers/seedDoc.js';

const run = process.env.RUN_INTEGRATION === '1' ? describe : describe.skip;
run('sync integration', () => {
  let c: StartedPostgreSqlContainer, pool: pg.Pool, stub: WpStub, repo: ConnectorsRepo, svc: SyncService, connectorId: string, docId: string, sourceId: string;
  const revisions = memoryRevisions(); const events: unknown[] = [];
  beforeAll(async () => {
    c = await new PostgreSqlContainer('pgvector/pgvector:pg16').start();
    await runner({ databaseUrl: c.getConnectionUri(), dir: 'migrations', direction: 'up', migrationsTable: 'pgmigrations', log: () => undefined });
    pool = new pg.Pool({ connectionString: c.getConnectionUri() });
    stub = await startWpStub([{ id: 7, title: { rendered: 'איטיות גלישה' }, content: { rendered: '<h2>שלב 1</h2><p>פתח CRM</p>' }, modified_gmt: '2025-06-12T10:00:00', link: 'http://wp/7', status: 'publish' }]);
    repo = new ConnectorsRepo(pool, '00'.repeat(32));
    const row = await repo.create({ type: 'wordpress', name: 'wp', config: { baseUrl: stub.url, username: 'u', applicationPassword: 'p', postTypes: ['posts'], categoryMap: {}, webhookSecret: 'topsecret1' } }, null);
    connectorId = row.id;
    ({ docId, sourceId } = await seedDocument(pool, connectorId, 'posts:7'));
    svc = new SyncService({ repo, registry: buildRegistry(), db: pool, revisions, documents: sqlDocumentsService(pool), events: { publish: (e) => events.push(e) } });
    // establish the baseline: first run pushes local v1 → synced
    await svc.pushDocument(connectorId, docId, null);
  }, 180000);
  afterAll(async () => { await pool.end(); await stub.close(); await c.stop(); });

  it('starts synced', async () => { expect((await repo.links(connectorId))[0].state).toBe('synced'); expect((await svc.runConnector(connectorId, null)).imported).toBe(0); });
  it('remote-only edit → revision ingested, pending_import', async () => {
    stub.posts.get('posts:7')!.content.rendered = '<h2>שלב 1</h2><p>פתח CRM ↗ שדה חדש</p>';
    stub.posts.get('posts:7')!.modified_gmt = '2025-07-01T00:00:00';
    const r = await svc.runConnector(connectorId, null);
    expect(r.imported).toBe(1); expect(revisions.calls.map((x) => x.sourceId)).toEqual([sourceId]);
    expect((await repo.links(connectorId))[0].state).toBe('pending_import');
  });
  it('after suggestions applied → baseline moves and state is synced', async () => {
    await pool.query('update documents set current_version=2 where id=$1', [docId]);
    await svc.afterSuggestionsApplied(sourceId, docId, 2);
    const l = (await repo.links(connectorId))[0];
    expect(l.state).toBe('synced'); expect(l.base_local_version).toBe(2);
    expect((await svc.runConnector(connectorId, null)).imported).toBe(0);
  });
  it('local-only edit → pushed to WordPress', async () => {
    await pool.query('update documents set current_version=3, title=$2 where id=$1', [docId, 'איטיות גלישה (מעודכן)']);
    const r = await svc.runConnector(connectorId, null);
    expect(r.pushed).toBe(1);
    expect(stub.posts.get('posts:7')!.title.rendered).toBe('איטיות גלישה (מעודכן)');
    expect((await repo.links(connectorId))[0]).toMatchObject({ state: 'synced', base_local_version: 3 });
  });
  it('both changed → conflict, then merged resolution pushes and clears', async () => {
    stub.posts.get('posts:7')!.content.rendered = '<h2>שלב 1</h2><p>שינוי מרחוק</p>';
    await pool.query('update documents set current_version=4 where id=$1', [docId]);
    const r = await svc.runConnector(connectorId, null);
    expect(r.conflicts).toBe(1);
    const link = (await repo.links(connectorId))[0];
    expect(link.state).toBe('conflict');
    expect((link.conflict as { remote: unknown[] }).remote).toHaveLength(2);
    expect(events.some((e) => (e as { name: string }).name === 'sync.conflict')).toBe(true);
    const merged = await sqlDocumentsService(pool).getById(docId);
    const resolved = await svc.resolveConflict(link, { resolution: 'merged', merged: merged! }, null);
    expect(resolved.state).toBe('synced');
    expect(stub.puts[stub.puts.length - 1].id).toBe(7);
  });
});
```

`test/helpers/seedDoc.ts` (SQL-backed minimal `DocumentsService` and in-memory `SourceRevisionService`):
```ts
import type pg from 'pg';
import type { Block, Document } from '@wecom/shared';
import type { DocumentsService, SourceRevisionService } from '../../src/modules/connectors/sync.js';
import type { SourceContent } from '@wecom/connectors';

export async function seedDocument(pool: pg.Pool, connectorId: string, externalId: string) {
  const src = await pool.query("insert into sources(kind, connector_id, external_id, title) values ('wordpress', $1, $2, 'איטיות גלישה') returning id", [connectorId, externalId]);
  const doc = await pool.query("insert into documents(slug, title, category, wave, priority, status, current_version, source_id) values ('browsing', 'איטיות גלישה', 'tech', 1, 'hh', 'published', 1, $1) returning id", [src.rows[0].id]);
  const docId = doc.rows[0].id as string;
  const snapshot = { id: docId, slug: 'browsing', title: 'איטיות גלישה', description: '', category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 1, related: [], phases: [{ id: 'p1', label: 'שלב 1', steps: [{ key: 's1', num: '1', title: 'פתח CRM', actions: [{ id: 'a1', text: 'פתח CRM' }], outcomes: [], blockRefs: [], deps: [] }] }], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  await pool.query('insert into document_versions(document_id, version, snapshot, label) values ($1, 1, $2, $3)', [docId, snapshot, 'seed']);
  return { docId, sourceId: src.rows[0].id as string };
}

export function sqlDocumentsService(pool: pg.Pool): DocumentsService {
  const load = async (id: string): Promise<Document | null> => {
    const d = (await pool.query('select * from documents where id=$1', [id])).rows[0]; if (!d) return null;
    const v = (await pool.query('select snapshot from document_versions where document_id=$1 order by version desc limit 1', [id])).rows[0];
    return { ...(v?.snapshot ?? {}), id, title: d.title, currentVersion: d.current_version, updatedAt: d.updated_at.toISOString() } as Document;
  };
  return {
    getById: load,
    getVersionSnapshot: async (id, version) => ((await pool.query('select snapshot from document_versions where document_id=$1 and version<=$2 order by version desc limit 1', [id, version])).rows[0]?.snapshot ?? null),
    getBlocksFor: async (): Promise<Block[]> => [],
    ensureSourceForConnector: async (connectorId, externalId, title) => { const r = await pool.query("insert into sources(kind, connector_id, external_id, title) values ('wordpress',$1,$2,$3) on conflict do nothing returning id", [connectorId, externalId, title]); const id = r.rows[0]?.id ?? (await pool.query('select id from sources where connector_id=$1 and external_id=$2', [connectorId, externalId])).rows[0].id; return { sourceId: id }; },
    replaceStructure: async (id, doc, _actor, label) => { const v = (await pool.query('update documents set current_version=current_version+1, updated_at=now() where id=$1 returning current_version', [id])).rows[0].current_version; await pool.query('insert into document_versions(document_id, version, snapshot, label) values ($1,$2,$3,$4)', [id, v, { ...doc, currentVersion: v }, label]); return (await load(id))!; },
  };
}

export function memoryRevisions(): SourceRevisionService & { calls: { sourceId: string; content: SourceContent }[] } {
  const calls: { sourceId: string; content: SourceContent }[] = [];
  return { calls, ingest: async (sourceId, content) => { calls.push({ sourceId, content }); return { revisionId: 'mem-' + calls.length, changed: true }; } };
}
```

- [ ] **Step 2: Run** — `pnpm --filter @wecom/api test:int -- connectors-sync.int` → FAIL until Task 11 code is wired; then PASS (5 tests). If `afterSuggestionsApplied` fails on the `left join` because `sync_links.source_id` is null for pushed links, ensure `pushDocument` passes `link.source_id` from `documents.source_id` (add `const srcRow = await this.d.db.query('select source_id from documents where id=$1', [documentId])` and use it when the link has no source).
- [ ] **Step 3: Commit** — `git add apps/api && git commit -m "test(api): sync state machine integration against postgres and wordpress stub"`.

---

### Task 13: pg-boss jobs (`connector.run` on cron, `connector.webhook`) and failure events

**Files:**
- Create: `apps/api/src/modules/connectors/jobs.ts`
- Test: `apps/api/test/connectors-jobs.test.ts` (unit, fake boss)

**Interfaces:**
- Produces: `registerConnectorJobs(boss: PgBossLike, deps: { repo: ConnectorsRepo; registry: ConnectorRegistry; sync: SyncService; events: EventBus; log: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void } }): Promise<void>` where `PgBossLike = { work(name: string, handler: (job: { id: string; data: unknown }) => Promise<void>): Promise<void>; schedule(name: string, cron: string, data?: object, opts?: object): Promise<void>; unschedule(name: string): Promise<void>; send(name: string, data: object): Promise<string | null> }`. Schedules `connector.run.<id>` for every enabled connector (`repo.list()`), re-syncs schedules via `refreshSchedules()` (exported; routes call it after create/patch/delete). Job failures emit `job.failed` and set `last_status = 'error'` with the message in `health.lastError`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi } from 'vitest';
import { registerConnectorJobs } from '../src/modules/connectors/jobs.js';

function fakeBoss() {
  const handlers = new Map<string, (job: { id: string; data: unknown }) => Promise<void>>();
  const schedules: [string, string][] = [];
  return { handlers, schedules, work: vi.fn(async (n: string, h: (job: { id: string; data: unknown }) => Promise<void>) => { handlers.set(n, h); }), schedule: vi.fn(async (n: string, cron: string) => { schedules.push([n, cron]); }), unschedule: vi.fn(async () => undefined), send: vi.fn(async () => 'j1') };
}

describe('connector jobs', () => {
  it('schedules enabled connectors and runs them', async () => {
    const boss = fakeBoss();
    const repo = { list: vi.fn(async () => [{ id: 'c1', enabled: true, schedule: '*/5 * * * *' }, { id: 'c2', enabled: false, schedule: '* * * * *' }]), setRun: vi.fn() };
    const sync = { runConnector: vi.fn(async () => ({ imported: 1, pushed: 0, conflicts: 0, linked: 0 })), handleRemoteChanges: vi.fn() };
    const events = { publish: vi.fn() };
    await registerConnectorJobs(boss, { repo: repo as never, registry: {} as never, sync: sync as never, events, log: { info() {}, error() {} } });
    expect(boss.schedules).toEqual([['connector.run.c1', '*/5 * * * *']]);
    await boss.handlers.get('connector.run.c1')!({ id: 'j', data: { connectorId: 'c1' } });
    expect(sync.runConnector).toHaveBeenCalledWith('c1', null);
  });
  it('routes webhook jobs and reports failures', async () => {
    const boss = fakeBoss();
    const repo = { list: vi.fn(async () => []), setRun: vi.fn() };
    const sync = { runConnector: vi.fn(), handleRemoteChanges: vi.fn(async () => { throw new Error('boom'); }) };
    const events = { publish: vi.fn() };
    await registerConnectorJobs(boss, { repo: repo as never, registry: {} as never, sync: sync as never, events, log: { info() {}, error() {} } });
    await expect(boss.handlers.get('connector.webhook')!({ id: 'j2', data: { connectorId: 'c1', changes: [] } })).rejects.toThrow('boom');
    expect(events.publish).toHaveBeenCalledWith(expect.objectContaining({ name: 'job.failed', payload: { jobName: 'connector.webhook', jobId: 'j2', error: 'boom' } }));
    expect(repo.setRun).toHaveBeenCalledWith('c1', 'error', { lastError: 'boom' });
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```ts
import { makeEvent, type Event } from '@wecom/shared';
import type { RemoteChange } from '@wecom/connectors';
import type { ConnectorsRepo } from './repo.js';
import type { SyncService } from './sync.js';

export interface PgBossLike { work(name: string, handler: (job: { id: string; data: unknown }) => Promise<void>): Promise<unknown>; schedule(name: string, cron: string, data?: object, opts?: object): Promise<unknown>; unschedule(name: string): Promise<unknown>; send(name: string, data: object): Promise<string | null> }
export interface JobDeps { repo: ConnectorsRepo; registry: unknown; sync: SyncService; events: { publish(e: Event): void }; log: { info(o: unknown, m?: string): void; error(o: unknown, m?: string): void } }

const scheduled = new Set<string>();

export async function refreshSchedules(boss: PgBossLike, repo: ConnectorsRepo, sync: SyncService, deps: JobDeps): Promise<void> {
  const rows = await repo.list();
  const wanted = new Map(rows.filter((r) => r.enabled).map((r) => ['connector.run.' + r.id, r]));
  for (const name of scheduled) if (!wanted.has(name)) { await boss.unschedule(name); scheduled.delete(name); }
  for (const [name, r] of wanted) {
    if (!scheduled.has(name)) await boss.work(name, wrap(name, deps, async (data) => { await sync.runConnector((data as { connectorId: string }).connectorId, null); }));
    await boss.schedule(name, r.schedule, { connectorId: r.id }, { tz: 'Asia/Jerusalem' });
    scheduled.add(name);
  }
}

function wrap(name: string, deps: JobDeps, fn: (data: unknown) => Promise<void>) {
  return async (job: { id: string; data: unknown }) => {
    try { await fn(job.data); }
    catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      deps.log.error({ job: name, id: job.id, error }, 'connector job failed');
      const connectorId = (job.data as { connectorId?: string })?.connectorId;
      if (connectorId) await deps.repo.setRun(connectorId, 'error', { lastError: error });
      deps.events.publish(makeEvent('job.failed', { jobName: name, jobId: job.id, error }));
      throw e;
    }
  };
}

export async function registerConnectorJobs(boss: PgBossLike, deps: JobDeps): Promise<void> {
  await boss.work('connector.run', wrap('connector.run', deps, async (data) => { const d = data as { connectorId: string; actorId: string | null }; await deps.sync.runConnector(d.connectorId, d.actorId ?? null); }));
  await boss.work('connector.webhook', wrap('connector.webhook', deps, async (data) => { const d = data as { connectorId: string; changes: RemoteChange[] }; await deps.sync.handleRemoteChanges(d.connectorId, d.changes); }));
  await refreshSchedules(boss, deps.repo, deps.sync, deps);
}
```
In `routes.ts`, after create/patch/delete call `opts.refresh?.()` (pass `refresh: () => refreshSchedules(app.boss, repo, sync, deps)` from `index.ts` when `app.boss` exists).

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/api && git commit -m "feat(api): connector cron and webhook jobs with failure events"`.

---

### Task 14: Wire the module into the app, publish hook, and documentation

**Files:**
- Modify: `apps/api/src/app.ts` (register `connectorsModule` in the `/api/v1` scope after L2's content module; pass `enqueue` from `app.boss` when present), `apps/api/src/modules/content/publish.ts` (L2 file — add one call: after a successful publish, `for (const link of await app.connectors.repo.linksForDocument(documentId)) if (link.state === 'synced') await app.connectors.sync.pushDocument(link.connector_id, documentId, actorId)`; implement `linksForDocument(documentId)` in `repo.ts` as `select * from sync_links where document_id=$1`), `deploy/INSTALL.md` (L1 file — add a "WordPress connector" section: generate `CONNECTOR_KEY` with `openssl rand -hex 32`, create an application password in WordPress, install `deploy/wp-plugin`, add the connector in `/admin/connectors`, test, run), `docs/api/openapi.json` regenerated
- Test: extend `apps/api/test/connectors-routes.test.ts` with one case: publishing a linked document (via the L2 route if present, otherwise by calling `sync.pushDocument` directly) updates the stub post.

- [ ] **Step 1: Add the failing test case**

```ts
  it('pushes a linked document on publish', async () => {
    const conn = (await app.inject({ method: 'POST', url: '/api/v1/connectors', payload: body() })).json();
    const { docId } = await seedDocument(pool, conn.id, 'posts:7');
    stub.posts.set('posts:7', { id: 7, title: { rendered: 'ישן' }, content: { rendered: '<p>ישן</p>' }, modified_gmt: '2025-01-01T00:00:00', link: 'http://wp/7', status: 'publish' });
    await app.connectors.sync.pushDocument(conn.id, docId, userId);
    expect(stub.posts.get('posts:7')!.title.rendered).toBe('איטיות גלישה');
    const links = (await app.inject({ method: 'GET', url: `/api/v1/connectors/${conn.id}/links` })).json();
    expect(links.items[0]).toMatchObject({ externalId: 'posts:7', state: 'synced', baseLocalVersion: 1 });
  });
```

- [ ] **Step 2: Run** — FAIL (module not registered / decorator missing).
- [ ] **Step 3: Implement the wiring** as described in Files above; in `app.ts`:
```ts
import connectorsModule from './modules/connectors/index.js';
// inside the /api/v1 registration, after content routes:
await v1.register(connectorsModule, { enqueue: opts.enqueue });
```
and accept `enqueue?: (name: string, data: unknown) => Promise<string>` plus `testUser` in `buildApp` options (the test shim from Task 10).
- [ ] **Step 4: Run** — `pnpm --filter @wecom/api test:int -- connectors-routes` PASS; `pnpm openapi` then `git diff --exit-code docs/api/openapi.json` shows the new routes committed.
- [ ] **Step 5: Commit** — `git add apps/api deploy docs/api && git commit -m "feat(api): wire connectors module, push-on-publish hook, install docs"`.

---

## Self-review

- **Spec coverage** (program §8): registry with encrypted config, schedule, health → Tasks 9, 10, 13; WordPress read via REST with polling and webhook plugin → Tasks 1, 3, 4, 7, 13; WordPress write rendering steps/branches/scripts as semantic blocks with baseline recording → Tasks 5, 6, 11; two-way rules with `sync_links`, three-column conflict payload, no overwrite until a lead resolves → Tasks 9, 11, 12; parity report → Task 10 (`GET /connectors/:id/links`); acceptance scenarios (edit WP → suggestion; accept → WP updated; both → conflict → merge) → Task 12 integration test. Contract 5 (§6) methods `describe/testConnection/listRemote/fetch/push/parseWebhook` → Tasks 1–7; "connectors never touch the database" → holds (only `apps/api` modules query Postgres). Static data files as real sources → Task 8.
- **Placeholder scan**: none; every step has code. The L2/L3/L5 touchpoints are named interfaces with test doubles, not TODOs.
- **Type consistency**: `SyncLinkRow` fields (`base_remote_hash`, `base_local_version`, `state`) match migration 0008 and `SyncLinkSchema` (camelCase mapping in `linkToApi`); `RemoteChange.kind` values `'created' | 'updated' | 'deleted'` from L0 are the only ones produced by `parseWebhook`; `SourceRevisionService.ingest(sourceId, content, actorId)` signature is identical in Tasks 11, 12 and the L5 hand-off; `makeEvent` payloads match L0 `events.ts` (`sync.completed` = `{ connectorId, imported, pushed, conflicts }`, `sync.conflict` = `{ connectorId, documentId, externalId }`, `job.failed` = `{ jobName, jobId, error }`).
- **Out of scope noted**: the admin UI for connectors and the three-column merge screen belong to L4 (stage 3/5 screens); the `documents.onPublished` hook location is L2's `publish.ts` and is a one-line addition described in Task 14.
