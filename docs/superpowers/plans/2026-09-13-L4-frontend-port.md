# L4 — Frontend Port (React + TypeScript) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the static app in `legacy/` to `apps/web` (React 18 + TypeScript + Vite) at full feature parity, backed by the stage-1 API, with login, permission-aware UI, live updates over SSE, and admin/system screens.

**Architecture:** One SPA. Routing with React Router; server state with TanStack Query over the generated `openapi-fetch` client (`src/api/client.ts` from L0); an SSE hook invalidates queries by event name; per-user state (pins, recent, drafts, preferences) lives on the API, call-mode progress in `sessionStorage`. Rendering logic (`fmt`, `wordDiff`, `stepText`) comes from `@wecom/shared`; components are split by the same boundaries as the legacy files. Until L2/L3 land, every component is developed against `msw` handlers whose fixtures validate against the shared zod schemas, so the UI never depends on fake code in product paths.

**Tech Stack:** React 18.3, TypeScript 5 strict, Vite 5, react-router-dom 6, @tanstack/react-query 5, openapi-fetch 0.12, zod 3 (via `@wecom/shared`), Vitest 2 + @testing-library/react 16 + jsdom, msw 2, Playwright 1.47.

**Spec:** `docs/superpowers/specs/2026-09-13-kb-platform-stage1-foundation-design.md` (§4 API surface, §5 frontend port, §6 testing) and `docs/superpowers/specs/2026-09-13-kb-platform-program-and-lanes.md` (§5 lane L4, §6 contracts 2–4). Depends on `docs/superpowers/plans/2026-09-13-L0-contracts-and-scaffold.md` Tasks 3–10, 13, 15 for names.

## Global Constraints

- Routes exactly: `/library/:category?`, `/doc/:id/:step?`, `/edit/:id`, `/history/:id/:v?`, `/trash`, `/sources/:id?`, `/pinned`, `/recent`, `/drafts`, `/fields`, `/blocks`, `/admin/*`, `/login`.
- API base `/api/v1`, SSE at `/events`; all calls through `api` from `src/api/client.ts` (typed by `docs/api/openapi.json`); never hand-write fetch URLs elsewhere.
- Permission strings and event names only from `@wecom/shared` (`PERMISSIONS`, `EVENTS`); never string literals in components.
- All user-facing text Hebrew, `<html lang="he" dir="rtl">`; design tokens copied from `legacy/css/app.css` unchanged (light/dark via `data-theme`, Plex/Rubik via `data-font`).
- HTML from `fmt`/`wordDiff` is already escaped; it is rendered only through the `<Fmt>`/`<Html>` components, never concatenated with user input.
- Every component test uses `msw` (no manual `fetch` mocks); every fixture is parsed with the matching shared schema in `test/msw/fixtures.ts` so drift fails tests.
- Commit after every task; commit messages end with the attribution lines the session provides.

## File structure

```
apps/web/
  package.json (deps added in Task 1), vite.config.ts, tsconfig.json, playwright.config.ts
  index.html
  src/main.tsx                       providers + router
  src/App.tsx                        <RouterProvider>
  src/routes.tsx                     route table
  src/styles/app.css                 tokens + components (from legacy/css/app.css) + React-only additions
  src/lib/prefs.ts                   applyPrefs(prefs) → data-theme/data-font
  src/lib/format.ts                  re-exports from @wecom/shared + helpers (fmtDate, ago, inDays)
  src/lib/diffSteps.ts               diffSteps(oldDoc,newDoc) rows + blame (port of legacy views-history.js)
  src/lib/keyboard.ts                useHotkeys(map), isTyping()
  src/lib/callState.ts               sessionStorage call-mode state per document
  src/api/client.ts                  (L0) openapi-fetch client
  src/api/keys.ts                    query key factory
  src/api/hooks/me.ts                useMe, can()
  src/api/hooks/documents.ts         useDocuments, useDocument, useCreateDocument, usePatchDocument, useSaveStructure, usePublish, useDeleteDocument, useTogglePin, useRecordView, useVersions, useVersion, useRestore, useRelated, useLinks
  src/api/hooks/blocks.ts, fields.ts, scripts.ts, notes.ts, drafts.ts, search.ts, trash.ts, sources.ts, suggestions.ts, preferences.ts, admin.ts, system.ts
  src/api/events.ts                  useEvents(): SSE → invalidate
  src/components/Fmt.tsx             <Fmt text/> <Html html/>
  src/components/ui/{Button,Chip,Kbd,Toast,Modal,Confirm,Prompt,Empty}.tsx
  src/components/shell/{Shell,Sidebar,Rail,TabStrip,MobileDrawer}.tsx
  src/components/shell/navStore.tsx  tabs, history stack, split state (React context)
  src/components/library/{LibraryPage,DocCard,Facets,AutoCrmCard,CardMenu,FieldsPage,BlocksPage}.tsx
  src/components/article/{ArticlePage,StepView,StepConnections,DocHead,DocBody,JumpStrip,Trail,CallAside,Panel,CardMap,SplitView,Peek}.tsx
  src/components/palette/Palette.tsx
  src/components/editor/{EditorPage,BlockLibrary,StepEditor,BranchEditor,DropZone,SidePane,Checks}.tsx
  src/components/history/{HistoryPage,DiffView}.tsx
  src/components/trash/TrashPage.tsx
  src/components/sources/{SourcesPage,SourceSidebar,SourcePage,SuggestionsPanel,SuggestionCard}.tsx
  src/components/settings/SettingsDialog.tsx
  src/components/auth/{LoginPage,RequireAuth}.tsx
  src/components/admin/{AdminLayout,UsersPage,RolesPage,GroupsMapPage,SessionsPage,AuditPage,SystemPage}.tsx
  test/setup.ts, test/msw/fixtures.ts, test/msw/handlers.ts, test/msw/server.ts, test/render.tsx
  test/**/*.test.tsx
  e2e/{login,call-mode,publish-restore,trash,search}.spec.ts, e2e/fixtures/oidc-issuer.ts
```

---

### Task 1: Dependencies, test harness, global stylesheet, preferences bootstrap

**Files:**
- Modify: `apps/web/package.json`, `apps/web/vite.config.ts`, `apps/web/tsconfig.json`, `apps/web/index.html`
- Create: `apps/web/src/styles/app.css`, `apps/web/src/lib/prefs.ts`, `apps/web/test/setup.ts`, `apps/web/test/render.tsx`
- Test: `apps/web/test/lib/prefs.test.ts`

**Interfaces:**
- Produces: `applyPrefs(p: Preferences): void` (sets `document.documentElement.dataset.theme|font`), `renderWithProviders(ui, { route?, me? })` for tests.

- [ ] **Step 1: Failing test**

`apps/web/test/lib/prefs.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { applyPrefs } from '../../src/lib/prefs.js';

describe('applyPrefs', () => {
  it('sets theme and font attributes', () => {
    applyPrefs({ theme: 'dark', font: 'rubik', panel: true, callMode: true, sidebarExpanded: false });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.dataset.font).toBe('rubik');
  });
  it('follows the system when theme is null', () => {
    applyPrefs({ theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false });
    expect(['light', 'dark']).toContain(document.documentElement.dataset.theme);
    expect(document.documentElement.dataset.font).toBe('plex');
  });
});
```

- [ ] **Step 2: Run** — `pnpm --filter @wecom/web test` — FAIL (module missing).

- [ ] **Step 3: Add dependencies and harness**

Add to `apps/web/package.json` `dependencies`: `"zustand"` is NOT used (context only). Add `devDependencies`: `"@testing-library/react": "^16.0.1"`, `"@testing-library/user-event": "^14.5.2"`, `"@testing-library/jest-dom": "^6.5.0"`, `"msw": "^2.4.9"`, `"@playwright/test": "^1.47.2"`. Scripts: `"e2e": "playwright test"`.

`vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000', '/events': 'http://localhost:3000' } },
  test: { environment: 'jsdom', setupFiles: ['test/setup.ts'], include: ['test/**/*.test.ts?(x)'], globals: false, css: false },
});
```

`test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './msw/server.js';
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => { server.resetHandlers(); window.sessionStorage.clear(); });
afterAll(() => server.close());
if (!window.matchMedia) window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
class ES { onmessage: null = null; addEventListener() {} close() {} }
(globalThis as unknown as { EventSource: unknown }).EventSource = ES;
```

`src/lib/prefs.ts`:
```ts
import type { Preferences } from '@wecom/shared';
export function applyPrefs(p: Preferences): void {
  const root = document.documentElement;
  const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  root.dataset.theme = p.theme ?? (dark ? 'dark' : 'light');
  root.dataset.font = p.font === 'rubik' ? 'rubik' : 'plex';
}
```

`test/render.tsx`:
```tsx
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';
export function renderWithProviders(ui: ReactElement, opts: { route?: string } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
  return { qc, ...render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[opts.route ?? '/library']}>{ui}</MemoryRouter></QueryClientProvider>) };
}
```

`src/styles/app.css`: copy `legacy/css/app.css` verbatim (tokens, all components, media queries, print), then append:
```css
/* React-only additions */
.route-loading { padding: 40px; text-align: center; color: var(--muted); }
.field-error { color: var(--red-dark); font-size: 11.5px; }
.login { min-height: 100vh; display: grid; place-items: center; background: var(--bg); padding: 16px; }
.login .card { width: min(420px, 100%); padding: 28px; display: flex; flex-direction: column; gap: 14px; }
.login .logo { font-size: 32px; font-weight: 700; color: var(--red); font-family: Rubik, var(--font); }
.admin-layout { display: grid; grid-template-columns: 220px 1fr; flex: 1; min-height: 0; }
.admin-nav { border-inline-end: 1px solid var(--border); background: var(--surface); padding: 12px; display: flex; flex-direction: column; gap: 2px; }
.admin-nav a { padding: 8px 12px; border-radius: var(--r); color: var(--muted); text-decoration: none; }
.admin-nav a.active { background: var(--red-light); color: var(--red-dark); font-weight: 500; }
.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th, .table td { text-align: start; padding: 10px 12px; border-bottom: 1px solid var(--border); vertical-align: top; }
.table th { font-size: 10.5px; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); }
.perm-matrix td:not(:first-child) { text-align: center; }
@media (max-width: 960px) { .admin-layout { grid-template-columns: 1fr; } .admin-nav { flex-direction: row; overflow-x: auto; } }
```
`index.html` gets `<link rel="stylesheet" href="/src/styles/app.css">` is not needed — import it from `main.tsx` (`import './styles/app.css'`).

- [ ] **Step 4: Run** — `pnpm install && pnpm --filter @wecom/web test` — PASS (msw server file comes in Task 2; create `test/msw/server.ts` now as `export const server = setupServer();` with `import { setupServer } from 'msw/node'`).
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): test harness, stylesheet, preferences bootstrap"`.

---

### Task 2: msw fixtures and handlers (schema-validated)

**Files:**
- Create: `apps/web/test/msw/fixtures.ts`, `apps/web/test/msw/handlers.ts`
- Modify: `apps/web/test/msw/server.ts`
- Test: `apps/web/test/msw/fixtures.test.ts`

**Interfaces:**
- Produces: `fx` object: `fx.me` (`Me`), `fx.docBrowsing` (`Document`, 13 steps, phases as legacy seed), `fx.docIntl` (`Document` with `code: 'R-02'`), `fx.cards` (`DocumentCard[]`), `fx.blocks`, `fx.fields`, `fx.scripts`, `fx.notes`, `fx.versions`, `fx.sources`, `fx.suggestions`, `fx.trash`, `fx.users`, `fx.roles`; `handlers` (msw `http` handlers for every stage-1 route); helpers `withMe(partial)` and `asDenied(route)`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from 'vitest';
import { DocumentSchema, DocumentCardSchema, MeSchema, SuggestionSchema, SourceSchema, TrashItemSchema, BlockSchema, CrmFieldSchema, NoteSchema, VersionSchema } from '@wecom/shared';
import { fx } from './fixtures.js';

describe('fixtures validate against shared schemas', () => {
  it('documents', () => { DocumentSchema.parse(fx.docBrowsing); DocumentSchema.parse(fx.docIntl); });
  it('cards', () => { fx.cards.forEach((c) => DocumentCardSchema.parse(c)); expect(fx.cards.length).toBeGreaterThan(5); });
  it('me / blocks / fields / notes / versions', () => { MeSchema.parse(fx.me); fx.blocks.forEach((b) => BlockSchema.parse(b)); fx.fields.forEach((f) => CrmFieldSchema.parse(f)); fx.notes.forEach((n) => NoteSchema.parse(n)); fx.versions.forEach((v) => VersionSchema.parse(v)); });
  it('pipeline', () => { fx.sources.forEach((s) => SourceSchema.parse(s)); fx.suggestions.forEach((s) => SuggestionSchema.parse(s)); fx.trash.forEach((t) => TrashItemSchema.parse(t)); });
});
```

- [ ] **Step 2: Run** — FAIL.

- [ ] **Step 3: Write fixtures** (ids are fixed UUIDs; content mirrors `legacy/js/data.js` for the flagship doc so parity tests read naturally)

`test/msw/fixtures.ts` (excerpt showing the shape; fill all 13 steps of the browsing document from `legacy/js/data.js` `KB.SEED.docs[0]`, converting `id`→`key`, `hint` stays, `block: 'sim-refresh'`→`blockId: BLK_SIM`):
```ts
import type { Block, CrmField, Document, DocumentCard, Me, Note, Source, Suggestion, TrashItem, Version } from '@wecom/shared';
export const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', U2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
export const D_BROWSING = '11111111-1111-4111-8111-111111111111', D_INTL = '22222222-2222-4222-8222-222222222222', D_CHURN = '33333333-3333-4333-8333-333333333333';
export const BLK_SIM = '44444444-4444-4444-8444-444444444441', BLK_DEV = '44444444-4444-4444-8444-444444444442';
export const SRC_TECH = '55555555-5555-4555-8555-555555555551', REV_1 = '66666666-6666-4666-8666-666666666661';
const T = '2025-06-12T12:48:00.000Z';

