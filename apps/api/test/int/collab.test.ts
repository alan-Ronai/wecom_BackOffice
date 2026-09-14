import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startTestDb, integration } from '../helpers/db.js';
import { buildTestApp } from '../helpers/app.js';
import { makeUser, auth, minimalStructure } from '../helpers/fixtures.js';

const run = integration ? describe : describe.skip;

run('stage 5 — collaboration', () => {
  let db: Awaited<ReturnType<typeof startTestDb>>;
  let app: Awaited<ReturnType<typeof buildTestApp>>;
  let author: Awaited<ReturnType<typeof makeUser>>;
  let lead: Awaited<ReturnType<typeof makeUser>>;

  /** Creates a card with real steps, so an approve publishes rather than marking it partial. */
  const makeDoc = async (title: string, category = 'tech') => {
    const doc = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/documents',
        headers: auth(author),
        payload: { title, category, wave: 1, priority: 'm', kind: 'steps' },
      })
    ).json();
    const saved = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${doc.id}/structure`,
      headers: { ...auth(author), 'if-match': doc.etag },
      payload: minimalStructure,
    });
    expect(saved.statusCode).toBe(200);
    return saved.json();
  };

  beforeAll(async () => {
    db = await startTestDb();
    app = await buildTestApp(db.pool, db.url);
    await app.events.start(db.url);
    author = await makeUser(db.pool, { name: 'ענבר לוי' });
    lead = await makeUser(db.pool, { name: 'דנה רוזן' });
    // `leadIds` reads the real role graph, so the reviewer needs the role, not just the
    // permission set the test header carries.
    await db.pool.query(
      `insert into user_roles(user_id, role_id) select $1, id from roles where name='lead'`,
      [lead.id],
    );
  }, 180000);

  afterAll(async () => {
    await app.close();
    await db.stop();
  });

  it('seeds the five built-in templates from the legacy presets', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(author) });
    expect(r.statusCode).toBe(200);
    const builtIns = r.json().items.filter((t: { builtIn: boolean }) => t.builtIn);
    expect(builtIns).toHaveLength(5);
    // One phase whose steps are the preset items, exactly as the editor inserts them.
    expect(builtIns[0].phases).toHaveLength(1);
    expect(builtIns[0].phases[0].steps.length).toBeGreaterThan(3);
    expect(builtIns.map((t: { name: string }) => t.name)).toContain('שאלות בירור');
  });

  it('refuses to edit or delete a built-in template but accepts a new one', async () => {
    const builtIn = (await app.inject({ method: 'GET', url: '/api/v1/templates', headers: auth(author) }))
      .json()
      .items.find((t: { builtIn: boolean }) => t.builtIn);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/templates/${builtIn.id}`,
      headers: auth(author),
      payload: { name: 'שינוי' },
    });
    expect(patched.statusCode).toBe(409);
    expect(patched.json().code).toBe('BUILT_IN');
    const created = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      headers: auth(author),
      payload: {
        name: 'תבנית שימור',
        description: 'שיחת שימור',
        category: 'plans',
        kind: 'retention',
        phases: minimalStructure.phases,
      },
    });
    expect(created.statusCode).toBe(201);
    expect(created.json().builtIn).toBe(false);
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/templates/${created.json().id}`,
          headers: auth(author),
        })
      ).statusCode,
    ).toBe(204);
  });

  it('a comment that mentions someone notifies exactly that person', async () => {
    const doc = await makeDoc('איטיות גלישה');
    const before = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true',
      headers: auth(lead),
    });
    expect(before.json().unread).toBe(0);

    const comment = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/comments`,
      headers: auth(author),
      payload: { stepKey: 's1', text: 'ל@דנה רוזן — אפשר לאשר את הניסוח?' },
    });
    expect(comment.statusCode).toBe(201);
    expect(comment.json()).toMatchObject({ authorName: 'ענבר לוי', stepKey: 's1', likes: 0 });
    expect(comment.json().mentions).toEqual([{ userId: lead.id, displayName: 'דנה רוזן' }]);

    const bell = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true',
      headers: auth(lead),
    });
    expect(bell.json().unread).toBe(1);
    expect(bell.json().items[0]).toMatchObject({ kind: 'mention', entityType: 'comment' });
    expect(bell.json().items[0].title).toContain('ענבר לוי');
    // The author mentioned somebody else, so the author's own bell stays quiet.
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/notifications', headers: auth(author) })).json()
        .unread,
    ).toBe(0);

    // read → unread drops to zero and stays there
    const read = await app.inject({
      method: 'POST',
      url: '/api/v1/notifications/read',
      headers: auth(lead),
      payload: { ids: [bell.json().items[0].id] },
    });
    expect(read.json()).toEqual({ unread: 0 });

    // like, resolve, delete
    const id = comment.json().id;
    expect(
      (await app.inject({ method: 'POST', url: `/api/v1/comments/${id}/like`, headers: auth(lead) })).json(),
    ).toMatchObject({ likes: 1, likedByMe: true });
    const resolved = await app.inject({
      method: 'POST',
      url: `/api/v1/comments/${id}/resolve`,
      headers: auth(lead),
    });
    expect(resolved.json().resolvedByName).toBe('דנה רוזן');
    const stranger = await makeUser(db.pool, { perms: ['docs.read', 'notes.write'] });
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/comments/${id}`, headers: auth(stranger) }))
        .statusCode,
    ).toBe(403);
    expect(
      (await app.inject({ method: 'DELETE', url: `/api/v1/comments/${id}`, headers: auth(author) }))
        .statusCode,
    ).toBe(204);
  });

  it('offers mentionable users by prefix', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/v1/users/mentionable?q=דנה',
      headers: auth(author),
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().items.map((u: { displayName: string }) => u.displayName)).toContain('דנה רוזן');
  });

  it('request-review → approve publishes a version and notifies the requester', async () => {
    const doc = await makeDoc('חסימת גלישה');
    const requested = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(author),
      payload: { note: 'נא לאשר לפני הגל' },
    });
    expect(requested.statusCode).toBe(201);
    expect(requested.json()).toMatchObject({ status: 'open', requestedByName: 'ענבר לוי' });
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })).json()
        .status,
    ).toBe('review');
    // The lead holds docs.publish, so the request reached them without being named.
    const leadBell = await app.inject({
      method: 'GET',
      url: '/api/v1/notifications?unread=true',
      headers: auth(lead),
    });
    expect(leadBell.json().items[0]).toMatchObject({ kind: 'review', entityType: 'review_request' });

    const queue = await app.inject({
      method: 'GET',
      url: '/api/v1/reviews?status=open',
      headers: auth(lead),
    });
    expect(queue.json().total).toBe(1);
    expect(queue.json().items[0]).toMatchObject({ title: 'חסימת גלישה', category: 'tech' });

    const decided = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve', label: 'אושר לגל 1' },
    });
    expect(decided.statusCode).toBe(200);
    expect(decided.json()).toMatchObject({ status: 'approved', decidedByName: 'דנה רוזן' });

    const after = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })
    ).json();
    expect(after.status).toBe('published');
    expect(after.currentVersion).toBe(1);
    const versions = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/versions`, headers: auth(author) })
    ).json();
    expect(versions.items.at(-1)).toMatchObject({ version: 1, label: 'אושר לגל 1', authorName: 'דנה רוזן' });
    // ...and the requester is told, with the publish wording rather than the review one.
    const authorBell = (
      await app.inject({ method: 'GET', url: '/api/v1/notifications?unread=true', headers: auth(author) })
    ).json();
    expect(authorBell.items[0]).toMatchObject({ kind: 'publish' });
  });

  /**
   * E-2 (acceptance review §4, §7 item 9). The review filed a request and then approved it from
   * the same account; both calls returned 2xx and the review read `approved`. "Editor requests,
   * lead approves" is a PRD promise, and `docs.publish` alone did not enforce it.
   */
  it('the requester cannot approve their own review request', async () => {
    const doc = await makeDoc('אישור עצמי');
    // `lead` holds both the role and `docs.publish`, so the *only* thing standing between this
    // account and its own approval is the new check.
    const requested = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(lead),
      payload: {},
    });
    expect(requested.statusCode, requested.body).toBe(201);

    const self = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve' },
    });
    expect(self.statusCode, self.body).toBe(403);
    expect(self.json().code).toBe('SELF_APPROVAL');

    // Nothing moved: the request is still open and the document is still in review.
    const still = await db.pool.query(`select status from review_requests where document_id=$1`, [doc.id]);
    expect(still.rows[0].status).toBe('open');
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(lead) })).json()
        .status,
    ).toBe('review');

    // Somebody else can still approve it, so the guard is about *who*, not about the document.
    await db.pool.query(
      `insert into user_roles(user_id, role_id) select $1, id from roles where name='lead'`,
      [author.id],
    );
    const other = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(author),
      payload: { decision: 'approve' },
    });
    expect(other.statusCode, other.body).toBe(200);
    expect(other.json().status).toBe('approved');
  });

  it('the requester may still send their own document back to draft', async () => {
    // A withdrawal publishes nothing, so requiring a colleague for it would only strand drafts.
    const doc = await makeDoc('משיכה עצמית');
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(lead),
      payload: {},
    });
    const back = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'changes', note: 'נמשך לתיקון' },
    });
    expect(back.statusCode, back.body).toBe(200);
    expect(back.json().status).toBe('changes');
  });

  it('a changes decision sends the card back to draft', async () => {
    const doc = await makeDoc('תקלת SIM', 'sim');
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(author),
      payload: {},
    });
    const decided = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'changes', note: 'חסר שלב הסלמה' },
    });
    expect(decided.json()).toMatchObject({ status: 'changes', decisionNote: 'חסר שלב הסלמה' });
    expect(
      (await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })).json()
        .status,
    ).toBe('draft');
    // No open request left, so a second decision has nothing to decide.
    const again = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve' },
    });
    expect(again.statusCode).toBe(400);
  });

  /**
   * I5: the approval used to publish whatever the document was at decision time. Nothing
   * recorded what the reviewer was asked to look at, so an author could push edits between
   * "send to review" and "approve" and have them published under the reviewer's name.
   */
  it('refuses to approve a document that changed since the review was requested', async () => {
    const doc = await makeDoc('שינוי אחרי בקשה', 'tech');
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(author),
      payload: {},
    });

    // The author edits after asking. `PUT /structure` mints a new etag, which is the baseline
    // the request recorded — a version number alone would not have moved for a draft edit.
    const fresh = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })
    ).headers.etag as string;
    const edited = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${doc.id}/structure`,
      headers: { ...auth(author), 'if-match': fresh },
      payload: {
        phases: [
          {
            id: 'p1',
            label: 'שלב 1',
            steps: [
              {
                key: 's1',
                num: '1',
                title: 'צעד שנוסף אחרי הבקשה',
                blockRefs: [],
                deps: [],
                actions: [{ id: 'a1', text: 'משהו חדש' }],
                outcomes: [{ kind: 'ok', text: '✓ סיום' }],
              },
            ],
          },
        ],
      },
    });
    expect(edited.statusCode).toBe(200);

    const stale = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve' },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().code).toBe('REVIEW_STALE');
    // Nothing was published, and the request is still open for a second look.
    const after = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })
    ).json();
    expect(after.status).toBe('review');

    // Sending it back for changes needs no baseline — it cannot publish anything.
    const back = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'changes', note: 'נבדק שוב' },
    });
    expect(back.statusCode).toBe(200);

    // Asking again re-baselines on the edited document, and the approval then goes through.
    await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(author),
      payload: {},
    });
    const ok = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve' },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().status).toBe('approved');
  });

  it('saved views: CRUD, and a shared view is visible to everyone', async () => {
    const mine = await app.inject({
      method: 'POST',
      url: '/api/v1/views',
      headers: auth(author),
      payload: { name: 'הגל שלי', query: { wave: 1, category: 'tech' }, shared: false },
    });
    expect(mine.statusCode).toBe(201);
    expect(mine.json()).toMatchObject({ ownerName: 'ענבר לוי', shared: false });
    const shared = await app.inject({
      method: 'POST',
      url: '/api/v1/views',
      headers: auth(author),
      payload: { name: 'לכל הרצפה', query: { priority: 'hh' }, shared: true },
    });
    expect(shared.statusCode).toBe(201);

    const asLead = (await app.inject({ method: 'GET', url: '/api/v1/views', headers: auth(lead) })).json();
    const names = asLead.items.map((v: { name: string }) => v.name);
    expect(names).toContain('לכל הרצפה');
    expect(names).not.toContain('הגל שלי');

    // Somebody else's view is theirs to change.
    expect(
      (
        await app.inject({
          method: 'PATCH',
          url: `/api/v1/views/${shared.json().id}`,
          headers: auth(lead),
          payload: { shared: false },
        })
      ).statusCode,
    ).toBe(403);
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/v1/views/${mine.json().id}`,
      headers: auth(author),
      payload: { name: 'הגל שלי (מעודכן)', query: { wave: 2 } },
    });
    expect(patched.json()).toMatchObject({ name: 'הגל שלי (מעודכן)', query: { wave: 2 } });
    expect(
      (
        await app.inject({
          method: 'DELETE',
          url: `/api/v1/views/${mine.json().id}`,
          headers: auth(author),
        })
      ).statusCode,
    ).toBe(204);
  });

  it('presence: a heartbeat appears, an expired row disappears', async () => {
    const doc = await makeDoc('נוכחות');
    expect(
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/documents/${doc.id}/presence`,
          headers: auth(author),
        })
      ).statusCode,
    ).toBe(204);
    await app.inject({ method: 'POST', url: `/api/v1/documents/${doc.id}/presence`, headers: auth(lead) });
    const here = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/presence`, headers: auth(author) })
    ).json();
    expect(here.documentId).toBe(doc.id);
    expect(here.editors.map((e: { userId: string }) => e.userId).sort()).toEqual([author.id, lead.id].sort());
    expect(here.editors[0].initials).toBeTruthy();

    // Age one row past the 30 s TTL: it stops counting as present without being deleted.
    await db.pool.query(
      "update presence set last_seen_at = now() - interval '2 minutes' where user_id = $1 and document_id = $2",
      [lead.id, doc.id],
    );
    const later = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}/presence`, headers: auth(author) })
    ).json();
    expect(later.editors.map((e: { userId: string }) => e.userId)).toEqual([author.id]);
    expect((await db.pool.query('select count(*)::int n from presence')).rows[0].n).toBe(2);
  });

  it('bulk: a category-scoped user changes what they may and is told what they may not', async () => {
    const tech = await makeDoc('בולק טק', 'tech');
    const billing = await makeDoc('בולק חיוב', 'billing');
    const scoped = await makeUser(db.pool, { name: 'מוגבל', scopes: ['tech'] });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/bulk',
      headers: auth(scoped),
      payload: { ids: [tech.id, billing.id], action: 'set-priority', priority: 'hh' },
    });
    expect(r.statusCode).toBe(200);
    expect(r.json().affected).toBe(1);
    expect(r.json().skipped).toHaveLength(1);
    expect(r.json().skipped[0].id).toBe(billing.id);
    expect(r.json().skipped[0].reason).toContain('billing');
    expect(
      (await db.pool.query('select priority from documents where id=$1', [tech.id])).rows[0].priority,
    ).toBe('hh');
    expect(
      (await db.pool.query('select priority from documents where id=$1', [billing.id])).rows[0].priority,
    ).toBe('m');
    // Every document that was actually touched left an audit row of its own.
    const audited = await db.pool.query(
      `select count(*)::int n from audit_log where action='documents.bulk.set-priority' and entity_id=$1`,
      [tech.id],
    );
    expect(audited.rows[0].n).toBe(1);
  });

  it('bulk: an action the caller cannot perform skips everything with a reason', async () => {
    const doc = await makeDoc('בולק מחיקה');
    const agent = await makeUser(db.pool, { perms: ['docs.read', 'notes.write'] });
    const r = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/bulk',
      headers: auth(agent),
      payload: { ids: [doc.id], action: 'delete' },
    });
    expect(r.json()).toEqual({
      affected: 0,
      skipped: [{ id: doc.id, reason: 'אין הרשאה docs.delete' }],
    });
  });

  // N1 (re-review, important): a bulk `request-review` used to insert `review_requests`
  // with no `base_version`/`base_etag`, so the I5 staleness guard (`reviews.ts:191`) read
  // `null` as "predates the column" and skipped the check — a bulk-requested review could
  // be approved after arbitrary edits. It must be exactly as strict as the single-document
  // route.
  it('bulk: request-review records a baseline, so an edit before approval is caught as stale', async () => {
    const doc = await makeDoc('בולק בדיקה — בסיס חדש');
    const bulk = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/bulk',
      headers: auth(author),
      payload: { ids: [doc.id], action: 'request-review' },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().affected).toBe(1);

    const baseline = await db.pool.query(
      `select base_version, base_etag from review_requests where document_id=$1 and status='open'`,
      [doc.id],
    );
    // The bug: both columns stayed null, which the approve path treats as "no baseline
    // to check" rather than "this document has never moved since the request".
    expect(baseline.rows[0].base_version).not.toBeNull();
    expect(baseline.rows[0].base_etag).not.toBeNull();

    const fresh = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })
    ).headers.etag as string;
    const edited = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${doc.id}/structure`,
      headers: { ...auth(author), 'if-match': fresh },
      payload: minimalStructure,
    });
    expect(edited.statusCode).toBe(200);

    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve' },
    });
    // Before the fix this was 200: the null baseline let a post-request edit through
    // unreviewed under the reviewer's approval.
    expect(approve.statusCode).toBe(409);
    expect(approve.json().code).toBe('REVIEW_STALE');
  });

  it('bulk: request-review over an already-open request refreshes the baseline, not inherits it', async () => {
    const doc = await makeDoc('בולק בדיקה — דריסת בסיס');
    // Opens a request the single-document way, baselined on v1.
    const opened = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/request-review`,
      headers: auth(author),
      payload: {},
    });
    expect(opened.statusCode).toBe(201);

    // The document moves on while the request is still open — allowed; `reviews.ts`'s own
    // test above confirms editing during `status: 'review'` succeeds.
    const fresh = (
      await app.inject({ method: 'GET', url: `/api/v1/documents/${doc.id}`, headers: auth(author) })
    ).headers.etag as string;
    const edited = await app.inject({
      method: 'PUT',
      url: `/api/v1/documents/${doc.id}/structure`,
      headers: { ...auth(author), 'if-match': fresh },
      payload: minimalStructure,
    });
    expect(edited.statusCode).toBe(200);

    // A bulk request-review lands on the same still-open row (the partial unique index
    // matches it), hitting the `on conflict … do update` branch.
    const bulk = await app.inject({
      method: 'POST',
      url: '/api/v1/documents/bulk',
      headers: auth(author),
      payload: { ids: [doc.id], action: 'request-review' },
    });
    expect(bulk.statusCode).toBe(200);
    expect(bulk.json().affected).toBe(1);

    // The baseline must now be v2 (the edited document), not the v1 the single-document
    // request opened with — before the fix the `do update` never touched
    // base_version/base_etag, so the stale v1 baseline would have survived and wrongly
    // 409'd this legitimate approval.
    const approve = await app.inject({
      method: 'POST',
      url: `/api/v1/documents/${doc.id}/review-decision`,
      headers: auth(lead),
      payload: { decision: 'approve' },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().status).toBe('approved');
  });

  it('keeps a server-side draft for /edit/new', async () => {
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/drafts/new', headers: auth(author) })).statusCode,
    ).toBe(204);
    const put = await app.inject({
      method: 'PUT',
      url: '/api/v1/drafts/new',
      headers: auth(author),
      payload: { payload: { title: 'טיוטה חדשה', category: 'ops' } },
    });
    expect(put.statusCode).toBe(200);
    expect(put.json().documentId).toBeNull();
    const got = await app.inject({ method: 'GET', url: '/api/v1/drafts/new', headers: auth(author) });
    expect(got.json().payload).toEqual({ title: 'טיוטה חדשה', category: 'ops' });
    expect(
      (await app.inject({ method: 'DELETE', url: '/api/v1/drafts/new', headers: auth(author) })).statusCode,
    ).toBe(204);
  });
});
