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