export const me: Me = { user: { id: U1, subject: 'inbar@wecom.co.il', source: 'entra', email: 'inbar@wecom.co.il', displayName: 'ענבר ל.', initials: 'ע', active: true, lastLoginAt: T }, roles: ['lead'], permissions: ['docs.read','docs.create','docs.edit','docs.publish','docs.delete','docs.restore','blocks.edit','fields.edit','scripts.edit','notes.write','notes.moderate','suggestions.review','suggestions.apply','sources.manage'], categoryScopes: null, preferences: { theme: null, font: 'plex', panel: true, callMode: true, sidebarExpanded: false } };

export const docBrowsing: Document = {
  id: D_BROWSING, slug: 'browsing', code: 'T-01', title: 'איטיות גלישה / חוסר גלישה', description: 'נוהל דיבאג מלא – משלב מסנן ראשוני עד טיפול עמוק במסלולי מקום ספציפי / בכל מקום',
  category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7, sourceId: SRC_TECH, sourceRef: 'פרק 4', related: [{ documentId: D_INTL, why: 'מסלול מקביל · APN, ריענון SIM' }], createdAt: T, updatedAt: T, etag: 'e7',
  phases: [
    { id: 'p1', label: 'שלב 1 – מסנן', note: 'ללא מעורבות לקוח', steps: [
      { key: 's1', num: '1', title: 'בדיקת חסימת גלישה בארץ', sourceRef: '§4.1', blockRefs: [], deps: [], actions: [{ id: 'a1', text: 'פתח CRM ↗ שדה **"גלישה בארץ"**' }, { id: 'a2', text: 'אם **"חסום"** → כנס לאזור האישי ↗ ביצוע פעולות ↗ גלישה ותוכן → הדלק את המתג' }], outcomes: [{ kind: 'ok', text: '✓ לא חסום – המשך לשלב 2', goto: 's2' }, { kind: 'alert', text: '⚑ חסום – הפעל מתג גלישה' }] },
      { key: 's2', num: '2', title: 'בדיקת סיום חבילת גלישה', sourceRef: '§4.2', blockRefs: [], deps: [], actions: [{ id: 'a1', text: 'אזור אישי ↗ **"השימושים שלי"**' }], outcomes: [], branch: { q: 'מה מוצג?', options: [{ kind: 'if', label: 'ניצל 100%', text: 'הסבר ללקוח שהחבילה הסתיימה.' }, { kind: 'then', label: 'חבילה פעילה', text: 'המשך לשלב 3', goto: 's3' }] } },
      { key: 's3', num: '3', title: 'בדיקות במכשיר הלקוח', sourceRef: '§4.3', blockId: BLK_DEV, blockRefs: [], deps: [], actions: [], outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום השיחה' }, { kind: 'next', text: '→ לא הסתדר – המשך לשלב 2 (מברר)', goto: 's4' }] },
    ] },
    /* …phases p2, r1 (route '1'), r2 (route '2') with steps s4, s4a, s4b, s5…s13 exactly as legacy/js/data.js, s11 with blockId: BLK_SIM… */
  ],
};
export const blocks: Block[] = [
  { id: BLK_SIM, slug: 'sim-refresh', title: 'ריענון SIM', kind: 'step', actions: [{ id: 'b1', text: 'CRM ← מצב עריכה על המספר ← sim block lbl ← שמור' }, { id: 'b2', text: 'שוב עריכה ← sim allow lbl ← שמור' }, { id: 'b3', text: 'בקש מהלקוח לאתחל מכשיר' }], outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום' }, { kind: 'next', text: '→ לא הסתדר – המשך' }], currentVersion: 2, updatedAt: T },
  { id: BLK_DEV, slug: 'device-checks', title: 'בדיקות במכשיר הלקוח', kind: 'step', description: 'עבור עם הלקוח על ההגדרות הבאות:', actions: [{ id: 'b1', text: '**נתונים סלולריים** – אם כבוי → להדליק' }, { id: 'b2', text: '**Wi-Fi** – אם דולק → לכבות' }], outcomes: [{ kind: 'ok', text: '✓ הסתדר – סיום השיחה' }], currentVersion: 1, updatedAt: T },
];
export const fields: CrmField[] = [
  { name: 'גלישה בארץ', status: 'ok', path: 'CRM ↗ פרטי קו', updatedAt: T }, { name: 'השימושים שלי', status: 'ok', path: 'אזור אישי', updatedAt: T },
  { name: 'sim block lbl', status: 'ok', path: 'CRM ↗ מצב עריכה', updatedAt: T }, { name: 'sim allow lbl', status: 'ok', path: 'CRM ↗ מצב עריכה', updatedAt: T },
  { name: 'APN', status: 'ok', path: 'מכשיר', updatedAt: T }, { name: 'שירות נדידה', status: 'renamed', renamedTo: 'שירותי נדידה', path: 'CRM ↗ שירותים', updatedAt: T },
];
export const cards: DocumentCard[] = [
  { id: D_BROWSING, slug: 'browsing', title: docBrowsing.title, description: docBrowsing.description, category: 'tech', wave: 1, priority: 'hh', kind: 'steps', status: 'published', currentVersion: 7, updatedAt: T, stepCount: 15, linksOut: 3, linksIn: 1, views: 212, crmFields: ['גלישה בארץ', 'השימושים שלי', 'sim block lbl', 'sim allow lbl', 'APN'], hasSharedBlocks: true, pinned: true, authorName: 'ענבר ל.' },
  { id: D_INTL, slug: 'no-data-abroad', title: 'אין גלישה בחו"ל', description: 'בדיקות מערכת, APN, זהות רשת, ריענון SIM, איפוס רשת', category: 'intl', wave: 1, priority: 'h', kind: 'steps', status: 'published', currentVersion: 4, updatedAt: T, stepCount: 8, linksOut: 4, linksIn: 2, views: 0, crmFields: ['APN'], hasSharedBlocks: false, pinned: false },
  /* + 6 more cards across categories/waves incl. one status 'partial' and one 'draft' */
];
export const notes: Note[] = [{ id: '77777777-7777-4777-8777-777777777771', documentId: D_BROWSING, stepKey: 's8', authorId: U2, authorName: 'דנה ר.', text: 'שלב 8: Speedtest חוסם ב-Wi-Fi של הלקוח — לבקש לכבות לפני.', likes: 4, likedByMe: false, createdAt: T }];
export const versions: Version[] = [5, 6, 7].map((v) => ({ documentId: D_BROWSING, version: v, kind: 'published', label: ['מיזוג "ריענון SIM" לבלוק משותף', 'שינוי סף Speedtest 5→6 מגה', 'הוספת שלב 13 · החלפת SIM/eSIM'][v - 5], authorId: U1, authorName: v === 6 ? 'אלון ר.' : 'ענבר ל.', createdAt: T }));
export const sources: Source[] = [{ id: SRC_TECH, kind: 'docx', connectorId: null, externalId: null, title: 'נהלי תמיכה טכנית', ext: '.docx', syncState: 'pending', lastHash: 'h41', lastSyncedAt: T, linkedDocuments: 7, pendingSuggestions: 3, updatedAt: T }];
export const suggestions: Suggestion[] = [{ id: '88888888-8888-4888-8888-888888888881', sourceRevisionId: REV_1, anchor: '§4.8', type: 'update-step', title: 'סף Speedtest 5 → 6 מגה + ניתוק Wi-Fi', targetDocumentId: D_BROWSING, targetStepKey: 's8', targetBlockId: null, payload: { type: 'update-step', addActions: ['ודא שהלקוח מנותק מ-Wi-Fi לפני הבדיקה'], patch: {} }, confidence: 0.96, rationale: 'ערך מספרי שונה בפסקה 4.8', status: 'pending', createdAt: T }];
export const trash: TrashItem[] = [{ type: 'document', id: D_CHURN, title: 'Hotspot לא עובד', meta: 'תמיכה טכנית · topics.json#19 · v2 · 4 שלבים', deletedBy: 'אלון ר.', deletedAt: T, purgeAt: '2025-07-12T12:48:00.000Z', impact: { brokenLinks: 2, documents: [{ id: D_BROWSING, title: docBrowsing.title }] } }];
export const fx = { me, docBrowsing, docIntl: { ...docBrowsing, id: D_INTL, slug: 'no-data-abroad', code: 'R-02', title: 'אין גלישה בחו"ל', category: 'intl' as const, related: [] }, cards, blocks, fields, scripts: [], notes, versions, sources, suggestions, trash, users: [me.user], roles: [] };
```

`test/msw/handlers.ts` (every stage-1 route; mutable in-memory copies so tests can assert side effects):
```ts
import { http, HttpResponse } from 'msw';
import { fx } from './fixtures.js';
const B = '/api/v1';
export const state = { pins: new Set([fx.docBrowsing.id]), notes: [...fx.notes], suggestions: fx.suggestions.map((s) => ({ ...s })), drafts: new Map<string, unknown>(), published: [] as { id: string; label: string }[], trash: [...fx.trash] };
export const handlers = [
  http.get(`${B}/auth/me`, () => HttpResponse.json(fx.me)),
  http.get(`${B}/auth/providers`, () => HttpResponse.json({ providers: [{ id: 'entra', label: 'כניסה עם חשבון wecom' }, { id: 'local', label: 'חשבון מקומי' }] })),
  http.post(`${B}/auth/logout`, () => HttpResponse.json({ ok: true })),
  http.get(`${B}/documents`, ({ request }) => { const u = new URL(request.url); let items = fx.cards.map((c) => ({ ...c, pinned: state.pins.has(c.id) })); const cat = u.searchParams.get('category'); if (cat) items = items.filter((c) => c.category === cat); if (u.searchParams.get('pinned') === 'true') items = items.filter((c) => c.pinned); return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 }); }),
  http.get(`${B}/documents/:id`, ({ params }) => { const d = [fx.docBrowsing, fx.docIntl].find((x) => x.id === params.id); return d ? HttpResponse.json(d) : HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 }); }),
  http.get(`${B}/documents/:id/related`, () => HttpResponse.json([{ documentId: fx.docIntl.id, title: fx.docIntl.title, category: 'intl', why: 'מסלול מקביל · APN, ריענון SIM' }])),
  http.get(`${B}/documents/:id/links`, () => HttpResponse.json({ out: [{ fromDocumentId: fx.docBrowsing.id, fromStepKey: 's11', toDocumentId: null, toBlockId: fx.blocks[0].id, toFieldName: null, toSourceId: null, type: 'shares_block', origin: 'detected' }], in: [] })),
  http.get(`${B}/documents/:id/notes`, () => HttpResponse.json(state.notes)),
  http.post(`${B}/documents/:id/notes`, async ({ request, params }) => { const b = (await request.json()) as { stepKey: string | null; text: string }; const n = { id: crypto.randomUUID(), documentId: String(params.id), stepKey: b.stepKey, authorId: fx.me.user.id, authorName: fx.me.user.displayName, text: b.text, likes: 0, likedByMe: false, createdAt: new Date().toISOString() }; state.notes.push(n); return HttpResponse.json(n, { status: 201 }); }),
  http.post(`${B}/notes/:id/like`, ({ params }) => { const n = state.notes.find((x) => x.id === params.id)!; n.likedByMe = !n.likedByMe; n.likes += n.likedByMe ? 1 : -1; return HttpResponse.json(n); }),
  http.post(`${B}/documents/:id/pin`, ({ params }) => { state.pins.add(String(params.id)); return HttpResponse.json({ pinned: true }); }),
  http.delete(`${B}/documents/:id/pin`, ({ params }) => { state.pins.delete(String(params.id)); return HttpResponse.json({ pinned: false }); }),
  http.post(`${B}/documents/:id/view`, () => HttpResponse.json({ ok: true })),
  http.get(`${B}/documents/:id/versions`, () => HttpResponse.json(fx.versions)),
  http.get(`${B}/documents/:id/versions/:v`, ({ params }) => HttpResponse.json({ ...fx.docBrowsing, currentVersion: Number(params.v) })),
  http.post(`${B}/documents/:id/restore/:v`, ({ params }) => HttpResponse.json({ ...fx.docBrowsing, currentVersion: 8, etag: 'e8' })),
  http.post(`${B}/documents/:id/publish`, async ({ request, params }) => { const b = (await request.json()) as { label: string }; state.published.push({ id: String(params.id), label: b.label }); return HttpResponse.json({ ...fx.docBrowsing, currentVersion: 8, etag: 'e8' }); }),
  http.put(`${B}/documents/:id/structure`, async ({ request }) => HttpResponse.json({ ...fx.docBrowsing, ...(await request.json() as object), etag: 'e7b' })),
  http.post(`${B}/documents`, async ({ request }) => HttpResponse.json({ ...fx.docBrowsing, id: '99999999-9999-4999-8999-999999999999', ...(await request.json() as object), status: 'draft', currentVersion: 0 }, { status: 201 })),
  http.delete(`${B}/documents/:id`, () => HttpResponse.json({ ok: true })),
  http.get(`${B}/documents/:id/draft`, ({ params }) => { const d = state.drafts.get(String(params.id)); return d ? HttpResponse.json({ payload: d, updatedAt: new Date().toISOString() }) : new HttpResponse(null, { status: 204 }); }),
  http.put(`${B}/documents/:id/draft`, async ({ request, params }) => { const b = (await request.json()) as { payload: unknown }; state.drafts.set(String(params.id), b.payload); return HttpResponse.json({ ok: true, updatedAt: new Date().toISOString() }); }),
  http.delete(`${B}/documents/:id/draft`, ({ params }) => { state.drafts.delete(String(params.id)); return HttpResponse.json({ ok: true }); }),
  http.get(`${B}/blocks`, () => HttpResponse.json(fx.blocks)),
  http.get(`${B}/blocks/:id/usage`, () => HttpResponse.json([{ documentId: fx.docBrowsing.id, title: fx.docBrowsing.title, stepKey: 's11', stepNum: '11', embedded: true }])),
  http.get(`${B}/fields`, () => HttpResponse.json(fx.fields)),
  http.get(`${B}/fields/:name/usage`, () => HttpResponse.json([{ documentId: fx.docBrowsing.id, title: fx.docBrowsing.title, category: 'tech', currentVersion: 7 }])),
  http.get(`${B}/scripts`, () => HttpResponse.json(fx.scripts)),
  http.get(`${B}/search`, ({ request }) => { const q = new URL(request.url).searchParams.get('q') ?? ''; const hits = q ? [{ type: 'step', id: `${fx.docBrowsing.id}#s11`, documentId: fx.docBrowsing.id, stepKey: 's11', num: '11', title: 'ריענון SIM', snippet: 'בתוך איטיות גלישה', meta: 'topics.json · תמיכה טכנית', score: 80 }] : []; return HttpResponse.json({ groups: hits.length ? [{ type: 'steps', hits }] : [], total: hits.length, tookMs: 4, files: 1 }); }),
  http.get(`${B}/trash`, () => HttpResponse.json({ items: state.trash })),
  http.post(`${B}/trash/:type/:id/restore`, ({ params }) => { state.trash = state.trash.filter((t) => t.id !== params.id); return HttpResponse.json({ ok: true }); }),
  http.get(`${B}/sources`, () => HttpResponse.json(fx.sources)),
  http.get(`${B}/sources/:id/revisions/:rev`, () => HttpResponse.json({ id: 'rev', sourceId: fx.sources[0].id, hash: 'h41', accepted: false, importedAt: '2025-06-12T12:48:00.000Z', importedBy: null, paragraphs: [{ ref: '4.8', heading: 'בדיקת מהירות גלישה.', runs: [{ t: 'בקש מהלקוח להריץ Speedtest. ' }, { t: 'מעל 5 מגה', del: true }, { t: ' מעל 6 מגה', add: true }] }] })),
  http.get(`${B}/suggestions`, () => HttpResponse.json({ items: state.suggestions, total: state.suggestions.length, page: 1, pageSize: 50 })),
  http.post(`${B}/suggestions/:id/:decision`, ({ params }) => { const s = state.suggestions.find((x) => x.id === params.id)!; s.status = params.decision === 'accept' ? 'accepted' : params.decision === 'reject' ? 'rejected' : 'pending'; return HttpResponse.json(s); }),
  http.post(`${B}/suggestions/publish`, () => { state.suggestions.forEach((s) => { if (s.status === 'accepted') s.status = 'applied'; }); return HttpResponse.json({ applied: 1 }); }),
  http.get(`${B}/me/preferences`, () => HttpResponse.json(fx.me.preferences)),
  http.put(`${B}/me/preferences`, async ({ request }) => HttpResponse.json(await request.json())),
  http.get(`${B}/admin/users`, () => HttpResponse.json({ items: fx.users, total: 1, page: 1, pageSize: 50 })),
  http.get(`${B}/admin/roles`, () => HttpResponse.json(fx.roles)),
  http.get(`${B}/admin/groups-map`, () => HttpResponse.json({ entries: [] })),
  http.get(`${B}/admin/sessions`, () => HttpResponse.json([])),
  http.get(`${B}/admin/audit`, () => HttpResponse.json({ items: [], total: 0, page: 1, pageSize: 50 })),
  http.get(`${B}/admin/system`, () => HttpResponse.json({ db: true, model: false, queue: 0, connectors: {}, dbSizeMb: 12, backups: [] })),
  http.get(`${B}/system/health`, () => HttpResponse.json({ ok: true, db: true, model: false, queue: 0, version: '0.1.0', uptimeSec: 10 })),
];
export const withMe = (partial: Partial<typeof fx.me>) => http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, ...partial }));
export const asDenied = (method: 'get' | 'post' | 'put' | 'delete', path: string) => http[method](`${B}${path}`, () => HttpResponse.json({ code: 'FORBIDDEN', message: 'אין הרשאה' }, { status: 403 }));
```
`test/msw/server.ts`: `export const server = setupServer(...handlers);`

- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git add apps/web/test && git commit -m "test(web): msw fixtures and handlers validated by shared schemas"`.

