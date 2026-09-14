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
import type { Document, Note, Suggestion } from '@wecom/shared';
import * as fixtures from './fixtures.js';
import { fx } from './fixtures.js';
import { resetStage4State, stage4Handlers } from './stage4.js';
import type { TrashItem } from '../../src/api/types.js';

const B = '/api/v1';

interface State {
  pins: Set<string>;
  notes: Note[];
  suggestions: Suggestion[];
  drafts: Map<string, unknown>;
  published: { id: string; label: string }[];
  trash: TrashItem[];
  documents: Map<string, Document>;
  views: string[];
  processed: string[];
  publishedSources: string[];
  preferences: typeof fx.me.preferences;
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
  views: [],
  processed: [],
  publishedSources: [],
  preferences: { ...fx.me.preferences },
});

export const state: State = initial();

export function resetState(): void {
  Object.assign(state, initial());
  resetStage4State();
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

export const handlers: RequestHandler[] = [
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
    let items = fx.cards.map((c) => ({ ...c, pinned: state.pins.has(c.id) }));
    const cat = u.searchParams.get('category');
    if (cat) items = items.filter((c) => c.category === cat);
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
  http.get(`${B}/fields`, () => HttpResponse.json({ items: fx.fields.map((f) => ({ ...f, usedIn: 1 })) })),
  http.put(`${B}/fields/:name`, async ({ request, params }) =>
    HttpResponse.json({
      ...fx.fields.find((f) => f.name === decodeURIComponent(String(params.name))),
      ...((await request.json()) as object),
    }),
  ),
  http.delete(`${B}/fields/:name`, () => HttpResponse.json({ auditId: AUDIT })),
  // Rows carry `stepKeys: string[]`, not `category`/`currentVersion`.
  http.get(`${B}/fields/:name/usage`, () =>
    HttpResponse.json({
      items: [{ documentId: fx.docBrowsing.id, title: fx.docBrowsing.title, stepKeys: ['s11'] }],
    }),
  ),

  // …and each script with the documents that reference it.
  http.get(`${B}/scripts`, () =>
    HttpResponse.json({
      items: fx.scripts.map((s) => ({
        ...s,
        usedIn: [{ documentId: fx.docBrowsing.id, title: fx.docBrowsing.title }],
      })),
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
  http.delete(`${B}/trash`, () => {
    const purged = state.trash.length;
    state.trash = [];
    return HttpResponse.json({ purged });
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
  http.put(`${B}/me/preferences`, async ({ request }) => {
    state.preferences = (await request.json()) as typeof state.preferences;
    return HttpResponse.json(state.preferences);
  }),

  http.get(`${B}/admin/users`, () =>
    HttpResponse.json({ items: fx.users, total: fx.users.length, page: 1, pageSize: 50 }),
  ),
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
  http.get(`${B}/admin/audit`, () =>
    HttpResponse.json({ items: fx.audit, total: fx.audit.length, page: 1, pageSize: 50 }),
  ),
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

  // Stage 4 — connected data (`test/msw/stage4.ts`), kept in its own module so the two stages
  // can be reviewed apart. Registered last; the patterns are disjoint from everything above.
  ...stage4Handlers,
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
