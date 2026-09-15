# X4b — Chat Elsewhere + Admin AI Web (editor dock, article ask pane, `/admin/ai`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the second half of wave 6's web surface in `apps/web`: the chat dock for the step editor, the collapsed "שאל את המערכת" pane for agents on the article page, and the admin AI page (`/admin/ai`) with five tabs — הנחיות (brief + style with version history and a system-prompt preview), מודלים (tier preset, three model slots, live test, reindex), הערכה (eval runs), אנליטיקת הצעות (accept / edit / reject rates), שיחות (transcript browser, JSONL export, delete) — all against MSW, validated at runtime against the wave 6 zod contract, and left as standalone components plus lazy route entries for X6 to mount.

**Architecture:** Same shape as the wave 4/5 web lanes. X4a (parallel) owns the shared chat surface: `apps/web/src/components/ai/ChatPane.tsx` with props `{ kind: 'workspace' | 'editor' | 'article'; documentId: string; context?: { stepKey?: string; suggestionId?: string; selection?: string }; tools?: 'ask' | 'chat'; onProposedEdits?; onRefinedSuggestion? }` and the conversation hooks in `apps/web/src/api/hooks/ai.ts`. This lane **consumes** `ChatPane` and never re-implements chat transport; until X4a lands it ships a thin placeholder `ChatPane` at the same path with the same props (a static "הצ'אט נטען…" box) that X6 deletes. Admin hooks (`api/hooks/aiAdmin.ts`, `api/hooks/suggestionAnalytics.ts`) call a small typed bridge (`apps/web/src/api/wave6.ts`) because the X0/X1/X2/X3 routes are not in `docs/api/openapi.json` while this lane runs; every response is parsed with `checked(...)` against `@wecom/shared` (`schemas/wave6.ts` + the additive `SuggestionAnalyticsSchema` in `pipeline.ts`). X6 swaps each hook body to the generated `api.*` client (one line per hook) and deletes the bridge. Components live under `apps/web/src/components/ai/` and `apps/web/src/components/admin/`, reuse `Empty`, `Modal`/`Toast`, `fmtDate`, `download()`, the `NumField` pattern from `admin/WorkflowSettingsSection.tsx`, and the real-`<button>` tablist pattern from `feedback/FeedbackPage.tsx`.

**Tech Stack:** React 18, TypeScript strict, React Router 6 (lazy routes), TanStack Query 5, zod 3, Vitest + Testing Library + MSW 2, `@wecom/shared`.

**Spec:** `docs/superpowers/specs/2026-09-15-kb-wave6-ai-copilot-design.md` (§1.4 chat placement, §1.5 persistence + export, §1.7 briefed model / admin-editable brief and style, §1.9 measured accuracy, §4.1 settings & eval routes, §4.2 analytics, §4.3 conversations + admin transcript routes, §5 "Step editor" / "Article page" / "Admin AI page", §6 tiers) and `docs/superpowers/plans/2026-09-15-X0-wave6-contracts.md` (canonical names; contract doc `docs/api/CONTRACTS-wave6.md`).

## Global Constraints

- Node `>=22`, pnpm `>=9`, TypeScript `strict: true`. Run from the repo root with `pnpm --filter @wecom/web <script>`; web tests with `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4`.
- Every request/response shape comes from `@wecom/shared` (`schemas/wave6.ts` once X0 lands; on disk when this lane starts). Never re-declare a schema in `apps/web`. Parse every response with `checked` (or `checkedMaybe` for 204/404-null routes).
- Web only: do **not** touch `apps/api/`, `packages/`, `docs/api/openapi.json`. Append-only touches to `apps/web/src/routes.tsx` (lazy style: `lazyRoute(() => import(...))`), `apps/web/src/api/keys.ts`, `apps/web/test/msw/handlers.ts` (one import + one spread + one reset call), `apps/web/src/styles/app.css` (one appended `/* wave 6 — X4b */` block).
- Never edit `components/shell/*`, `ArticlePage.tsx`, `EditorPage.tsx`, `admin/AdminLayout.tsx`, `admin/IdentityPage.tsx`, `sources/SourcesPage.tsx` — X6 mounts (mount list in the lane report, Task 7). Do not create `components/ai/ChatPane.tsx` if X4a's file already exists on your branch point; if it does not, create the placeholder in Task 3 and name it in the report so X6 deletes it.
- Permissions: `ai.manage` gates `/admin/ai` (whole page); `ai.chat` gates `EditorChatDock`; `ai.ask` gates `ArticleAskPane`. Use `useCan()`; pass `enabled` to queries the caller lacks permission for (no guaranteed-403 round trips).
- No inline `<script>` anywhere (CSP has no `unsafe-inline` for scripts); JSONL export goes through `download()` (Blob URL), never a static `<a href>` to a data URL.
- Hebrew UI strings verbatim from this plan; RTL; real `<button>`s for every control; tablists with roving `tabIndex` and RTL-aware arrow keys.
- Conventional commit per task ending with the line `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## File structure

```
apps/web/src/api/wave6.ts                                  request bridge: w6<T>(schema, method, path, {query, body}), w6Void (new; X6 deletes)
apps/web/src/api/keys.ts                                   (append: ai.*, admin.ai.*, suggestions.analytics)
apps/web/src/api/hooks/aiAdmin.ts                          settings, versions, model test, eval runs, run eval, reindex, conversations (admin), delete, export (new)
apps/web/src/api/hooks/suggestionAnalytics.ts              useSuggestionAnalytics(q, enabled) (new)
apps/web/src/api/invalidateAi.ts                           invalidateAi(qc) (new)
apps/web/src/components/ai/ChatPane.tsx                    PLACEHOLDER only if absent (X4a owns the real one; X6 deletes the placeholder)
apps/web/src/components/ai/EditorChatDock.tsx              collapsible dock for EditorPage; editor tool set (new)
apps/web/src/components/ai/ArticleAskPane.tsx              collapsed "שאל את המערכת" for agents; ask tool set; step citations → links (new)
apps/web/src/components/ai/citations.tsx                   renderWithStepLinks(text, documentId) — turns "שלב 3א" mentions into <Link>s (new)
apps/web/src/components/admin/AiPage.tsx                   /admin/ai shell: tabs + permission gate (new)
apps/web/src/components/admin/ai/PromptsTab.tsx            brief + style editors, versions, system-prompt preview (new)
apps/web/src/components/admin/ai/ModelsTab.tsx             tier preset, slots, test per slot, reindex (new)
apps/web/src/components/admin/ai/EvalTab.tsx               eval runs table + run button (new)
apps/web/src/components/admin/ai/SuggestionAnalyticsTab.tsx  rates by type/source/model/prompt version (new)
apps/web/src/components/admin/ai/ConversationsTab.tsx      transcript browser + viewer + export + delete (new)
apps/web/src/components/admin/ai/Tabs.tsx                  AdminTabs — roving tablist reused by AiPage (new)
apps/web/src/components/admin/ai/NumField.tsx              copy of WorkflowSettingsSection's NumField (new; X6 may dedupe)
apps/web/src/lib/promptPreview.ts                          buildSystemPromptPreview(settings) — client-side rendering of the v3 layout (new)
apps/web/src/routes.tsx                                    (append: admin child `ai`)
apps/web/src/styles/app.css                                (append: .ai-dock, .ask-pane, .ai-admin*, .transcript*)
apps/web/test/msw/ai-admin.ts                              aiAdminHandlers, aiAdminState, resetAiAdminState, sample* (new)
apps/web/test/msw/handlers.ts                              (append import/spread/reset)
apps/web/test/ai/fixtures.test.ts                          fixtures parse through the wave 6 schemas (new)
apps/web/test/ai/EditorChatDock.test.tsx, ArticleAskPane.test.tsx, citations.test.tsx (new)
apps/web/test/admin/AiPage.test.tsx, AiPrompts.test.tsx, AiModels.test.tsx, AiEvalAnalytics.test.tsx, AiConversations.test.tsx (new)
```

## Names consumed from other lanes (verify in Task 1; adapt imports, never re-implement)

| Lane | Import | Path |
|---|---|---|
| X0 | `AiSettingsSchema`, `AiSettingsPutSchema`, `AiSettingVersionSchema`, `AiModelsSettingsSchema`, `AiLimitsSettingsSchema`, `ModelTestBodySchema`, `ModelTestResultSchema`, `MODEL_TIER_PRESETS`, `EvalRunSchema`, `EvalRunsResponseSchema`, `ConversationSchema`, `ConversationsQuerySchema`, `ConversationsResponseSchema`, `ConversationDetailSchema`, `AiMessageSchema`, `AI_TOOLS`, `toolsFor` | `@wecom/shared` (`schemas/wave6.ts`) |
| X0 (X3 additive) | `SuggestionAnalyticsQuerySchema`, `SuggestionAnalyticsSchema` | `@wecom/shared` (`schemas/pipeline.ts`) |
| X4a | `ChatPane` (props above), hooks `useConversations`, `useConversation`, `useSendMessage` | `apps/web/src/components/ai/ChatPane.tsx`, `apps/web/src/api/hooks/ai.ts` |
| main | `useCan`, `useMe`, `checked`, `checkedMaybe`, `api`, `ApiError`, `Empty`, `useModal`, `useToast`, `fmtDate`, `download`, `counted`/`plural`, `keys`, `lazyRoute` | existing |

---

### Task 1: Fixtures and MSW handler group

**Files:**
- Create: `apps/web/test/msw/ai-admin.ts`, `apps/web/test/ai/fixtures.test.ts`
- Modify: `apps/web/test/msw/handlers.ts` (append one import, one spread, one reset)

**Interfaces:**
- Consumes: the wave 6 schemas listed above (read `packages/shared/src/schemas/wave6.ts` and the `SuggestionAnalyticsSchema` in `pipeline.ts` first; the literals below follow X0's canonical table — if a field name differs on disk, the fixture follows the schema and the parity test is what tells you).
- Produces: `aiAdminHandlers: RequestHandler[]`, `aiAdminState`, `resetAiAdminState()`, `sampleSettings()`, `sampleVersions()`, `sampleEvalRun()`, `sampleAnalytics()`, `sampleConversation()`, `sampleMessages()`, ids `CONV_1`, `MSG_1`, `MSG_2`.

- [ ] **Step 1: Write the failing parity test**

`apps/web/test/ai/fixtures.test.ts`:
```tsx
import { describe, it, expect } from 'vitest';
import {
  AiSettingsSchema,
  AiSettingVersionSchema,
  ConversationDetailSchema,
  ConversationsResponseSchema,
  EvalRunSchema,
  ModelTestResultSchema,
  SuggestionAnalyticsSchema,
} from '@wecom/shared';
import {
  sampleAnalytics,
  sampleConversation,
  sampleEvalRun,
  sampleMessages,
  sampleModelTest,
  sampleSettings,
  sampleVersions,
} from '../msw/ai-admin.js';