---

### Task 3: `<Fmt>` component and format helpers

**Files:**
- Create: `apps/web/src/components/Fmt.tsx`, `apps/web/src/lib/format.ts`
- Test: `apps/web/test/components/Fmt.test.tsx`

**Interfaces:**
- Produces: `<Fmt text fields? docs? noCrm? as?/>` (default `span`), `<Html html/>`, `useFmtContext()` returning `{ fields: FieldInfo[]; docs: DocRef[] }` from `useFields()`/`useDocRefs()` (Task 4); `fmtDate(iso, { month? })`, `ago(iso)`, `inDays(iso)` (ports of legacy `KB.fmtDate/ago/inDays`).

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Fmt } from '../../src/components/Fmt.js';
import { fmtDate, ago } from '../../src/lib/format.js';

describe('<Fmt>', () => {
  it('renders CRM chips and bdi isolation', () => {
    const { container } = render(<Fmt text='פתח CRM ↗ שדה "גלישה בארץ" ← APN' fields={[{ name: 'גלישה בארץ', status: 'ok' }]} docs={[]} />);
    expect(container.querySelector('.crm[data-crm="גלישה בארץ"]')).not.toBeNull();
    expect(container.querySelector('bdi.lat')?.textContent).toBe('APN');
  });
  it('never renders raw html from text', () => {
    render(<Fmt text="<img src=x onerror=alert(1)>" fields={[]} docs={[]} />);
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText(/onerror/)).toBeInTheDocument();
  });
});
describe('dates', () => {
  it('formats Hebrew dates', () => { expect(fmtDate('2025-06-12')).toBe('12 יוני 2025'); expect(fmtDate('2025-06-12', { month: true })).toBe('יוני 2025'); });
  it('relative time', () => { expect(ago(new Date(Date.now() - 3 * 864e5).toISOString())).toBe('לפני 3 ימים'); });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`src/components/Fmt.tsx`:
```tsx
import { useMemo, type ElementType } from 'react';
import { fmt, type DocRef, type FieldInfo } from '@wecom/shared';
export function Html({ html, as: Tag = 'span', className }: { html: string; as?: ElementType; className?: string }) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
export function Fmt({ text, fields, docs, noCrm, as, className }: { text: string | null | undefined; fields: FieldInfo[]; docs: DocRef[]; noCrm?: boolean; as?: ElementType; className?: string }) {
  const html = useMemo(() => fmt(text ?? '', { fields, docs, noCrm }), [text, fields, docs, noCrm]);
  return <Html html={html} as={as} className={className} />;
}
```

`src/lib/format.ts`:
```ts
export { fmt, stripFmt, wordDiff, similarity, stepText, escapeHtml } from '@wecom/shared';
const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
const parse = (v: string | number | Date) => new Date(typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v + 'T12:00:00' : v);
export const fmtDate = (v: string | number | Date, o: { month?: boolean } = {}) => { const d = parse(v); if (isNaN(d.getTime())) return ''; return o.month ? `${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}` : `${d.getDate()} ${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`; };
export const fmtTime = (v: string | number | Date) => { const d = parse(v); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
export const ago = (v: string | number | Date) => { const s = Math.max(0, (Date.now() - parse(v).getTime()) / 1000); if (s < 5) return 'עכשיו'; if (s < 60) return `לפני ${Math.floor(s)} שנ׳`; const m = s / 60; if (m < 60) return `לפני ${Math.floor(m)} דק׳`; const h = m / 60; if (h < 24) return `לפני ${Math.floor(h)} שעות`; const d = h / 24; if (d < 2) return 'אתמול'; if (d < 30) return `לפני ${Math.floor(d)} ימים`; return fmtDate(v); };
export const inDays = (v: string | number | Date) => { const d = Math.ceil((parse(v).getTime() - Date.now()) / 864e5); return d <= 0 ? 'היום' : d === 1 ? 'מחר' : `בעוד ${d} ימים`; };
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): Fmt component and date helpers"`.

---

### Task 4: Data layer — query keys, hooks per resource, `useMe`/`can`, SSE invalidation

**Files:**
- Create: `apps/web/src/api/keys.ts`, `src/api/hooks/me.ts`, `src/api/hooks/documents.ts`, `src/api/hooks/blocks.ts`, `src/api/hooks/fields.ts`, `src/api/hooks/scripts.ts`, `src/api/hooks/notes.ts`, `src/api/hooks/drafts.ts`, `src/api/hooks/search.ts`, `src/api/hooks/trash.ts`, `src/api/hooks/sources.ts`, `src/api/hooks/suggestions.ts`, `src/api/hooks/preferences.ts`, `src/api/hooks/admin.ts`, `src/api/hooks/system.ts`, `src/api/events.ts`, `src/api/unwrap.ts`
- Test: `apps/web/test/api/hooks.test.tsx`, `apps/web/test/api/events.test.tsx`

**Interfaces:**
- Produces (exact hook names, all return TanStack results):
  - `keys = { me: ['me'], docs: (q) => ['documents', q], doc: (id) => ['document', id], related: (id), links: (id), notes: (id), versions: (id), version: (id, v), draft: (id), blocks: ['blocks'], blockUsage: (id), fields: ['fields'], fieldUsage: (name), scripts: ['scripts'], search: (q, types), trash: ['trash'], sources: ['sources'], revision: (id, rev), suggestions: (q), prefs: ['prefs'], admin: { users: (q), roles: ['roles'], groups: ['groups'], sessions: ['sessions'], audit: (q), system: ['system'] }, health: ['health'] }`
  - `unwrap(res)` throws `ApiError { status, code, message, details }` when `res.error`.
  - `useMe()`, `useLogout()`, `can(me: Me | undefined, permission: Permission, doc?: { category: Category }): boolean`, `useCan()` → `(p, doc?) => boolean`.
  - documents: `useDocuments(query: ListDocumentsQuery)`, `useDocument(id)`, `useRelated(id)`, `useLinks(id)`, `useCreateDocument()`, `usePatchDocument(id)`, `useSaveStructure(id)` (sends `If-Match`), `usePublish(id)`, `useDeleteDocument()`, `useTogglePin()` (optimistic on `keys.docs('*')`), `useRecordView()`, `useVersions(id)`, `useVersion(id, v)`, `useRestore(id)`.
  - notes: `useNotes(id)`, `useAddNote(id)`, `useLikeNote(id)` (optimistic), `useDeleteNote(id)`.
  - drafts: `useDraft(id)`, `useSaveDraft(id)` (debounced 600 ms inside the hook via `useDebouncedMutation`), `useDeleteDraft(id)`.
  - `useSearch(q, types)` (enabled when `q.length > 0`, `keepPreviousData`), `useTrash()`, `useRestoreTrash()`, `usePurgeTrash()`, `useRestoreAllTrash()`, `useEmptyTrash()`.
  - `useSources()`, `useRevision(id, rev)`, `useProcessSource()`, `useUploadSource()`, `useSuggestions(q)`, `useDecideSuggestion()`, `useEditSuggestion()`, `usePublishSuggestions()`.
  - `usePreferences()`, `useSavePreferences()` (also calls `applyPrefs`).
  - admin: `useUsers(q)`, `usePatchUser()`, `useRoles()`, `useUpsertRole()`, `useDeleteRole()`, `useGroupsMap()`, `useSaveGroupsMap()`, `useSessions()`, `useRevokeSession()`, `useAudit(q)`, `useSystem()`; `useHealth()`.
  - `useEvents()`: opens `EventSource('/events')`, parses with `EventSchema`, invalidates: `document.*` → `keys.doc(id)`, `keys.docs`, `keys.versions(id)`, `keys.trash`; `suggestion.*` → `keys.suggestions`, `keys.sources`; `sync.*` → `keys.sources`; `system.status` → `keys.system`, `keys.health`; exposes `{ connected: boolean; last?: Event }`.

- [ ] **Step 1: Failing tests**

`test/api/hooks.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useDocuments, useTogglePin } from '../../src/api/hooks/documents.js';
import { useMe, can } from '../../src/api/hooks/me.js';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

const wrap = () => { const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>; };

describe('hooks', () => {
  it('lists documents by category', async () => {
    const { result } = renderHook(() => useDocuments({ category: 'intl', page: 1, pageSize: 50, sort: 'wave' }), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.items.every((c) => c.category === 'intl')).toBe(true));
  });
  it('toggles pin optimistically and persists', async () => {
    const w = wrap();
    const list = renderHook(() => useDocuments({ page: 1, pageSize: 50, sort: 'wave' }), { wrapper: w });
    const pin = renderHook(() => useTogglePin(), { wrapper: w });
    await waitFor(() => expect(list.result.current.data).toBeDefined());
    await act(async () => { await pin.result.current.mutateAsync({ id: fx.docIntl.id, pinned: true }); });
    expect(state.pins.has(fx.docIntl.id)).toBe(true);
  });
  it('resolves permissions with category scope', async () => {
    const { result } = renderHook(() => useMe(), { wrapper: wrap() });
    await waitFor(() => expect(result.current.data?.user.displayName).toBe('ענבר ל.'));
    expect(can(result.current.data, 'docs.publish', { category: 'tech' })).toBe(true);
    expect(can({ ...result.current.data!, categoryScopes: ['intl'] }, 'docs.publish', { category: 'tech' })).toBe(false);
    expect(can(result.current.data, 'users.manage')).toBe(false);
  });
});
```

`test/api/events.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useEvents } from '../../src/api/events.js';
import { keys } from '../../src/api/keys.js';

class FakeES { static last: FakeES; listeners: Record<string, ((e: MessageEvent) => void)[]> = {}; constructor() { FakeES.last = this; } addEventListener(n: string, f: (e: MessageEvent) => void) { (this.listeners[n] ??= []).push(f); } close() {} emit(n: string, data: unknown) { (this.listeners[n] ?? []).forEach((f) => f({ data: JSON.stringify(data) } as MessageEvent)); } }

describe('useEvents', () => {
  it('invalidates document queries on document.published', async () => {
    (globalThis as unknown as { EventSource: unknown }).EventSource = FakeES;
    const qc = new QueryClient(); const spy = vi.spyOn(qc, 'invalidateQueries');
    renderHook(() => useEvents(), { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> });
    FakeES.last.emit('document.published', { name: 'document.published', payload: { documentId: '11111111-1111-4111-8111-111111111111', version: 8, actorId: null }, at: new Date().toISOString() });
    await waitFor(() => expect(spy).toHaveBeenCalledWith({ queryKey: keys.doc('11111111-1111-4111-8111-111111111111') }));
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** (representative files; the remaining hooks follow the same pattern with the route names from spec §4)

`src/api/unwrap.ts`:
```ts
export class ApiError extends Error { constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); } }
export function unwrap<T>(res: { data?: T; error?: unknown; response: Response }): T {
  if (res.error !== undefined || !res.response.ok) { const e = (res.error ?? {}) as { code?: string; message?: string; details?: unknown }; throw new ApiError(res.response.status, e.code ?? 'ERROR', e.message ?? 'שגיאה', e.details); }
  return res.data as T;
}
```

`src/api/keys.ts`:
```ts
export const keys = {
  me: ['me'] as const, health: ['health'] as const, prefs: ['prefs'] as const,
  docs: (q: unknown = '*') => ['documents', q] as const, doc: (id: string) => ['document', id] as const, related: (id: string) => ['related', id] as const, links: (id: string) => ['links', id] as const,
  notes: (id: string) => ['notes', id] as const, versions: (id: string) => ['versions', id] as const, version: (id: string, v: number) => ['version', id, v] as const, draft: (id: string) => ['draft', id] as const,
  blocks: ['blocks'] as const, blockUsage: (id: string) => ['blockUsage', id] as const, fields: ['fields'] as const, fieldUsage: (n: string) => ['fieldUsage', n] as const, scripts: ['scripts'] as const,
  search: (q: string, types?: string) => ['search', q, types ?? ''] as const, trash: ['trash'] as const, sources: ['sources'] as const, revision: (id: string, rev: string) => ['revision', id, rev] as const, suggestions: (q: unknown = '*') => ['suggestions', q] as const,
  admin: { users: (q: unknown = '*') => ['admin', 'users', q] as const, roles: ['admin', 'roles'] as const, groups: ['admin', 'groups'] as const, sessions: ['admin', 'sessions'] as const, audit: (q: unknown = '*') => ['admin', 'audit', q] as const, system: ['admin', 'system'] as const },
};
```

`src/api/hooks/me.ts`:
```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, Me, Permission } from '@wecom/shared';
import { api } from '../client.js'; import { keys } from '../keys.js'; import { unwrap, ApiError } from '../unwrap.js';
export function useMe() { return useQuery({ queryKey: keys.me, queryFn: async () => unwrap<Me>(await api.GET('/auth/me')), retry: (n, e) => !(e instanceof ApiError && e.status === 401) && n < 2, staleTime: 60_000 }); }
export function useLogout() { const qc = useQueryClient(); return useMutation({ mutationFn: async () => unwrap(await api.POST('/auth/logout')), onSuccess: () => { qc.clear(); window.location.assign('/login'); } }); }
export function can(me: Me | undefined, permission: Permission, doc?: { category: Category }): boolean {
  if (!me) return false; if (!me.permissions.includes(permission)) return false;
  if (doc && permission.startsWith('docs.') && me.categoryScopes && !me.categoryScopes.includes(doc.category)) return false;
  return true;
}
export function useCan() { const { data } = useMe(); return (p: Permission, doc?: { category: Category }) => can(data, p, doc); }
```

`src/api/hooks/documents.ts` (excerpt):
```ts
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import type { Document, DocumentCard, ListDocumentsQuery, Version } from '@wecom/shared';
import { api } from '../client.js'; import { keys } from '../keys.js'; import { unwrap } from '../unwrap.js';
type Page = { items: DocumentCard[]; total: number; page: number; pageSize: number };
export const useDocuments = (q: Partial<ListDocumentsQuery>) => useQuery({ queryKey: keys.docs(q), queryFn: async () => unwrap<Page>(await api.GET('/documents', { params: { query: q as never } })), placeholderData: keepPreviousData });
export const useDocument = (id: string | undefined) => useQuery({ queryKey: keys.doc(id ?? ''), enabled: !!id, queryFn: async () => unwrap<Document>(await api.GET('/documents/{id}', { params: { path: { id: id! } } })) });
export const useRelated = (id: string) => useQuery({ queryKey: keys.related(id), queryFn: async () => unwrap<{ documentId: string; title: string; category: string; why: string }[]>(await api.GET('/documents/{id}/related', { params: { path: { id } } })) });
export const useVersions = (id: string) => useQuery({ queryKey: keys.versions(id), queryFn: async () => unwrap<Version[]>(await api.GET('/documents/{id}/versions', { params: { path: { id } } })) });
export const useVersion = (id: string, v: number | undefined) => useQuery({ queryKey: keys.version(id, v ?? -1), enabled: v != null, queryFn: async () => unwrap<Document>(await api.GET('/documents/{id}/versions/{v}', { params: { path: { id, v: v! } } })) });
export function useTogglePin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, pinned }: { id: string; pinned: boolean }) => unwrap(pinned ? await api.POST('/documents/{id}/pin', { params: { path: { id } } }) : await api.DELETE('/documents/{id}/pin', { params: { path: { id } } })),
    onMutate: async ({ id, pinned }) => { await qc.cancelQueries({ queryKey: ['documents'] }); const prev = qc.getQueriesData<Page>({ queryKey: ['documents'] }); qc.setQueriesData<Page>({ queryKey: ['documents'] }, (p) => p && { ...p, items: p.items.map((c) => (c.id === id ? { ...c, pinned } : c)) }); return { prev }; },
    onError: (_e, _v, ctx) => ctx?.prev.forEach(([k, d]) => qc.setQueryData(k, d)),
    onSettled: () => qc.invalidateQueries({ queryKey: ['documents'] }),
  });
}
export const usePublish = (id: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: async (body: { label: string; markPartial?: boolean }) => unwrap<Document>(await api.POST('/documents/{id}/publish', { params: { path: { id } }, body })), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.doc(id) }); qc.invalidateQueries({ queryKey: keys.versions(id) }); qc.invalidateQueries({ queryKey: ['documents'] }); qc.removeQueries({ queryKey: keys.draft(id) }); } }); };
export const useSaveStructure = (id: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: async ({ phases, related, etag }: { phases: Document['phases']; related?: Document['related']; etag?: string }) => unwrap<Document>(await api.PUT('/documents/{id}/structure', { params: { path: { id } }, body: { phases, related }, headers: etag ? { 'If-Match': etag } : {} })), onSuccess: (d) => qc.setQueryData(keys.doc(id), d) }); };
export const useRestore = (id: string) => { const qc = useQueryClient(); return useMutation({ mutationFn: async (v: number) => unwrap<Document>(await api.POST('/documents/{id}/restore/{v}', { params: { path: { id, v } } })), onSuccess: () => { qc.invalidateQueries({ queryKey: keys.doc(id) }); qc.invalidateQueries({ queryKey: keys.versions(id) }); } }); };
export const useRecordView = () => useMutation({ mutationFn: async (id: string) => unwrap(await api.POST('/documents/{id}/view', { params: { path: { id } } })) });
export const useDeleteDocument = () => { const qc = useQueryClient(); return useMutation({ mutationFn: async (id: string) => unwrap(await api.DELETE('/documents/{id}', { params: { path: { id } } })), onSuccess: () => { qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: keys.trash }); } }); };
export const useCreateDocument = () => useMutation({ mutationFn: async (body: Parameters<typeof api.POST<'/documents'>>[1] extends { body?: infer B } ? B : never) => unwrap<Document>(await api.POST('/documents', { body })) });
```

`src/api/events.ts`:
```ts
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { EVENTS, EventSchema, type Event } from '@wecom/shared';
import { keys } from './keys.js';
export function useEvents() {
  const qc = useQueryClient(); const [connected, setConnected] = useState(false); const [last, setLast] = useState<Event>();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/events', { withCredentials: true } as EventSourceInit);
    es.addEventListener('open', () => setConnected(true)); es.addEventListener('error', () => setConnected(false));
    for (const name of EVENTS) es.addEventListener(name, (raw) => {
      const parsed = EventSchema.safeParse(JSON.parse((raw as MessageEvent).data)); if (!parsed.success) return;
      const ev = parsed.data; setLast(ev);
      if (ev.name.startsWith('document.')) { const id = (ev.payload as { documentId: string }).documentId; qc.invalidateQueries({ queryKey: keys.doc(id) }); qc.invalidateQueries({ queryKey: ['documents'] }); qc.invalidateQueries({ queryKey: keys.versions(id) }); qc.invalidateQueries({ queryKey: keys.trash }); }
      else if (ev.name.startsWith('suggestion.')) { qc.invalidateQueries({ queryKey: ['suggestions'] }); qc.invalidateQueries({ queryKey: keys.sources }); }
      else if (ev.name.startsWith('sync.')) qc.invalidateQueries({ queryKey: keys.sources });
      else if (ev.name === 'system.status' || ev.name === 'job.failed') { qc.invalidateQueries({ queryKey: keys.admin.system }); qc.invalidateQueries({ queryKey: keys.health }); }
    });
    return () => es.close();
  }, [qc]);
  return { connected, last };
}
```
Remaining hook files follow the same shape (`useQuery` + `unwrap` per GET, `useMutation` + invalidate per write; `useSaveDraft` wraps `useMutation` in a 600 ms `setTimeout` debounce and exposes `{ save(payload), saving, lastSavedAt }`; `useSavePreferences` calls `applyPrefs` in `onSuccess`).

- [ ] **Step 4: Run** — PASS (both files). `pnpm --filter @wecom/web typecheck` — PASS (paths in `api.GET('/documents/{id}')` must exist in `schema.d.ts`; regenerate after L2 merges; until then, the L0 skeleton's OpenAPI only has `/system/health` — add a `src/api/paths.d.ts` fallback declaring the stage-1 routes typed from shared schemas so typecheck passes before L2; delete it when the generated file covers them).
- [ ] **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): typed data layer, permissions helper, SSE invalidation"`.

