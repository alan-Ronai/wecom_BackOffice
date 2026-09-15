/**
 * msw handlers for every stage-1 route.
 *
 * These mirror the **published contract** (`docs/api/openapi.json` and the route handlers), not
 * what is convenient for the app: paginated lists answer `{ items, total, page, pageSize }`,
 * unpaginated ones `{ items }`, publish/restore `{ document, version, auditId }`, 204s carry no
 * body, and so on. `fixtures.test.ts` parses each of these responses with the matching
 * `@wecom/shared` response schema, so a handler cannot drift from the contract silently.
 *
 * State is mutable so tests can assert side effects (`state.pins`, `state.published`,
 * `state.drafts`, …) and is reset between tests by `setup.ts`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import { PreferencesSchema, type CrmField, type Document, type Note, type Suggestion } from '@wecom/shared';
import * as fixtures from './fixtures.js';
import { fx, REV_1 } from './fixtures.js';
import { resetStage4State, stage4Handlers } from './stage4.js';
import { resetStage5, stage5Handlers } from './stage5.js';
import { resetStage45, stage45Handlers } from './stage45.js';
import { initialTaxonomy, taxonomyHandlers, type TaxonomyState } from './taxonomy.js';
import { feedbackHandlers, resetFeedbackState } from './feedback-handlers.js';
import type { TrashItem } from '../../src/api/types.js';

const B = '/api/v1';

interface State extends TaxonomyState {
  pins: Set<string>;
  notes: Note[];
  suggestions: Suggestion[];
  drafts: Map<string, unknown>;
  published: { id: string; label: string }[];
  trash: TrashItem[];
  documents: Map<string, Document>;
  fields: CrmField[];
  views: string[];
  processed: string[];
  publishedSources: string[];
  preferences: typeof fx.me.preferences;
  /* wave 4 · W2 governance */
  statusChanges: { id: string; status: string; reason: string }[];
  sourceReviewCleared: { id: string; note: string }[];
  /* wave 4 — source documents (W4) */
  sourceDocs: Map<
    string,
    {
      html: string;
      text: string;
      version: number;
      etag: string;
      versions: { version: number; label: string; html: string }[];
      /** Set for an imported source; the raw-docx download hangs off it. */
      latestRevisionId?: string | null;
    }
  >;
  assets: string[];
  sourceDrafts: Map<string, { html: string; updatedAt: string }>;
}

const initial = (): State => ({
  pins: new Set([fx.docBrowsing.id]),
  notes: fx.notes.map((n) => ({ ...n })),
  suggestions: fx.suggestions.map((s) => ({ ...s })),
  drafts: new Map(),
  published: [],
  trash: fx.trash.map((t) => ({ ...t })),
  documents: new Map([
    [fx.docBrowsing.id, fx.docBrowsing],
    [fx.docIntl.id, fx.docIntl],
  ]),
  fields: fx.fields.map((f) => ({ ...f })),
  views: [],
  processed: [],
  publishedSources: [],
  preferences: { ...fx.me.preferences },
  ...initialTaxonomy(),
  statusChanges: [],
  sourceReviewCleared: [],
  sourceDocs: new Map(),
  assets: [],
  sourceDrafts: new Map(),
});

export const state: State = initial();

export function resetState(): void {
  Object.assign(state, initial());
  resetStage4State();
  resetStage5();
  resetStage45();
  resetFeedbackState();
}

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
/** 204 No Content — an empty body, as the API sends it. */
const noContent = () => new HttpResponse(null, { status: 204 });
const AUDIT = 'aaaaaaaa-0000-4000-8000-00000000aud1';
let etagSeq = 0;
const nextEtag = () => `e-${++etagSeq}`;

/** The envelope `GET|PUT /documents/:id/draft` returns. */
const draftEnvelope = (id: string, payload: unknown) => ({
  draftKey: id,
  documentId: id,
  payload,
  updatedAt: new Date().toISOString(),
  otherEditors: [] as { userId: string; name: string; updatedAt: string }[],
});

/** `GET|PUT /drafts/new/:draftId` — same envelope, but no document exists yet. */
const newDraftEnvelope = (draftKey: string, payload: unknown) => ({
  draftKey,
  documentId: null,
  payload,
  updatedAt: new Date().toISOString(),
  otherEditors: [] as { userId: string; name: string; updatedAt: string }[],
});

