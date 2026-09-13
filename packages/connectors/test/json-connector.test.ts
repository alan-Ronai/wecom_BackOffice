import { describe, it, expect } from 'vitest';
import { JsonFileConnector, JsonConfigSchema } from '../src/index.js';
import { paragraphText } from '@wecom/shared';

const rows = [
  {
    id: 'T-41',
    title: 'דיבאג נטישה',
    desc: 'זיהוי לקוח מאותת',
    cat: 'ops',
    wave: 1,
    pri: 'hh',
    steps: 'זיהוי סימנים\nפתיחת שיחה',
  },
  { id: 'T-19', title: 'Hotspot לא עובד', desc: '', cat: 'tech', wave: 2, pri: 'm', steps: '' },
];
const cfg = JsonConfigSchema.parse({
  inline: JSON.stringify(rows),
  format: 'json',
  mapping: {
    id: 'id',
    title: 'title',
    description: 'desc',
    category: 'cat',
    wave: 'wave',
    priority: 'pri',
    steps: 'steps',
  },
});

describe('JsonFileConnector', () => {
  it('lists rows as remote items', async () => {
    const items = await new JsonFileConnector().listRemote(cfg);
    expect(items.map((i) => i.externalId)).toEqual(['T-41', 'T-19']);
    expect(items[0].title).toBe('דיבאג נטישה');
  });
  it('fetches a row as paragraphs with meta', async () => {
    const s = await new JsonFileConnector().fetch(cfg, 'T-41');
    expect(s.paragraphs.map((p) => [p.ref, paragraphText(p)])).toEqual([
      ['h2-1', 'דיבאג נטישה'],
      ['h2-1.p-1', 'זיהוי לקוח מאותת'],
      ['h2-1.p-2', 'זיהוי סימנים'],
      ['h2-1.p-3', 'פתיחת שיחה'],
    ]);
    expect(s.meta).toMatchObject({ category: 'ops', wave: 1, priority: 'hh' });
  });
  it('parses csv with a header row', async () => {
    const csv = JsonConfigSchema.parse({
      inline: 'title,cat\n"בירור חיוב",billing\n',
      format: 'csv',
      mapping: { title: 'title', category: 'cat' },
    });
    const items = await new JsonFileConnector().listRemote(csv);
    expect(items).toHaveLength(1);
    expect((await new JsonFileConnector().fetch(csv, items[0].externalId)).meta).toMatchObject({
      category: 'billing',
    });
  });
  it('is read-only', async () => {
    await expect(new JsonFileConnector().push(cfg, null, {} as never)).rejects.toThrow(/read-only/);
  });
});