---

### Task 5: Shell — router, sidebar (full/rail), tab strip, nav store, hotkeys, toasts, modals

**Files:**
- Create: `src/routes.tsx`, `src/App.tsx` (replace L0 placeholder), `src/main.tsx` (replace), `src/components/shell/{Shell,Sidebar,Rail,TabStrip,MobileDrawer,navStore}.tsx`, `src/components/ui/{Button,Chip,Kbd,Toast,Modal,Confirm,Prompt,Empty}.tsx`, `src/lib/keyboard.ts`
- Test: `test/shell/Shell.test.tsx`, `test/shell/navStore.test.tsx`

**Interfaces:**
- Produces: `useNav()` from `navStore`: `{ tabs: { docId: string; title: string }[]; activeTab: number; openDoc(id, opts?: { newTab?: boolean; step?: string }); closeTab(i); split: { left: string; right: string } | null; toggleSplit(rightId?); back(); forward(); canBack; canForward; trail: string[] }` (history stack mirrors `react-router` navigation; tabs persisted per user in `preferences` is out of scope — `sessionStorage`); `useToast()` → `toast(msg, kind?, undo?)`; `useModal()` → `{ confirm(title, html, ok, cls) → Promise<boolean>; prompt(title, label, value?, multiline?) → Promise<string | null>; open(node) }`; `useHotkeys(map: Record<string, (e) => void>, deps)` ignoring typing targets; `isTyping()`.
- Shell layout ids: `#app` (class `rail` when in doc/edit/history/sources and not expanded), `#sidebar`, `#tabstrip`, `#view`.

