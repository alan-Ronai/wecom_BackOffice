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
    ]);
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
