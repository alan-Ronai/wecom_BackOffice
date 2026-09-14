/**
 * msw handlers for the wave 4 (W3) `/feedback*` routes, mirroring `docs/api/CONTRACTS-wave4.md`.
 *
 * State is mutable so tests can assert what the UI actually sent (`feedbackState.items`); it is
 * reset between tests by `resetState()` in `handlers.ts`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { z } from 'zod';
import {
  FEEDBACK_STATUSES,
  FeedbackDetailSchema,
  type FeedbackAnalytics,
  type FeedbackRow,
  type FeedbackStatus,
} from '@wecom/shared';
import { fx } from './fixtures.js';

/** W0 exports the schema but no `FeedbackDetail` alias — derive it rather than restate the shape. */
type FeedbackDetail = z.infer<typeof FeedbackDetailSchema>;

const B = '/api/v1';
const T = '2026-09-14T08:00:00.000Z';

export const feedbackState: { items: FeedbackRow[] } = { items: [] };
export const resetFeedbackState = (): void => {
  feedbackState.items = [];
};

export const sampleFeedback = (over: Partial<FeedbackRow> = {}): FeedbackRow => ({
  id: 'f0000000-0000-4000-8000-000000000001',
  documentId: fx.docBrowsing.id,
  documentVersion: fx.docBrowsing.currentVersion,
  docType: 'R',
  worldSlug: fx.docBrowsing.category,
  stepKey: 's2',
  kind: 'error',
  text: 'הסף השתנה',
  status: 'new',
  userId: fx.me.user.id,
  userName: 'דנה ר.',
  createdAt: T,
  assigneeId: null,
  decisionNote: null,
  decidedBy: null,
  decidedAt: null,
  resolvedVersion: null,
  documentTitle: fx.docBrowsing.title,
  assigneeName: null,
  ...over,
});

const OPEN: FeedbackStatus[] = ['new', 'in_review', 'needs_update'];

const counts = (): Record<FeedbackStatus, number> =>
  Object.fromEntries(
    FEEDBACK_STATUSES.map((s) => [s, feedbackState.items.filter((f) => f.status === s).length]),
  ) as Record<FeedbackStatus, number>;

export const feedbackHandlers: RequestHandler[] = [
  http.post(`${B}/documents/:id/feedback`, async ({ params, request }) => {
    const body = (await request.json()) as {
      kind: FeedbackRow['kind'];
      text?: string;
      stepKey?: string;
    };
    const row = sampleFeedback({
      id: crypto.randomUUID(),
      documentId: params.id as string,
      kind: body.kind,
      text: body.text ?? '',
      stepKey: body.stepKey ?? null,
    });
    feedbackState.items.push(row);
    // The 201 body is `FeedbackSchema`, a subset of the row shape the queue reads.
    const plain: Partial<FeedbackRow> = { ...row };
    delete plain.documentTitle;
    delete plain.assigneeName;
    return HttpResponse.json(plain, { status: 201 });
  }),
  http.get(`${B}/documents/:id/feedback`, ({ params }) =>
    HttpResponse.json({
      items: feedbackState.items.filter((f) => f.documentId === params.id && OPEN.includes(f.status)),
    }),
  ),
  // Declared before `/feedback/:id` so the literal segment wins.
  http.get(`${B}/feedback/analytics`, () => {
    const a: FeedbackAnalytics = {
      from: T,
      to: T,
      total: feedbackState.items.length,
      perItem: [
        { documentId: fx.docBrowsing.id, title: fx.docBrowsing.title, docType: 'R', count: 4, open: 2 },
      ],
      byKind: [
        { kind: 'error', count: 3 },
        { kind: 'missing', count: 1 },
      ],
      topItems: [{ documentId: fx.docBrowsing.id, title: fx.docBrowsing.title, count: 4 }],
      meanHoursToClose: 30.5,
      changeRate: 0.5,
      recurringByTopic: [],
    };
    return HttpResponse.json(a);
  }),
  http.get(`${B}/feedback/:id`, ({ params }) => {
    const f = feedbackState.items.find((x) => x.id === params.id);
    if (!f) return HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
    const d: FeedbackDetail = {
      ...f,
      versionLabel: `v${f.documentVersion}`,
      href: `/doc/${f.documentId}` + (f.stepKey ? `/${f.stepKey}` : ''),
      laterVersions: [{ version: f.documentVersion + 1, label: 'תיקון', createdAt: T }],
    };
    return HttpResponse.json(d);
  }),
  http.get(`${B}/feedback`, ({ request }) => {
    const u = new URL(request.url);
    const status = u.searchParams.get('status');
    const kind = u.searchParams.get('kind');
    // §5.4's five filters, all of them in `FeedbackQuerySchema`.
    const world = u.searchParams.get('world');
    const docType = u.searchParams.get('docType');
    const assigneeId = u.searchParams.get('assigneeId');
    const documentId = u.searchParams.get('documentId');
    const items = feedbackState.items.filter(
      (f) =>
        (!status || f.status === status) &&
        (!kind || f.kind === kind) &&
        (!world || f.worldSlug === world) &&
        (!docType || f.docType === docType) &&
        (!assigneeId || f.assigneeId === assigneeId) &&
        (!documentId || f.documentId === documentId),
    );
    return HttpResponse.json({ items, total: items.length, page: 1, pageSize: 50, counts: counts() });
  }),
  http.patch(`${B}/feedback/:id`, async ({ params, request }) => {
    const body = (await request.json()) as Partial<FeedbackRow>;
    const f = feedbackState.items.find((x) => x.id === params.id)!;
    Object.assign(f, body);
    if (body.assigneeId !== undefined) f.assigneeName = body.assigneeId ? 'ענבר ל.' : null;
    if (f.status === 'done' || f.status === 'no_change') {
      f.decidedAt = T;
      f.decidedBy = fx.me.user.id;
    }
    return HttpResponse.json(f);
  }),
  http.post(`${B}/feedback/:id/resolve`, async ({ params, request }) => {
    const body = (await request.json()) as { version: number; decisionNote?: string };
    const f = feedbackState.items.find((x) => x.id === params.id)!;
    Object.assign(f, {
      status: 'done',
      resolvedVersion: body.version,
      decidedAt: T,
      decidedBy: fx.me.user.id,
      decisionNote: body.decisionNote ?? f.decisionNote,
    });
    return HttpResponse.json(f);
  }),
];
