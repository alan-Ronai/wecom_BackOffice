import { describe, it, expect } from 'vitest';
import { EVENTS, EventSchema, makeEvent } from '../src/index.js';

describe('events', () => {
  it('lists the spec names', () => {
    expect([...EVENTS]).toEqual([
      'document.published',
      'document.updated',
      'document.deleted',
      'suggestion.created',
      'suggestion.decided',
      'sync.completed',
      'sync.conflict',
      'job.failed',
      'system.status',
      // Stage 5 — collaboration. Appended, never reordered: a subscriber that predates
      // them must keep matching every name it already knew at the position it knew it.
      'notification.created',
      'comment.created',
      'review.requested',
      'review.decided',
      'presence.changed',
    ]);
  });
  it('validates a stage-5 payload', () => {
    const e = makeEvent('review.decided', {
      reviewRequestId: '11111111-1111-4111-8111-111111111111',
      documentId: '22222222-2222-4222-8222-222222222222',
      decision: 'approve',
      decidedBy: '33333333-3333-4333-8333-333333333333',
    });
    expect(EventSchema.parse(e).name).toBe('review.decided');
    expect(EventSchema.safeParse({ ...e, payload: { decision: 'nope' } }).success).toBe(false);
  });
  it('builds and validates an event', () => {
    const e = makeEvent('document.published', {
      documentId: '11111111-1111-4111-8111-111111111111',
      version: 8,
      actorId: null,
    });
    expect(EventSchema.parse(e).name).toBe('document.published');
    expect(EventSchema.safeParse({ name: 'document.published', payload: {}, at: e.at }).success).toBe(false);
  });
});