- [ ] **Step 1: Failing tests**

`test/shell/Shell.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

describe('<Shell>', () => {
  it('renders sidebar counts and category rows', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await waitFor(() => expect(screen.getByText('ספריית ידע')).toBeInTheDocument());
    expect(screen.getByText('חו"ל ונדידה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /חיפוש בכל המקורות/ })).toBeInTheDocument();
  });
  it('collapses to a rail on document routes and expands back', async () => {
    renderWithProviders(<App />, { route: '/doc/11111111-1111-4111-8111-111111111111' });
    await waitFor(() => expect(document.querySelector('#app')).toHaveClass('rail'));
    await userEvent.click(screen.getByTitle('הרחב תפריט'));
    expect(document.querySelector('#app')).not.toHaveClass('rail');
  });
  it('opens the palette with Ctrl+K', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByPlaceholderText(/חפש מסמך/)).toBeInTheDocument();
  });
});
```

`test/shell/navStore.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { NavProvider, useNav } from '../../src/components/shell/navStore.js';
const w = ({ children }: { children: React.ReactNode }) => <MemoryRouter><NavProvider>{children}</NavProvider></MemoryRouter>;
describe('navStore', () => {
  it('replaces the active tab unless newTab, caps at 8, closes to neighbour', () => {
    const { result } = renderHook(() => useNav(), { wrapper: w });
    act(() => result.current.openDoc('a', { title: 'A' })); act(() => result.current.openDoc('b', { title: 'B' }));
    expect(result.current.tabs.map((t) => t.docId)).toEqual(['b']);
    act(() => result.current.openDoc('c', { title: 'C', newTab: true }));
    expect(result.current.tabs.map((t) => t.docId)).toEqual(['b', 'c']); expect(result.current.activeTab).toBe(1);
    act(() => result.current.closeTab(1)); expect(result.current.activeTab).toBe(0);
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

`src/routes.tsx`:
```tsx
import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Shell } from './components/shell/Shell.js';
import { RequireAuth } from './components/auth/RequireAuth.js';
import { LoginPage } from './components/auth/LoginPage.js';
import { LibraryPage } from './components/library/LibraryPage.js';
import { FieldsPage } from './components/library/FieldsPage.js';
import { BlocksPage } from './components/library/BlocksPage.js';
import { ArticlePage } from './components/article/ArticlePage.js';
import { EditorPage } from './components/editor/EditorPage.js';
import { HistoryPage } from './components/history/HistoryPage.js';
import { TrashPage } from './components/trash/TrashPage.js';
import { SourcesPage } from './components/sources/SourcesPage.js';
import { AdminLayout } from './components/admin/AdminLayout.js';
import { UsersPage } from './components/admin/UsersPage.js'; import { RolesPage } from './components/admin/RolesPage.js'; import { GroupsMapPage } from './components/admin/GroupsMapPage.js'; import { SessionsPage } from './components/admin/SessionsPage.js'; import { AuditPage } from './components/admin/AuditPage.js'; import { SystemPage } from './components/admin/SystemPage.js';
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { element: <RequireAuth><Shell /></RequireAuth>, children: [
    { index: true, element: <Navigate to="/library" replace /> },
    { path: 'library/:category?', element: <LibraryPage mode="library" /> },
    { path: 'pinned', element: <LibraryPage mode="pinned" /> }, { path: 'recent', element: <LibraryPage mode="recent" /> }, { path: 'drafts', element: <LibraryPage mode="drafts" /> },
    { path: 'fields', element: <FieldsPage /> }, { path: 'blocks', element: <BlocksPage /> },
    { path: 'doc/:id/:step?', element: <ArticlePage /> }, { path: 'edit/:id', element: <EditorPage /> }, { path: 'history/:id?/:v?', element: <HistoryPage /> },
    { path: 'trash', element: <TrashPage /> }, { path: 'sources/:id?', element: <SourcesPage /> },
    { path: 'admin', element: <AdminLayout />, children: [{ index: true, element: <Navigate to="users" replace /> }, { path: 'users', element: <UsersPage /> }, { path: 'roles', element: <RolesPage /> }, { path: 'groups', element: <GroupsMapPage /> }, { path: 'sessions', element: <SessionsPage /> }, { path: 'audit', element: <AuditPage /> }, { path: 'system', element: <SystemPage /> }] },
  ] },
]);
```
`src/App.tsx` exports `App` = `<RouterProvider router={router}/>` when used from `main.tsx`; for tests, `App` accepts being mounted inside a `MemoryRouter`: implement `App` as the route tree via `useRoutes(routeObjects)` and `main.tsx` wraps it in `BrowserRouter` (so `createBrowserRouter` above becomes `export const routeObjects = [...]` and `App = () => useRoutes(routeObjects)`).

`src/components/shell/navStore.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
type Tab = { docId: string; title: string };
type Split = { left: string; right: string } | null;
interface Nav { tabs: Tab[]; activeTab: number; openDoc(id: string, o?: { title?: string; newTab?: boolean; step?: string }): void; closeTab(i: number): void; setActiveTab(i: number): void; split: Split; toggleSplit(rightId?: string): void; back(): void; forward(): void; canBack: boolean; canForward: boolean; trail: { path: string; title: string }[]; setTitle(path: string, title: string): void }
const Ctx = createContext<Nav | null>(null);
const load = <T,>(k: string, d: T): T => { try { return JSON.parse(sessionStorage.getItem(k) ?? '') as T; } catch { return d; } };
export function NavProvider({ children }: { children: ReactNode }) {
  const nav = useNavigate(); const loc = useLocation();
  const [tabs, setTabs] = useState<Tab[]>(() => load('kb.tabs', [])); const [activeTab, setActiveTab] = useState(() => load('kb.activeTab', 0)); const [split, setSplit] = useState<Split>(null);
  const stack = useRef<{ path: string; title: string }[]>([]); const pos = useRef(-1); const [, tick] = useState(0); const titles = useRef(new Map<string, string>());
  useEffect(() => { sessionStorage.setItem('kb.tabs', JSON.stringify(tabs)); sessionStorage.setItem('kb.activeTab', String(activeTab)); }, [tabs, activeTab]);
  useEffect(() => { const path = loc.pathname; const s = stack.current; if (s[pos.current]?.path === path) return; if (s[pos.current - 1]?.path === path) pos.current--; else if (s[pos.current + 1]?.path === path) pos.current++; else { stack.current = s.slice(0, pos.current + 1).concat({ path, title: titles.current.get(path) ?? path }); pos.current = stack.current.length - 1; } if (!path.startsWith('/doc/')) setSplit(null); tick((n) => n + 1); }, [loc.pathname]);
  const openDoc = useCallback((id: string, o: { title?: string; newTab?: boolean; step?: string } = {}) => {
    setTabs((t) => { const i = t.findIndex((x) => x.docId === id); let next = t.slice(); let act = i; if (i < 0) { if (o.newTab || !t.length) { next.push({ docId: id, title: o.title ?? id }); act = next.length - 1; } else { next[activeTab] = { docId: id, title: o.title ?? id }; act = activeTab; } } else if (o.title) next[i] = { docId: id, title: o.title }; if (next.length > 8) { next = next.slice(1); act = Math.max(0, act - 1); } setActiveTab(act); return next; });
    nav(`/doc/${id}${o.step ? '/' + o.step : ''}`);
  }, [nav, activeTab]);
  const closeTab = useCallback((i: number) => { setTabs((t) => { const next = t.filter((_, j) => j !== i); const wasActive = i === activeTab; const act = Math.min(activeTab >= i ? activeTab - 1 : activeTab, next.length - 1); setActiveTab(Math.max(0, act)); if (wasActive) nav(next.length ? `/doc/${next[Math.max(0, act)].docId}` : '/library'); return next; }); }, [activeTab, nav]);
  const toggleSplit = useCallback((rightId?: string) => { const m = /^\/doc\/([^/]+)/.exec(loc.pathname); if (!m) return; if (split && !rightId) { setSplit(null); return; } const right = rightId ?? tabs.find((t) => t.docId !== m[1])?.docId; if (right) setSplit({ left: m[1], right }); }, [loc.pathname, split, tabs]);
  const value = useMemo<Nav>(() => ({ tabs, activeTab, openDoc, closeTab, setActiveTab, split, toggleSplit, back: () => nav(-1), forward: () => nav(1), canBack: pos.current > 0, canForward: pos.current < stack.current.length - 1, trail: stack.current.slice(0, pos.current + 1), setTitle: (p, t) => { titles.current.set(p, t); const e = stack.current.find((x) => x.path === p); if (e) e.title = t; } }), [tabs, activeTab, openDoc, closeTab, split, toggleSplit, nav, loc.pathname]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useNav = () => { const v = useContext(Ctx); if (!v) throw new Error('NavProvider missing'); return v; };
```

`src/lib/keyboard.ts`:
```ts
import { useEffect } from 'react';
export const isTyping = () => { const a = document.activeElement as HTMLElement | null; return !!a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable); };
/** map keys like 'ctrl+k', 'alt+t', 'ArrowDown', '1', '?' → handler. Modifier combos fire even while typing; plain keys don't. */
export function useHotkeys(map: Record<string, (e: KeyboardEvent) => void>, deps: unknown[]) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { const mod = e.ctrlKey || e.metaKey; const key = e.key.length === 1 ? e.key.toLowerCase() : e.key; const combo = `${mod ? 'ctrl+' : ''}${e.altKey ? 'alt+' : ''}${key}`; const fn = map[combo] ?? map[e.key]; if (!fn) return; if (!mod && !e.altKey && isTyping()) return; fn(e); };
    window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h);
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
}
export const HEBREW_KEY_ALIASES: Record<string, string> = { ק: 'e', ע: 'g', מ: 'n', פ: 'p', ב: 'c', י: 'h', "'": 'w' };
```

`Shell.tsx` renders `#app` grid with `<Sidebar/>`/`<Rail/>` (chosen by route + `preferences.sidebarExpanded`), `#tabstrip` (`<TabStrip/>` only on `/doc/*` when tabs exist), `<Outlet/>` in `#view`, mounts `useEvents()`, `<Palette/>`, `<Peek/>` host, `<ToastHost/>`, `<ModalHost/>`, and global hotkeys: `ctrl+k` palette, `ctrl+d` theme toggle via `useSavePreferences`, `ctrl+\\` `toggleSplit`, `alt+t` palette in `newtab` mode, `alt+ArrowLeft/Right` back/forward (RTL-aware like legacy), `?` keymap modal, `w` close tab on doc routes. `Sidebar.tsx` ports legacy `renderSidebar` (brand, search trigger, nav items with counts from `useDocuments({pinned:true})`, `useTrash()`, `useSources()`, sources rows from `KB.SOURCES` equivalent constant `SOURCE_FILES` in `src/lib/constants.ts`, category rows with counts from `useDocuments({})`, user footer with theme toggle and settings). `Rail.tsx` ports the collapsed variant. `TabStrip.tsx` ports `renderTabs`. `MobileDrawer` toggles `.open` + scrim. UI atoms are thin wrappers over legacy classes (`btn`, `chip`, `kbd`, `toast`, `overlay/modal`).

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git add apps/web && git commit -m "feat(web): shell, sidebar/rail, tabs, nav store, hotkeys, toasts, modals"`.

---

### Task 6: Login page and auth guard

**Files:**
- Create: `src/components/auth/LoginPage.tsx`, `src/components/auth/RequireAuth.tsx`
- Test: `test/auth/Login.test.tsx`

**Interfaces:**
- Produces: `RequireAuth` (renders children when `useMe()` succeeds; on 401 → `<Navigate to="/login?next=…"/>`; on load shows `.route-loading`), `LoginPage` (lists `GET /auth/providers`; Entra button is an `<a href="/api/v1/auth/login?next=…">`; local form posts `/auth/local`).

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { server } from '../msw/server.js';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

describe('auth', () => {
  it('redirects unauthenticated users to /login with providers', async () => {
    server.use(http.get('/api/v1/auth/me', () => HttpResponse.json({ code: 'UNAUTHENTICATED', message: 'לא מחובר' }, { status: 401 })));
    renderWithProviders(<App />, { route: '/library/intl' });
    expect(await screen.findByRole('link', { name: 'כניסה עם חשבון wecom' })).toHaveAttribute('href', '/api/v1/auth/login?next=%2Flibrary%2Fintl');
  });
  it('shows the app when authenticated', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await waitFor(() => expect(screen.getByText('ספריית ידע')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**

```tsx
// RequireAuth.tsx
import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { useMe } from '../../api/hooks/me.js'; import { ApiError } from '../../api/unwrap.js'; import { applyPrefs } from '../../lib/prefs.js';
import { useEffect } from 'react';
export function RequireAuth({ children }: { children: ReactNode }) {
  const me = useMe(); const loc = useLocation();
  useEffect(() => { if (me.data) applyPrefs(me.data.preferences); }, [me.data]);
  if (me.isPending) return <div className="route-loading">טוען…</div>;
  if (me.error instanceof ApiError && me.error.status === 401) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} replace />;
  if (me.error) return <div className="empty"><b>השרת לא זמין</b>{me.error.message}</div>;
  return <>{children}</>;
}
// LoginPage.tsx
import { useQuery } from '@tanstack/react-query'; import { useSearchParams } from 'react-router-dom';
import { api } from '../../api/client.js'; import { unwrap } from '../../api/unwrap.js';
export function LoginPage() {
  const [sp] = useSearchParams(); const next = sp.get('next') ?? '/library';
  const providers = useQuery({ queryKey: ['providers'], queryFn: async () => unwrap<{ providers: { id: string; label: string }[] }>(await api.GET('/auth/providers')) });
  return <div className="login"><div className="card">
    <div className="logo">wecom.</div><div className="muted">מאגר ידע פנימי · כניסה</div>
    {providers.data?.providers.map((p) => p.id === 'local'
      ? <form key={p.id} className="form" onSubmit={async (e) => { e.preventDefault(); const f = new FormData(e.currentTarget); await api.POST('/auth/local', { body: { username: String(f.get('u')), password: String(f.get('p')) } }); window.location.assign(next); }}><label>שם משתמש<input name="u" /></label><label>סיסמה<input name="p" type="password" /></label><button className="btn">כניסה מקומית</button></form>
      : <a key={p.id} className="btn primary" href={`/api/v1/auth/login?next=${encodeURIComponent(next)}`}>{p.label}</a>)}
    <div className="small muted">הזדהות דרך חשבון Microsoft של החברה. במקרה של בעיה פנו ל-IT.</div>
  </div></div>;
}
```

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): login page and auth guard"`.