describe('ai admin msw fixtures match the wave 6 contract', () => {
  it('settings, versions and model tests parse', () => {
    const s = AiSettingsSchema.parse(sampleSettings());
    expect(s.models.tier).toBe(1);
    expect(s.limits.chatPerUserPerHour).toBe(60);
    for (const v of sampleVersions()) AiSettingVersionSchema.parse(v);
    expect(ModelTestResultSchema.parse(sampleModelTest('chat')).reachable).toBe(true);
  });
  it('eval runs and suggestion analytics parse', () => {
    expect(EvalRunSchema.parse(sampleEvalRun()).hitTarget).toBeGreaterThan(0);
    expect(SuggestionAnalyticsSchema.parse(sampleAnalytics()).total).toBeGreaterThan(0);
  });
  it('conversations list and detail parse', () => {
    const list = ConversationsResponseSchema.parse({ items: [sampleConversation()], total: 1, page: 1, pageSize: 50 });
    expect(list.items[0].kind).toBe('workspace');
    const detail = ConversationDetailSchema.parse({ conversation: sampleConversation(), messages: sampleMessages() });
    expect(detail.messages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 test/ai/fixtures.test.ts`
Expected: FAIL — `../msw/ai-admin.js` does not exist.

- [ ] **Step 3: Write the handler group**

`apps/web/test/msw/ai-admin.ts`:
```tsx
/**
 * msw handlers for the wave 6 admin/AI routes (`docs/api/CONTRACTS-wave6.md`, X0/X1/X2/X3 rows the
 * admin page and the two chat mounts call). Mutable state so tests can assert what the UI sent;
 * reset via `resetAiAdminState()`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type {
  AiMessage,
  AiSettings,
  AiSettingVersion,
  Conversation,
  EvalRun,
  ModelTestResult,
  SuggestionAnalytics,
} from '@wecom/shared';

const B = '/api/v1';
const T = '2026-09-15T08:00:00.000Z';
export const CONV_1 = 'd0000000-0000-4000-8000-000000000001';
export const MSG_1 = 'e0000000-0000-4000-8000-000000000001';
export const MSG_2 = 'e0000000-0000-4000-8000-000000000002';
export const USER_A = 'f0000000-0000-4000-8000-00000000000a';
export const DOC_1 = '10000000-0000-4000-8000-000000000001';
export const RUN_1 = '20000000-0000-4000-8000-000000000001';

export const sampleSettings = (over: Partial<AiSettings> = {}): AiSettings => ({
  brief: { text: 'wecom היא חברת תקשורת; הנציגים משרתים לקוחות פרטיים.', version: 2 },
  style: { text: 'משפטים קצרים, גוף שני, בלי סלנג.', version: 1 },
  models: {
    tier: 1,
    suggestModel: 'dictalm2.0-instruct:7b-q4_K_M',
    chatModel: 'dictalm2.0-instruct:7b-q4_K_M',
    embedModel: 'bge-m3:latest',
    embedDimension: 1024,
  },
  limits: { chatPerUserPerHour: 60, maxContextChars: 24000 },
  ...over,
});
export const sampleVersions = (): AiSettingVersion[] => [
  { key: 'ai.brief', version: 2, value: { text: 'wecom היא חברת תקשורת; הנציגים משרתים לקוחות פרטיים.' }, updatedBy: USER_A, updatedByName: 'נועה', updatedAt: T },
  { key: 'ai.brief', version: 1, value: { text: 'wecom היא חברת תקשורת.' }, updatedBy: USER_A, updatedByName: 'נועה', updatedAt: '2026-09-14T08:00:00.000Z' },
  { key: 'ai.style', version: 1, value: { text: 'משפטים קצרים, גוף שני, בלי סלנג.' }, updatedBy: USER_A, updatedByName: 'נועה', updatedAt: T },
];
export const sampleModelTest = (slot: 'suggest' | 'chat' | 'embed'): ModelTestResult =>
  slot === 'embed'
    ? { slot, tag: 'bge-m3:latest', reachable: true, sizeBytes: 1_200_000_000, dims: 1024 }
    : { slot, tag: 'dictalm2.0-instruct:7b-q4_K_M', reachable: true, sizeBytes: 4_400_000_000, tokensPerSec: 4.2 };
export const sampleEvalRun = (over: Partial<EvalRun> = {}): EvalRun => ({
  id: RUN_1,
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  promptVersion: 'v3.2.1',
  embedModel: 'bge-m3:latest',
  startedAt: T,
  finishedAt: '2026-09-15T08:12:00.000Z',
  cases: 40,
  hitTarget: 0.78,
  hitType: 0.85,
  contentOverlap: 0.61,
  notes: '',
  ...over,
});
export const sampleAnalytics = (): SuggestionAnalytics => ({
  total: 120,
  byType: [
    { key: 'update-step', total: 70, accepted: 40, edited: 20, rejected: 10 },
    { key: 'new-card', total: 30, accepted: 12, edited: 6, rejected: 12 },
    { key: 'deprecate-step', total: 20, accepted: 15, edited: 0, rejected: 5 },
  ],
  bySource: [{ key: 'נוהל eSIM.docx', total: 60, accepted: 35, edited: 15, rejected: 10 }],
  byModel: [{ key: 'dictalm2.0-instruct:7b-q4_K_M', total: 120, accepted: 67, edited: 26, rejected: 27 }],
  byPromptVersion: [{ key: 'v3.2.1', total: 120, accepted: 67, edited: 26, rejected: 27 }],
  rates: { accepted: 0.56, edited: 0.22, rejected: 0.22 },
  meanMinutesToDecision: 95,
});
export const sampleConversation = (over: Partial<Conversation> = {}): Conversation => ({
  id: CONV_1,
  kind: 'workspace',
  documentId: DOC_1,
  documentTitle: 'טיפול באיטיות גלישה',
  sourceRevisionId: null,
  userId: USER_A,
  userName: 'נועה',
  title: 'קיצור סעיף 3',
  model: 'dictalm2.0-instruct:7b-q4_K_M',
  promptVersion: 'v3.2.1',
  messageCount: 2,
  createdAt: T,
  updatedAt: T,
  ...over,
});
export const sampleMessages = (): AiMessage[] => [
  { id: MSG_1, conversationId: CONV_1, seq: 1, role: 'user', content: 'קצר את סעיף 3', toolCalls: null, toolResults: null, proposedEditsId: null, refinedSuggestionId: null, tokensIn: 12, tokensOut: 0, latencyMs: 0, model: 'dictalm2.0-instruct:7b-q4_K_M', promptVersion: 'v3.2.1', feedback: null, createdAt: T },
  { id: MSG_2, conversationId: CONV_1, seq: 2, role: 'assistant', content: 'הצעתי לקצר את שלב 3א ולמזג את 3ב.', toolCalls: [{ id: 'tc1', name: 'propose_source_edit', args: { anchor: '§3' } }], toolResults: [{ id: 'tc1', ok: true, summary: '2 שינויים' }], proposedEditsId: null, refinedSuggestionId: null, tokensIn: 900, tokensOut: 80, latencyMs: 14_000, model: 'dictalm2.0-instruct:7b-q4_K_M', promptVersion: 'v3.2.1', feedback: 'up', createdAt: T },
];

export const aiAdminState = {
  settings: sampleSettings(),
  versions: sampleVersions(),
  evalRuns: [sampleEvalRun()] as EvalRun[],
  conversations: [sampleConversation()] as Conversation[],
  messages: { [CONV_1]: sampleMessages() } as Record<string, AiMessage[]>,
  deleted: [] as string[],
  reindexQueued: 0,
  evalQueued: 0,
  lastPut: null as unknown,
  lastTest: null as string | null,
  exportCalls: 0,
  analytics: sampleAnalytics(),
};
export const resetAiAdminState = () => {
  aiAdminState.settings = sampleSettings();
  aiAdminState.versions = sampleVersions();
  aiAdminState.evalRuns = [sampleEvalRun()];
  aiAdminState.conversations = [sampleConversation()];
  aiAdminState.messages = { [CONV_1]: sampleMessages() };
  aiAdminState.deleted = [];
  aiAdminState.reindexQueued = 0;
  aiAdminState.evalQueued = 0;
  aiAdminState.lastPut = null;
  aiAdminState.lastTest = null;
  aiAdminState.exportCalls = 0;
  aiAdminState.analytics = sampleAnalytics();
};

const deepMerge = (a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b))
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object'
      ? deepMerge(a[k] as Record<string, unknown>, v as Record<string, unknown>)
      : v;
  return out;
};

export const aiAdminHandlers: RequestHandler[] = [
  http.get(`${B}/admin/ai/settings`, () => HttpResponse.json(aiAdminState.settings)),
  http.put(`${B}/admin/ai/settings`, async ({ request }) => {
    const patch = (await request.json()) as Record<string, unknown>;
    aiAdminState.lastPut = patch;
    const merged = deepMerge(aiAdminState.settings as unknown as Record<string, unknown>, patch) as unknown as AiSettings;
    // The server bumps a version only when the text changed — mirror that so the UI's "גרסה N" is honest.
    if (patch.brief && (patch.brief as { text?: string }).text !== aiAdminState.settings.brief.text) merged.brief.version = aiAdminState.settings.brief.version + 1;
    if (patch.style && (patch.style as { text?: string }).text !== aiAdminState.settings.style.text) merged.style.version = aiAdminState.settings.style.version + 1;
    aiAdminState.settings = merged;
    return HttpResponse.json(merged);
  }),
  http.get(`${B}/admin/ai/settings/versions`, () => HttpResponse.json({ items: aiAdminState.versions })),
  http.post(`${B}/admin/ai/models/test`, async ({ request }) => {
    const { slot } = (await request.json()) as { slot: 'suggest' | 'chat' | 'embed' };
    aiAdminState.lastTest = slot;
    return HttpResponse.json(sampleModelTest(slot));
  }),
  http.post(`${B}/admin/ai/eval`, () => {
    aiAdminState.evalQueued += 1;
    return HttpResponse.json({ queued: true }, { status: 202 });
  }),
  http.get(`${B}/admin/ai/eval/runs`, () => HttpResponse.json({ items: aiAdminState.evalRuns })),
  http.post(`${B}/admin/ai/reindex`, () => {
    aiAdminState.reindexQueued += 1;
    return HttpResponse.json({ queued: true }, { status: 202 });
  }),
  http.get(`${B}/suggestions/analytics`, () => HttpResponse.json(aiAdminState.analytics)),
  http.get(`${B}/admin/ai/conversations`, ({ request }) => {
    const u = new URL(request.url);
    const user = u.searchParams.get('user');
    const feedback = u.searchParams.get('feedback');
    let items = aiAdminState.conversations.filter((c) => !aiAdminState.deleted.includes(c.id));
    if (user) items = items.filter((c) => c.userId === user || c.userName.includes(user));
    if (feedback) items = items.filter((c) => (aiAdminState.messages[c.id] ?? []).some((m) => m.feedback === feedback));
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),
  http.get(`${B}/admin/ai/conversations/export.jsonl`, () => {
    aiAdminState.exportCalls += 1;
    const lines = aiAdminState.conversations.map((c) => JSON.stringify({ conversation: c, messages: aiAdminState.messages[c.id] ?? [] }));
    return new HttpResponse(lines.join('\n') + '\n', { headers: { 'content-type': 'application/x-ndjson' } });
  }),
  http.get(`${B}/ai/conversations/:id`, ({ params }) => {
    const c = aiAdminState.conversations.find((x) => x.id === params.id);
    if (!c || aiAdminState.deleted.includes(c.id)) return HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
    return HttpResponse.json({ conversation: c, messages: aiAdminState.messages[c.id] ?? [] });
  }),
  http.delete(`${B}/admin/ai/conversations/:id`, ({ params }) => {
    aiAdminState.deleted.push(String(params.id));
    return new HttpResponse(null, { status: 204 });
  }),
];
```
Adjust field names to `wave6.ts` on disk (e.g. if `Conversation` has no `userName`/`documentTitle`/`messageCount`, drop them; if `AiMessage.feedback` is not part of the message schema, keep feedback filtering by a local map instead). The parity test decides.

`apps/web/test/msw/handlers.ts` — append next to the wave 5 lines:
```tsx
import { aiAdminHandlers, resetAiAdminState } from './ai-admin.js';
// …in `handlers`: ...aiAdminHandlers,
// …in the reset function: resetAiAdminState();
```

- [ ] **Step 4: Run to verify pass** — the three parity tests green; full `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 test/msw` still green.
- [ ] **Step 5: Commit** — `test(web): wave 6 ai-admin msw group and contract parity fixtures`

---

### Task 2: Request bridge, query keys, admin hooks, analytics hook, invalidation

**Files:**
- Create: `apps/web/src/api/wave6.ts`, `apps/web/src/api/hooks/aiAdmin.ts`, `apps/web/src/api/hooks/suggestionAnalytics.ts`, `apps/web/src/api/invalidateAi.ts`
- Modify: `apps/web/src/api/keys.ts` (append)
- Test: `apps/web/test/admin/AiHooks.test.tsx`

**Interfaces:**
- Produces: `w6<T>(schema, method, path, opts?)`, `w6Void(method, path, opts?)`, `w6Text(path)`; keys `keys.ai.settings`, `keys.ai.versions`, `keys.ai.evalRuns`, `keys.ai.conversations(q)`, `keys.ai.conversation(id)`, `keys.suggestions.analytics(q)`; hooks `useAiSettings(enabled)`, `usePutAiSettings()`, `useAiSettingVersions(enabled)`, `useTestModel()`, `useRunEval()`, `useReindex()`, `useEvalRuns(enabled)`, `useAdminConversations(q, enabled)`, `useAdminConversation(id, enabled)`, `useDeleteConversation()`, `exportConversations()` (fetches JSONL text and calls `download`); `useSuggestionAnalytics(q, enabled)`; `invalidateAi(qc)`.

- [ ] **Step 1: Write the failing hook test**

`apps/web/test/admin/AiHooks.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { useAiSettings, usePutAiSettings, useTestModel, useDeleteConversation } from '../../src/api/hooks/aiAdmin.js';
import { useSuggestionAnalytics } from '../../src/api/hooks/suggestionAnalytics.js';
import { aiAdminState, CONV_1 } from '../msw/ai-admin.js';

const wrap = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { qc, w: ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider> };
};

describe('ai admin hooks', () => {
  it('reads settings and bumps the brief version on save', async () => {
    const { w } = wrap();
    const { result } = renderHook(() => ({ s: useAiSettings(true), put: usePutAiSettings() }), { wrapper: w });
    await waitFor(() => expect(result.current.s.data?.models.tier).toBe(1));
    await act(async () => { await result.current.put.mutateAsync({ brief: { text: 'טקסט חדש' } }); });
    expect((aiAdminState.lastPut as { brief: { text: string } }).brief.text).toBe('טקסט חדש');
    await waitFor(() => expect(result.current.s.data?.brief.version).toBe(3));
  });
  it('tests a model slot and reports the result', async () => {
    const { w } = wrap();
    const { result } = renderHook(() => useTestModel(), { wrapper: w });
    const r = await act(async () => result.current.mutateAsync({ slot: 'embed' }));
    expect(r.dims).toBe(1024);
    expect(aiAdminState.lastTest).toBe('embed');
  });
  it('deletes a conversation and drops it from the list cache', async () => {
    const { w, qc } = wrap();
    const { result } = renderHook(() => useDeleteConversation(), { wrapper: w });
    const spy = vi.spyOn(qc, 'invalidateQueries');
    await act(async () => { await result.current.mutateAsync(CONV_1); });
    expect(aiAdminState.deleted).toContain(CONV_1);
    expect(spy).toHaveBeenCalledWith(expect.objectContaining({ queryKey: ['ai', 'conversations'] }));
  });
  it('does not call analytics when disabled', async () => {
    const { w } = wrap();
    const { result } = renderHook(() => useSuggestionAnalytics({}, false), { wrapper: w });
    expect(result.current.fetchStatus).toBe('idle');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4 test/admin/AiHooks.test.tsx` → FAIL (modules missing).

- [ ] **Step 3: Implement**

`apps/web/src/api/wave6.ts` (bridge; X6 deletes):
```tsx
/**
 * Wave 6 bridge for routes not yet in `openapi.json` while the X lanes run in parallel.
 * Same origin/credentials/error envelope as `api`; every response is parsed with the shared schema.
 * X6 replaces each caller with `api.GET/POST/…` and deletes this file.
 */
import type { z } from 'zod';
import { ApiError } from './unwrap.js';

const BASE = '/api/v1';
type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface Opts { query?: Record<string, string | number | boolean | undefined>; body?: unknown }

const url = (path: string, query?: Opts['query']) => {
  const u = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined && v !== '') u.searchParams.set(k, String(v));
  return u.toString();
};
async function raw(method: Method, path: string, opts: Opts = {}): Promise<Response> {
  const res = await fetch(url(path, opts.query), {
    method,
    credentials: 'same-origin',
    headers: opts.body === undefined ? {} : { 'content-type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  if (!res.ok) {
    let code = 'HTTP_' + res.status;
    let message = res.statusText;
    try { const j = (await res.json()) as { code?: string; message?: string }; code = j.code ?? code; message = j.message ?? message; } catch { /* no body */ }
    throw new ApiError(res.status, code, message);
  }
  return res;
}
export async function w6<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, method: Method, path: string, opts?: Opts): Promise<T> {
  const res = await raw(method, path, opts);
  const parsed = schema.safeParse(await res.json());
  if (!parsed.success) throw new ApiError(res.status, 'CONTRACT', 'תשובת השרת אינה תואמת לחוזה: ' + parsed.error.issues[0]?.path.join('.'));
  return parsed.data;
}
export async function w6Void(method: Method, path: string, opts?: Opts): Promise<void> { await raw(method, path, opts); }
export async function w6Text(path: string, opts?: Opts): Promise<string> { return (await raw('GET', path, opts)).text(); }
```
(Read `apps/web/src/api/unwrap.ts` for `ApiError`'s constructor signature and match it.)

`apps/web/src/api/keys.ts` — append inside `keys`:
```tsx
  /* wave 6 — AI (X4a owns ai.conversation*, X4b owns the rest) */
  ai: {
    settings: ['ai', 'settings'] as const,
    versions: ['ai', 'settings', 'versions'] as const,
    evalRuns: ['ai', 'eval', 'runs'] as const,
    conversations: (q: unknown = '*') => ['ai', 'conversations', q] as const,
    conversation: (id: string) => ['ai', 'conversation', id] as const,
  },
  suggestionAnalytics: (q: unknown = '*') => ['suggestions', 'analytics', q] as const,
```
If X4a already added `ai.conversations`/`ai.conversation` with the same shape, keep one definition (theirs) and add only the missing keys.

`apps/web/src/api/invalidateAi.ts`:
```tsx
import type { QueryClient } from '@tanstack/react-query';
/** Anything under `ai` plus the analytics that depend on prompt/model versions. */
export const invalidateAi = (qc: QueryClient) => {
  for (const k of [['ai'], ['suggestions', 'analytics']] as const) void qc.invalidateQueries({ queryKey: [...k] });
};
```

`apps/web/src/api/hooks/aiAdmin.ts`:
```tsx
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AiSettingsSchema, AiSettingVersionSchema, ConversationDetailSchema, ConversationsResponseSchema,
  EvalRunsResponseSchema, ModelTestResultSchema,
  type AiSettingsPut, type ModelTestBody,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { w6, w6Text, w6Void } from '../wave6.js';
import { download } from '../../lib/format.js';
import { invalidateAi } from '../invalidateAi.js';

const VersionsResponse = z.object({ items: z.array(AiSettingVersionSchema) });
const Queued = z.object({ queued: z.boolean() });

export const useAiSettings = (enabled = true) =>
  useQuery({ queryKey: keys.ai.settings, enabled, staleTime: 30_000, queryFn: () => w6(AiSettingsSchema, 'GET', '/admin/ai/settings') }); // X6: api.GET
export const usePutAiSettings = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: AiSettingsPut) => w6(AiSettingsSchema, 'PUT', '/admin/ai/settings', { body: patch }), // X6: api.PUT
    onSuccess: (s) => { qc.setQueryData(keys.ai.settings, s); void qc.invalidateQueries({ queryKey: keys.ai.versions }); },
  });
};
export const useAiSettingVersions = (enabled = true) =>
  useQuery({ queryKey: keys.ai.versions, enabled, queryFn: async () => (await w6(VersionsResponse, 'GET', '/admin/ai/settings/versions')).items });
export const useTestModel = () =>
  useMutation({ mutationFn: (body: ModelTestBody) => w6(ModelTestResultSchema, 'POST', '/admin/ai/models/test', { body }) });
export const useRunEval = () => {
  const qc = useQueryClient();
  return useMutation({ mutationFn: () => w6(Queued, 'POST', '/admin/ai/eval'), onSuccess: () => void qc.invalidateQueries({ queryKey: keys.ai.evalRuns }) });
};
export const useReindex = () => useMutation({ mutationFn: () => w6(Queued, 'POST', '/admin/ai/reindex') });
export const useEvalRuns = (enabled = true) =>
  useQuery({ queryKey: keys.ai.evalRuns, enabled, refetchInterval: 30_000, queryFn: async () => (await w6(EvalRunsResponseSchema, 'GET', '/admin/ai/eval/runs')).items });

export interface AdminConversationsQuery { user?: string; documentId?: string; from?: string; to?: string; feedback?: 'up' | 'down'; page?: number }
export const useAdminConversations = (q: AdminConversationsQuery, enabled = true) =>
  useQuery({ queryKey: keys.ai.conversations({ admin: true, ...q }), enabled, queryFn: () => w6(ConversationsResponseSchema, 'GET', '/admin/ai/conversations', { query: q }) });
export const useAdminConversation = (id: string | null, enabled = true) =>
  useQuery({ queryKey: keys.ai.conversation(id ?? ''), enabled: enabled && !!id, queryFn: () => w6(ConversationDetailSchema, 'GET', `/ai/conversations/${id}`) });
export const useDeleteConversation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => w6Void('DELETE', `/admin/ai/conversations/${id}`),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['ai', 'conversations'] }); },
  });
};
/** JSONL export: fetched, then handed to the browser through a Blob URL (no inline data links). */
export async function exportConversations(q: AdminConversationsQuery = {}): Promise<void> {
  const text = await w6Text('/admin/ai/conversations/export.jsonl', { query: q });
  download(`ai-conversations-${new Date().toISOString().slice(0, 10)}.jsonl`, text, 'application/x-ndjson');
}
export { invalidateAi };
```
(`AiSettingsPut`/`ModelTestBody` type aliases come from X0; if X0 exported only schemas, derive with `z.input<typeof AiSettingsPutSchema>` locally in this file.)

`apps/web/src/api/hooks/suggestionAnalytics.ts`:
```tsx
import { useQuery } from '@tanstack/react-query';
import { SuggestionAnalyticsSchema, type SuggestionAnalyticsQuery } from '@wecom/shared';
import { keys } from '../keys.js';
import { w6 } from '../wave6.js';
export const useSuggestionAnalytics = (q: SuggestionAnalyticsQuery, enabled = true) =>
  useQuery({ queryKey: keys.suggestionAnalytics(q), enabled, staleTime: 60_000, queryFn: () => w6(SuggestionAnalyticsSchema, 'GET', '/suggestions/analytics', { query: q as Record<string, string | undefined> }) }); // X6: api.GET
