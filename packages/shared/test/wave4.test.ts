import { describe, it, expect } from 'vitest';
import {
  DOC_TYPES,
  DOC_TYPE_LABELS,
  DocTypeSchema,
  WorldSlugSchema,
  WorldSchema,
  WorldBodySchema,
  TopicViewSchema,
} from '../src/index.js';

const U = '11111111-1111-4111-8111-111111111111';
const T = '2026-09-14T10:00:00.000Z';

describe('wave4 taxonomy schemas', () => {
  it('lists doc types in PRD order with Hebrew labels', () => {
    expect([...DOC_TYPES]).toEqual(['M', 'R', 'O', 'E', 'S', 'T', 'I']);
    expect(DOC_TYPE_LABELS.M).toBe('אבחון');
    expect(DOC_TYPE_LABELS.I).toBe('מידע');
    expect(DocTypeSchema.safeParse('X').success).toBe(false);
  });
  it('validates world slugs like the existing category slugs', () => {
    expect(WorldSlugSchema.safeParse('sim').success).toBe(true);
    expect(WorldSlugSchema.safeParse('field-ops-2').success).toBe(true);
    expect(WorldSlugSchema.safeParse('Sim').success).toBe(false);
    expect(WorldSlugSchema.safeParse('').success).toBe(false);
  });
  it('parses a world row and a create body', () => {
    const w = WorldSchema.parse({
      id: U,
      slug: 'sim',
      name: 'SIM / eSIM',
      description: '',
      position: 0,
      active: true,
      topicCount: 3,
      itemCount: 12,
      createdAt: T,
      updatedAt: T,
    });
    expect(w.slug).toBe('sim');
    expect(WorldBodySchema.parse({ slug: 'new', name: 'חדש' })).toEqual({
      slug: 'new',
      name: 'חדש',
      description: '',
      active: true,
    });
  });
  it('parses a topic view grouped by doc type', () => {
    const v = TopicViewSchema.parse({
      topic: {
        id: U,
        worldSlug: 'sim',
        slug: 'esim-activation',
        name: 'הפעלת eSIM',
        description: '',
        position: 0,
        active: true,
        itemCount: 2,
      },
      world: {
        id: U,
        slug: 'sim',
        name: 'SIM / eSIM',
        description: '',
        position: 0,
        active: true,
        topicCount: 1,
        itemCount: 2,
        createdAt: T,
        updatedAt: T,
      },
      groups: [
        {
          docType: 'M',
          items: [
            {
              id: U,
              slug: 'm-esim',
              title: 'אבחון eSIM',
              docType: 'M',
              kind: 'steps',
              status: 'published',
              worlds: ['sim'],
              description: '',
              tags: ['esim'],
              updatedAt: T,
            },
          ],
        },
      ],
    });
    expect(v.groups[0].items[0].tags).toEqual(['esim']);
  });
});

import {
  DocumentStatusSchema,
  DocumentKindSchema,
  UNPUBLISHED_STATUSES,
  DocumentSchema,
  DocumentCardSchema,
  ListDocumentsQuerySchema,
  SearchQuerySchema,
  PublishBodySchema,
  SetStatusBodySchema,
} from '../src/index.js';

describe('wave4 governance extensions', () => {
  it('widens status and kind enums', () => {
    expect(DocumentStatusSchema.options).toEqual([
      'draft',
      'review',
      'published',
      'partial',
      'invalid',
      'archived',
    ]);
    expect(DocumentKindSchema.options).toEqual(['steps', 'retention', 'text']);
    expect([...UNPUBLISHED_STATUSES]).toEqual(['draft', 'review', 'invalid', 'archived']);
  });
  it('keeps old documents valid and defaults the new fields', () => {
    const d = DocumentSchema.parse({
      id: U,
      slug: 'r-01',
      title: 'מסמך',
      description: '',
      category: 'sim',
      wave: 1,
      priority: 'h',
      kind: 'steps',
      status: 'published',
      currentVersion: 1,
      phases: [],
      createdAt: T,
      updatedAt: T,
    });
    expect(d.tags).toEqual([]);
    expect(d.worlds).toEqual([]);
    expect(d.topics).toEqual([]);
    expect(d.sourceReviewNeeded).toBe(false);
    expect(d.docType).toBeUndefined();
    const c = DocumentCardSchema.parse({
      id: U,
      slug: 'r-01',
      title: 'מסמך',
      description: '',
      category: 'sim',
      wave: 1,
      priority: 'h',
      kind: 'steps',
      status: 'published',
      currentVersion: 1,
      updatedAt: T,
      stepCount: 0,
      linksOut: 0,
      linksIn: 0,
      views: 0,
      crmFields: [],
      hasSharedBlocks: false,
      pinned: false,
    });
    expect(c.tags).toEqual([]);
  });
  it('accepts taxonomy filters on list and search', () => {
    const q = ListDocumentsQuerySchema.parse({
      world: 'sim',
      topic: U,
      docType: 'R',
      tag: ['esim', 'apn'],
    });
    expect(q.tag).toEqual(['esim', 'apn']);
    expect(ListDocumentsQuerySchema.parse({ tag: 'esim' }).tag).toEqual(['esim']);
    expect(SearchQuerySchema.parse({ q: 'x', docType: 'O' }).docType).toBe('O');
  });
  it('lets publish close feedback and validates status changes', () => {
    expect(PublishBodySchema.parse({ label: 'v', resolveFeedbackIds: [U] }).resolveFeedbackIds).toEqual([
      U,
    ]);
    expect(SetStatusBodySchema.safeParse({ status: 'published', reason: 'x' }).success).toBe(false);
    expect(SetStatusBodySchema.parse({ status: 'invalid', reason: 'הוחלף בנוהל חדש' }).status).toBe(
      'invalid',
    );
  });
});