export const handlers: RequestHandler[] = [
  // First, so `/feedback/analytics` is matched before any generic `:id` route another lane adds.
  ...feedbackHandlers,
  http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, preferences: { ...state.preferences } })),
  // Bare provider ids plus a fallback — not `{ id, label }` objects.
  http.get(`${B}/auth/providers`, () =>
    HttpResponse.json({ providers: ['entra', 'local'], fallback: 'none' }),
  ),
  http.post(`${B}/auth/logout`, () => HttpResponse.json({ ok: true })),
  http.post(`${B}/auth/local`, async ({ request }) => {
    const b = (await request.json()) as { email?: string; password?: string };
    // The route validates `{ email, password }`; a `username` body is a 400.
    if (!b?.email || !b?.password)
      return HttpResponse.json({ code: 'BAD_REQUEST', message: 'שדות חסרים' }, { status: 400 });
    return HttpResponse.json({ ok: true });
  }),

  http.get(`${B}/documents`, ({ request }) => {
    const u = new URL(request.url);
    // Type-T (script) documents are part of the corpus like anything else since the 0030 fold,
    // and `?docType=T` is what replaced `GET /scripts` for the three readers that used it.
    let items = [...fx.cards, ...fx.scriptCards].map((c) => ({ ...c, pinned: state.pins.has(c.id) }));
    const cat = u.searchParams.get('category');
    if (cat) items = items.filter((c) => c.category === cat);
    const docType = u.searchParams.get('docType');
    if (docType) items = items.filter((c) => c.docType === docType);
    const world = u.searchParams.get('world');
    if (world) items = items.filter((c) => (c.worlds ?? []).includes(world));
    const topic = u.searchParams.get('topic');
    if (topic) items = items.filter((c) => (c.topics ?? []).includes(topic));
    const tags = u.searchParams.getAll('tag');
    if (tags.length) items = items.filter((c) => tags.every((t) => (c.tags ?? []).includes(t)));
    /**
     * `q` — the same free-text narrowing the route does (H2). Until this existed the handler
     * returned the whole fixture set whatever was asked, so a component that filtered client-side
     * and one that sent `q` were indistinguishable in a test: the picker could stay blind to
     * everything past page 1 with every editor spec still green.
     */
    const q = u.searchParams.get('q')?.trim().toLowerCase();
    if (q)
      items = items.filter((c) => [c.title, c.description].some((v) => (v ?? '').toLowerCase().includes(q)));
    if (u.searchParams.get('pinned') === 'true') items = items.filter((c) => c.pinned);
    if (u.searchParams.get('recent') === 'true') items = items.filter((c) => c.views > 0);
    if (u.searchParams.get('drafts') === 'true') items = items.filter((c) => c.status === 'draft');
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),
  http.get(`${B}/documents/:id`, ({ params }) => {
    const d = state.documents.get(String(params.id));
    return d ? HttpResponse.json(d) : notFound();
  }),
  http.post(`${B}/documents`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      ...fx.docBrowsing,
      id: '99999999-9999-4999-8999-999999999999',
      slug: 'new-document',
      phases: [],
      ...body,
      status: 'draft',
      currentVersion: 0,
    } as Document;
    state.documents.set(created.id, created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${B}/documents/:id`, async ({ params, request }) => {
    const d = state.documents.get(String(params.id));
    if (!d) return notFound();
    // Rotates the etag, like the route does.
    const next = { ...d, ...((await request.json()) as object), etag: nextEtag() } as Document;
    state.documents.set(next.id, next);
    return HttpResponse.json(next);
  }),
  http.delete(`${B}/documents/:id`, ({ params }) => {
    state.documents.delete(String(params.id));
    return HttpResponse.json({ auditId: AUDIT, restoreUntil: new Date(Date.now() + 6e8).toISOString() });
  }),
  // If-Match is required (428) and must be current (412) — the etag is the only thing stopping
  // one editor's structure save from clobbering another's. PATCH rotates it, so a patch-then-save
  // flow has to thread the *patched* etag through.
  http.put(`${B}/documents/:id/structure`, async ({ params, request }) => {
    const d = state.documents.get(String(params.id));
    if (!d) return notFound();
    const ifMatch = request.headers.get('if-match');
    if (!ifMatch)
      return HttpResponse.json(
        { code: 'IF_MATCH_REQUIRED', message: 'נדרשת כותרת If-Match עם ה-etag של המסמך' },
        { status: 428 },
      );
    if (ifMatch !== d.etag)
      return HttpResponse.json(
        { code: 'PRECONDITION_FAILED', message: 'המסמך השתנה בינתיים' },
        { status: 412 },
      );
    const next = { ...d, ...((await request.json()) as object), etag: nextEtag() } as Document;
    state.documents.set(next.id, next);
    return HttpResponse.json(next);
  }),
  // `{ document, version, auditId }` — not a bare Document.
  http.post(`${B}/documents/:id/publish`, async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as { label: string };
    state.published.push({ id, label: body.label });
    const d = state.documents.get(id);
    if (!d) return notFound();
    const document = {
      ...d,
      currentVersion: d.currentVersion + 1,
      status: 'published',
      etag: 'e8',
    } as Document;
    state.documents.set(id, document);
    return HttpResponse.json({ document, version: document.currentVersion, auditId: AUDIT });
  }),
  http.get(`${B}/documents/:id/versions`, () => HttpResponse.json({ items: fx.versions })),
  http.get(`${B}/documents/:id/versions/:v`, ({ params }) =>
    HttpResponse.json({ ...fx.docBrowsing, currentVersion: Number(params.v) }),
  ),
  http.get(`${B}/documents/:id/diff`, ({ request }) => {
    const u = new URL(request.url);
    const from = Number(u.searchParams.get('from') ?? 6);
    const to = Number(u.searchParams.get('to') ?? 7);
    return HttpResponse.json({
      from,
      to,
      rows: [
        {
          kind: 'changed',
          oldStep: { key: 's11', num: '11', titleHtml: 'ריענון SIM', lines: ['הנחיית ריענון'] },
          newStep: { key: 's11', num: '11', titleHtml: 'ריענון SIM', lines: ['הנחיית ריענון מעודכנת'] },
          blame: { version: to, author: 'ענבר ל.' },
        },
      ],
      stats: { changed: 1, added: 0, removed: 0 },
    });
  }),
  http.post(`${B}/documents/:id/restore/:v`, ({ params }) => {
    const document = { ...fx.docBrowsing, currentVersion: 8, etag: 'e8' };
    state.documents.set(String(params.id), document);
    return HttpResponse.json({ document, version: 8, auditId: AUDIT });
  }),
  http.get(`${B}/documents/:id/related`, () =>
    HttpResponse.json({
      items: [
        {
          documentId: fx.docIntl.id,
          title: fx.docIntl.title,
          category: 'intl',
          why: 'מסלול מקביל · APN, ריענון SIM',
        },
      ],
    }),
  ),
  http.get(`${B}/documents/:id/links`, ({ params }) =>
    HttpResponse.json({
      out: [
        {
          fromDocumentId: String(params.id),
          fromStepKey: 's11',
          toDocumentId: null,
          toBlockId: fx.blocks[0].id,
          toFieldName: null,
          toSourceId: null,
          type: 'shares_block',
          origin: 'detected',
        },
      ],
      in: [],
    }),
  ),
  http.get(`${B}/documents/:id/notes`, ({ params }) =>
    HttpResponse.json({ items: state.notes.filter((n) => n.documentId === String(params.id)) }),
  ),
  http.post(`${B}/documents/:id/notes`, async ({ request, params }) => {
    const b = (await request.json()) as { stepKey: string | null; text: string };
    const n: Note = {
      id: crypto.randomUUID(),
      documentId: String(params.id),
      stepKey: b.stepKey ?? null,
      authorId: fx.me.user.id,
      authorName: fx.me.user.displayName,
      text: b.text,
      likes: 0,
      likedByMe: false,
      createdAt: new Date().toISOString(),
    };
    state.notes.push(n);
    return HttpResponse.json(n, { status: 201 });
  }),
  http.delete(`${B}/notes/:id`, ({ params }) => {
    state.notes = state.notes.filter((n) => n.id !== params.id);
    return noContent();
  }),
  // Only the new counter pair comes back, not the whole note.
  http.post(`${B}/notes/:id/like`, ({ params }) => {
    const n = state.notes.find((x) => x.id === params.id);
    if (!n) return notFound();
    n.likedByMe = !n.likedByMe;
    n.likes += n.likedByMe ? 1 : -1;
    return HttpResponse.json({ likes: n.likes, likedByMe: n.likedByMe });
  }),
  http.post(`${B}/documents/:id/pin`, ({ params }) => {
    state.pins.add(String(params.id));
    return noContent();
  }),
  http.delete(`${B}/documents/:id/pin`, ({ params }) => {
    state.pins.delete(String(params.id));
    return noContent();
  }),
  http.post(`${B}/documents/:id/view`, ({ params }) => {
    state.views.push(String(params.id));
    return noContent();
  }),
  http.get(`${B}/documents/:id/draft`, ({ params }) => {
    const id = String(params.id);
    const d = state.drafts.get(id);
    return d === undefined ? noContent() : HttpResponse.json(draftEnvelope(id, d));
  }),
  http.put(`${B}/documents/:id/draft`, async ({ request, params }) => {
    const id = String(params.id);
    const b = (await request.json()) as { payload: unknown };
    state.drafts.set(id, b.payload);
    return HttpResponse.json(draftEnvelope(id, b.payload));
  }),
  /**
   * The server-side draft behind `/edit/new`. Note the different envelope key: `documentId` is
   * null because the document does not exist yet.
   */
  http.get(`${B}/drafts/new/:draftId`, ({ params }) => {
    const key = `new:${String(params.draftId)}`;
    const payload = state.drafts.get(key);
    return payload === undefined ? noContent() : HttpResponse.json(newDraftEnvelope(key, payload));
  }),
  http.put(`${B}/drafts/new/:draftId`, async ({ request, params }) => {
    const key = `new:${String(params.draftId)}`;
    const { payload } = (await request.json()) as { payload: unknown };
    state.drafts.set(key, payload);
    return HttpResponse.json(newDraftEnvelope(key, payload));
  }),
  http.delete(`${B}/drafts/new/:draftId`, ({ params }) => {
    state.drafts.delete(`new:${String(params.draftId)}`);
    return HttpResponse.json({ auditId: AUDIT });
  }),
  http.get(`${B}/drafts`, () =>
    HttpResponse.json({
      items: [...state.drafts.keys()].map((k) => ({
        draftKey: k,
        documentId: k.startsWith('new:') ? null : k,
        title: k.startsWith('new:') ? 'פריט ידע חדש' : (state.documents.get(k)?.title ?? ''),
        updatedAt: new Date().toISOString(),
      })),
    }),
  ),
  http.delete(`${B}/documents/:id/draft`, ({ params }) => {
    state.drafts.delete(String(params.id));
    return noContent();
  }),

  http.get(`${B}/blocks`, () => HttpResponse.json({ items: fx.blocks })),
  http.post(`${B}/blocks`, async ({ request }) =>
    HttpResponse.json({ ...fx.blocks[0], ...((await request.json()) as object) }),
  ),
  http.get(`${B}/blocks/:id`, ({ params }) => {
    const b = fx.blocks.find((x) => x.id === params.id);
    return b ? HttpResponse.json(b) : notFound();
  }),
  http.put(`${B}/blocks/:id`, async ({ request, params }) =>
    HttpResponse.json({
      ...fx.blocks.find((b) => b.id === params.id),
      ...((await request.json()) as object),
    }),
  ),
  http.delete(`${B}/blocks/:id`, () =>
    HttpResponse.json({ auditId: AUDIT, restoreUntil: new Date(Date.now() + 6e8).toISOString() }),
  ),
  // Rows carry `mode: 'embedded' | 'reference'`, inside an `{ items }` envelope.
  http.get(`${B}/blocks/:id/usage`, () =>
    HttpResponse.json({
      items: [
        {
          documentId: fx.docBrowsing.id,
          title: fx.docBrowsing.title,
          stepKey: 's11',
          stepNum: '11',
          mode: 'embedded',
        },
      ],
    }),
  ),

  // The list endpoint enriches each field with a `usedIn` count (the element schema has none).
  http.get(`${B}/fields`, () => HttpResponse.json({ items: state.fields.map((f) => ({ ...f, usedIn: 1 })) })),
  http.put(`${B}/fields/:name`, async ({ request, params }) =>
    HttpResponse.json({
      ...fx.fields.find((f) => f.name === decodeURIComponent(String(params.name))),
      ...((await request.json()) as object),
    }),
  ),
  http.delete(`${B}/fields/:name`, ({ params }) => {
    state.fields = state.fields.filter((f) => f.name !== decodeURIComponent(String(params.name)));
    return HttpResponse.json({ auditId: AUDIT });
  }),
  // Rows carry `stepKeys: string[]`, not `category`/`currentVersion`.
  http.get(`${B}/fields/:name/usage`, () =>
    HttpResponse.json({
      items: [{ documentId: fx.docBrowsing.id, title: fx.docBrowsing.title, stepKeys: ['s11'] }],
    }),
  ),

  http.get(`${B}/search`, ({ request }) => {
    const u = new URL(request.url);
    const q = (u.searchParams.get('q') ?? '').trim();
    if (!q) return HttpResponse.json({ groups: [], total: 0, tookMs: 1, files: 0 });
    // `types` is a comma-separated list of *group* names, and the real API honours it.
    const types = u.searchParams.get('types');
    const want = types ? new Set(types.split(',').map((t) => t.trim())) : null;
    const groups = [
      {
        type: 'steps' as const,
        hits: [
          {
            type: 'step' as const,
            id: `${fx.docBrowsing.id}#s11`,
            documentId: fx.docBrowsing.id,
            stepKey: 's11',
            num: '11',
            title: 'ריענון SIM',
            snippet: 'בתוך איטיות גלישה',
            meta: 'topics.json · תמיכה טכנית',
            score: 80,
            // A-2, appended with the contract: the knowledge item behind the hit. `meta` keeps
            // its ingest filename on purpose — the point of the fix is that the client now has
            // something better to render and no longer has to show it.
            docType: 'M' as const,
            world: 'tech',
            docTitle: fx.docBrowsing.title,
          },
        ],
      },
      {
        type: 'documents' as const,
        hits: [
          {
            type: 'document' as const,
            id: fx.docBrowsing.id,
            documentId: fx.docBrowsing.id,
            title: fx.docBrowsing.title,
            snippet: fx.docBrowsing.description,
            meta: 'topics.json · תמיכה טכנית',
            score: 60,
            docType: 'M' as const,
            world: 'tech',
            docTitle: fx.docBrowsing.title,
          },
        ],
      },
    ].filter((g) => !want || want.has(g.type));
    return HttpResponse.json({
      groups,
      total: groups.reduce((a, g) => a + g.hits.length, 0),
      tookMs: 4,
      files: 1,
    });
  }),

  http.get(`${B}/trash`, () => HttpResponse.json({ items: state.trash })),
  http.post(`${B}/trash/:type/:id/restore`, ({ params }) => {
    state.trash = state.trash.filter((t) => t.id !== params.id);
    return HttpResponse.json({ auditId: AUDIT });
  }),
  http.delete(`${B}/trash/:type/:id`, ({ params }) => {
    state.trash = state.trash.filter((t) => t.id !== params.id);
    return noContent();
  }),
  http.post(`${B}/trash/restore-all`, () => {
    const restored = state.trash.length;
    state.trash = [];
    return HttpResponse.json({ restored });
  }),
  // A-C1: the route now answers `{ purged, skipped }` — a once-published item is never purged by
  // hand, so "empty the bin" cannot promise it emptied. Nothing in the fixture is skipped; a test
  // that wants the skipped path overrides this handler.
  http.delete(`${B}/trash`, () => {
    const purged = state.trash.length;
    state.trash = [];
    return HttpResponse.json({ purged, skipped: 0 });
  }),

  http.get(`${B}/sources`, () => HttpResponse.json({ items: fx.sources })),
  http.post(`${B}/sources/upload`, () =>
    HttpResponse.json({
      sourceId: fx.sources[0].id,
      revisionId: fx.revision.id,
      duplicate: false,
      kind: 'docx',
      paragraphs: fx.revision.paragraphs.length,
    }),
  ),
  http.post(`${B}/sources/:id/process`, ({ params }) => {
    state.processed.push(String(params.id));
    return HttpResponse.json({ revisionId: fx.revision.id, created: 2, used: 'heuristics' });
  }),
  http.get(`${B}/sources/:id/revisions/:rev`, () => HttpResponse.json(fx.revision)),

  http.get(`${B}/suggestions`, () =>
    HttpResponse.json({
      items: state.suggestions,
      total: state.suggestions.length,
      page: 1,
      pageSize: 50,
    }),
  ),
  // Three concrete routes, not one templated `:decision` segment.
  ...(['accept', 'reject', 'reset'] as const).map((decision) =>
    http.post(`${B}/suggestions/:id/${decision}`, ({ params }) => {
      const s = state.suggestions.find((x) => x.id === params.id);
      if (!s) return notFound();
      s.status = decision === 'accept' ? 'accepted' : decision === 'reject' ? 'rejected' : 'pending';
      return HttpResponse.json(s);
    }),
  ),
  http.put(`${B}/suggestions/:id/edit`, async ({ params, request }) => {
    const s = state.suggestions.find((x) => x.id === params.id);
    if (!s) return notFound();
    const b = (await request.json()) as { editedPayload: Suggestion['payload'] };
    s.editedPayload = b.editedPayload;
    return HttpResponse.json(s);
  }),
  // `{ sourceId }` is required, and the result carries the created version ids.
  http.post(`${B}/suggestions/publish`, async ({ request }) => {
    const b = (await request.json().catch(() => null)) as { sourceId?: string } | null;
    if (!b?.sourceId)
      return HttpResponse.json({ code: 'BAD_REQUEST', message: 'sourceId חסר' }, { status: 400 });
    state.publishedSources.push(b.sourceId);
    const versions: string[] = [];
    state.suggestions.forEach((s) => {
      if (s.status === 'accepted') {
        s.status = 'applied';
        versions.push(`${s.targetDocumentId ?? fx.docBrowsing.id}@8`);
      }
    });
    return HttpResponse.json({ applied: versions.length, versions });
  }),

  http.get(`${B}/me/preferences`, () => HttpResponse.json(state.preferences)),
  // The route validates with `PreferencesSchema`, and zod strips whatever the schema does not
  // declare — so the mock parses with the same schema and cannot round-trip a key production
  // would drop. `PreferencesSchema` now carries the QOL keys (density, libraryView, savedViewId,
  // lastSeen, tourDone), so those do survive here, exactly as they survive on the server.
  http.put(`${B}/me/preferences`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    state.preferences = PreferencesSchema.parse(body);
    return HttpResponse.json(state.preferences);
  }),

  // `GET /admin/users` lives in `stage5.ts` — stage 5 changed its row shape and added filters.
  // `{ ok, auditId }` — the caller re-reads the user from the invalidated list.
  http.patch(`${B}/admin/users/:id`, () => HttpResponse.json({ ok: true, auditId: AUDIT })),
  http.get(`${B}/admin/roles`, () => HttpResponse.json({ items: fx.roles })),
  http.post(`${B}/admin/roles`, async ({ request }) =>
    HttpResponse.json({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      system: false,
      ...((await request.json()) as object),
      auditId: AUDIT,
    }),
  ),
  http.patch(`${B}/admin/roles/:id`, async ({ params, request }) =>
    HttpResponse.json({
      ...fx.roles.find((r) => r.id === params.id),
      ...((await request.json()) as object),
      auditId: AUDIT,
    }),
  ),
  http.delete(`${B}/admin/roles/:id`, () => HttpResponse.json({ ok: true, auditId: AUDIT })),
  http.get(`${B}/admin/groups-map`, () => HttpResponse.json({ entries: fx.groupsMap })),
  http.put(`${B}/admin/groups-map`, () => HttpResponse.json({ ok: true, auditId: AUDIT })),
  http.get(`${B}/admin/sessions`, () => HttpResponse.json({ items: fx.sessions })),
  http.delete(`${B}/admin/sessions/:id`, () => HttpResponse.json({ ok: true, auditId: AUDIT })),
  http.get(`${B}/admin/audit`, ({ request }) => {
    const u = new URL(request.url);
    const actorId = u.searchParams.get('actorId');
    const entityType = u.searchParams.get('entityType');
    const from = u.searchParams.get('from');
    let items = fx.audit;
    if (actorId) items = items.filter((e) => e.actorId === actorId);
    if (entityType) items = items.filter((e) => e.entityType === entityType);
    if (from) items = items.filter((e) => e.at >= from);
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),
  http.get(`${B}/admin/system`, () => HttpResponse.json(fx.system)),
  http.post(`${B}/admin/users`, async ({ request }) => {
    const b = (await request.json()) as { email: string; displayName: string };
    return HttpResponse.json(
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        subject: b.email,
        source: 'local',
        email: b.email,
        displayName: b.displayName,
        initials: b.displayName.slice(0, 1),
        active: true,
        lastLoginAt: null,
        roles: [],
      },
      { status: 201 },
    );
  }),
  http.get(`${B}/system/health`, () => HttpResponse.json(fx.health)),

  // Wave 4 · usage analytics (W5). `?world=` narrows to that world's items; the fixture has none
  // outside `tech`, so a filtered request answers with the item tables empty.
  http.get(`${B}/analytics/usage`, ({ request }) => {
    const world = new URL(request.url).searchParams.get('world');
    return HttpResponse.json(
      world ? { ...fx.usageAnalytics, itemViews: [], topItems: [] } : fx.usageAnalytics,
    );
  }),
  http.get(`${B}/analytics/search-log`, () => HttpResponse.json(fx.searchLog)),

  // Stage 4 — connected data (`test/msw/stage4.ts`), kept in its own module so the two stages
  // can be reviewed apart. Registered last; the patterns are disjoint from everything above.
  ...stage4Handlers,
  ...stage5Handlers,
  /* Stage 4–5 routes, typed from the zod contract — see `test/msw/stage45.ts`. */
  ...stage45Handlers,
  /* Wave 4 — taxonomy (W1), typed from the zod contract — see `test/msw/taxonomy.ts`. */
  ...taxonomyHandlers(state),

  /* ── wave 4 · W2 governance (appended) ─────────────────────────────────
   * `POST /documents/:id/status` and `POST /documents/:id/source-review/clear` per
   * `docs/api/CONTRACTS-wave4.md`. Both answer the full updated document, and both record the
   * request on `state` so component tests can assert what was actually sent. Registered after the
   * stage handlers; the patterns are disjoint from everything above.
   * `GET /users/mentionable`, which `OwnerFields` reads, is already served by `stage45Handlers`. */
  http.post(`${B}/documents/:id/status`, async ({ params, request }) => {
    const b = (await request.json()) as { status: Document['status']; reason: string };
    const id = params.id as string;
    const doc = state.documents.get(id);
    if (!doc) return notFound();
    state.statusChanges.push({ id, status: b.status, reason: b.reason });
    const next: Document = { ...doc, status: b.status, etag: nextEtag() };
    state.documents.set(id, next);
    return HttpResponse.json(next);
  }),
  http.post(`${B}/documents/:id/source-review/clear`, async ({ params, request }) => {
    const b = (await request.json()) as { note: string };
    const id = params.id as string;
    const doc = state.documents.get(id);
    if (!doc) return notFound();
    state.sourceReviewCleared.push({ id, note: b.note });
    const next: Document = {
      ...doc,
      sourceReviewNeeded: false,
      sourceReviewReason: null,
      etag: nextEtag(),
    };
    state.documents.set(id, next);
    return HttpResponse.json(next);
  }),

  /* ── wave 4 · source documents (W4) ───────────────────────────────────────
   * Shapes are `SourceDocumentSchema` / `SourceDocumentVersionsResponseSchema` / `AssetSchema`
   * from `@wecom/shared` — see `test/source/sourcedocs-contract.test.ts`, which parses each of
   * these responses so the mock cannot drift from `docs/api/CONTRACTS-wave4.md`. */
  http.get(`${B}/documents/:id/source`, ({ params }) => {
    const s = state.sourceDocs.get(String(params.id));
    if (!s) return noContent();
    return HttpResponse.json(
      {
        documentId: params.id,
        html: s.html,
        text: s.text,
        version: s.version,
        etag: s.etag,
        updatedById: fx.me.user.id,
        updatedByName: fx.me.user.displayName,
        updatedAt: '2026-09-14T10:00:00.000Z',
        // W4: the revision behind the current version, which is what makes the raw docx
        // download reachable. Null for a source authored in the editor rather than imported.
        latestRevisionId: s.latestRevisionId ?? null,
      },
      { headers: { etag: s.etag } },
    );
  }),
  http.put(`${B}/documents/:id/source`, async ({ params, request }) => {
    const id = String(params.id);
    const body = (await request.json()) as { html: string; label?: string };
    const cur = state.sourceDocs.get(id);
    const ifMatch = request.headers.get('if-match');
    // B-I3: on an *existing* source the header is mandatory, so a client that forgets it gets a
    // 428 rather than silently clobbering someone else's version.
    if (cur && !ifMatch)
      return HttpResponse.json({ code: 'IF_MATCH_REQUIRED', message: 'if-match required' }, { status: 428 });
    if (cur && ifMatch !== cur.etag)
      return HttpResponse.json({ code: 'ETAG_MISMATCH', message: 'stale' }, { status: 412 });
    const version = (cur?.version ?? 0) + 1;
    const next = {
      html: body.html,
      text: body.html.replace(/<[^>]+>/g, ''),
      version,
      etag: 'e' + version,
      versions: [...(cur?.versions ?? []), { version, label: body.label ?? '', html: body.html }],
      latestRevisionId: cur?.latestRevisionId ?? null,
    };
    state.sourceDocs.set(id, next);
    state.sourceDrafts.delete(id); // a saved version clears the autosave
    return HttpResponse.json(
      {
        documentId: id,
        html: next.html,
        text: next.text,
        version,
        etag: next.etag,
        updatedById: fx.me.user.id,
        updatedByName: fx.me.user.displayName,
        updatedAt: '2026-09-14T10:00:00.000Z',
        latestRevisionId: next.latestRevisionId,
      },
      { headers: { etag: next.etag } },
    );
  }),
  http.get(`${B}/documents/:id/source/versions`, ({ params }) =>
    HttpResponse.json({
      items: (state.sourceDocs.get(String(params.id))?.versions ?? [])
        .map((v) => ({
          documentId: params.id,
          version: v.version,
          label: v.label,
          authorId: fx.me.user.id,
          authorName: fx.me.user.displayName,
          createdAt: '2026-09-14T10:00:00.000Z',
          sourceRevisionId: null,
        }))
        .reverse(),
    }),
  ),
  http.get(`${B}/documents/:id/source/versions/:v`, ({ params }) => {
    const v = state.sourceDocs.get(String(params.id))?.versions.find((x) => x.version === Number(params.v));
    if (!v) return notFound();
    return HttpResponse.json({
      documentId: params.id,
      html: v.html,
      text: v.html.replace(/<[^>]+>/g, ''),
      version: v.version,
      etag: 'e' + v.version,
      updatedById: null,
      updatedByName: null,
      updatedAt: '2026-09-14T10:00:00.000Z',
      latestRevisionId: null,
    });
  }),
  http.post(`${B}/documents/:id/source/restore/:v`, ({ params }) => {
    const id = String(params.id);
    const cur = state.sourceDocs.get(id);
    const from = cur?.versions.find((x) => x.version === Number(params.v));
    if (!cur || !from) return notFound();
    const version = cur.version + 1;
    const next = {
      html: from.html,
      text: from.html.replace(/<[^>]+>/g, ''),
      version,
      etag: 'e' + version,
      versions: [...cur.versions, { version, label: `שוחזר מגרסה ${from.version}`, html: from.html }],
      latestRevisionId: cur.latestRevisionId ?? null,
    };
    state.sourceDocs.set(id, next);
    return HttpResponse.json({
      documentId: id,
      html: next.html,
      text: next.text,
      version,
      etag: next.etag,
      updatedById: fx.me.user.id,
      updatedByName: fx.me.user.displayName,
      updatedAt: '2026-09-14T10:00:00.000Z',
      latestRevisionId: next.latestRevisionId,
    });
  }),
  http.post(`${B}/documents/:id/source/import`, async ({ params, request }) => {
    const id = String(params.id);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File))
      return HttpResponse.json({ code: 'BAD_DOCX', message: 'קובץ חסר' }, { status: 400 });
    const cur = state.sourceDocs.get(id);
    const version = (cur?.version ?? 0) + 1;
    const html = `<h1>${file.name.replace(/\.docx$/i, '')}</h1>`;
    const next = {
      html,
      text: html.replace(/<[^>]+>/g, ''),
      version,
      etag: 'e' + version,
      versions: [...(cur?.versions ?? []), { version, label: 'יובא מ-Word', html }],
      // An import is exactly the case that has a raw revision behind it.
      latestRevisionId: REV_1,
    };
    state.sourceDocs.set(id, next);
    return HttpResponse.json({
      documentId: id,
      html: next.html,
      text: next.text,
      version,
      etag: next.etag,
      updatedById: fx.me.user.id,
      updatedByName: fx.me.user.displayName,
      updatedAt: '2026-09-14T10:00:00.000Z',
      latestRevisionId: next.latestRevisionId,
    });
  }),
  http.post(`${B}/assets`, () => {
    const id = crypto.randomUUID();
    state.assets.push(id);
    return HttpResponse.json({
      id,
      url: '/api/v1/assets/' + id,
      mime: 'image/png',
      size: 3,
      width: null,
      height: null,
    });
  }),
  http.get(`${B}/documents/:id/source/draft`, ({ params }) => {
    const d = state.sourceDrafts.get(String(params.id));
    return d ? HttpResponse.json(d) : noContent();
  }),
  http.put(`${B}/documents/:id/source/draft`, async ({ params, request }) => {
    const b = (await request.json()) as { html: string };
    state.sourceDrafts.set(String(params.id), { html: b.html, updatedAt: new Date().toISOString() });
    return noContent();
  }),
  http.delete(`${B}/documents/:id/source/draft`, ({ params }) => {
    state.sourceDrafts.delete(String(params.id));
    return noContent();
  }),
];

/** Override `/auth/me` for permission tests. */
export const withMe = (partial: Partial<typeof fx.me>): RequestHandler =>
  http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, ...partial }));

/** Make one route answer 403 so denial paths can be asserted. */
export const asDenied = (method: 'get' | 'post' | 'put' | 'delete', path: string): RequestHandler =>
  http[method](`${B}${path}`, () =>
    HttpResponse.json({ code: 'FORBIDDEN', message: 'אין הרשאה' }, { status: 403 }),
  );

export { fixtures };
