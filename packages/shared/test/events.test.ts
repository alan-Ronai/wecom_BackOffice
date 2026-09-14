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
      // Wave 4 — appended, never reordered.
      'feedback.created',
      'feedback.updated',
      'source_document.saved',
      'taxonomy.changed',
      // Wave 5 — appended, never reordered.
      'learning.assigned',
      'learning.completed',
      'learning.refresh_required',
      'gap.detected',
      // Pipeline fan-out — appended, never reordered.
      'sync.link_skipped',
    ]);
  });
  it('validates the sync.link_skipped payload', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    const other = '22222222-2222-4222-8222-222222222222';
    const e = EventSchema.parse(
      makeEvent('sync.link_skipped', {
        connectorId: id,
        externalId: 'posts:101',
        documentId: id,
        skippedDocumentId: other,
      }),
    );
    expect(e.name).toBe('sync.link_skipped');
    expect(e.payload).toMatchObject({ externalId: 'posts:101', skippedDocumentId: other });
  });
  it('validates the wave 5 events', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      EventSchema.parse(
        makeEvent('learning.completed', { assignmentId: id, userId: id, itemId: id, passed: true }),
      ).name,
    ).toBe('learning.completed');
    expect(EventSchema.parse(makeEvent('gap.detected', { gapId: id, kind: 'zero_results' })).name).toBe(
      'gap.detected',
    );
    expect(
      EventSchema.safeParse({
        name: 'learning.refresh_required',
        payload: { documentId: id, version: 3 }, // affectedUsers missing
        at: new Date().toISOString(),
      }).success,
    ).toBe(false);
  });
  it('validates the wave 4 events', () => {
    const id = '11111111-1111-4111-8111-111111111111';
    expect(
      EventSchema.parse(makeEvent('feedback.created', { feedbackId: id, documentId: id, kind: 'error' }))
        .name,
    ).toBe('feedback.created');
    expect(EventSchema.parse(makeEvent('taxonomy.changed', { entity: 'world', id })).name).toBe(
      'taxonomy.changed',
    );
    expect(
      EventSchema.safeParse({
        name: 'source_document.saved',
        payload: { documentId: id },
        at: new Date().toISOString(),
      }).success,
    ).toBe(false);
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
