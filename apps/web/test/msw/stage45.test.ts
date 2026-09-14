/**
 * The stage 4–5 mirror of `fixtures.test.ts`: every stage-5 handler's **response body** is parsed
 * with the schema from `packages/shared/src/schemas/stage45.ts` that the route declares.
 *
 * These routes are not in `openapi.json` yet, so this file is the only thing keeping the mocks —
 * and therefore every component test that depends on them — honest about the contract the backend
 * lanes are implementing.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  BulkResultSchema,
  CommentSchema,
  MentionCandidateSchema,
  NotificationsResponseSchema,
  PresenceSchema,
  ReviewQueueResponseSchema,
  ReviewRequestSchema,
  SavedViewSchema,
  TemplateSchema,
} from '@wecom/shared';
import { D_BROWSING, D_INTL } from './fixtures.js';
import { CMT_1, VIEW_1, stage45State } from './stage45.js';

const B = 'http://kb.test/api/v1';
const items = <T extends z.ZodTypeAny>(item: T) => z.object({ items: z.array(item) });

const json = async (url: string, init?: RequestInit) => {
  const res = await fetch(url, init);
  return { res, body: res.status === 204 ? null : ((await res.json()) as unknown) };
};
const post = (body?: unknown): RequestInit => ({
  method: 'POST',
  ...(body === undefined
    ? {}
    : { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
});

type Case = [name: string, url: string, init: RequestInit | undefined, schema: z.ZodTypeAny | null];

const cases: Case[] = [
  ['GET /notifications', `${B}/notifications`, undefined, NotificationsResponseSchema],
  [
    'GET /notifications?unread=true',
    `${B}/notifications?unread=true`,
    undefined,
    NotificationsResponseSchema,
  ],
  [
    'POST /notifications/read',
    `${B}/notifications/read`,
    post({ all: true }),
    z.object({ unread: z.number().int() }),
  ],
  ['GET /users/mentionable', `${B}/users/mentionable?q=%D7%93`, undefined, items(MentionCandidateSchema)],
  ['GET /documents/:id/comments', `${B}/documents/${D_BROWSING}/comments`, undefined, items(CommentSchema)],
  [
    'POST /documents/:id/comments',
    `${B}/documents/${D_BROWSING}/comments`,
    post({ stepKey: 's8', text: 'שלום' }),
    CommentSchema,
  ],
  ['POST /comments/:id/resolve', `${B}/comments/${CMT_1}/resolve`, post(), CommentSchema],
  ['POST /comments/:id/like', `${B}/comments/${CMT_1}/like`, post(), CommentSchema],
  ['DELETE /comments/:id', `${B}/comments/${CMT_1}`, { method: 'DELETE' }, null],
  [
    'POST /documents/:id/request-review',
    `${B}/documents/${D_BROWSING}/request-review`,
    post({ note: 'נא לבדוק' }),
    ReviewRequestSchema,
  ],
  [
    'POST /documents/:id/review-decision',
    `${B}/documents/${D_INTL}/review-decision`,
    post({ decision: 'approve', label: 'אושר' }),
    ReviewRequestSchema,
  ],
  ['GET /reviews', `${B}/reviews?status=open`, undefined, ReviewQueueResponseSchema],
  ['GET /views', `${B}/views`, undefined, items(SavedViewSchema)],
  ['POST /views', `${B}/views`, post({ name: 'שלי', query: { wave: 1 }, shared: false }), SavedViewSchema],
  [
    'PATCH /views/:id',
    `${B}/views/${VIEW_1}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ name: 'חו"ל ונדידה' }),
      headers: { 'content-type': 'application/json' },
    },
    SavedViewSchema,
  ],
  ['DELETE /views/:id', `${B}/views/${VIEW_1}`, { method: 'DELETE' }, null],
  ['GET /templates', `${B}/templates`, undefined, items(TemplateSchema)],
  ['GET /documents/:id/presence', `${B}/documents/${D_BROWSING}/presence`, undefined, PresenceSchema],
  ['POST /documents/:id/presence', `${B}/documents/${D_BROWSING}/presence`, post(), null],
  [
    'POST /documents/bulk',
    `${B}/documents/bulk`,
    post({ ids: [D_BROWSING], action: 'pin' }),
    BulkResultSchema,
  ],
  ['POST /telemetry', `${B}/telemetry`, post({ events: [{ kind: 'outcome' }] }), null],
];

describe('stage 4–5 handlers match the shared zod contract', () => {
  it.each(cases)('%s', async (_name, url, init, schema) => {
    const { res, body } = await json(url, init);
    expect(res.ok).toBe(true);
    if (schema === null) {
      expect(res.status).toBe(204);
      return;
    }
    expect(() => schema.parse(body)).not.toThrow();
  });

  it('marks notifications read and reports the remaining unread count', async () => {
    const before = NotificationsResponseSchema.parse((await json(`${B}/notifications`)).body);
    expect(before.unread).toBeGreaterThan(0);
    const after = (await json(`${B}/notifications/read`, post({ all: true }))).body as { unread: number };
    expect(after.unread).toBe(0);
  });

  it('resolves `@displayName` tokens in a comment into mentions', async () => {
    const created = CommentSchema.parse(
      (
        await json(
          `${B}/documents/${D_BROWSING}/comments`,
          post({ stepKey: 's8', text: 'שאלה ל-@דנה ר. לגבי השלב' }),
        )
      ).body,
    );
    expect(created.mentions.map((m) => m.displayName)).toContain('דנה ר.');
  });

  it('records bulk actions and telemetry batches', async () => {
    await json(`${B}/documents/bulk`, post({ ids: [D_BROWSING, D_INTL], action: 'unpin' }));
    await json(`${B}/telemetry`, post({ events: [{ kind: 'palette' }, { kind: 'jump' }] }));
    expect(stage45State.bulk.at(-1)).toEqual({ action: 'unpin', ids: [D_BROWSING, D_INTL] });
    expect(stage45State.telemetry.map((e) => e.kind)).toEqual(['palette', 'jump']);
  });
});
