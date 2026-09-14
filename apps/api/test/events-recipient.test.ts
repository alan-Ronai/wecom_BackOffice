import { describe, it, expect } from 'vitest';
import { makeEvent, type Event } from '@wecom/shared';
import { recipientDecision } from '../src/modules/events/routes.js';

// N2 (re-review, minor): a `PER_RECIPIENT` event whose payload has no `userId` used to fall
// open into a broadcast (`recipientOf` returned `null`, the same value a non-per-recipient
// event returns). `recipientDecision` must fail closed instead — drop it, deliver to nobody.
describe('recipientDecision', () => {
  it('does not restrict a broadcast event', () => {
    const e = makeEvent('document.updated', { documentId: 'd1', actorId: null });
    expect(recipientDecision(e)).toEqual({ drop: false, onlyTo: null });
  });

  it('restricts a well-formed per-recipient event to its userId', () => {
    const e = makeEvent('notification.created', {
      notificationId: 'n1',
      userId: 'u1',
      kind: 'mention',
      title: 'כותרת',
    });
    expect(recipientDecision(e)).toEqual({ drop: false, onlyTo: 'u1' });
  });

  it('drops a per-recipient event with no userId, rather than broadcasting it', () => {
    const malformed = {
      name: 'notification.created',
      payload: { notificationId: 'n1', kind: 'mention', title: 'כותרת' },
      at: new Date().toISOString(),
    } as unknown as Event;
    expect(recipientDecision(malformed)).toEqual({ drop: true });
  });
});
