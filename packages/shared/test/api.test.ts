import { describe, it, expect } from 'vitest';
import { ListDocumentsQuerySchema, SearchResponseSchema, StructureBodySchema } from '../src/schemas/index.js';

describe('api schemas', () => {
  it('coerces list query', () => {
    const q = ListDocumentsQuerySchema.parse({ category: 'intl', wave: '2', pinned: 'true', page: '2' });
    expect(q.wave).toBe(2);
    expect(q.pinned).toBe(true);
    expect(q.page).toBe(2);
    expect(q.pageSize).toBe(50);
  });
  it('requires at least one phase in a structure body', () => {
    expect(StructureBodySchema.safeParse({ phases: [] }).success).toBe(false);
  });
  it('groups search hits', () => {
    const r = SearchResponseSchema.parse({
      groups: [
        {
          type: 'documents',
          hits: [
            {
              type: 'document',
              id: '11111111-1111-4111-8111-111111111111',
              title: 'x',
              snippet: 'x',
              meta: '',
              score: 1,
            },
          ],
        },
      ],
      total: 1,
      tookMs: 3,
      files: 1,
    });
    expect(r.groups[0].hits[0].type).toBe('document');
  });
});
