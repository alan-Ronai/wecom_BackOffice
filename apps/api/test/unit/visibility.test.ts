import { describe, it, expect } from 'vitest';
import { canReadUnpublished, visibilityWhere } from '../../src/lib/visibility.js';

const u = (perms: string[]) => ({ permissions: new Set(perms) });

describe('visibility', () => {
  it('editors see everything', () => {
    expect(canReadUnpublished(u(['docs.read', 'docs.read_unpublished']))).toBe(true);
    expect(visibilityWhere(u(['docs.read_unpublished']))).toBe('');
  });
  it('read-only users see published and partial only', () => {
    expect(canReadUnpublished(u(['docs.read']))).toBe(false);
    expect(visibilityWhere(u(['docs.read']))).toBe(" and d.status in ('published','partial')");
    expect(visibilityWhere(u(['docs.read']), 'x')).toBe(" and x.status in ('published','partial')");
  });
});
