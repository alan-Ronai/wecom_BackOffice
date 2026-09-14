/**
 * msw handlers for the stage 4–5 routes (`docs/api/CONTRACTS-stage4-5.md`).
 *
 * These routes are not in `docs/api/openapi.json` yet — backend lanes A and B are landing them
 * concurrently — so the fixtures here are validated against the **zod contract** in
 * `packages/shared/src/schemas/stage45.ts` by `test/msw/stage45.test.ts`, exactly as the generated
 * routes are validated against their response schemas by `fixtures.test.ts`.
 *
 * State is mutable so tests can assert side effects (a comment posted, a view saved, a bulk pin
 * applied) and is reset between tests by `resetStage45()`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { z } from 'zod';
import { TelemetryBatchSchema } from '@wecom/shared';
import type {
  Comment,
  MentionCandidateSchema,
  Notification,
  Presence,
  ReviewRequest,
  SavedView,
  Template,
} from '@wecom/shared';
import { fx, D_BROWSING, D_INTL, U1, U2 } from './fixtures.js';
import { stage4State } from './stage4.js';

type MentionCandidate = z.infer<typeof MentionCandidateSchema>;

const B = '/api/v1';
const T = '2025-06-12T12:48:00.000Z';

export const N1 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
export const N2 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
export const N3 = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
export const CMT_1 = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
export const VIEW_1 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
export const TPL_STEPS = 'ffffffff-ffff-4fff-8fff-fffffffffff1';
export const TPL_RETENTION = 'ffffffff-ffff-4fff-8fff-fffffffffff2';
export const REVIEW_1 = 'abababab-abab-4bab-8bab-abababababa1';

const notifications = (): Notification[] => [
  {
    id: N1,
    kind: 'suggestion',
    title: '3 הצעות חדשות מ"נהלי תמיכה טכנית"',
    body: '§4.8, §4.9, §5.2',
    href: '/sources',
    entityType: 'source',
    entityId: fx.sources[0].id,
    createdAt: T,
    readAt: null,
  },
  {
    id: N2,
    kind: 'sync',
    title: 'קונפליקט סנכרון',
    body: 'איטיות גלישה §8 · WordPress',
    href: '/sync',
    entityType: 'document',
    entityId: D_BROWSING,
    createdAt: T,
    readAt: null,
  },
  {
    id: N3,
    kind: 'mention',
    title: 'דנה הזכירה אותך בשלב 8 של איטיות גלישה',
    body: '@ענבר אפשר להוסיף פעולה לפני?',
    href: `/doc/${D_BROWSING}/s8`,
    entityType: 'document',
    entityId: D_BROWSING,
    createdAt: T,
    readAt: T,
  },
];

const comments = (): Comment[] => [
  {
    id: CMT_1,
    documentId: D_BROWSING,
    stepKey: 's8',
    authorId: U2,
    authorName: 'דנה ר.',
    authorInitials: 'ד',
    text: 'Speedtest חוסם ב-Wi-Fi של הלקוח — @ענבר ל. אפשר להוסיף פעולה לפני?',
    mentions: [{ userId: U1, displayName: 'ענבר ל.' }],
    resolvedAt: null,
    resolvedByName: null,
    createdAt: T,
    likes: 2,
    likedByMe: false,
  },
];

export const mentionable: MentionCandidate[] = [
  { id: U1, displayName: 'ענבר ל.', initials: 'ע', email: 'inbar@wecom.co.il' },
  { id: U2, displayName: 'דנה ר.', initials: 'ד', email: 'dana@wecom.co.il' },
  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3', displayName: 'אלון ב.', initials: 'א', email: null },
];

const views = (): SavedView[] => [
  {
    id: VIEW_1,
    name: 'חו"ל',
    query: { category: 'intl' },
    shared: true,
    ownerId: U1,
    ownerName: 'ענבר ל.',
    createdAt: T,
  },
];

const templates = (): Template[] => [
  {
    id: TPL_STEPS,
    name: 'נוהל טכני',
    description: '13 שלבים · 2 מסלולים · תוצאות: הסתדר / הסלמה',
    category: 'tech',
    kind: 'steps',
    builtIn: true,
    updatedAt: T,
    phases: [
      {
        id: 'p1',
        label: 'שלב 1 – מסנן',
        steps: [
          {
            key: 't1',
            num: '1',
            title: 'ודא זיהוי הלקוח',
            blockRefs: [],
            deps: [],
            actions: [{ id: 'a1', text: 'בקש מספר מנוי ות.ז.' }],
            outcomes: [{ kind: 'next', text: 'זוהה' }],
          },
        ],
      },
    ],
  },
  {
    id: TPL_RETENTION,
    name: 'שימור',
    description: '3 סיבות עזיבה + סגירה · תסריטים מובנים',
    category: null,
    kind: 'retention',
    builtIn: true,
    updatedAt: T,
    phases: [
      {
        id: 'p1',
        label: 'זיהוי סיבה',
        steps: [
          {
            key: 't1',
            num: '1',
            title: 'מה גרם לפנייה?',
            blockRefs: [],
            deps: [],
            actions: [],
            outcomes: [],
          },
        ],
      },
    ],
  },
];

const reviews = (): (ReviewRequest & { title: string; category: 'tech' | 'intl' })[] => [
  {
    id: REVIEW_1,
    documentId: D_INTL,
    requestedBy: U2,
    requestedByName: 'דנה ר.',
    note: 'עדכנתי את שלב 4 לפי §4.9',
    status: 'open',
    decidedBy: null,
    decidedByName: null,
    decisionNote: null,
    createdAt: T,
    decidedAt: null,
    title: fx.docIntl.title,
    category: 'intl',
  },
];

interface Stage45State {
  notifications: Notification[];
  comments: Comment[];
  views: SavedView[];
  templates: Template[];
  reviews: ReturnType<typeof reviews>;
  presence: Record<string, Presence['editors']>;
  telemetry: { kind: string; documentId?: string; stepKey?: string }[];
  heartbeats: string[];
  bulk: { action: string; ids: string[] }[];
}

const initial = (): Stage45State => ({
  notifications: notifications(),
  comments: comments(),
  views: views(),
  templates: templates(),
  reviews: reviews(),
  presence: {
    [D_BROWSING]: [{ userId: U2, displayName: 'דנה ר.', initials: 'ד', since: T, lastSeenAt: T }],
  },
  telemetry: [],
  heartbeats: [],
  bulk: [],
});

export const stage45State: Stage45State = initial();
export function resetStage45(): void {
  Object.assign(stage45State, initial());
}

const uuid = (n: number) => `9a9a9a9a-9a9a-4a9a-8a9a-${String(n).padStart(12, '0')}`;
let seq = 0;
const noContent = () => new HttpResponse(null, { status: 204 });
const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });

export const stage45Handlers: RequestHandler[] = [
  /* ── notifications ────────────────────────────────────────────────────── */
  http.get(`${B}/notifications`, ({ request }) => {
    const unreadOnly = new URL(request.url).searchParams.get('unread') === 'true';
    const all = stage45State.notifications;
    const items = unreadOnly ? all.filter((n) => !n.readAt) : all;
    return HttpResponse.json({
      items,
      total: items.length,
      page: 1,
      pageSize: 50,
      unread: all.filter((n) => !n.readAt).length,
    });
  }),
  http.post(`${B}/notifications/read`, async ({ request }) => {
    const body = (await request.json()) as { ids?: string[]; all?: boolean };
    const at = new Date().toISOString();
    stage45State.notifications = stage45State.notifications.map((n) =>
      body.all || body.ids?.includes(n.id) ? { ...n, readAt: n.readAt ?? at } : n,
    );
    return HttpResponse.json({ unread: stage45State.notifications.filter((n) => !n.readAt).length });
  }),

  /* ── mentions & comments ──────────────────────────────────────────────── */
  http.get(`${B}/users/mentionable`, ({ request }) => {
    const q = (new URL(request.url).searchParams.get('q') ?? '').toLowerCase();
    return HttpResponse.json({
      items: mentionable.filter((m) => !q || m.displayName.toLowerCase().includes(q)),
    });
  }),
  http.get(`${B}/documents/:id/comments`, ({ params }) =>
    HttpResponse.json({
      items: stage45State.comments.filter((c) => c.documentId === String(params.id)),
    }),
  ),
  http.post(`${B}/documents/:id/comments`, async ({ params, request }) => {
    const body = (await request.json()) as { stepKey: string | null; text: string };
    const created: Comment = {
      id: uuid(++seq),
      documentId: String(params.id),
      stepKey: body.stepKey ?? null,
      authorId: U1,
      authorName: fx.me.user.displayName,
      authorInitials: fx.me.user.initials,
      text: body.text,
      // The server resolves `@displayName` tokens; the mock does the same so mention → notification
      // is visible in tests.
      mentions: mentionable
        .filter((m) => body.text.includes(`@${m.displayName}`))
        .map((m) => ({ userId: m.id, displayName: m.displayName })),
      resolvedAt: null,
      resolvedByName: null,
      createdAt: new Date().toISOString(),
      likes: 0,
      likedByMe: false,
    };
    stage45State.comments.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post(`${B}/comments/:id/resolve`, ({ params }) => {
    const c = stage45State.comments.find((x) => x.id === String(params.id));
    if (!c) return notFound();
    c.resolvedAt = new Date().toISOString();
    c.resolvedByName = fx.me.user.displayName;
    return HttpResponse.json(c);
  }),
  http.post(`${B}/comments/:id/like`, ({ params }) => {
    const c = stage45State.comments.find((x) => x.id === String(params.id));
    if (!c) return notFound();
    c.likedByMe = !c.likedByMe;
    c.likes += c.likedByMe ? 1 : -1;
    return HttpResponse.json(c);
  }),
  http.delete(`${B}/comments/:id`, ({ params }) => {
    stage45State.comments = stage45State.comments.filter((c) => c.id !== String(params.id));
    return noContent();
  }),

  /* ── review workflow ──────────────────────────────────────────────────── */
  http.post(`${B}/documents/:id/request-review`, async ({ params, request }) => {
    const body = (await request.json()) as { note?: string };
    const created = {
      id: uuid(++seq),
      documentId: String(params.id),
      requestedBy: U1,
      requestedByName: fx.me.user.displayName,
      note: body.note ?? null,
      status: 'open' as const,
      decidedBy: null,
      decidedByName: null,
      decisionNote: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
    };
    stage45State.reviews.push({ ...created, title: 'מסמך', category: 'tech' });
    return HttpResponse.json(created, { status: 201 });
  }),
  http.post(`${B}/documents/:id/review-decision`, async ({ params, request }) => {
    const body = (await request.json()) as { decision: 'approve' | 'changes'; note?: string };
    const row = stage45State.reviews.find((r) => r.documentId === String(params.id) && r.status === 'open');
    if (!row) return notFound();
    row.status = body.decision === 'approve' ? 'approved' : 'changes';
    row.decidedBy = U1;
    row.decidedByName = fx.me.user.displayName;
    row.decisionNote = body.note ?? null;
    row.decidedAt = new Date().toISOString();
    // `/reviews` rows carry `title`/`category`; the decision route answers a bare ReviewRequest.
    const rest = { ...row } as Partial<typeof row>;
    delete rest.title;
    delete rest.category;
    return HttpResponse.json(rest);
  }),
  http.get(`${B}/reviews`, ({ request }) => {
    const status = new URL(request.url).searchParams.get('status');
    const items = status ? stage45State.reviews.filter((r) => r.status === status) : stage45State.reviews;
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50 });
  }),

  /* ── saved views ──────────────────────────────────────────────────────── */
  http.get(`${B}/views`, () => HttpResponse.json({ items: stage45State.views })),
  http.post(`${B}/views`, async ({ request }) => {
    const body = (await request.json()) as { name: string; query: object; shared?: boolean };
    const created: SavedView = {
      id: uuid(++seq),
      name: body.name,
      query: body.query as Record<string, unknown>,
      shared: body.shared ?? false,
      ownerId: U1,
      ownerName: fx.me.user.displayName,
      createdAt: new Date().toISOString(),
    };
    stage45State.views.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),
  http.patch(`${B}/views/:id`, async ({ params, request }) => {
    const v = stage45State.views.find((x) => x.id === String(params.id));
    if (!v) return notFound();
    Object.assign(v, await request.json());
    return HttpResponse.json(v);
  }),
  http.delete(`${B}/views/:id`, ({ params }) => {
    stage45State.views = stage45State.views.filter((v) => v.id !== String(params.id));
    return noContent();
  }),

  /* ── templates ────────────────────────────────────────────────────────── */
  http.get(`${B}/templates`, () => HttpResponse.json({ items: stage45State.templates })),
  http.post(`${B}/templates`, async ({ request }) => {
    const body = (await request.json()) as Omit<Template, 'id' | 'builtIn' | 'updatedAt'>;
    const created: Template = {
      ...body,
      description: body.description ?? '',
      id: uuid(++seq),
      builtIn: false,
      updatedAt: new Date().toISOString(),
    };
    stage45State.templates.push(created);
    return HttpResponse.json(created, { status: 201 });
  }),

  /* ── presence ─────────────────────────────────────────────────────────── */
  http.get(`${B}/documents/:id/presence`, ({ params }) =>
    HttpResponse.json({
      documentId: String(params.id),
      editors: stage45State.presence[String(params.id)] ?? [],
    }),
  ),
  http.post(`${B}/documents/:id/presence`, ({ params }) => {
    stage45State.heartbeats.push(String(params.id));
    return noContent();
  }),

  /* ── bulk actions ─────────────────────────────────────────────────────── */
  http.post(`${B}/documents/bulk`, async ({ request }) => {
    const body = (await request.json()) as { ids: string[]; action: string };
    stage45State.bulk.push({ action: body.action, ids: body.ids });
    return HttpResponse.json({ affected: body.ids.length, skipped: [] });
  }),

  /* ── telemetry ────────────────────────────────────────────────────────── */
  /**
   * The **one** handler for `POST /telemetry`. Stage 4 owns the route (it feeds the dashboards)
   * and stage 4–5 owns the emitters (the article's outcome picker, palette and jump), so both
   * lanes' suites assert on it. msw answers with the first matching handler, so two registrations
   * meant one lane's log silently stayed empty — the batch is recorded into both logs here
   * instead, after being validated against the contract both lanes are written to.
   */
  http.post(`${B}/telemetry`, async ({ request }) => {
    const parsed = TelemetryBatchSchema.safeParse(await request.json());
    if (!parsed.success)
      return HttpResponse.json(
        { code: 'VALIDATION', message: 'telemetry batch does not match the contract' },
        { status: 400 },
      );
    stage45State.telemetry.push(...parsed.data.events);
    stage4State.telemetry.push(...parsed.data.events);
    return noContent();
  }),
];