```

- [ ] **Step 4: Run** — hook tests green; `pnpm --filter @wecom/web build` (tsc) green.
- [ ] **Step 5: Commit** — `feat(web): wave 6 bridge, keys, admin AI hooks, suggestion analytics hook`

---

### Task 3: `EditorChatDock`, `ArticleAskPane`, step citations (and the `ChatPane` placeholder if X4a is absent)

**Files:**
- Create: `apps/web/src/components/ai/EditorChatDock.tsx`, `apps/web/src/components/ai/ArticleAskPane.tsx`, `apps/web/src/components/ai/citations.tsx`; `apps/web/src/components/ai/ChatPane.tsx` **only if missing**
- Test: `apps/web/test/ai/EditorChatDock.test.tsx`, `apps/web/test/ai/ArticleAskPane.test.tsx`, `apps/web/test/ai/citations.test.tsx`

**Interfaces:**
- Consumes: `ChatPane` (X4a) with the props in the Architecture note.
- Produces: `EditorChatDock({ documentId: string; stepKey?: string; onInsertStep?: (step: DraftStep) => void; defaultOpen?: boolean })`, `ArticleAskPane({ documentId: string; stepKey?: string })`, `renderWithStepLinks(text: string, documentId: string): ReactNode[]`, `STEP_REF_RE`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/ai/citations.test.tsx`:
```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { renderWithStepLinks } from '../../src/components/ai/citations.js';

describe('step citations', () => {
  it('turns "שלב 3א" and "שלב 12" into links to the step and leaves other text alone', () => {
    render(<MemoryRouter>{renderWithStepLinks('ראה שלב 3א ואחר כך שלב 12. שלבים רבים.', 'doc-1')}</MemoryRouter>);
    const links = screen.getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/doc/doc-1/3א', '/doc/doc-1/12']);
    expect(screen.getByText(/שלבים רבים/)).toBeInTheDocument();
  });
});
```