---

### Task 7: Library page, cards, facets, auto CRM card, fields and blocks pages

**Files:**
- Create: `src/components/library/{LibraryPage,DocCard,Facets,AutoCrmCard,CardMenu,FieldsPage,BlocksPage,FieldDialog,BlockDialog}.tsx`, `src/lib/constants.ts` (`CATS`, `PRI`, `WAVES`, `SOURCE_FILES` copied from `legacy/js/data.js`)
- Test: `test/library/Library.test.tsx`

**Interfaces:**
- Produces: `<DocCard card onOpen onPin onMenu/>` (classes `tcard`, `partial`, `placeholder`, star `.star.on`), `<Facets value onChange/>` with `{ wave: 'all'|1|2|3; flag: null|'hh'|'month'|'partial' }`, `<AutoCrmCard/>` (top two used fields + changed fields from `useFields()`/`useFieldUsage`), `showField(name)` and `showBlock(id)` dialogs (`FieldDialog`, `BlockDialog` incl. edit/delete for `blocks.edit`/`fields.edit`).

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state } from '../msw/handlers.js';

describe('<LibraryPage>', () => {
  it('groups cards by wave with pinned first and the auto CRM card', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const grid = await screen.findByTestId('library-grid');
    const rules = within(grid).getAllByTestId('rule').map((r) => r.textContent);
    expect(rules[0]).toMatch(/מוצמדים/); expect(rules[1]).toMatch(/גל 1/);
    expect(within(grid).getByText('שדות CRM שמשתנים השבוע')).toBeInTheDocument();
  });
  it('filters by facet and category', async () => {
    renderWithProviders(<App />, { route: '/library/intl' });
    await screen.findByRole('heading', { name: /חו"ל ונדידה/ });
    await userEvent.click(screen.getByRole('button', { name: 'גל 2' }));
    await waitFor(() => expect(screen.queryByText('אין גלישה בחו"ל')).not.toBeInTheDocument());
  });
  it('toggles pin from the star', async () => {
    renderWithProviders(<App />, { route: '/library' });
    const card = (await screen.findByText('אין גלישה בחו"ל')).closest('.tcard')!;
    await userEvent.click(within(card as HTMLElement).getByTitle('הצמד'));
    await waitFor(() => expect(state.pins.has('22222222-2222-4222-8222-222222222222')).toBe(true));
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — port `legacy/js/views-library.js`: `LibraryPage` reads `mode` prop + `:category`, builds `ListDocumentsQuery` (`pinned`, `recent`, `drafts`, `category`), applies facets client-side exactly as legacy `draw()`, renders `topbar` (hamburger, crumb, import/export/new buttons guarded by `can('docs.create')`), `lib-head`, `Facets`, and the `grid` (`data-testid="library-grid"`, rules `data-testid="rule"`). `DocCard` ports `cardFor` with chips/meta/avatars; star calls `useTogglePin`; kebab opens `CardMenu` (edit/history/open-in-tab/pin/delete with `useModal().confirm` and `useDeleteDocument`, delete guarded by `can('docs.delete', card)`). Import/export: export = `GET /documents?pageSize=200` + `GET /blocks|fields|scripts` bundled to a JSON download; import = `POST /documents` per item of a JSON file (CSV rows → `POST /documents` with `phases: []`). `FieldsPage`/`BlocksPage` port the legacy views on `useFields()`/`useBlocks()`; `BlockDialog` edit form uses `useUpsertBlock` (`PUT /blocks/:id`) and shows usage from `useBlockUsage`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): library, cards, facets, fields and blocks pages"`.

---

### Task 8: Article page — call mode, keyboard, jump strip, trail, connections, aside, panel, peek, split

**Files:**
- Create: `src/lib/callState.ts`, `src/components/article/{ArticlePage,DocHead,DocBody,StepView,StepConnections,JumpStrip,Trail,CallAside,Panel,CardMap,SplitView,Peek}.tsx`
- Test: `test/article/Article.test.tsx`, `test/lib/callState.test.ts`

**Interfaces:**
- Produces: `callState.get(docId)` / `set` / `reset` with `{ started: number | null; active: string | null; results: Record<string, { kind: 'out'|'branch'; idx: number; label: string; goto?: string; ts: number }> }` in `sessionStorage` key `kb.call.<docId>`; `useCall(doc)` → `{ state, setActive(key, scroll?), move(dir), pickOutcome(key, res), skipped: Set<string>, summaryText(), reset() }`; `<StepView doc step ctx/>` where `ctx = { activeKey, results, skipped, callMode, expandAll, connections, onSelect, onOutcome, onNote, prefix? }` (port of `KB.renderStep`; resolves `blockId` through `useBlocks()`); `<Peek>` host reading a context `usePeek()` → `show(docId, anchor)`/`hide()`; `document`-level delegation for `a.doc-link[data-doc]` clicks and hover (installed once in `Shell`).

- [ ] **Step 1: Failing tests**

`test/lib/callState.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { callState } from '../../src/lib/callState.js';
describe('callState', () => {
  it('persists per document in sessionStorage', () => {
    callState.set('d1', { started: 1, active: 's2', results: { s1: { kind: 'out', idx: 0, label: 'x', ts: 1 } } });
    expect(JSON.parse(sessionStorage.getItem('kb.call.d1')!).active).toBe('s2');
    expect(callState.get('d1').results.s1.label).toBe('x');
    callState.reset('d1'); expect(callState.get('d1').active).toBeNull();
  });
});
```

`test/article/Article.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
const D = '11111111-1111-4111-8111-111111111111';

describe('<ArticlePage> call mode', () => {
  it('walks steps with the keyboard: ArrowDown, outcome 2, then 1', async () => {
    renderWithProviders(<App />, { route: `/doc/${D}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    expect(document.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s1');
    await userEvent.keyboard('{ArrowDown}'); expect(document.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s2');
    await userEvent.keyboard('2'); // branch option 2 → goto s3
    expect(document.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s3');
    await userEvent.keyboard('1');
    await waitFor(() => expect(document.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s4'));
    const jump = screen.getByTestId('jumpstrip');
    expect(within(jump).getByText('1')).toHaveClass('skip'); expect(within(jump).getByText('2')).toHaveClass('done');
    expect(screen.getByTestId('summary').textContent).toContain('ש2 ✓ חבילה פעילה');
  });
  it('shows step connections and shared block chips for s11', async () => {
    renderWithProviders(<App />, { route: `/doc/${D}/s11` });
    await screen.findByText('קשרים של השלב');
    expect(screen.getByText(/⧉ בלוק משותף/)).toBeInTheDocument();
    expect(screen.getByText('sim block lbl')).toHaveClass('crm');
  });
  it('adds a note with N and shows it in the notes tab', async () => {
    renderWithProviders(<App />, { route: `/doc/${D}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await userEvent.keyboard('n');
    await userEvent.type(await screen.findByRole('textbox'), 'לבדוק גם VPN');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await userEvent.click(screen.getByText(/הערות/));
    expect(await screen.findByText('לבדוק גם VPN')).toBeInTheDocument();
  });
  it('jumps with G then number', async () => {
    renderWithProviders(<App />, { route: `/doc/${D}` });
    await screen.findByRole('heading', { name: /איטיות גלישה/ });
    await userEvent.keyboard('g7{Enter}');
    expect(document.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s7');
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — port `legacy/js/views-article.js` one-to-one:

`src/lib/callState.ts`:
```ts
export type CallResult = { kind: 'out' | 'branch'; idx: number; label: string; goto?: string; ts: number };
export type CallState = { started: number | null; active: string | null; results: Record<string, CallResult> };
const empty = (): CallState => ({ started: null, active: null, results: {} });
export const callState = {
  get(docId: string): CallState { try { return { ...empty(), ...(JSON.parse(sessionStorage.getItem('kb.call.' + docId) ?? 'null') ?? {}) }; } catch { return empty(); } },
  set(docId: string, s: CallState) { sessionStorage.setItem('kb.call.' + docId, JSON.stringify(s)); },
  reset(docId: string) { sessionStorage.removeItem('kb.call.' + docId); },
};
```
`ArticlePage`: loads `useDocument(id)`, `useBlocks()`, `useFields()`, `useRelated`, `useLinks`, `useNotes`, `useVersions`; `useRecordView` once per mount; `useCall(doc)` implements `setActive/move/pickOutcome/skipped/summaryText` exactly as legacy (`goto` resolution, auto-advance, `nav(…, { replace: true })` to `/doc/:id/:key`); `useHotkeys` for `ArrowDown/ArrowUp/Enter/1/2/3/n/p/c/e/h` plus Hebrew aliases and the `g`-then-digits buffer (1500 ms arm, 450 ms after last digit, `Enter` commits) exposed as `jumpBuf` to `JumpStrip` (`data-testid="jumpstrip"`, classes `done/cur/skip`). Layout: `topbar` (crumb, call pill with timer + reset, print, pin, edit guarded by `can('docs.edit', doc)`, history, mobile panel toggle), `Trail`, `JumpStrip`, then `SplitView` when `useNav().split?.left === doc.id` else `doc-layout` with `DocHead`, `DocBody` (phases + `StepView`), `CallAside` (progress, rail list, keys, summary `data-testid="summary"` with copy via `navigator.clipboard`), and `Panel` (tabs קשרים / הערות N / גרסאות; notes form uses `useAddNote`, like uses `useLikeNote`; versions list links to `/history/:id/:v`). `StepView` renders `signals/pillars/stages/objection/principles` from `step.extras`; block-embedded steps merge `block.actions/outcomes/script`. `StepConnections` ports `KB.stepConnections` using `useLinks(doc.id)` (`shares_block` rows → other docs via `useBlockUsage`), `crmIn(stepText(step, block), fieldNames)`, `deps`, prev/next, and source (`doc.sourceId` → `useSources()` for title/state). `Peek` ports the navy popover with open / open-in-tab / split actions (`useNav().openDoc`, `toggleSplit`). `SplitView` renders two `DocBody`s with the block-synced scroll listener from legacy (`data-block` on steps). Note prompt uses `useModal().prompt` (multiline) whose OK button is labelled `אישור`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): article page with call mode, connections, panel, peek, split view"`.

---

### Task 9: Command palette

**Files:**
- Create: `src/components/palette/Palette.tsx`, `src/components/palette/paletteStore.tsx`
- Test: `test/palette/Palette.test.tsx`

**Interfaces:**
- Produces: `usePalette()` → `{ open(opts?: { mode?: 'search'|'newtab'|'split'; type?: string; query?: string }); close() }`; results from `useSearch(q, type)` (server) merged with local actions (new doc, theme, split, sources, trash, pinned, recent, fields, blocks, export, import, font, settings, keys, print; plus edit/history of the current doc); `Tab` cycles types `all/doc/step/crm/block/script/action`; `Enter` opens, `Ctrl+Enter` opens in a new tab; footer shows `N תוצאות ב-K קבצים · Xms` from `SearchResponse.total/files/tookMs`.

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';

describe('<Palette>', () => {
  it('searches the server and opens a step hit at its step', async () => {
    const r = renderWithProviders(<App />, { route: '/library' });
    await screen.findByText('ספריית ידע');
    await userEvent.keyboard('{Control>}k{/Control}');
    await userEvent.type(await screen.findByPlaceholderText(/חפש מסמך/), 'ריענון sim');
    const hit = await screen.findByText(/ריענון SIM/); expect(hit.closest('.ri')).not.toBeNull();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(r.container.querySelector('.step.cur')?.getAttribute('data-step')).toBe('s11'));
  });
  it('lists local actions when empty and cycles types with Tab', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await screen.findByText('ספריית ידע');
    await userEvent.keyboard('{Control>}k{/Control}');
    expect(await screen.findByText('צור פריט ידע חדש')).toBeInTheDocument();
    await userEvent.keyboard('{Tab}');
    expect(screen.getByText('מסמכים')).toHaveClass('on');
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — port `legacy/js/nav.js` palette: overlay + `.palette`, input with `types` chips, results grouped by `SearchResponse.groups` (group headers `מסמכים/שלבים/בלוק משותף/שדות CRM/תסריטים/פעולות`), `<mark>` highlighting of the query inside titles, keyboard nav (`ArrowUp/Down/Enter/Tab/Escape`), selection handlers per hit type (`document` → `openDoc`, `step` → `openDoc(id, { step })`, `field` → `showField`, `block` → `showBlock`, `script` → modal with copy, `action` → run). Local actions are filtered by substring on the query and appended as the `פעולות` group. `useDebounce(q, 120)` before `useSearch`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): command palette"`.

---

### Task 10: Editor page

**Files:**
- Create: `src/components/editor/{EditorPage,BlockLibrary,StepEditor,BranchEditor,DropZone,SidePane,Checks}.tsx`, `src/lib/editorModel.ts`
- Test: `test/editor/Editor.test.tsx`, `test/lib/editorModel.test.ts`

**Interfaces:**
- Produces: `editorModel` pure functions: `newStep(num)`, `renumber(doc)`, `addBasic(doc, type, targetKey, selected)`, `addShared(doc, block, targetKey)`, `addAction(doc, key, text)`, `moveStep(doc, key, dir)`, `dropAt(doc, data, targetKey)`, `checkList(doc, fields, blocks, related): Array<['ok'|'warn'|'bad', string]>` (all immutable, return new `Document`); `EditorPage` state: `doc` (draft), `selected`, `sideTab`, autosave via `useSaveDraft(id)` (600 ms), publish via `usePublish` (new docs first `useCreateDocument` then `useSaveStructure` then `usePublish`), review request via `PATCH /documents/:id { status: 'review' }`, JSON export download, `Escape` leaves.

- [ ] **Step 1: Failing tests**

`test/lib/editorModel.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { addBasic, addShared, checkList, moveStep, renumber } from '../../src/lib/editorModel.js';
import { fx } from '../msw/fixtures.js';
describe('editorModel', () => {
  it('adds a step after the selected one and renumbers', () => {
    const d = addBasic(fx.docBrowsing, 'step', 's1', 's1');
    expect(d.phases[0].steps.map((s) => s.num).slice(0, 3)).toEqual(['1', '2', '3']);
    expect(d.phases[0].steps[1].title).toBe('');
  });
  it('embeds a shared block as a new step', () => {
    const d = addShared(fx.docBrowsing, fx.blocks[0], null);
    const last = d.phases.at(-1)!.steps.at(-1)!; expect(last.blockId).toBe(fx.blocks[0].id); expect(last.title).toBe('ריענון SIM');
  });
  it('moves steps within a phase', () => { const d = moveStep(fx.docBrowsing, 's2', -1); expect(d.phases[0].steps[0].key).toBe('s2'); expect(renumber(d).phases[0].steps[0].num).toBe('1'); });
  it('flags empty steps and unknown fields', () => {
    const d = addBasic(fx.docBrowsing, 'step', null, null);
    const c = checkList(d, fx.fields, fx.blocks, []);
    expect(c.some(([k, t]) => k === 'warn' && t.includes('ריק'))).toBe(true);
  });
});
```

`test/editor/Editor.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state } from '../msw/handlers.js';
const D = '11111111-1111-4111-8111-111111111111';
describe('<EditorPage>', () => {
  it('autosaves a draft after typing and publishes with a label', async () => {
    renderWithProviders(<App />, { route: `/edit/${D}` });
    const title = await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.type(title, ' – מעודכן');
    await waitFor(() => expect(state.drafts.has(D)).toBe(true), { timeout: 2000 });
    expect(screen.getByText(/נשמר/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /פרסם v8/ }));
    await userEvent.type(await screen.findByRole('textbox', { name: /מה השתנה/ }), 'עדכון כותרת');
    await userEvent.click(screen.getByRole('button', { name: 'אישור' }));
    await waitFor(() => expect(state.published).toEqual([{ id: D, label: 'עדכון כותרת' }]));
  });
  it('inserts a shared block from the library and shows the shared box', async () => {
    renderWithProviders(<App />, { route: `/edit/${D}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    await userEvent.click(screen.getAllByText('ריענון SIM')[0]);
    expect(document.querySelectorAll('.ebox.shared').length).toBeGreaterThanOrEqual(2);
  });
  it('hides publish without docs.publish', async () => {
    const { withMe } = await import('../msw/handlers.js'); const { server } = await import('../msw/server.js');
    server.use(withMe({ permissions: ['docs.read', 'docs.edit'] }));
    renderWithProviders(<App />, { route: `/edit/${D}` });
    await screen.findByPlaceholderText('שם פריט הידע…');
    expect(screen.queryByRole('button', { name: /פרסם/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'בקש סקירה' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — `editorModel.ts` ports the mutation helpers from `legacy/js/views-editor.js` into pure functions over `Document` (using `structuredClone`); `EditorPage` ports the three-column layout: `BlockLibrary` (basics with `draggable` + `dataTransfer 'text/kb'`, shared blocks from `useBlocks()` with usage counts from `useLinks`/`useBlockUsage`, presets constant `PRESETS` in `constants.ts`), fields row (category/wave/priority/target file), phases with `StepEditor` (title, actions with CRM detection label from `crmIn`, outcomes with goto select, `BranchEditor`, script textarea, add-row, drag handle, shared-block header with `נתק העתק`/`ערוך בלוק`), `DropZone` with the `/` slash menu, permissions row, `SidePane` (tabs תצוגה חיה / JSON / Diff using `DocBody` with `expandAll`, `<pre>`, and `DiffView` from Task 11 against `useDocument(id)`), `Checks` from `checkList`. Publish button only when `can('docs.publish', doc)`; label `פרסם v{currentVersion+1}`; prompt modal input has `aria-label="מה השתנה? (מופיע בהיסטוריית הגרסאות)"`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): editor with block library, autosave, checks, publish"`.

---

### Task 11: History page and diff view

**Files:**
- Create: `src/lib/diffSteps.ts`, `src/components/history/{HistoryPage,DiffView}.tsx`
- Test: `test/lib/diffSteps.test.ts`, `test/history/History.test.tsx`

**Interfaces:**
- Produces: `diffSteps(oldDoc, newDoc): { old: Step|null; new: Step|null; kind: 'same'|'changed'|'added'|'removed' }[]`, `stepLines(step, block?)`, `blameMap(versions: Document[]): Record<stepKey, { v: number; author: string; kind: 'added'|'changed' }>`; `<DiffView oldDoc newDoc blame? compact? leftLabel rightLabel/>` renders `.diff-cols` with `wordDiff` per line; `HistoryPage` picker when no `:id`, otherwise timeline (`useVersions`), compare `:v` vs current (`useVersion` for both), `הצג JSON` modal, `שחזר ל-vX` via `useRestore` guarded by `can('docs.restore', doc)`.

- [ ] **Step 1: Failing tests**

```ts
// test/lib/diffSteps.test.ts
import { describe, it, expect } from 'vitest';
import { diffSteps } from '../../src/lib/diffSteps.js';
import { fx } from '../msw/fixtures.js';
describe('diffSteps', () => {
  it('aligns by key and classifies rows', () => {
    const old = structuredClone(fx.docBrowsing); old.phases[0].steps[0].actions[0].text = 'פתח CRM';
    old.phases[0].steps.splice(2, 1); // remove s3 in old → added in new
    const rows = diffSteps(old, fx.docBrowsing);
    expect(rows.find((r) => r.new?.key === 's1')?.kind).toBe('changed');
    expect(rows.find((r) => r.new?.key === 's3')?.kind).toBe('added');
    expect(rows.find((r) => r.new?.key === 's2')?.kind).toBe('same');
  });
});
```
```tsx
// test/history/History.test.tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
const D = '11111111-1111-4111-8111-111111111111';
describe('<HistoryPage>', () => {
  it('lists versions, compares v6 to current, and offers restore', async () => {
    renderWithProviders(<App />, { route: `/history/${D}/6` });
    expect(await screen.findByText('v7 · נוכחי')).toBeInTheDocument();
    expect(screen.getByText('v6 · בהשוואה')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'שחזר ל-v6' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'הצג JSON' }));
    expect(await screen.findByText(/"slug": "browsing"/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — port `legacy/js/views-history.js` (`stepLines`, `stepSig`, `diffSteps` alignment loop, `blameMap` over an array of version snapshots fetched with `useVersion` for each version ≤ compare when the timeline is small (≤ 25), `renderDiff` → `DiffView` JSX with `<Html>` for diff lines). Timeline stats per version (`+a שלבים · ~c שונו · −r`) computed with `diffSteps` between consecutive snapshots (lazy: only for versions whose snapshots are loaded).

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): version history and diff view"`.

---

### Task 12: Trash page

**Files:**
- Create: `src/components/trash/TrashPage.tsx`
- Test: `test/trash/Trash.test.tsx`

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state } from '../msw/handlers.js';
describe('<TrashPage>', () => {
  it('shows countdown, impact and restores an item', async () => {
    renderWithProviders(<App />, { route: '/trash' });
    expect(await screen.findByText('2 קישורים שבורים')).toBeInTheDocument();
    expect(screen.getByText(/בעוד \d+ ימים|היום/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'שחזר' }));
    await waitFor(() => expect(state.trash.length).toBe(0));
    expect(await screen.findByText('סל המיחזור ריק')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — port `legacy/js/views-trash.js` on `useTrash()`: header with counts, `שחזר הכל`/`רוקן סל` (confirm), checkbox multi-select with bulk restore/purge, rows with `purgeAt` countdown (`inDays`), progress bar colour by elapsed share of 30 days, impact chips, `שחזר` button (`useRestoreTrash` → `POST /trash/:type/:id/restore`). Restore/purge buttons guarded by `can('docs.restore')`.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): trash page"`.

---

### Task 13: Sources page and suggestions panel

**Files:**
- Create: `src/components/sources/{SourcesPage,SourceSidebar,SourcePage,SuggestionsPanel,SuggestionCard}.tsx`
- Test: `test/sources/Sources.test.tsx`

**Interfaces:**
- Produces: `SourcesPage` (`useSources()`, selected by `:id` or first `pending`), `SourcePage` renders the latest revision (`useRevision(id, 'latest')`) paragraphs with `r-add/r-del/r-chg` runs and the `שינויים בלבד / כל המסמך` toggle, header buttons `פתח ב-Word` (opens `GET /sources/:id/download` in a new tab when the API exposes it, else disabled with a tooltip) and `⟳ עבד שינויים` (`useProcessSource`), upload via `useUploadSource` (`POST /sources/upload`, multipart), `SuggestionsPanel` (`useSuggestions({ sourceId })`, accept/reject/reset via `useDecideSuggestion`, edit via `useEditSuggestion` with `editedPayload` typed by `SuggestionPayloadSchema`, `אשר הכל`, footer `N מאושרות` + `פרסם לספרייה` via `usePublishSuggestions`, guarded by `suggestions.review` / `suggestions.apply`).

- [ ] **Step 1: Failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { state } from '../msw/handlers.js';
describe('<SourcesPage>', () => {
  it('renders tracked changes and accepts + publishes a suggestion', async () => {
    renderWithProviders(<App />, { route: '/sources' });
    expect(await screen.findByText('מעל 5 מגה')).toHaveClass('r-del');
    await userEvent.click(screen.getByRole('button', { name: 'אשר' }));
    await waitFor(() => expect(state.suggestions[0].status).toBe('accepted'));
    await userEvent.click(screen.getByRole('button', { name: 'פרסם לספרייה' }));
    await userEvent.click(await screen.findByRole('button', { name: 'פרסם' }));
    await waitFor(() => expect(state.suggestions[0].status).toBe('applied'));
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — port `legacy/js/views-sources.js` UI (sidebar with source list + model status from `useHealth()` (`model: true/false` → "מודל מקומי · פעיל/לא זמין"), main page, panel), replacing every local simulation with the hooks above; `SuggestionCard` shows `payload`/`editedPayload` summaries per `type` (`update-step`: `addActions` list; `new-card`: title + step count; `update-block`: last action; `field-alert`: field chip).

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): sources and suggestions review"`.

---

### Task 14: Settings dialog, admin pages, system status

**Files:**
- Create: `src/components/settings/SettingsDialog.tsx`, `src/components/admin/{AdminLayout,UsersPage,RolesPage,GroupsMapPage,SessionsPage,AuditPage,SystemPage}.tsx`
- Test: `test/admin/Admin.test.tsx`, `test/settings/Settings.test.tsx`

**Interfaces:**
- Produces: `SettingsDialog` (font/theme/panel toggles via `useSavePreferences`, type sample via `<Fmt>`, rules text from legacy, local reset = clear `sessionStorage`), `AdminLayout` (guard `can('users.manage') || can('roles.manage') || can('audit.read') || can('system.admin')`, side nav), `UsersPage` (table: name, email, source, roles with category scope editor, active toggle, last login; `usePatchUser`), `RolesPage` (permission matrix from `PERMISSIONS` × `useRoles()`, locked `ADMIN_LOCKED` cells, `useUpsertRole`/`useDeleteRole`), `GroupsMapPage` (entries editor → `useSaveGroupsMap`), `SessionsPage` (`useSessions` + revoke), `AuditPage` (filters → `useAudit`, before/after JSON diff modal using `wordDiff` on stringified JSON), `SystemPage` (`useSystem()` + `useHealth()`: DB, model, queue, connectors, backups list, SSE connection state from `useEvents()`).

- [ ] **Step 1: Failing tests**

```tsx
// test/admin/Admin.test.tsx
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
import { withMe } from '../msw/handlers.js'; import { server } from '../msw/server.js';
import { PERMISSIONS } from '@wecom/shared';
describe('admin', () => {
  it('blocks non-admins', async () => {
    renderWithProviders(<App />, { route: '/admin/users' });
    expect(await screen.findByText('אין הרשאה לאזור הניהול')).toBeInTheDocument();
  });
  it('shows the permission matrix to admins', async () => {
    server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));
    renderWithProviders(<App />, { route: '/admin/roles' });
    expect(await screen.findByText('docs.publish')).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader').length).toBeGreaterThan(1);
  });
  it('renders system status', async () => {
    server.use(withMe({ roles: ['admin'], permissions: [...PERMISSIONS] }));
    renderWithProviders(<App />, { route: '/admin/system' });
    expect(await screen.findByText(/מסד נתונים/)).toBeInTheDocument();
    expect(screen.getByText(/מודל/)).toBeInTheDocument();
  });
});
```
```tsx
// test/settings/Settings.test.tsx
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../render.js';
import { App } from '../../src/App.js';
describe('settings', () => {
  it('switches font system live', async () => {
    renderWithProviders(<App />, { route: '/library' });
    await userEvent.click(await screen.findByTitle('הגדרות'));
    await userEvent.click(await screen.findByText('מצב נוכחי (Rubik)'));
    await waitFor(() => expect(document.documentElement.dataset.font).toBe('rubik'));
  });
});
```

- [ ] **Step 2: Run** — FAIL. **Step 3: Implement** — settings ports `KB.showSettings`; admin pages use the `table` classes; `RolesPage` renders `<table class="table perm-matrix">` with a header cell per role and a checkbox per permission, disabled for `ADMIN_LOCKED` on the admin column; every write shows a toast and invalidates its key; `AdminLayout` renders `<div className="empty"><b>אין הרשאה לאזור הניהול</b></div>` when denied.

- [ ] **Step 4: Run** — PASS. **Step 5: Commit** — `git commit -am "feat(web): settings, admin pages, system status"`.

---

### Task 15: Playwright end-to-end suite

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/fixtures/oidc-issuer.ts`, `apps/web/e2e/{login,call-mode,publish-restore,trash,search}.spec.ts`
- Modify: `apps/web/package.json` (script `e2e`), `.github/workflows/ci.yml` (job `e2e` after `build`, runs against `docker compose -f deploy/docker-compose.yml up` from L1; skipped until L1/L2/L3 merge via `if: hashFiles('deploy/docker-compose.yml') != ''`)

**Interfaces:**
- Consumes: running stack at `E2E_BASE_URL` (default `http://localhost:8080`), seeded content, a test OIDC issuer (`oidc-provider` on port 9400 with one user `e2e@wecom.test` in group `KB-Leads`) started by `oidc-issuer.ts` global setup; API env `OIDC_ISSUER=http://localhost:9400`.

- [ ] **Step 1: Write the config and global setup**

```ts
// playwright.config.ts
import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: 'e2e', globalSetup: './e2e/fixtures/oidc-issuer.ts', use: { baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080', locale: 'he-IL', viewport: { width: 1400, height: 860 } }, retries: 1, reporter: [['list'], ['html', { open: 'never' }]] });
```
```ts
// e2e/fixtures/oidc-issuer.ts
import Provider from 'oidc-provider';
export default async function globalSetup() {
  const issuer = new Provider('http://localhost:9400', { clients: [{ client_id: 'kb-e2e', client_secret: 'e2e-secret', redirect_uris: [(process.env.E2E_BASE_URL ?? 'http://localhost:8080') + '/api/v1/auth/callback'] }], claims: { openid: ['sub'], profile: ['name'], email: ['email'], groups: ['groups'] }, scopes: ['openid', 'profile', 'email', 'groups'],
    findAccount: async (_ctx, id) => ({ accountId: id, claims: async () => ({ sub: id, name: 'בודק E2E', email: 'e2e@wecom.test', groups: ['KB-Leads'] }) }),
    features: { devInteractions: { enabled: true } } });
  const server = issuer.listen(9400); process.env.__OIDC_SERVER = 'started';
  return async () => { server.close(); };
}
```
(add `oidc-provider` `^8.5.1` to devDependencies)

- [ ] **Step 2: Write the specs**

```ts
// e2e/login.spec.ts
import { test, expect } from '@playwright/test';
test('signs in through the test issuer and lands in the library', async ({ page }) => {
  await page.goto('/library');
  await page.getByRole('link', { name: 'כניסה עם חשבון wecom' }).click();
  await page.getByLabel('Login').fill('e2e-user'); await page.getByLabel('Password').fill('x'); await page.getByRole('button', { name: 'Sign-in' }).click();
  if (await page.getByRole('button', { name: 'Continue' }).isVisible()) await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByText('ספריית ידע')).toBeVisible();
  await expect(page.getByText('בודק E2E')).toBeVisible();
});
```
```ts
// e2e/call-mode.spec.ts
import { test, expect } from '@playwright/test';
test.use({ storageState: 'e2e/.auth/lead.json' }); // produced by login.spec via test.afterAll → page.context().storageState
test('library → call mode → outcomes → summary', async ({ page }) => {
  await page.goto('/library/tech');
  await page.getByText('איטיות גלישה / חוסר גלישה').first().click();
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's1');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('2'); await page.keyboard.press('1');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's4');
  await expect(page.getByTestId('summary')).toContainText('ש2 ✓ חבילה פעילה');
  await page.keyboard.press('Control+\\'); await expect(page.locator('.splitwrap')).toBeVisible();
});
```
```ts
// e2e/publish-restore.spec.ts
import { test, expect } from '@playwright/test';
test.use({ storageState: 'e2e/.auth/lead.json' });
test('edit → publish → history → restore', async ({ page }) => {
  await page.goto('/library'); await page.getByText('איטיות גלישה / חוסר גלישה').first().click();
  await page.keyboard.press('e');
  const title = page.getByPlaceholder('שם פריט הידע…'); await title.fill('איטיות גלישה / חוסר גלישה – E2E');
  await expect(page.getByText(/נשמר/)).toBeVisible();
  await page.getByRole('button', { name: /פרסם v/ }).click(); await page.getByLabel(/מה השתנה/).fill('בדיקת E2E'); await page.getByRole('button', { name: 'אישור' }).click();
  await expect(page.getByRole('heading', { name: /E2E/ })).toBeVisible();
  await page.keyboard.press('h');
  await page.getByText(/^v\d+$/).last().click();
  await page.getByRole('button', { name: /שחזר ל-v/ }).click(); await page.getByRole('button', { name: /שחזר ל-v/ }).last().click();
  await expect(page.getByText(/שוחזר מגרסה/)).toBeVisible();
});
```
```ts
// e2e/trash.spec.ts
import { test, expect } from '@playwright/test';
test.use({ storageState: 'e2e/.auth/lead.json' });
test('delete a card and restore it from the trash', async ({ page }) => {
  await page.goto('/library/plans');
  const card = page.locator('.tcard', { hasText: 'הקפאת קו זמנית' }); await card.hover(); await card.locator('.kebab').click();
  await page.getByText('🗑 מחק').click(); await page.getByRole('button', { name: 'העבר לסל' }).click();
  await page.goto('/trash'); await expect(page.getByText('הקפאת קו זמנית')).toBeVisible();
  await page.getByRole('button', { name: 'שחזר' }).first().click();
  await page.goto('/library/plans'); await expect(page.getByText('הקפאת קו זמנית')).toBeVisible();
});
```
```ts
// e2e/search.spec.ts
import { test, expect } from '@playwright/test';
test.use({ storageState: 'e2e/.auth/lead.json' });
test('Ctrl K finds a step and opens it', async ({ page }) => {
  await page.goto('/library'); await page.keyboard.press('Control+k');
  await page.getByPlaceholder(/חפש מסמך/).fill('ריענון sim');
  await expect(page.locator('.palette .gh', { hasText: 'שלבים' })).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.step.cur')).toHaveAttribute('data-step', 's11');
});
```

- [ ] **Step 3: Run locally** — `pnpm --filter @wecom/web e2e` against the Compose stack — PASS (5 specs). **Step 4: Commit** — `git add apps/web/e2e apps/web/playwright.config.ts .github && git commit -m "test(web): playwright e2e suite"`.

---

## Feature-parity checklist (acceptance matrix)

| Legacy capability (legacy/README.md) | Component | Test |
|---|---|---|
| Library by wave/priority, category routes | `LibraryPage`, `Facets` | Library.test "groups cards" / "filters" |
| Pinned section, ★ pin/unpin, P key | `DocCard`, `useTogglePin`, `ArticlePage` | Library.test "toggles pin", hooks.test "pin" |
| Auto card: CRM fields changing this week | `AutoCrmCard` | Library.test "auto CRM card" |
| Import/export JSON & CSV | `LibraryPage` toolbar | e2e (manual smoke) + hooks unit for bundle builder |
| Article call mode: ↑↓, 1–3, ↵, timer, reset | `ArticlePage`, `useCall` | Article.test "walks steps" |
| Jump strip + G-then-number, skipped marks | `JumpStrip` | Article.test "jumps with G" |
| Trail + source § | `Trail` | Article.test (assert trail text) |
| Step connections (block, CRM, deps, source) | `StepConnections` | Article.test "connections for s11" |
| Related docs (auto), CRM fields, shared blocks panel | `Panel` | Article.test panel tab assertions |
| Notes with likes, N key | `Panel`, `useAddNote`, `useLikeNote` | Article.test "adds a note" |
| Summary for CRM, C key | `CallAside` | Article.test summary text |
| Card map | `CardMap` | Article.test (`מפת הכרטיס`) |
| Hover peek with open/tab/split | `Peek` | Article.test hover (`userEvent.hover`) |
| Tabs strip, Alt T, W close, Alt ←/→ | `TabStrip`, `navStore` | navStore.test, Shell.test |
| Split view with block-synced scroll, Ctrl \ | `SplitView` | e2e call-mode |
| Ctrl K palette: docs/steps/fields/blocks/scripts/actions, Tab types | `Palette` | Palette.test, e2e search |
| Editor: block library, drag/drop, shared blocks, detach | `BlockLibrary`, `StepEditor` | Editor.test "inserts a shared block", editorModel.test |
| Editor: `/` slash commands, autosave, JSON export, review request, publish | `DropZone`, `EditorPage` | Editor.test "autosaves … publishes" |
| Pre-publish checks | `Checks`, `checkList` | editorModel.test "flags empty steps" |
| Live preview / JSON / Diff tabs | `SidePane` | Editor.test (tab switching) |
| Version history, compare, blame, JSON, restore | `HistoryPage`, `DiffView` | History.test, diffSteps.test, e2e publish-restore |
| Trash: countdown, impact, restore, bulk, empty | `TrashPage` | Trash.test, e2e trash |
| Sources: tracked changes, suggestions accept/reject/edit/publish | `SourcesPage`, `SuggestionsPanel` | Sources.test |
| Dark mode Ctrl D, Plex/Rubik switch, settings | `SettingsDialog`, `useSavePreferences` | Settings.test |
| Keymap `?` | `Shell` | Shell.test (`?` opens modal) |
| Mobile drawer / responsive | `MobileDrawer` | Shell.test at 400px (`window.innerWidth` mock) |
| New: login with providers | `LoginPage`, `RequireAuth` | Login.test, e2e login |
| New: permission-aware controls | `useCan` everywhere | Editor.test "hides publish", Admin.test "blocks non-admins" |
| New: live updates (SSE) | `useEvents` | events.test |
| New: admin users/roles/groups/sessions/audit, system status | `Admin/*`, `SystemPage` | Admin.test |

## Self-review

- **Spec coverage**: §5 routes → Task 5; components list → Tasks 5–14; data layer, SSE, optimistic updates, `useMe`/`can` → Task 4; shared rendering via `<Fmt>` → Task 3; sessionStorage call progress → Task 8; parity checklist + login + permission-aware UI + "another editor" indicator (rendered in `EditorPage` from `GET /documents/:id/draft` returning another user's draft — add to Task 10 implement notes: show `עורך אחר עובד על המסמך` chip when `draft.userId !== me.user.id`) + system status → Tasks 6, 10, 14; §6 tests (component, msw, Playwright incl. OIDC test issuer) → Tasks 1, 2, 15.
- **Placeholder scan**: fixtures excerpt says "fill all 13 steps … from legacy/js/data.js" — that is a copy instruction with an exact source, not a placeholder; every other step has code.
- **Type consistency**: hook names match between Task 4 and consumers; `keys.*` shapes match `useEvents`; `Step.key`/`blockId`/`extras` follow L0 `StepSchema`; `Suggestion.payload` discriminators follow L0 `SuggestionPayloadSchema`; permission strings only via `Permission` type; `data-testid`s (`library-grid`, `rule`, `jumpstrip`, `summary`) are used identically in tests and implementations.