import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_STATUSES,
  CreateFeedbackBodySchema,
  FeedbackSchema,
  FeedbackAnalyticsSchema,
  PutSourceDocumentBodySchema,
  AssetSchema,
  ASSET_MIMES,
  ASSET_MAX_BYTES,
  UsageAnalyticsSchema,
  SearchLogRowSchema,
} from '../src/index.js';

describe('wave4 feedback / source / usage schemas', () => {
  it('has the seven PRD feedback kinds and five statuses', () => {
    expect([...FEEDBACK_KINDS]).toEqual([
      'outdated',
      'error',
      'unclear',
      'missing',
      'process_fails',
      'no_answer',
      'other',
    ]);
    expect(FEEDBACK_KIND_LABELS.process_fails).toBe('התהליך לא עובד בפועל');
    expect([...FEEDBACK_STATUSES]).toEqual(['new', 'in_review', 'needs_update', 'no_change', 'done']);
  });
  it('agent body needs only a kind', () => {
    expect(CreateFeedbackBodySchema.parse({ kind: 'other' })).toEqual({ kind: 'other', text: '' });
    expect(CreateFeedbackBodySchema.safeParse({ kind: 'other', text: 'x'.repeat(1001) }).success).toBe(
      false,
    );
  });
  it('parses a stored feedback row with auto-captured context', () => {
    const f = FeedbackSchema.parse({
      id: U,
      documentId: U,
      documentVersion: 3,
      docType: 'R',
      worldSlug: 'sim',
      stepKey: 's11',
      kind: 'error',
      text: '',
      status: 'new',
      userId: U,
      userName: 'דנה',
      createdAt: T,
      assigneeId: null,
      decisionNote: null,
      decidedBy: null,
      decidedAt: null,
      resolvedVersion: null,
    });
    expect(f.documentVersion).toBe(3);
  });
  it('analytics shape', () => {
    const a = FeedbackAnalyticsSchema.parse({
      from: T,
      to: T,
      total: 1,
      perItem: [{ documentId: U, title: 't', docType: 'R', count: 1, open: 1 }],
      byKind: [{ kind: 'error', count: 1 }],
      topItems: [{ documentId: U, title: 't', count: 1 }],
      meanHoursToClose: null,
      changeRate: 0,
      recurringByTopic: [{ topicId: U, topicName: 'x', kind: 'error', count: 1 }],
    });
    expect(a.total).toBe(1);
  });
  it('source document body and assets', () => {
    expect(PutSourceDocumentBodySchema.parse({ html: '<p>x</p>' }).label).toBeUndefined();
    expect(ASSET_MAX_BYTES).toBe(10 * 1024 * 1024);
    expect(ASSET_MIMES).toContain('image/png');
    expect(
      AssetSchema.parse({
        id: U,
        url: '/api/v1/assets/' + U,
        mime: 'image/png',
        size: 10,
        width: null,
        height: null,
      }).size,
    ).toBe(10);
  });
  it('usage analytics and search log rows', () => {
    expect(
      SearchLogRowSchema.parse({
        id: U,
        userId: U,
        userName: 'x',
        q: 'apn',
        filters: {},
        results: 0,
        tookMs: 4,
        at: T,
      }).results,
    ).toBe(0);
    const u = UsageAnalyticsSchema.parse({
      from: T,
      to: T,
      itemViews: [{ documentId: U, title: 't', docType: 'R', views: 3, viewers: 2, lastViewedAt: T }],
      topItems: [{ documentId: U, title: 't', views: 3 }],
      topTopics: [{ topicId: U, name: 'x', worldSlug: 'sim', views: 3 }],
      viewers: [{ userId: U, displayName: 'x', views: 3 }],
      zeroResultTerms: [{ q: 'zzz', count: 2, lastAt: T }],
      staleness: [
        {
          documentId: U,
          title: 't',
          ownerName: null,
          updatedAt: T,
          publishedAt: null,
          daysSinceUpdate: 12,
        },
      ],
    });
    expect(u.zeroResultTerms[0].q).toBe('zzz');
  });
});
