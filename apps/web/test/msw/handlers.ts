/**
 * msw handlers for every stage-1 route. State is mutable so tests can assert side effects
 * (`state.pins`, `state.published`, `state.drafts`, …) and is reset between tests by `setup.ts`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Document, Note, Suggestion } from '@wecom/shared';
import * as fixtures from './fixtures.js';
import { fx } from './fixtures.js';
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
  preferences: { ...fx.me.preferences },
});

export const state: State = initial();

export function resetState(): void {
  Object.assign(state, initial());
}

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });

export const handlers: RequestHandler[] = [
  http.get(`${B}/auth/me`, () => HttpResponse.json({ ...fx.me, preferences: { ...state.preferences } })),
  http.get(`${B}/auth/providers`, () =>
    HttpResponse.json({
      providers: [
        { id: 'entra', label: 'כניסה עם חשבון wecom' },
        { id: 'local', label: 'חשבון מקומי' },
      ],
    }),
  ),
  http.post(`${B}/auth/logout`, () => HttpResponse.json({ ok: true })),
  http.post(`${B}/auth/local`, () => HttpResponse.json({ ok: true })),

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
    const next = { ...d, ...((await request.json()) as object) } as Document;
    state.documents.set(next.id, next);
    return HttpResponse.json(next);
  }),
  http.delete(`${B}/documents/:id`, ({ params }) => {
    state.documents.delete(String(params.id));
    return HttpResponse.json({ ok: true });
  }),
  http.put(`${B}/documents/:id/structure`, async ({ params, request }) => {
    const d = state.documents.get(String(params.id)) ?? fx.docBrowsing;
    const next = { ...d, ...((await request.json()) as object), etag: 'e7b' } as Document;
    state.documents.set(next.id, next);
    return HttpResponse.json(next);
  }),
  http.post(`${B}/documents/:id/publish`, async ({ params, request }) => {
    const body = (await request.json()) as { label: string };
    state.published.push({ id: String(params.id), label: body.label });
    const d = state.documents.get(String(params.id)) ?? fx.docBrowsing;
    const next = { ...d, currentVersion: d.currentVersion + 1, status: 'published', etag: 'e8' } as Document;
    state.documents.set(next.id, next);
    return HttpResponse.json(next);
  }),
  http.get(`${B}/documents/:id/versions`, () => HttpResponse.json(fx.versions)),
  http.get(`${B}/documents/:id/versions/:v`, ({ params }) =>
    HttpResponse.json({ ...fx.docBrowsing, currentVersion: Number(params.v) }),
  ),
  http.post(`${B}/documents/:id/restore/:v`, ({ params }) => {
    const next = { ...fx.docBrowsing, currentVersion: 8, etag: 'e8' };
    state.documents.set(String(params.id), next);
    return HttpResponse.json(next);
  }),
  http.get(`${B}/documents/:id/related`, () =>
    HttpResponse.json([
      {
        documentId: fx.docIntl.id,
        title: fx.docIntl.title,
        category: 'intl',
        why: 'מסלול מקביל · APN, ריענון SIM',
      },
    ]),
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
    HttpResponse.json(state.notes.filter((n) => n.documentId === String(params.id))),
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
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${B}/notes/:id/like`, ({ params }) => {
    const n = state.notes.find((x) => x.id === params.id);
    if (!n) return notFound();
    n.likedByMe = !n.likedByMe;
    n.likes += n.likedByMe ? 1 : -1;
    return HttpResponse.json(n);
  }),
  http.post(`${B}/documents/:id/pin`, ({ params }) => {
    state.pins.add(String(params.id));
    return HttpResponse.json({ pinned: true });
  }),
  http.delete(`${B}/documents/:id/pin`, ({ params }) => {
    state.pins.delete(String(params.id));
    return HttpResponse.json({ pinned: false });
  }),
  http.post(`${B}/documents/:id/view`, ({ params }) => {
    state.views.push(String(params.id));
    return HttpResponse.json({ ok: true });
  }),
  http.get(`${B}/documents/:id/draft`, ({ params }) => {
    const d = state.drafts.get(String(params.id));
    return d
      ? HttpResponse.json({ payload: d, updatedAt: new Date().toISOString(), userId: fx.me.user.id })
      : new HttpResponse(null, { status: 204 });
  }),
  http.put(`${B}/documents/:id/draft`, async ({ request, params }) => {
    const b = (await request.json()) as { payload: unknown };
    state.drafts.set(String(params.id), b.payload);
    return HttpResponse.json({ ok: true, updatedAt: new Date().toISOString() });
  }),
  http.delete(`${B}/documents/:id/draft`, ({ params }) => {
    state.drafts.delete(String(params.id));
    return HttpResponse.json({ ok: true });
  }),

  http.get(`${B}/blocks`, () => HttpResponse.json(fx.blocks)),
  http.post(`${B}/blocks`, async ({ request }) =>
    HttpResponse.json({ ...fx.blocks[0], ...((await request.json()) as object) }),
  ),
  http.put(`${B}/blocks/:id`, async ({ request, params }) =>
    HttpResponse.json({
      ...fx.blocks.find((b) => b.id === params.id),
      ...((await request.json()) as object),
    }),
  ),
  http.delete(`${B}/blocks/:id`, () => HttpResponse.json({ ok: true })),
  http.get(`${B}/blocks/:id/usage`, () =>
    HttpResponse.json([
      {
        documentId: fx.docBrowsing.id,
        title: fx.docBrowsing.title,
        stepKey: 's11',
        stepNum: '11',
        embedded: true,
      },
    ]),
  ),

  http.get(`${B}/fields`, () => HttpResponse.json(fx.fields)),
  http.put(`${B}/fields/:name`, async ({ request, params }) =>
    HttpResponse.json({
      ...fx.fields.find((f) => f.name === decodeURIComponent(String(params.name))),
      ...((await request.json()) as object),
    }),
  ),
  http.get(`${B}/fields/:name/usage`, () =>
    HttpResponse.json([
      {
        documentId: fx.docBrowsing.id,
        title: fx.docBrowsing.title,
        category: 'tech',
        currentVersion: 7,
      },
    ]),
  ),
  http.get(`${B}/scripts`, () => HttpResponse.json(fx.scripts)),

  http.get(`${B}/search`, ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').trim();
    if (!q) return HttpResponse.json({ groups: [], total: 0, tookMs: 1, files: 0 });
    const hits = [
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
    ];
    return HttpResponse.json({
      groups: [{ type: 'steps', hits }],
      total: hits.length,
      tookMs: 4,
      files: 1,
    });
  }),

  http.get(`${B}/trash`, () => HttpResponse.json({ items: state.trash })),
  http.post(`${B}/trash/:type/:id/restore`, ({ params }) => {
    state.trash = state.trash.filter((t) => t.id !== params.id);
    return HttpResponse.json({ ok: true });
  }),
  http.delete(`${B}/trash/:type/:id`, ({ params }) => {
    state.trash = state.trash.filter((t) => t.id !== params.id);
    return HttpResponse.json({ ok: true });
  }),
  http.post(`${B}/trash/restore-all`, () => {
    state.trash = [];
    return HttpResponse.json({ ok: true });
  }),
  http.delete(`${B}/trash`, () => {
    state.trash = [];
    return HttpResponse.json({ ok: true });
  }),

  http.get(`${B}/sources`, () => HttpResponse.json(fx.sources)),
  http.post(`${B}/sources/upload`, () => HttpResponse.json(fx.sources[0])),
  http.post(`${B}/sources/:id/process`, ({ params }) => {
    state.processed.push(String(params.id));
    return HttpResponse.json(fx.sources[0]);
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
  http.post(`${B}/suggestions/:id/:decision`, ({ params }) => {
    const s = state.suggestions.find((x) => x.id === params.id);
    if (!s) return notFound();
    s.status =
      params.decision === 'accept' ? 'accepted' : params.decision === 'reject' ? 'rejected' : 'pending';
    return HttpResponse.json(s);
  }),
  http.put(`${B}/suggestions/:id/edit`, async ({ params, request }) => {
    const s = state.suggestions.find((x) => x.id === params.id);
    if (!s) return notFound();
    const b = (await request.json()) as { editedPayload: Suggestion['payload'] };
    s.editedPayload = b.editedPayload;
    return HttpResponse.json(s);
  }),
  http.post(`${B}/suggestions/publish`, () => {
    let applied = 0;
    state.suggestions.forEach((s) => {
      if (s.status === 'accepted') {
        s.status = 'applied';
        applied++;
      }
    });
    return HttpResponse.json({ applied });
  }),

  http.get(`${B}/me/preferences`, () => HttpResponse.json(state.preferences)),
  http.put(`${B}/me/preferences`, async ({ request }) => {
    state.preferences = (await request.json()) as typeof state.preferences;
    return HttpResponse.json(state.preferences);
  }),

  http.get(`${B}/admin/users`, () =>
    HttpResponse.json({ items: fx.users, total: fx.users.length, page: 1, pageSize: 50 }),
  ),
  http.patch(`${B}/admin/users/:id`, async ({ params, request }) =>
    HttpResponse.json({
      ...fx.users.find((u) => u.id === params.id),
      ...((await request.json()) as object),
    }),
  ),
  http.get(`${B}/admin/roles`, () => HttpResponse.json(fx.roles)),
  http.post(`${B}/admin/roles`, async ({ request }) =>
    HttpResponse.json({
      id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1',
      system: false,
      ...((await request.json()) as object),
    }),
  ),
  http.patch(`${B}/admin/roles/:id`, async ({ params, request }) =>
    HttpResponse.json({
      ...fx.roles.find((r) => r.id === params.id),
      ...((await request.json()) as object),
    }),
  ),
  http.delete(`${B}/admin/roles/:id`, () => HttpResponse.json({ ok: true })),
  http.get(`${B}/admin/groups-map`, () => HttpResponse.json({ entries: fx.groupsMap })),
  http.put(`${B}/admin/groups-map`, async ({ request }) =>
    HttpResponse.json((await request.json()) as object),
  ),
  http.get(`${B}/admin/sessions`, () => HttpResponse.json(fx.sessions)),
  http.delete(`${B}/admin/sessions/:id`, () => HttpResponse.json({ ok: true })),
  http.get(`${B}/admin/audit`, () =>
    HttpResponse.json({ items: fx.audit, total: fx.audit.length, page: 1, pageSize: 50 }),
  ),
  http.get(`${B}/admin/system`, () => HttpResponse.json(fx.system)),
  http.get(`${B}/system/health`, () =>
    HttpResponse.json({ ok: true, db: true, model: false, queue: 0, version: '0.1.0', uptimeSec: 10 }),
  ),
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
