import { describe, it, expect } from 'vitest';
import { withDb, integration } from '../helpers/l5/db.js';
import { seedUser } from '../helpers/l5/stubs.js';
import { SourceRevisionService } from '../../src/modules/sources/revisions.js';
import { parseText } from '../../src/modules/sources/text.js';

const run = integration ? describe : describe.skip;

run('SourceRevisionService', () => {
  it(
    'ingests, dedupes by hash and enqueues processing',
    async () =>
      withDb(async (pool) => {
        const sent: unknown[] = [];
        const svc = new SourceRevisionService(pool, {
          send: async (name, data) => {
            sent.push([name, data]);
            return 'job1';
          },
        });
        const uid = await seedUser(pool, { displayName: 'ענבר ל.' });
        const { id } = await svc.createSource({ kind: 'text', title: 'נהלים' }, uid);
        const content = parseText('נהלים.md', '4.8 בדיקת מהירות. בקש מהלקוח להריץ Speedtest.');

        const a = await svc.ingest(id, content, uid, Buffer.from('raw'));
        expect(a.duplicate).toBe(false);
        expect(sent).toEqual([['pipeline.process', { revisionId: a.revisionId }]]);

        const b = await svc.ingest(id, content, uid);
        expect(b.duplicate).toBe(true);
        expect(b.revisionId).toBe(a.revisionId);
        expect(sent).toHaveLength(1);

        const src = (await svc.listSources()).find((s) => s.id === id)!;
        expect(src.syncState).toBe('pending');
        expect(src.lastHash).toBe(content.hash);
        expect(src.linkedDocuments).toBe(0);
        expect(src.pendingSuggestions).toBe(0);

        expect((await svc.getRevision(a.revisionId))?.paragraphs[0].ref).toBe('4.8');
        expect(await svc.latestRevisionId(id)).toBe(a.revisionId);
        expect(await svc.latestAccepted(id)).toBeNull();
      }),
    180000,
  );
});
