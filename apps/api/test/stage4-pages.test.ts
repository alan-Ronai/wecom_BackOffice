import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from './helpers/db.js';
import { buildTestApp } from './helpers/app.js';
import { makeUser, auth } from './helpers/fixtures.js';

const run = integration ? describe : describe.skip;

const OLD_FIELD = 'גלישה בארץ';
const NEW_FIELD = 'סטטוס גלישה';

run('stage 4: field page, field rename and block page', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let u: Awaited<ReturnType<typeof makeUser>>;
  let docId: string;
  let blockId: string;

  const get = (url: string) => app.inject({ method: 'GET', url, headers: auth(u) });
  const post = (url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, headers: auth(u), payload });

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    u = await makeUser(db.pool);

    await app.inject({
      method: 'PUT',
      url: `/api/v1/fields/${encodeURIComponent(OLD_FIELD)}`,
      headers: auth(u),
      payload: { name: OLD_FIELD, status: 'ok', path: 'CRM > לקוח > גלישה' },
    });
    blockId = (
      await post('/api/v1/blocks', {
        title: 'בדיקת חסימה',
        kind: 'step',
        actions: [{ id: 'a1', text: 'פתח CRM' }],
        outcomes: [{ kind: 'ok', text: '✓ תקין' }],
      })
    ).json().id;
    docId = (
      await post('/api/v1/documents', {
        title: 'איטיות גלישה',
        description: '',
        category: 'tech',
        wave: 1,
        priority: 'hh',
        kind: 'steps',
      })
    ).json().id;

    const etag = (await get(`/api/v1/documents/${docId}`)).headers.etag as string;
    const s = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${docId}/structure`,
      headers: { ...auth(u), 'if-match': etag },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'שלב 1',
            steps: [
              {
                key: 's1',
                num: '1',
                title: `בדיקת ${OLD_FIELD}`,
                blockRefs: [blockId],
                deps: [],
                actions: [{ id: 'a1', text: `פתח CRM ובדוק את ${OLD_FIELD}` }],
                outcomes: [{ kind: 'ok', text: `✓ ${OLD_FIELD} תקין` }],
              },
              {
                key: 's2',
                num: '2',
                title: 'בלוק משותף',
                blockId,
                blockRefs: [],
                deps: [],
                actions: [],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
            ],
          },
        ],
      },
    });
    if (s.statusCode !== 200) throw new Error(`structure failed: ${s.statusCode} ${s.body}`);
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('serves a field page with usage, history and alerts', async () => {
    const r = await get(`/api/v1/fields/${encodeURIComponent(OLD_FIELD)}/page`);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.field.name).toBe(OLD_FIELD);
    expect(p.documents).toBe(1);
    expect(p.usage[0]).toMatchObject({ documentId: docId, stepKey: 's1', category: 'tech', stepNum: '1' });
    expect(p.usage[0].text).toContain(OLD_FIELD);
    // The PUT that registered the field is audited, so the page has a trail.
    expect(p.history.some((h: { action: string }) => h.action === 'fields.edit')).toBe(true);
    expect(p.alerts).toEqual([]);
    expect((await get('/api/v1/fields/%D7%9C%D7%90-%D7%A7%D7%99%D7%99%D7%9D/page')).statusCode).toBe(404);
  });

  it('renames a field, rewrites the references and publishes one version per document', async () => {
    const before = (await get(`/api/v1/documents/${docId}`)).json().currentVersion;
    const r = await post(`/api/v1/fields/${encodeURIComponent(OLD_FIELD)}/rename`, {
      newName: NEW_FIELD,
      updateReferences: true,
      label: 'שינוי שם שדה ב-CRM',
    });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ updatedDocuments: 1, versionsCreated: 1 });
    expect(r.json().field.name).toBe(NEW_FIELD);

    const doc = (await get(`/api/v1/documents/${docId}`)).json();
    expect(doc.currentVersion).toBe(before + 1);
    const step = doc.phases[0].steps[0];
    expect(step.title).toBe(`בדיקת ${NEW_FIELD}`);
    expect(step.actions[0].text).toContain(NEW_FIELD);
    expect(step.actions[0].text).not.toContain(OLD_FIELD);
    expect(step.outcomes[0].text).toContain(NEW_FIELD);

    const versions = (await get(`/api/v1/documents/${docId}/versions`)).json();
    expect(versions.items.some((v: { label: string }) => v.label === 'שינוי שם שדה ב-CRM')).toBe(true);

    // The old name survives as a tombstone pointing at the new one.
    const oldPage = (await get(`/api/v1/fields/${encodeURIComponent(OLD_FIELD)}/page`)).json();
    expect(oldPage.field.status).toBe('renamed');
    expect(oldPage.field.renamedTo).toBe(NEW_FIELD);
    expect(oldPage.alerts.map((a: { kind: string }) => a.kind)).toContain('renamed');
    expect(oldPage.documents).toBe(0);

    // …and the references now hang off the new name.
    const newPage = (await get(`/api/v1/fields/${encodeURIComponent(NEW_FIELD)}/page`)).json();
    expect(newPage.documents).toBe(1);
    expect(newPage.usage[0].stepKey).toBe('s1');
  });

  it('refuses a no-op rename and 404s on an unknown field', async () => {
    const same = await post(`/api/v1/fields/${encodeURIComponent(NEW_FIELD)}/rename`, {
      newName: NEW_FIELD,
      updateReferences: true,
      label: 'x',
    });
    expect(same.statusCode).toBe(400);
    const missing = await post('/api/v1/fields/%D7%90%D7%99%D7%9F/rename', {
      newName: 'x',
      updateReferences: true,
      label: 'x',
    });
    expect(missing.statusCode).toBe(404);
  });

  it('serves a block page with embedded and referenced usage plus versions', async () => {
    const r = await get(`/api/v1/blocks/${blockId}/page`);
    expect(r.statusCode).toBe(200);
    const p = r.json();
    expect(p.block.id).toBe(blockId);
    const modes = Object.fromEntries(
      p.usage.map((x: { stepKey: string; mode: string }) => [x.stepKey, x.mode]),
    );
    expect(modes).toEqual({ s1: 'reference', s2: 'embedded' });
    expect(p.usage.every((x: { category: string }) => x.category === 'tech')).toBe(true);
    expect(p.versions.length).toBeGreaterThanOrEqual(1);
    expect(p.versions[0].authorName).toBe(u.name);
    expect((await get('/api/v1/blocks/11111111-1111-4111-8111-111111111111/page')).statusCode).toBe(404);
  });
});