`apps/web/test/ai/ArticleAskPane.test.tsx` (uses a test-only `ChatPane` mock so it does not depend on X4a's transport):
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { ArticleAskPane } from '../../src/components/ai/ArticleAskPane.js';

vi.mock('../../src/components/ai/ChatPane.js', () => ({
  ChatPane: (p: { kind: string; tools?: string; documentId: string }) => <div data-testid="chat-pane">{p.kind}:{p.tools}:{p.documentId}</div>,
}));
vi.mock('../../src/api/hooks/me.js', async (orig) => {
  const m = (await orig()) as Record<string, unknown>;
  return { ...m, useCan: () => (p: string) => p === 'ai.ask' || p === 'docs.read' };
});

describe('ArticleAskPane', () => {
  it('starts collapsed, opens on click, and mounts the ask-tool chat for the document', () => {
    renderWithProviders(<ArticleAskPane documentId="doc-1" stepKey="s3" />);
    expect(screen.queryByTestId('chat-pane')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'שאל את המערכת' }));
    expect(screen.getByTestId('chat-pane')).toHaveTextContent('article:ask:doc-1');
    expect(screen.getByRole('region', { name: 'שאל את המערכת' })).toBeInTheDocument();
  });
});
```
Add a second test file for the dock (`EditorChatDock.test.tsx`): same mocks with `useCan` granting `ai.chat`; asserts the dock renders a "צ'אט" toggle, opens with `kind="editor"` and `tools="chat"`, that without `ai.chat` it renders nothing, and that the `Escape` key closes it.

- [ ] **Step 2: Run to verify failure** — the three files fail on missing modules.

- [ ] **Step 3: Implement**

`apps/web/src/components/ai/citations.tsx`:
```tsx
import { Fragment, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
/** "שלב 3א", "שלב 12", "שלב 4ב'" — the step's display number as the article prints it. */
export const STEP_REF_RE = /שלב\s+(\d{1,3}[א-ת]?'?)/g;
export function renderWithStepLinks(text: string, documentId: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(STEP_REF_RE)) {
    const i = m.index ?? 0;
    if (i > last) out.push(<Fragment key={last}>{text.slice(last, i)}</Fragment>);
    const num = m[1].replace(/'$/, '');
    out.push(<Link key={i} to={`/doc/${documentId}/${num}`} className="step-cite">{m[0]}</Link>);
    last = i + m[0].length;
  }
  if (last < text.length) out.push(<Fragment key={last}>{text.slice(last)}</Fragment>);
  return out;
}
```
(Check how `ArticlePage` routes to a step — `routes.tsx` has `doc/:id/:step`; if the segment is the step `key` rather than its display number, change the link to use the key via the document's steps map passed in as a second argument: `renderWithStepLinks(text, documentId, numToKey?: Map<string,string>)`.)

`apps/web/src/components/ai/ArticleAskPane.tsx`:
```tsx
import { useId, useState } from 'react';
import { useCan } from '../../api/hooks/me.js';
import { ChatPane } from './ChatPane.js';

export const ASK_TITLE = 'שאל את המערכת';
/** Agents' read-only Q&A on the article (spec §5). Collapsed by default; no write tools. */
export function ArticleAskPane({ documentId, stepKey }: { documentId: string; stepKey?: string }) {
  const can = useCan();
  const [open, setOpen] = useState(false);
  const id = useId();
  if (!can('ai.ask')) return null;
  return (
    <section className="ask-pane" aria-label={ASK_TITLE}>
      <button type="button" className="btn sm ask-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {ASK_TITLE}
      </button>
      {open ? (
        <div id={id} className="ask-body">
          <ChatPane kind="article" tools="ask" documentId={documentId} context={stepKey ? { stepKey } : undefined} />
          <p className="muted small">התשובות מבוססות על התוכן שפורסם בלבד ומצטטות מספרי שלבים.</p>
        </div>
      ) : null}
    </section>
  );
}
```

`apps/web/src/components/ai/EditorChatDock.tsx`:
```tsx
import { useEffect, useId, useState } from 'react';
import { useCan } from '../../api/hooks/me.js';
import { ChatPane } from './ChatPane.js';
export interface DraftStep { title: string; actions: string[]; outcomes?: { kind: 'ok' | 'next' | 'alert'; text: string }[] }
/** Editor-side chat (spec §5 "Step editor"): refine, explain, draft a step, review the document. */
export function EditorChatDock({ documentId, stepKey, onInsertStep, defaultOpen = false }: {
  documentId: string; stepKey?: string; onInsertStep?: (step: DraftStep) => void; defaultOpen?: boolean;
}) {
  const can = useCan();
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!can('ai.chat')) return null;
  return (
    <aside className={'ai-dock' + (open ? ' open' : '')} aria-label="צ'אט עם המערכת">
      <button type="button" className="btn sm ai-dock-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        {open ? 'סגור צ\'אט' : 'צ\'אט'}
      </button>
      {open ? (
        <div id={id} className="ai-dock-body">
          <ChatPane
            kind="editor"
            tools="chat"
            documentId={documentId}
            context={stepKey ? { stepKey } : undefined}
            onDraftStep={onInsertStep}
          />
        </div>
      ) : null}
    </aside>
  );
}
```
`onDraftStep` is a prop X4a's `ChatPane` may not expose; if its props lack it, pass the callback through `onToolResult?.('draft_step', payload)` if that exists, else keep the prop out and note in the report that X6 wires `draft_step` insertion (the dock exposes `onInsertStep` either way).

Placeholder `ChatPane.tsx` (only if absent):
```tsx
/** PLACEHOLDER — X4a ships the real ChatPane at this path; X6 deletes this file at merge. */
export interface ChatPaneProps {
  kind: 'workspace' | 'editor' | 'article'; documentId: string;
  context?: { stepKey?: string; suggestionId?: string; selection?: string };
  tools?: 'ask' | 'chat'; onProposedEdits?: (id: string) => void; onRefinedSuggestion?: (id: string) => void; onDraftStep?: (s: unknown) => void;
}
export function ChatPane(_: ChatPaneProps) { return <div className="chat-pane muted">הצ'אט נטען…</div>; }
```

- [ ] **Step 4: Run** — three test files green; build green.
- [ ] **Step 5: Commit** — `feat(web): editor chat dock, article ask pane, step citations`

---

### Task 4: `/admin/ai` shell, roving tabs, הנחיות tab, מודלים tab

**Files:**
- Create: `apps/web/src/components/admin/AiPage.tsx`, `apps/web/src/components/admin/ai/Tabs.tsx`, `apps/web/src/components/admin/ai/PromptsTab.tsx`, `apps/web/src/components/admin/ai/ModelsTab.tsx`, `apps/web/src/components/admin/ai/NumField.tsx`, `apps/web/src/lib/promptPreview.ts`
- Test: `apps/web/test/admin/AiPage.test.tsx`, `apps/web/test/admin/AiPrompts.test.tsx`, `apps/web/test/admin/AiModels.test.tsx`, `apps/web/test/lib/promptPreview.test.ts`

**Interfaces:**
- Produces: `AiPage()` (route `/admin/ai`, `?tab=prompts|models|eval|analytics|conversations`), `AdminTabs({ tabs: { id, label }[]; value; onChange; controls })`, `PromptsTab()`, `ModelsTab()`, `NumField(...)` (same props as `WorkflowSettingsSection`'s), `buildSystemPromptPreview(settings: AiSettings): string`, `TAB_LABELS`.

- [ ] **Step 1: Write the failing tests**

`apps/web/test/lib/promptPreview.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { buildSystemPromptPreview } from '../../src/lib/promptPreview.js';
import { sampleSettings } from '../msw/ai-admin.js';
describe('system prompt preview', () => {
  it('lays out brief, architecture, style and rules in order with the prompt version', () => {
    const p = buildSystemPromptPreview(sampleSettings());
    expect(p.indexOf('## על החברה')).toBeLessThan(p.indexOf('## ארכיטקטורת הידע'));
    expect(p.indexOf('## ארכיטקטורת הידע')).toBeLessThan(p.indexOf('## סגנון'));
    expect(p).toContain('wecom היא חברת תקשורת');
    expect(p).toContain('גרסת הנחיות: v3.2.1');
  });
});
```

`apps/web/test/admin/AiPage.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithProviders } from '../render.js';
import { AiPage } from '../../src/components/admin/AiPage.js';

const grant = (perms: string[]) =>
  vi.doMock('../../src/api/hooks/me.js', async (orig) => {
    const m = (await orig()) as Record<string, unknown>;
    return { ...m, useCan: () => (p: string) => perms.includes(p) };
  });

describe('AiPage', () => {
  it('refuses without ai.manage', async () => {
    grant(['docs.read']);
    const { AiPage: P } = await import('../../src/components/admin/AiPage.js');
    renderWithProviders(<P />, { route: '/admin/ai' });
    expect(await screen.findByText('אין הרשאה לניהול הבינה המלאכותית')).toBeInTheDocument();
  });
  it('renders five tabs and moves between them with arrow keys (RTL)', async () => {
    grant(['ai.manage']);
    renderWithProviders(<AiPage />, { route: '/admin/ai' });
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['הנחיות', 'מודלים', 'הערכה', 'אנליטיקת הצעות', 'שיחות']);
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' }); // RTL: left = forward
    expect(screen.getByRole('tab', { name: 'מודלים' })).toHaveAttribute('aria-selected', 'true');
  });
});
```

`apps/web/test/admin/AiPrompts.test.tsx`: renders `PromptsTab` (with `ai.manage`), asserts the brief textarea shows the fixture text and "גרסה 2", edits it, clicks "שמור", asserts `aiAdminState.lastPut.brief.text` and that "גרסה 3" appears; opens "היסטוריית גרסאות" and sees two brief versions; clicks "תצוגת system prompt" and sees `## על החברה`.

