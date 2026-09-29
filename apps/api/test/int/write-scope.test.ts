import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth } from '../helpers/fixtures.js';
import * as learning from '../../src/modules/learning/repo.js';
import { startWpStub, type WpStub } from '../../../../packages/connectors/test/helpers/wpStub.js';

const run = integration ? describe : describe.skip;

/**
 * Wave Y, owner decision on wave 5 A-M6 — reads stay "any overlap", **writes** (edit, publish,
 * delete, status and ownership changes) need the caller to hold **every** world the entity spans.
 * App-wide: documents, blocks, fields and learning items. Unscoped roles are unaffected.
 *
 * Every entity below spans `billing` and `sim`. `half` is a manager scoped to `billing` only:
 * each case asserts they can still read it (200) and cannot change it (403). `whole` holds both
 * worlds and gets through the same writes, so the 403s are the rule and not a broken route.
 */
run('write scope — every world (A-M6)', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let admin: Awaited<ReturnType<typeof makeUser>>;
  let half: Awaited<ReturnType<typeof makeUser>>;
  let whole: Awaited<ReturnType<typeof makeUser>>;
  let blockId: string;
  const FIELD = 'מספר מנוי';

  const post = (url: string, payload: unknown, as = admin) =>
    app.inject({ method: 'POST', url, headers: auth(as), payload });

  const putStructure = async (id: string, actionText: string, block: string | null) => {
    const etag = (await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(admin) }))
      .headers.etag as string;
    const r = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${id}/structure`,
      headers: { ...auth(admin), 'if-match': etag },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'שלב 1',
            steps: [
              {
                key: 's1',
                num: '1',
                title: 'בלוק',
                ...(block ? { blockId: block } : {}),
                blockRefs: [],
                deps: [],
                actions: block ? [] : [{ id: 'a0', text: 'פתח' }],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
              {
                key: 's2',
                num: '2',
                title: 'המשך',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: actionText }],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
            ],
          },
        ],
      },
    });
    if (r.statusCode !== 200) throw new Error(`structure ${id}: ${r.statusCode} ${r.body}`);
  };

  /** A published document; `worlds` are its secondary memberships next to the primary `category`. */
  const makeDoc = async (
    title: string,
    category: string,
    worlds: string[] = [],
    block: string | null = null,
    publish = true,
  ) => {
    const r = await post('/api/v1/documents', {
      title,
      category,
      worlds,
      wave: 1,
      priority: 'm',
      kind: 'steps',
    });
    expect(r.statusCode, r.body).toBe(201);
    const id = r.json().id as string;
    await putStructure(id, `בדוק את ${FIELD}`, block);
    if (!publish) return id;
    const pub = await post(`/api/v1/documents/${id}/publish`, { label: 'v1' });
    expect(pub.statusCode, pub.body).toBe(200);
    return id;
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    admin = await makeUser(db.pool, { name: 'מנהלת' });
    half = await makeUser(db.pool, { name: 'מנהל גבייה', scopes: ['billing'] });
    whole = await makeUser(db.pool, { name: 'מנהל גבייה+סים', scopes: ['billing', 'sim'] });
    await app.inject({
      method: 'PUT',
      url: `/api/v1/fields/${encodeURIComponent(FIELD)}`,
      headers: auth(admin),
      payload: { name: FIELD, status: 'ok', path: 'CRM > לקוח' },
    });
    blockId = (
      await post('/api/v1/blocks', {
        title: 'בלוק משותף',
        kind: 'step',
        actions: [{ id: 'a1', text: 'פתח CRM' }],
        outcomes: [{ kind: 'ok', text: '✓ תקין' }],
      })
    ).json().id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    await db?.stop();
  });

  describe('documents', () => {
    it('a one-world manager reads a two-world document but cannot edit, publish, re-status or delete it', async () => {
      const id = await makeDoc('משותף גבייה+סים', 'billing', ['sim']);
      const read = await app.inject({ method: 'GET', url: `/api/v1/documents/${id}`, headers: auth(half) });
      expect(read.statusCode).toBe(200);
      expect(read.json().worlds).toEqual(expect.arrayContaining(['billing', 'sim']));

      const writes = [
        { method: 'PATCH' as const, url: `/api/v1/documents/${id}`, payload: { title: 'שונה' } },
        { method: 'PATCH' as const, url: `/api/v1/documents/${id}`, payload: { ownerId: half.id } },
        { method: 'POST' as const, url: `/api/v1/documents/${id}/publish`, payload: { label: 'v2' } },
        {
          method: 'POST' as const,
          url: `/api/v1/documents/${id}/status`,
          payload: { status: 'archived', reason: 'ישן' },
        },
        { method: 'POST' as const, url: `/api/v1/documents/${id}/request-review`, payload: {} },
        { method: 'DELETE' as const, url: `/api/v1/documents/${id}` },
      ];
      for (const w of writes) {
        const r = await app.inject({ ...w, headers: auth(half) });
        expect(r.statusCode, `${w.method} ${w.url} ${JSON.stringify(w.payload ?? {})}`).toBe(403);
        expect(r.json().code).toBe('SCOPE_DENIED');
      }
      // Reads that happen to be POSTs stay reads: pin and view are personal.
      expect((await post(`/api/v1/documents/${id}/pin`, {}, half)).statusCode).toBeLessThan(300);

      // Holding every world is enough, and the document is untouched by the refusals above.
      const ok = await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: auth(whole),
        payload: { title: 'שונה בידי מי שמחזיק בשני העולמות' },
      });
      expect(ok.statusCode, ok.body).toBe(200);
      expect((await post(`/api/v1/documents/${id}/publish`, { label: 'v2' }, whole)).statusCode).toBe(200);
    });

    it("a single-world document is still the one-world manager's to write", async () => {
      const id = await makeDoc('גבייה בלבד', 'billing');
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/v1/documents/${id}`,
        headers: auth(half),
        payload: { title: 'גבייה — עודכן' },
      });
      expect(r.statusCode, r.body).toBe(200);
    });

    it('bulk skips a two-world document for a one-world manager, but still pins it', async () => {
      const shared = await makeDoc('בכמות משותף', 'billing', ['sim']);
      const own = await makeDoc('בכמות גבייה', 'billing');
      const r = await post(
        '/api/v1/documents/bulk',
        { action: 'set-priority', ids: [shared, own], priority: 'h' },
        half,
      );
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().affected).toBe(1);
      expect(r.json().skipped).toEqual([{ id: shared, reason: expect.stringContaining('sim') }]);
      const pin = await post('/api/v1/documents/bulk', { action: 'pin', ids: [shared] }, half);
      expect(pin.json()).toMatchObject({ affected: 1, skipped: [] });
    });

    it('trash: restoring or purging a two-world document needs both worlds; restore-all leaves it', async () => {
      // A draft: a once-published document is archived, not deleted.
      const id = await makeDoc('לסל', 'billing', ['sim'], null, false);
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/v1/documents/${id}`, headers: auth(admin) }))
          .statusCode,
      ).toBe(200);
      // Listed for the one-world manager (a read) …
      const list = (await app.inject({ method: 'GET', url: '/api/v1/trash', headers: auth(half) })).json();
      expect(list.items.some((i: { id: string }) => i.id === id)).toBe(true);
      // … but not theirs to bring back or destroy.
      expect((await post(`/api/v1/trash/document/${id}/restore`, {}, half)).statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'DELETE', url: `/api/v1/trash/document/${id}`, headers: auth(half) }))
          .statusCode,
      ).toBe(403);
      await post('/api/v1/trash/restore-all', {}, half);
      const still = await db.pool.query('select deleted_at from documents where id=$1', [id]);
      expect(still.rows[0].deleted_at).not.toBeNull();
      // Holding both worlds restores it.
      expect((await post(`/api/v1/trash/document/${id}/restore`, {}, whole)).statusCode).toBe(200);
    });
  });

  describe('blocks', () => {
    it('a block used in two worlds is readable by a one-world manager but not editable or deletable', async () => {
      await makeDoc('בלוק בגבייה', 'billing', [], blockId);
      await makeDoc('בלוק בסים', 'sim', [], blockId);
      expect(
        (await app.inject({ method: 'GET', url: `/api/v1/blocks/${blockId}`, headers: auth(half) }))
          .statusCode,
      ).toBe(200);
      const body = {
        title: 'בלוק משותף — שונה',
        kind: 'step',
        actions: [{ id: 'a1', text: 'פתח CRM' }],
        outcomes: [{ kind: 'ok', text: '✓ תקין' }],
      };
      const put = await app.inject({
        method: 'PUT',
        url: `/api/v1/blocks/${blockId}`,
        headers: auth(half),
        payload: body,
      });
      expect(put.statusCode).toBe(403);
      const del = await app.inject({
        method: 'DELETE',
        url: `/api/v1/blocks/${blockId}`,
        headers: auth(half),
      });
      expect(del.statusCode).toBe(403);
      expect(
        (await app.inject({ method: 'GET', url: `/api/v1/blocks/${blockId}`, headers: auth(admin) })).json()
          .title,
      ).toBe('בלוק משותף');
      const ok = await app.inject({
        method: 'PUT',
        url: `/api/v1/blocks/${blockId}`,
        headers: auth(whole),
        payload: body,
      });
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it("a block used only in the manager's world, or not used at all, is theirs to edit", async () => {
      const b = (
        await post('/api/v1/blocks', {
          title: 'בלוק גבייה',
          kind: 'step',
          actions: [{ id: 'a1', text: 'x' }],
          outcomes: [{ kind: 'ok', text: '✓' }],
        })
      ).json().id as string;
      const body = {
        title: 'בלוק גבייה — שונה',
        kind: 'step',
        actions: [{ id: 'a1', text: 'y' }],
        outcomes: [{ kind: 'ok', text: '✓' }],
      };
      expect(
        (await app.inject({ method: 'PUT', url: `/api/v1/blocks/${b}`, headers: auth(half), payload: body }))
          .statusCode,
      ).toBe(200);
      await makeDoc('בלוק גבייה בשימוש', 'billing', [], b);
      expect(
        (await app.inject({ method: 'PUT', url: `/api/v1/blocks/${b}`, headers: auth(half), payload: body }))
          .statusCode,
      ).toBe(200);
    });
  });

  describe('fields', () => {
    it('a field referenced in two worlds is readable but not editable, renameable or deletable by a one-world manager', async () => {
      // The documents above reference FIELD in billing and in sim.
      const enc = encodeURIComponent(FIELD);
      expect(
        (await app.inject({ method: 'GET', url: `/api/v1/fields/${enc}/page`, headers: auth(half) }))
          .statusCode,
      ).toBe(200);
      const put = await app.inject({
        method: 'PUT',
        url: `/api/v1/fields/${enc}`,
        headers: auth(half),
        payload: { name: FIELD, status: 'retired', path: 'CRM > לקוח' },
      });
      expect(put.statusCode).toBe(403);
      const rename = await post(
        `/api/v1/fields/${enc}/rename`,
        { newName: 'מזהה מנוי', updateReferences: true, label: 'x' },
        half,
      );
      expect(rename.statusCode).toBe(403);
      const del = await app.inject({ method: 'DELETE', url: `/api/v1/fields/${enc}`, headers: auth(half) });
      expect(del.statusCode).toBe(403);
      const field = await db.pool.query('select status, deleted_at from crm_fields where name=$1', [FIELD]);
      expect(field.rows[0]).toMatchObject({ status: 'ok', deleted_at: null });
      // Holding both worlds is enough.
      const ok = await app.inject({
        method: 'PUT',
        url: `/api/v1/fields/${enc}`,
        headers: auth(whole),
        payload: { name: FIELD, status: 'ok', path: 'CRM > לקוח > מנוי' },
      });
      expect(ok.statusCode, ok.body).toBe(200);
    });
  });

  describe('learning items', () => {
    /**
     * The derived case: a briefing with no `world_slug` spans the union of its documents' worlds
     * (`worldsOfItem`). One `billing` and one `sim` document make it a two-world item.
     */
    it('a briefing citing a billing and a sim document is readable but not writable by a billing manager', async () => {
      const billingDoc = await makeDoc('תדריך גבייה', 'billing');
      const simDoc = await makeDoc('תדריך סים', 'sim');
      const item = (await post('/api/v1/learning/items', { kind: 'briefing', title: 'תדריך משותף' })).json();
      const entries = await app.inject({
        method: 'PUT',
        url: `/api/v1/learning/items/${item.id}/entries`,
        headers: auth(admin),
        payload: { entries: [{ documentId: billingDoc }, { documentId: simDoc }] },
      });
      expect(entries.statusCode, entries.body).toBe(200);

      const base = `/api/v1/learning/items/${item.id}`;
      expect((await app.inject({ method: 'GET', url: base, headers: auth(half) })).statusCode).toBe(200);
      expect(
        (await app.inject({ method: 'GET', url: `${base}/versions`, headers: auth(half) })).statusCode,
      ).toBe(200);
      expect(
        (await app.inject({ method: 'GET', url: `${base}/completion`, headers: auth(half) })).statusCode,
      ).toBe(200);

      const writes = [
        { method: 'PATCH' as const, url: base, payload: { title: 'שונה' } },
        {
          method: 'PUT' as const,
          url: `${base}/entries`,
          payload: { entries: [{ documentId: billingDoc }] },
        },
        { method: 'POST' as const, url: `${base}/publish`, payload: { label: 'v1' } },
        { method: 'POST' as const, url: `${base}/assign`, payload: { userIds: [half.id] } },
        { method: 'DELETE' as const, url: base },
      ];
      for (const w of writes) {
        const r = await app.inject({ ...w, headers: auth(half) });
        expect(r.statusCode, `${w.method} ${w.url}`).toBe(403);
      }
      const after = (await app.inject({ method: 'GET', url: base, headers: auth(admin) })).json();
      expect(after.title).toBe('תדריך משותף');
      expect(after.entries).toHaveLength(2);

      // Holding both worlds is enough.
      const ok = await app.inject({
        method: 'PATCH',
        url: base,
        headers: auth(whole),
        payload: { title: 'שונה' },
      });
      expect(ok.statusCode, ok.body).toBe(200);
    });

    it("an item in the manager's own world only stays theirs to write", async () => {
      const item = (
        await post(
          '/api/v1/learning/items',
          { kind: 'quiz', title: 'בוחן גבייה', worldSlug: 'billing' },
          half,
        )
      ).json();
      const r = await app.inject({
        method: 'PATCH',
        url: `/api/v1/learning/items/${item.id}`,
        headers: auth(half),
        payload: { title: 'בוחן גבייה — שונה' },
      });
      expect(r.statusCode, r.body).toBe(200);
    });

    /**
     * Review of A-M6: an item with no world of its own spans its cited documents' worlds, so the
     * write that changes what it cites (or clears its world) is judged on the item it leaves.
     */
    describe('writes that move an item into other worlds', () => {
      let billingDoc: string;
      let simDoc: string;
      let mixedDoc: string;
      const item = async (payload: Record<string, unknown>, as = half) => {
        const r = await post('/api/v1/learning/items', { title: 'עולמות', ...payload }, as);
        expect(r.statusCode, r.body).toBe(201);
        return r.json().id as string;
      };
      const put = (id: string, what: 'entries' | 'questions', docs: string[], as = half) =>
        app.inject({
          method: 'PUT',
          url: `/api/v1/learning/items/${id}/${what}`,
          headers: auth(as),
          payload:
            what === 'entries'
              ? { entries: docs.map((documentId) => ({ documentId })) }
              : {
                  questions: docs.map((documentId) => ({
                    documentId,
                    stem: 'שאלה',
                    kind: 'single',
                    options: [{ id: 'a', text: 'נכון', correct: true }],
                  })),
                },
        });
      const counts = async (id: string) => {
        const r = await db.pool.query(
          `select (select count(*)::int from briefing_entries where item_id=$1) e,
                  (select count(*)::int from quiz_questions where item_id=$1) q,
                  (select world_slug from learning_items where id=$1) w`,
          [id],
        );
        return r.rows[0] as { e: number; q: number; w: string | null };
      };

      beforeAll(async () => {
        billingDoc = await makeDoc('עולמות גבייה', 'billing');
        simDoc = await makeDoc('עולמות סים', 'sim');
        mixedDoc = await makeDoc('עולמות גבייה+סים', 'billing', ['sim']);
      });

      it('entries: a world-less briefing cannot be made to cite a document the caller cannot see', async () => {
        const id = await item({ kind: 'briefing', worldSlug: null });
        const r = await put(id, 'entries', [billingDoc, simDoc]);
        expect(r.statusCode, r.body).toBe(404);
        expect(r.body).not.toContain('עולמות סים');
        expect((await counts(id)).e).toBe(0);
      });

      it('entries: a billing briefing cannot cite a sim-only document either (the response would leak it)', async () => {
        const id = await item({ kind: 'briefing', worldSlug: 'billing' });
        expect((await put(id, 'entries', [simDoc])).statusCode).toBe(404);
        expect((await counts(id)).e).toBe(0);
      });

      it('entries: citing a readable two-world document that would make the item two-world is a 403 and rolls back', async () => {
        const id = await item({ kind: 'briefing', worldSlug: null });
        const r = await put(id, 'entries', [mixedDoc]);
        expect(r.statusCode, r.body).toBe(403);
        expect(r.json().code).toBe('SCOPE_DENIED');
        expect((await counts(id)).e).toBe(0);
        // A billing-only citation keeps the item in the caller's world.
        expect((await put(id, 'entries', [billingDoc])).statusCode).toBe(200);
        // Holding both worlds, or none of the scoping, is enough.
        expect((await put(id, 'entries', [mixedDoc, billingDoc], whole)).statusCode).toBe(200);
        const other = await item({ kind: 'briefing', worldSlug: null }, admin);
        expect((await put(other, 'entries', [simDoc, billingDoc], admin)).statusCode).toBe(200);
        expect((await counts(other)).e).toBe(2);
      });

      it('questions: the same two checks, on a world-less quiz', async () => {
        const id = await item({ kind: 'quiz', worldSlug: null });
        expect((await put(id, 'questions', [simDoc])).statusCode).toBe(404);
        const r = await put(id, 'questions', [billingDoc, mixedDoc]);
        expect(r.statusCode, r.body).toBe(403);
        expect(r.json().code).toBe('SCOPE_DENIED');
        expect((await counts(id)).q).toBe(0);
        expect((await put(id, 'questions', [billingDoc, mixedDoc], whole)).statusCode).toBe(200);
        expect((await counts(id)).q).toBe(2);
        const other = await item({ kind: 'quiz', worldSlug: null }, admin);
        expect((await put(other, 'questions', [simDoc], admin)).statusCode).toBe(200);
      });

      it('PATCH worldSlug:null on a billing item citing a sim document hands it to sim — 403, the world stays', async () => {
        // A billing item may cite a readable two-world document: its own world decides.
        const id = await item({ kind: 'briefing', worldSlug: 'billing' });
        expect((await put(id, 'entries', [mixedDoc])).statusCode).toBe(200);
        const patch = (payload: Record<string, unknown>, as = half) =>
          app.inject({ method: 'PATCH', url: `/api/v1/learning/items/${id}`, headers: auth(as), payload });
        const r = await patch({ worldSlug: null, title: 'בלי עולם' });
        expect(r.statusCode, r.body).toBe(403);
        expect(r.json().code).toBe('SCOPE_DENIED');
        const row = await db.pool.query('select world_slug, title from learning_items where id=$1', [id]);
        expect(row.rows[0]).toMatchObject({ world_slug: 'billing', title: 'עולמות' });
        // Other patches of the same item are untouched by the rule.
        expect((await patch({ title: 'שונה' })).statusCode).toBe(200);
        const ok = await patch({ worldSlug: null }, whole);
        expect(ok.statusCode, ok.body).toBe(200);
        expect((await counts(id)).w).toBeNull();
        expect((await patch({ worldSlug: 'billing' }, admin)).statusCode).toBe(200);
        expect((await patch({ worldSlug: null }, admin)).statusCode).toBe(200);
      });

      it('POST and /generate do not open the same hole', async () => {
        // Create takes no references; a world the caller does not hold is refused up front.
        expect(
          (await post('/api/v1/learning/items', { kind: 'quiz', title: 'x', worldSlug: 'sim' }, half))
            .statusCode,
        ).toBe(403);
        // Generate saves nothing and refuses documents the caller cannot read (A-I5).
        const id = await item({ kind: 'quiz', worldSlug: null });
        const g = await post(`/api/v1/learning/items/${id}/generate`, { documentIds: [simDoc] }, half);
        expect(g.statusCode).toBe(404);
        expect((await counts(id)).q).toBe(0);
      });
    });

    /**
     * A-M8: `canSeeById` is the lean loader the routes use; `canSee` is the one that takes an
     * assembled item. They share one rule (`seesItem`), so over every viewer × item pair here —
     * unscoped, one-world, two-world, non-manager; draft and published; with a world, derived
     * worlds, and none — the two must give the same answer.
     */
    it('A-M8: canSeeById and canSee agree for every viewer and item', async () => {
      const billingDoc = await makeDoc('ראות גבייה', 'billing');
      const simDoc = await makeDoc('ראות סים', 'sim');
      const create = async (payload: Record<string, unknown>, entries: string[], publish: boolean) => {
        const item = (
          await post('/api/v1/learning/items', { kind: 'briefing', title: 'ראות', ...payload })
        ).json();
        if (entries.length)
          await app.inject({
            method: 'PUT',
            url: `/api/v1/learning/items/${item.id}/entries`,
            headers: auth(admin),
            payload: { entries: entries.map((documentId) => ({ documentId })) },
          });
        if (publish) await post(`/api/v1/learning/items/${item.id}/publish`, { label: 'v1' });
        return item.id as string;
      };
      const items = [
        await create({ worldSlug: 'sim' }, [], false),
        await create({ worldSlug: 'sim' }, [], true),
        await create({}, [billingDoc, simDoc], true),
        await create({}, [billingDoc], false),
        await create({}, [], true),
      ];
      const perms = new Set(['learning.read']);
      const u = (worldScopes: string[] | null, manage: boolean) => ({
        user: {
          id: admin.id,
          displayName: 'x',
          roles: [],
          permissions: manage ? new Set([...perms, 'learning.manage']) : perms,
          worldScopes,
          categoryScopes: worldScopes,
          sessionId: null,
        } as unknown as Parameters<typeof learning.viewerOf>[0],
        manage,
      });
      const viewers = [
        u(null, true),
        u(['billing'], true),
        u(['billing', 'sim'], true),
        u(['tech'], true),
        u(['billing'], false),
      ];
      for (const id of items)
        for (const v of viewers) {
          const full = await learning.getItem(db.pool, id);
          const viaFull = !!full && (await learning.canSee(db.pool, full, v));
          const head = await learning.canSeeById(db.pool, id, v);
          expect(head !== null, `${id} ${JSON.stringify(v.user.worldScopes)} manage=${v.manage}`).toBe(
            viaFull,
          );
          if (head && v.user.worldScopes !== null)
            expect(new Set(head.worlds)).toEqual(new Set(await learning.worldsOfItem(db.pool, id)));
        }
    });
  });

  /**
   * Coordinator ruling on Y1's "not done": the two document writers that had no world check at
   * all. `POST /suggestions/publish` applies every accepted suggestion of a source in one
   * transaction, so one out-of-scope target refuses the whole request and nothing is applied.
   */
  describe('suggestions publish', () => {
    const seedSource = async (targets: string[]) => {
      const src = (
        await db.pool.query(`insert into sources(kind, title) values ('docx','מקור') returning id`)
      ).rows[0].id as string;
      const rev = (
        await db.pool.query(
          `insert into source_revisions(source_id, hash, paragraphs) values ($1,'h1','[]'::jsonb) returning id`,
          [src],
        )
      ).rows[0].id as string;
      for (const target of targets)
        await db.pool.query(
          `insert into suggestions(source_revision_id, anchor, type, title, target_document_id, target_step_key, payload, confidence, rationale, status)
           values ($1,'§1','update-step','עדכון',$2,'s2',$3,0.9,'המקור עודכן','accepted')`,
          [
            rev,
            target,
            JSON.stringify({
              type: 'update-step',
              addActions: ['פעולה מהמקור'],
              outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              patch: {},
            }),
          ],
        );
      return src;
    };
    const versionOf = async (id: string) =>
      (await db.pool.query('select current_version v from documents where id=$1', [id])).rows[0].v as number;

    it('refuses the whole publish when one target spans a world the caller does not hold', async () => {
      const own = await makeDoc('הצעה גבייה', 'billing');
      const shared = await makeDoc('הצעה משותף', 'billing', ['sim']);
      const src = await seedSource([own, shared]);
      const before = [await versionOf(own), await versionOf(shared)];

      const r = await post('/api/v1/suggestions/publish', { sourceId: src }, half);
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json()).toMatchObject({ code: 'SCOPE_DENIED', details: { worlds: ['billing', 'sim'] } });
      // Nothing half-published: neither document moved and both suggestions are still accepted.
      expect([await versionOf(own), await versionOf(shared)]).toEqual(before);
      const statuses = await db.pool.query(
        `select g.status from suggestions g join source_revisions sr on sr.id=g.source_revision_id where sr.source_id=$1`,
        [src],
      );
      expect(statuses.rows.map((x) => x.status)).toEqual(['accepted', 'accepted']);

      const ok = await post('/api/v1/suggestions/publish', { sourceId: src }, whole);
      expect(ok.statusCode, ok.body).toBe(200);
      expect(ok.json().applied).toBe(2);
      expect(await versionOf(shared)).toBe(before[1] + 1);
    });

    it('lets a one-world manager publish a source whose targets are all in their world', async () => {
      const own = await makeDoc('הצעה גבייה בלבד', 'billing');
      const src = await seedSource([own]);
      const r = await post('/api/v1/suggestions/publish', { sourceId: src }, half);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().applied).toBe(1);
    });

    it('counts the world a new-card would be created in', async () => {
      const src = (
        await db.pool.query(`insert into sources(kind, title) values ('docx','מקור חדש') returning id`)
      ).rows[0].id as string;
      const rev = (
        await db.pool.query(
          `insert into source_revisions(source_id, hash, paragraphs) values ($1,'h2','[]'::jsonb) returning id`,
          [src],
        )
      ).rows[0].id as string;
      await db.pool.query(
        `insert into suggestions(source_revision_id, anchor, type, title, payload, confidence, rationale, status)
         values ($1,'§1','new-card','כרטיס חדש',$2,0.9,'חדש','accepted')`,
        [
          rev,
          JSON.stringify({
            type: 'new-card',
            title: 'כרטיס חדש בסים',
            description: '',
            category: 'sim',
            wave: 1,
            priority: 'm',
            phases: [],
          }),
        ],
      );
      const r = await post('/api/v1/suggestions/publish', { sourceId: src }, half);
      expect(r.statusCode, r.body).toBe(403);
      expect(r.json().details.worlds).toEqual(['sim']);
    });
  });

  /** `POST /sync/links/:id/{sync,resolve}` write the linked document in either direction. */
  describe('sync links', () => {
    let stub: WpStub;
    let linkId: string;

    beforeAll(async () => {
      stub = await startWpStub([]);
      const created = await post('/api/v1/connectors', {
        type: 'wordpress',
        name: 'אתר תמיכה',
        config: {
          baseUrl: stub.url,
          username: 'kb',
          applicationPassword: 'pw',
          postTypes: ['posts'],
          categoryMap: {},
          webhookSecret: 'topsecret1',
        },
      });
      expect(created.statusCode, created.body).toBe(201);
      const connectorId = created.json().id as string;
      const docId = await makeDoc('מקושר משותף', 'billing', ['sim']);
      await app.connectors.sync.pushDocument(connectorId, docId, null);
      linkId = (
        await db.pool.query('select id from sync_links where connector_id=$1 and document_id=$2', [
          connectorId,
          docId,
        ])
      ).rows[0].id as string;
    });
    afterAll(async () => {
      await stub?.close();
    });

    it('a one-world manager may not push, import or resolve a two-world linked document', async () => {
      for (const direction of ['push', 'import']) {
        const r = await post(`/api/v1/sync/links/${linkId}/sync`, { direction }, half);
        expect(r.statusCode, direction).toBe(403);
        expect(r.json()).toMatchObject({ code: 'SCOPE_DENIED', details: { worlds: ['billing', 'sim'] } });
      }
      const res = await post(`/api/v1/sync/links/${linkId}/resolve`, { resolution: 'ours' }, half);
      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe('SCOPE_DENIED');
    });

    it('a manager holding both worlds gets through', async () => {
      const r = await post(`/api/v1/sync/links/${linkId}/sync`, { direction: 'push' }, whole);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json()).toMatchObject({ conflicts: 0, errors: [] });
      // Past the scope gate: the request is judged on its body, not refused for its worlds.
      const res = await post(`/api/v1/sync/links/${linkId}/resolve`, { resolution: 'merged' }, whole);
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe('MERGE_REQUIRED');
    });
  });

  /**
   * Review of A-M6: restoring or purging a trashed block or CRM field changes every document that
   * uses it, so it follows `assertBlockWritable` / `assertFieldWritable` — every world of those
   * documents. The bulk routes leave such items in the trash rather than refusing the batch.
   */
  describe('trash: blocks and fields', () => {
    const draft = async (title: string, category: string, text: string, block: string | null = null) => {
      const r = await post('/api/v1/documents', {
        title,
        category,
        worlds: [],
        wave: 1,
        priority: 'm',
        kind: 'steps',
      });
      expect(r.statusCode, r.body).toBe(201);
      await putStructure(r.json().id as string, text, block);
    };
    /** The row's `deleted_at` (null once restored), or 'gone' once purged. */
    const trashed = async (table: 'blocks' | 'crm_fields', key: string, id: string) => {
      const r = await db.pool.query(`select deleted_at from ${table} where ${key}=$1`, [id]);
      return r.rowCount ? (r.rows[0].deleted_at as Date | null) : 'gone';
    };
    const del = (url: string, as = half, headers: Record<string, string> = {}) =>
      app.inject({ method: 'DELETE', url, headers: { ...auth(as), ...headers } });

    it('a block used in billing and sim: a billing manager may not restore or purge it; bulk leaves it', async () => {
      const b = (
        await post('/api/v1/blocks', {
          title: 'בלוק לסל',
          kind: 'step',
          actions: [{ id: 'a1', text: 'x' }],
          outcomes: [{ kind: 'ok', text: '✓' }],
        })
      ).json().id as string;
      await draft('בלוק לסל גבייה', 'billing', 'המשך', b);
      await draft('בלוק לסל סים', 'sim', 'המשך', b);
      expect((await del(`/api/v1/blocks/${b}`, admin)).statusCode).toBeLessThan(300);

      expect((await post(`/api/v1/trash/block/${b}/restore`, {}, half)).statusCode).toBe(403);
      expect((await del(`/api/v1/trash/block/${b}`)).statusCode).toBe(403);
      expect((await post('/api/v1/trash/restore-all', {}, half)).statusCode).toBe(200);
      expect(await trashed('blocks', 'id', b)).toBeInstanceOf(Date);
      expect((await del('/api/v1/trash', half, { 'x-confirm': 'empty' })).statusCode).toBe(200);
      expect(await trashed('blocks', 'id', b)).toBeInstanceOf(Date);

      expect((await post(`/api/v1/trash/block/${b}/restore`, {}, whole)).statusCode).toBe(200);
      expect(await trashed('blocks', 'id', b)).toBeNull();
      // Unscoped: purge goes through.
      expect((await del(`/api/v1/blocks/${b}`, admin)).statusCode).toBeLessThan(300);
      expect((await del(`/api/v1/trash/block/${b}`, admin)).statusCode).toBe(204);
      expect(await trashed('blocks', 'id', b)).toBe('gone');
    });

    it('a CRM field mentioned in billing and sim: the same rule', async () => {
      const F = 'קוד לסל';
      const enc = encodeURIComponent(F);
      expect(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/v1/fields/${enc}`,
            headers: auth(admin),
            payload: { name: F, status: 'ok', path: 'CRM > לקוח' },
          })
        ).statusCode,
      ).toBe(200);
      await draft('שדה לסל גבייה', 'billing', `בדוק את ${F}`);
      await draft('שדה לסל סים', 'sim', `בדוק את ${F}`);
      expect((await del(`/api/v1/fields/${enc}`, admin)).statusCode).toBeLessThan(300);

      expect((await post(`/api/v1/trash/field/${enc}/restore`, {}, half)).statusCode).toBe(403);
      expect((await del(`/api/v1/trash/field/${enc}`)).statusCode).toBe(403);
      await post('/api/v1/trash/restore-all', {}, half);
      await del('/api/v1/trash', half, { 'x-confirm': 'empty' });
      expect(await trashed('crm_fields', 'name', F)).toBeInstanceOf(Date);

      expect((await post(`/api/v1/trash/field/${enc}/restore`, {}, whole)).statusCode).toBe(200);
      expect(await trashed('crm_fields', 'name', F)).toBeNull();
      expect((await del(`/api/v1/fields/${enc}`, admin)).statusCode).toBeLessThan(300);
      expect((await post(`/api/v1/trash/field/${enc}/restore`, {}, admin)).statusCode).toBe(200);
    });

    it("a block used only in the caller's world is theirs to restore", async () => {
      const b = (
        await post('/api/v1/blocks', {
          title: 'בלוק גבייה לסל',
          kind: 'step',
          actions: [{ id: 'a1', text: 'x' }],
          outcomes: [{ kind: 'ok', text: '✓' }],
        })
      ).json().id as string;
      await draft('בלוק גבייה לסל מסמך', 'billing', 'המשך', b);
      expect((await del(`/api/v1/blocks/${b}`, admin)).statusCode).toBeLessThan(300);
      expect((await post(`/api/v1/trash/block/${b}/restore`, {}, half)).statusCode).toBe(200);
    });
  });
});