`apps/web/test/admin/AiModels.test.tsx`: renders `ModelsTab`, asserts the tier select shows "דרגה 1", changing to "דרגה 2" fills the three slot inputs from `MODEL_TIER_PRESETS[2]`, "בדוק" on the embed slot shows "1024 ממדים" and `aiAdminState.lastTest === 'embed'`, "שמור" sends `models` in the PUT, "אינדוקס מחדש" confirms then increments `aiAdminState.reindexQueued`.

- [ ] **Step 2: Run to verify failure** — all four fail on missing modules.

- [ ] **Step 3: Implement**

`apps/web/src/lib/promptPreview.ts`:
```ts
import type { AiSettings } from '@wecom/shared';
/** Client-side rendering of the v3 system-prompt layout for the admin preview (the API assembles the real one). */
export const ARCHITECTURE_BLOCK = [
  'עולמות תוכן → נושאים → פריטי ידע. שבעה סוגי פריטים: M אבחון, R טיפול, O תפעול, E הסלמה, S מומחה, T תסריט, I מידע.',
  'רק תוכן שפורסם מוצג לנציגים. שינוי במקור לעולם אינו מעדכן את תצוגת העבודה בלי אישור עורך.',
  'בלוקים משותפים ושדות CRM מופיעים במסמכים רבים — שינוי בהם משפיע על כולם.',
].join('\n');
export function buildSystemPromptPreview(s: AiSettings): string {
  const version = `v3.${s.brief.version}.${s.style.version}`;
  return [
    `# הנחיות למערכת (גרסת הנחיות: ${version})`,
    '## על החברה', s.brief.text || '(ריק)',
    '## ארכיטקטורת הידע', ARCHITECTURE_BLOCK,
    '## סגנון', s.style.text || '(ריק)',
    '## כללי המשימה', 'החזר JSON תקין לפי הסכמה; אל תמציא מזהים; ציין השפעה על מסמכים אחרים.',
  ].join('\n\n');
}
```

`apps/web/src/components/admin/ai/Tabs.tsx`:
```tsx
import { useRef } from 'react';
export interface TabDef { id: string; label: string }
/** Roving tablist. RTL: ArrowLeft moves forward, ArrowRight back; Home/End jump. */
export function AdminTabs({ tabs, value, onChange, controls }: { tabs: TabDef[]; value: string; onChange: (id: string) => void; controls: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const idx = Math.max(0, tabs.findIndex((t) => t.id === value));
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    onChange(tabs[n].id);
    (ref.current?.querySelectorAll<HTMLButtonElement>('[role=tab]')[n])?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') { e.preventDefault(); go(idx + 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); go(idx - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(tabs.length - 1); }
  };
  return (
    <div className="facets" role="tablist" aria-label="לשוניות" ref={ref} onKeyDown={onKey}>
      {tabs.map((t, i) => (
        <button key={t.id} type="button" role="tab" aria-selected={i === idx} aria-controls={controls} tabIndex={i === idx ? 0 : -1}
          className={'facet' + (i === idx ? ' on' : '')} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}
```

`apps/web/src/components/admin/AiPage.tsx`:
```tsx
import { lazy, Suspense } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useCan } from '../../api/hooks/me.js';
import { Empty } from '../ui/index.js';
import { AdminTabs } from './ai/Tabs.js';
import { PromptsTab } from './ai/PromptsTab.js';
import { ModelsTab } from './ai/ModelsTab.js';
const EvalTab = lazy(() => import('./ai/EvalTab.js').then((m) => ({ default: m.EvalTab })));
const SuggestionAnalyticsTab = lazy(() => import('./ai/SuggestionAnalyticsTab.js').then((m) => ({ default: m.SuggestionAnalyticsTab })));
const ConversationsTab = lazy(() => import('./ai/ConversationsTab.js').then((m) => ({ default: m.ConversationsTab })));

export const TAB_LABELS = [
  { id: 'prompts', label: 'הנחיות' },
  { id: 'models', label: 'מודלים' },
  { id: 'eval', label: 'הערכה' },
  { id: 'analytics', label: 'אנליטיקת הצעות' },
  { id: 'conversations', label: 'שיחות' },
];
export function AiPage() {
  const can = useCan();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'prompts';
  if (!can('ai.manage')) return <Empty title="אין הרשאה לניהול הבינה המלאכותית" />;
  return (
    <div className="page ai-admin">
      <div className="lib-head"><h1>בינה מלאכותית</h1></div>
      <AdminTabs tabs={TAB_LABELS} value={tab} onChange={(id) => setSp({ tab: id }, { replace: true })} controls="ai-tabpanel" />
      <div id="ai-tabpanel" role="tabpanel">
        <Suspense fallback={<p className="muted">טוען…</p>}>
          {tab === 'prompts' && <PromptsTab />}
          {tab === 'models' && <ModelsTab />}
          {tab === 'eval' && <EvalTab />}
          {tab === 'analytics' && <SuggestionAnalyticsTab />}
          {tab === 'conversations' && <ConversationsTab />}
        </Suspense>
      </div>
    </div>
  );
}
```
(Tasks 5–6 create the three lazy tabs; until then Task 4's build passes because the files are added in this same task as empty exports — create `EvalTab.tsx`, `SuggestionAnalyticsTab.tsx`, `ConversationsTab.tsx` here with `export function X() { return null; }` and fill them in Tasks 5–6.)

`apps/web/src/components/admin/ai/PromptsTab.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react';
import { useAiSettings, useAiSettingVersions, usePutAiSettings } from '../../../api/hooks/aiAdmin.js';
import { buildSystemPromptPreview } from '../../../lib/promptPreview.js';
import { fmtDate } from '../../../lib/format.js';
import { useToast } from '../../ui/Toast.js';

function TextBlock({ label, value, version, onSave }: { label: string; value: string; version: number; onSave: (t: string) => Promise<void> }) {
  const [text, setText] = useState(value);
  const dirty = useRef(false);
  useEffect(() => { if (!dirty.current) setText(value); }, [value]);
  return (
    <section className="settings-card">
      <h2>{label} <span className="chip">גרסה {version}</span></h2>
      <textarea className="ai-textarea" dir="rtl" rows={8} value={text} aria-label={label}
        onChange={(e) => { dirty.current = true; setText(e.target.value); }} />
      <div className="row">
        <button type="button" className="btn" disabled={text === value} onClick={() => void onSave(text).then(() => { dirty.current = false; })}>שמור</button>
        <button type="button" className="btn ghost" disabled={text === value} onClick={() => { dirty.current = false; setText(value); }}>בטל</button>
      </div>
    </section>
  );
}

export function PromptsTab() {
  const s = useAiSettings();
  const put = usePutAiSettings();
  const versions = useAiSettingVersions();
  const toast = useToast();
  const [showPreview, setShowPreview] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  if (!s.data) return <p className="muted">טוען…</p>;
  const save = (key: 'brief' | 'style') => async (text: string) => {
    try { await put.mutateAsync({ [key]: { text } }); toast('ההנחיות נשמרו', 'ok'); }
    catch (e) { toast(e instanceof Error ? e.message : 'השמירה נכשלה', 'warn'); }
  };
  return (
    <div className="ai-prompts">
      <TextBlock label="תיאור החברה" value={s.data.brief.text} version={s.data.brief.version} onSave={save('brief')} />
      <TextBlock label="כללי סגנון" value={s.data.style.text} version={s.data.style.version} onSave={save('style')} />
      <div className="row">
        <button type="button" className="btn ghost" onClick={() => setShowPreview((v) => !v)}>תצוגת system prompt</button>
        <button type="button" className="btn ghost" onClick={() => setShowHistory((v) => !v)}>היסטוריית גרסאות</button>
      </div>
      {showPreview ? <pre className="ai-preview" dir="rtl">{buildSystemPromptPreview(s.data)}</pre> : null}
      {showHistory ? (
        <table className="table">
          <thead><tr><th>מפתח</th><th>גרסה</th><th>מי</th><th>מתי</th><th>טקסט</th></tr></thead>
          <tbody>
            {(versions.data ?? []).map((v) => (
              <tr key={v.key + v.version}><td>{v.key === 'ai.brief' ? 'תיאור החברה' : 'כללי סגנון'}</td><td>{v.version}</td><td>{v.updatedByName ?? v.updatedBy ?? '—'}</td><td>{fmtDate(v.updatedAt)}</td><td className="ai-ver-text">{String((v.value as { text?: string }).text ?? '')}</td></tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}
```

`apps/web/src/components/admin/ai/ModelsTab.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { MODEL_TIER_PRESETS, type AiModelsSettings, type ModelTestResult } from '@wecom/shared';
import { useAiSettings, usePutAiSettings, useReindex, useTestModel } from '../../../api/hooks/aiAdmin.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';
import { NumField } from './NumField.js';

const SLOT_LABEL = { suggest: 'מודל הצעות', chat: 'מודל צ\'אט', embed: 'מודל הטמעה' } as const;
const fmtBytes = (n?: number) => (n ? (n / 1e9).toFixed(1) + ' GB' : '—');
export function ModelsTab() {
  const s = useAiSettings();
  const put = usePutAiSettings();
  const test = useTestModel();
  const reindex = useReindex();
  const modal = useModal();
  const toast = useToast();
  const [m, setM] = useState<AiModelsSettings | null>(null);
  const [results, setResults] = useState<Partial<Record<'suggest' | 'chat' | 'embed', ModelTestResult>>>({});
  useEffect(() => { if (s.data && !m) setM(s.data.models); }, [s.data, m]);
  if (!m) return <p className="muted">טוען…</p>;
  const applyTier = (tier: number) => {
    const p = MODEL_TIER_PRESETS[tier as 0 | 1 | 2 | 3 | 4];
    setM({ tier, suggestModel: p.suggestModel, chatModel: p.chatModel, embedModel: p.embedModel, embedDimension: p.embedDimension });
  };
  const dimsChanged = s.data && m.embedDimension !== s.data.models.embedDimension;
  return (
    <div className="ai-models">
      <section className="settings-card">
        <h2>דרגת מודלים</h2>
        <label>דרגה
          <select value={m.tier} onChange={(e) => applyTier(Number(e.target.value))}>
            {[0, 1, 2, 3, 4].map((t) => <option key={t} value={t}>דרגה {t}</option>)}
          </select>
        </label>
        <p className="muted small">בחירת דרגה ממלאת את שלושת המשבצות מהתצורה המומלצת; אפשר לערוך כל משבצת בנפרד.</p>
      </section>
      {(['suggest', 'chat', 'embed'] as const).map((slot) => {
        const key = slot === 'suggest' ? 'suggestModel' : slot === 'chat' ? 'chatModel' : 'embedModel';
        const r = results[slot];
        return (
          <section className="settings-card" key={slot}>
            <h2>{SLOT_LABEL[slot]}</h2>
            <label>תג המודל<input dir="ltr" value={m[key]} onChange={(e) => setM({ ...m, [key]: e.target.value })} /></label>
            {slot === 'embed' ? <NumField label="מספר ממדים" value={m.embedDimension} min={64} max={4096} onChange={(n) => setM({ ...m, embedDimension: n })} /> : null}
            <div className="row">
              <button type="button" className="btn sm" disabled={test.isPending} onClick={() => void test.mutateAsync({ slot }).then((res) => setResults((x) => ({ ...x, [slot]: res })))}>בדוק</button>
              {r ? (
                <span role="status">
                  {r.reachable ? '✔ זמין' : '✖ לא זמין'} · {fmtBytes(r.sizeBytes)}
                  {r.dims ? ` · ${r.dims} ממדים` : ''}{r.tokensPerSec ? ` · ${r.tokensPerSec.toFixed(1)} טוקנים/שנייה` : ''}{r.error ? ` · ${r.error}` : ''}
                </span>
              ) : null}
            </div>
          </section>
        );
      })}
      <div className="row">
        <button type="button" className="btn" disabled={put.isPending} onClick={() => void put.mutateAsync({ models: m }).then(() => toast('המודלים נשמרו', 'ok')).catch((e) => toast(e instanceof Error ? e.message : 'השמירה נכשלה', 'warn'))}>שמור</button>
        <button type="button" className="btn ghost" disabled={reindex.isPending} onClick={async () => {
          if (!(await modal.confirm('אינדוקס מחדש של כל ההטמעות?', dimsChanged ? 'מספר הממדים השתנה — חובה לבצע אינדוקס מחדש אחרי השמירה.' : 'הפעולה רצה ברקע ועשויה להימשך דקות.'))) return;
          try { await reindex.mutateAsync(); toast('האינדוקס נוסף לתור', 'ok'); } catch { toast('לא ניתן להפעיל אינדוקס', 'warn'); }
        }}>אינדוקס מחדש</button>
        {dimsChanged ? <span className="chip warn">שינוי ממדים דורש אינדוקס מחדש</span> : null}
      </div>
    </div>
  );
}
```
`NumField.tsx`: copy the component from `components/admin/WorkflowSettingsSection.tsx` verbatim (same props), noting in the file header that X6 may dedupe both into `components/ui/`.

- [ ] **Step 4: Run** — the four tests green; build green.
- [ ] **Step 5: Commit** — `feat(web): /admin/ai shell with prompts and models tabs`

---

### Task 5: הערכה tab and אנליטיקת הצעות tab

**Files:**
- Modify: `apps/web/src/components/admin/ai/EvalTab.tsx`, `apps/web/src/components/admin/ai/SuggestionAnalyticsTab.tsx` (fill the stubs)
- Test: `apps/web/test/admin/AiEvalAnalytics.test.tsx`

- [ ] **Step 1: Failing test** — renders `EvalTab`: table row shows the fixture's model, `v3.2.1`, `40` cases and `78%` / `85%` / `61%`; clicking "הרץ הערכה" increments `aiAdminState.evalQueued` and toasts "ההערכה נוספה לתור". Renders `SuggestionAnalyticsTab`: the headline rates read "אושרו 56%", "נערכו 22%", "נדחו 22%"; the by-type table lists `update-step` with `70`; switching the "פילוח" select to "לפי מודל" shows the model row; the date inputs write `from`/`to` to the URL (`?from=…`).
- [ ] **Step 2: Run to verify failure**.
- [ ] **Step 3: Implement**

`EvalTab.tsx`:
```tsx
import { useEvalRuns, useRunEval } from '../../../api/hooks/aiAdmin.js';
import { fmtDate } from '../../../lib/format.js';
import { useToast } from '../../ui/Toast.js';
const pct = (x: number) => Math.round(x * 100) + '%';
export function EvalTab() {
  const runs = useEvalRuns();
  const run = useRunEval();
  const toast = useToast();
  return (
    <div className="ai-eval">
      <div className="row">
        <button type="button" className="btn" disabled={run.isPending} onClick={() => void run.mutateAsync().then(() => toast('ההערכה נוספה לתור', 'ok')).catch(() => toast('לא ניתן להפעיל הערכה', 'warn'))}>הרץ הערכה</button>
        <span className="muted small">ההערכה רצה על סט המקרים המחויב במאגר ומודדת פגיעה בשלב היעד, בסוג ההצעה ובחפיפת התוכן.</span>
      </div>
      <table className="table" aria-label="ריצות הערכה">
        <thead><tr><th>התחלה</th><th>מודל</th><th>גרסת הנחיות</th><th>הטמעה</th><th>מקרים</th><th>שלב יעד</th><th>סוג</th><th>חפיפת תוכן</th><th>הערות</th></tr></thead>
        <tbody>
          {(runs.data ?? []).map((r) => (
            <tr key={r.id}><td>{fmtDate(r.startedAt)}</td><td dir="ltr">{r.model}</td><td dir="ltr">{r.promptVersion}</td><td dir="ltr">{r.embedModel}</td><td>{r.cases}</td><td>{pct(r.hitTarget)}</td><td>{pct(r.hitType)}</td><td>{pct(r.contentOverlap)}</td><td>{r.finishedAt ? r.notes : 'רץ…'}</td></tr>
          ))}
          {!runs.data?.length ? <tr><td colSpan={9} className="muted">עדיין לא בוצעה הערכה.</td></tr> : null}
        </tbody>
      </table>
    </div>
  );
}
```

`SuggestionAnalyticsTab.tsx`:
```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSuggestionAnalytics } from '../../../api/hooks/suggestionAnalytics.js';
const pct = (x: number) => Math.round(x * 100) + '%';
const GROUPS = [['byType', 'לפי סוג'], ['bySource', 'לפי מקור'], ['byModel', 'לפי מודל'], ['byPromptVersion', 'לפי גרסת הנחיות']] as const;
type GroupKey = (typeof GROUPS)[number][0];
export function SuggestionAnalyticsTab() {
  const [sp, setSp] = useSearchParams();
  const [group, setGroup] = useState<GroupKey>('byType');
  const q = { from: sp.get('from') ?? undefined, to: sp.get('to') ?? undefined };
  const a = useSuggestionAnalytics(q);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); v ? n.set(k, v) : n.delete(k); setSp(n, { replace: true }); };
  if (!a.data) return <p className="muted">טוען…</p>;
  const rows = a.data[group];
  return (
    <div className="ai-analytics">
      <div className="row">
        <label>מתאריך<input type="date" value={q.from?.slice(0, 10) ?? ''} onChange={(e) => set('from', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
        <label>עד תאריך<input type="date" value={q.to?.slice(0, 10) ?? ''} onChange={(e) => set('to', e.target.value ? new Date(e.target.value).toISOString() : '')} /></label>
        <label>פילוח<select value={group} onChange={(e) => setGroup(e.target.value as GroupKey)}>{GROUPS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      </div>
      <div className="stats">
        <div className="stat"><b>{a.data.total}</b><span>הצעות</span></div>
        <div className="stat"><b>{pct(a.data.rates.accepted)}</b><span>אושרו</span></div>
        <div className="stat"><b>{pct(a.data.rates.edited)}</b><span>נערכו ואושרו</span></div>
        <div className="stat"><b>{pct(a.data.rates.rejected)}</b><span>נדחו</span></div>
        <div className="stat"><b>{a.data.meanMinutesToDecision ?? '—'}</b><span>דקות עד החלטה</span></div>
      </div>
      <table className="table" aria-label="פילוח הצעות">
        <thead><tr><th>{GROUPS.find(([k]) => k === group)?.[1]}</th><th>סה"כ</th><th>אושרו</th><th>נערכו</th><th>נדחו</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td dir="auto">{r.key}</td><td>{r.total}</td><td>{r.accepted}</td><td>{r.edited}</td><td>{r.rejected}</td></tr>)}</tbody>
      </table>
    </div>
  );
}
```
(Use the local `toIso`/`day` helpers from `AnalyticsPage.tsx` for the date inputs if the shared `lib/format.ts` lacks them — copy them, do not import from the page. If the analytics row type on disk names fields differently from `key/total/accepted/edited/rejected`, add one `rowsOf()` adapter in this file and adjust the fixture.)

- [ ] **Step 4: Run** — green; build green.
- [ ] **Step 5: Commit** — `feat(web): admin AI eval runs and suggestion analytics tabs`

---

### Task 6: שיחות tab — transcript browser, viewer, export, delete

**Files:**
- Modify: `apps/web/src/components/admin/ai/ConversationsTab.tsx` (fill the stub)
- Test: `apps/web/test/admin/AiConversations.test.tsx`

- [ ] **Step 1: Failing test** — renders `ConversationsTab`: lists the fixture conversation with user "נועה", document "טיפול באיטיות גלישה", kind "סביבת עבודה", 2 messages; clicking the row opens the viewer showing both messages with role labels "משתמש" / "המערכת", the tool call chip `propose_source_edit`, the 👍 marker on the assistant message, model and latency; filtering "משוב" to "שלילי" empties the list; "ייצוא JSONL" calls `download` (spy `lib/format.download`) with a `.jsonl` name and increments `aiAdminState.exportCalls`; "מחק" asks for confirmation (mock `useModal().confirm` → true) then the row disappears and `aiAdminState.deleted` contains the id.
- [ ] **Step 2: Run to verify failure**.
- [ ] **Step 3: Implement**

```tsx
import { useState } from 'react';
import type { AiMessage } from '@wecom/shared';
import { exportConversations, useAdminConversation, useAdminConversations, useDeleteConversation, type AdminConversationsQuery } from '../../../api/hooks/aiAdmin.js';
import { fmtDate } from '../../../lib/format.js';
import { counted } from '../../../lib/count.js';
import { useModal } from '../../ui/Modal.js';
import { useToast } from '../../ui/Toast.js';

const KIND_LABEL = { workspace: 'סביבת עבודה', editor: 'עורך שלבים', article: 'עמוד פריט' } as const;
const ROLE_LABEL = { user: 'משתמש', assistant: 'המערכת', tool: 'כלי', system: 'מערכת' } as const;

function Message({ m }: { m: AiMessage }) {
  return (
    <article className={'transcript-msg ' + m.role} aria-label={ROLE_LABEL[m.role]}>
      <header>
        <b>{ROLE_LABEL[m.role]}</b>
        <span className="muted small">{fmtDate(m.createdAt)} · {m.model} · {m.latencyMs ? Math.round(m.latencyMs / 1000) + ' שנ׳' : ''}</span>
        {m.feedback === 'up' ? <span aria-label="משוב חיובי">👍</span> : m.feedback === 'down' ? <span aria-label="משוב שלילי">👎</span> : null}
      </header>
      <p dir="auto">{m.content}</p>
      {m.toolCalls?.length ? <div className="chips">{m.toolCalls.map((t) => <span key={t.id} className="chip" dir="ltr">{t.name}</span>)}</div> : null}
    </article>
  );
}

export function ConversationsTab() {
  const [q, setQ] = useState<AdminConversationsQuery>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const list = useAdminConversations(q);
  const detail = useAdminConversation(openId);
  const del = useDeleteConversation();
  const modal = useModal();
  const toast = useToast();
  return (
    <div className="ai-conversations">
      <div className="row">
        <label>משתמש<input value={q.user ?? ''} onChange={(e) => setQ({ ...q, user: e.target.value || undefined })} /></label>
        <label>מתאריך<input type="date" onChange={(e) => setQ({ ...q, from: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>
        <label>עד תאריך<input type="date" onChange={(e) => setQ({ ...q, to: e.target.value ? new Date(e.target.value).toISOString() : undefined })} /></label>
        <label>משוב<select value={q.feedback ?? ''} onChange={(e) => setQ({ ...q, feedback: (e.target.value || undefined) as 'up' | 'down' | undefined })}><option value="">הכל</option><option value="up">חיובי</option><option value="down">שלילי</option></select></label>
        <button type="button" className="btn ghost" onClick={() => void exportConversations(q).then(() => toast('הייצוא הורד', 'ok')).catch(() => toast('הייצוא נכשל', 'warn'))}>ייצוא JSONL</button>
      </div>
      <div className="transcript-layout">
        <table className="table" aria-label="שיחות">
          <thead><tr><th>מתי</th><th>משתמש</th><th>מסמך</th><th>סוג</th><th>הודעות</th><th></th></tr></thead>
          <tbody>
            {(list.data?.items ?? []).map((c) => (
              <tr key={c.id} className={c.id === openId ? 'on' : ''}>
                <td><button type="button" className="linklike" onClick={() => setOpenId(c.id)}>{fmtDate(c.createdAt)}</button></td>
                <td>{c.userName ?? c.userId}</td><td>{c.documentTitle ?? c.documentId ?? '—'}</td><td>{KIND_LABEL[c.kind]}</td><td>{counted(c.messageCount ?? 0, 'messages')}</td>
                <td><button type="button" className="btn xs danger" onClick={async () => {
                  if (!(await modal.confirm('למחוק את השיחה לצמיתות?', 'המחיקה מסירה את התמליל מהמאגר ומהייצוא.'))) return;
                  try { await del.mutateAsync(c.id); if (openId === c.id) setOpenId(null); toast('השיחה נמחקה', 'ok'); } catch { toast('המחיקה נכשלה', 'warn'); }
                }}>מחק</button></td>
              </tr>
            ))}
            {!list.data?.items.length ? <tr><td colSpan={6} className="muted">אין שיחות תואמות.</td></tr> : null}
          </tbody>
        </table>
        {openId ? (
          <section className="transcript" aria-label="תמליל">
            {detail.data ? detail.data.messages.map((m) => <Message key={m.id} m={m} />) : <p className="muted">טוען…</p>}
          </section>
        ) : null}
      </div>
    </div>
  );
}
```
(`counted(n, 'messages')` — add a `messages` entry to `apps/web/src/lib/count.ts` if it lacks one: singular "הודעה אחת", plural "N הודעות". `lib/count.ts` is not on the never-edit list; append only.)

- [ ] **Step 4: Run** — green; build green.
- [ ] **Step 5: Commit** — `feat(web): admin AI conversations browser with export and delete`

---

### Task 7: Route, CSS, gate, lane report

**Files:**
- Modify: `apps/web/src/routes.tsx` (admin child), `apps/web/src/styles/app.css` (append block)
- Create: `.superpowers/sdd/program/X4b-report.md` (git-ignored)

- [ ] **Step 1: Route** — in `routes.tsx`, add the loader constant next to the other admin loaders and the child route after `taxonomy`:
```tsx
const AiPage = () => import('./components/admin/AiPage.js').then((m) => ({ default: m.AiPage }));
// …inside the admin children:
{ path: 'ai', element: lazyRoute(AiPage) },
```
- [ ] **Step 2: CSS** — append to `app.css`:
```css
/* wave 6 — X4b: chat dock, ask pane, admin AI */
.ai-dock { position: sticky; bottom: 0; align-self: end; max-width: 420px; z-index: 5; }
.ai-dock-body { border: 1px solid var(--border); border-radius: var(--r-2); background: var(--surface-1); box-shadow: var(--shadow-2); height: 60vh; display: flex; flex-direction: column; }
.ask-pane { margin-block: 12px; }
.ask-body { border: 1px solid var(--border); border-radius: var(--r-2); padding: 8px; background: var(--surface-1); }
.step-cite { text-decoration: underline dotted; }
.ai-admin .settings-card + .settings-card { margin-top: 12px; }
.ai-textarea { width: 100%; font: inherit; padding: 8px; }
.ai-preview { white-space: pre-wrap; background: var(--surface-2); padding: 12px; border-radius: var(--r-2); max-height: 50vh; overflow: auto; }
.ai-ver-text { max-width: 40ch; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.transcript-layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.transcript { max-height: 70vh; overflow: auto; }
.transcript-msg { border-inline-start: 3px solid var(--border); padding: 6px 10px; margin-block: 8px; }
.transcript-msg.assistant { border-color: var(--purple); }
.transcript-msg.user { border-color: var(--accent); }
@media (max-width: 900px) { .transcript-layout { grid-template-columns: 1fr; } .ai-dock { max-width: 100%; } }
```
(Use the token names actually present in `app.css`; if `--purple`/`--accent`/`--r-2`/`--shadow-2` are named differently, substitute the existing ones.)
- [ ] **Step 3: Gate** — `pnpm --filter @wecom/web build`, `pnpm --filter @wecom/web test -- --minWorkers=1 --maxWorkers=4`, `pnpm lint` (apps/web) and `prettier --check apps/web`. All green.
- [ ] **Step 4: Report** — `.superpowers/sdd/program/X4b-report.md` with: per-task status and commits; exact component names + props + paths; hooks and keys; MSW names; whether the `ChatPane` placeholder was created; deviations; **mount points for X6**:
  - `admin/AdminLayout.tsx` `LINKS`: `['ai', 'בינה מלאכותית', 'ai.manage']` after `identity`.
  - `editor/EditorPage.tsx`: `<EditorChatDock documentId={doc.id} stepKey={selectedStepKey} onInsertStep={insertDraftStep} />` inside `.ed-main` after `HistoryStrip`; `insertDraftStep` maps `DraftStep` onto the editor model's add-step action.
  - `article/ArticlePage.tsx`: `<ArticleAskPane documentId={doc.id} stepKey={currentStepKey} />` directly under `<RefreshBanner …/>` (line ~538), inside the work view only (not the print frame).
  - Replace the `ChatPane` placeholder with X4a's; pass `onDraftStep` if X4a's props differ.
  - Swap every `// X6: api.*` bridge call to the generated client after OpenAPI regen; delete `api/wave6.ts`; dedupe `NumField` if desired.
- [ ] **Step 5: Commit** — `feat(web): /admin/ai route and wave 6 styles`

---

## Self-review

- **Spec coverage:** §1.4 (editor dock + article pane) → Task 3; §1.5 (persisted transcripts, export, delete) → Task 6; §1.7 (admin-editable brief/style with versions, preview) → Task 4; §1.9 (eval runs, acceptance analytics) → Task 5; §6 (tier presets, slots, test, reindex) → Task 4; §4.1/§4.3 admin routes → Tasks 1–2; mounts deliberately left to X6 per §7.
- **Placeholders:** none. The only conditional file is the `ChatPane` placeholder, and the condition (X4a absent on the branch point) plus its deletion are explicit.
- **Type consistency:** hook names in Task 2 match every consumer in Tasks 4–6; `AdminConversationsQuery` is defined once; `TAB_LABELS` ids match the `?tab=` values and the test's expected labels; `counted(n, 'messages')` requires the one `count.ts` addition named in Task 6.
- **Open contract points** (for the controller): see the reply.
