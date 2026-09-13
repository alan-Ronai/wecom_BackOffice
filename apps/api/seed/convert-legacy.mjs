/**
 * Convert the static legacy library (`legacy/js/data.js`, `legacy/js/data-docs.js`) into the JSON
 * the seed command loads. Run with `pnpm --filter @wecom/api convert:legacy`; the output under
 * `apps/api/seed/*.json` is committed so seeding never has to parse the legacy bundles again.
 *
 * Decision — card-only topics: `KB.TOPICS` entries without a `docId` have no written procedure.
 * They are emitted to `cards.json` and seeded as ordinary `documents` rows with `status = 'draft'`,
 * zero phases, `topic_id` = the legacy numeric id and `current_version = 0`. The list endpoint
 * returns them as cards with `stepCount = 0` and the frontend renders them as placeholders
 * ("כרטיס ללא מסמך"). Writing the procedure is a normal `PUT /documents/:id/structure` + publish,
 * so there is no separate table and no second code path.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import vm from 'node:vm';
import { DocumentSchema } from '@wecom/shared';

const here = new URL('./', import.meta.url);

// --- load the legacy bundles in a bare `window.KB` context ------------------
const ctx = { window: {} };
ctx.window.KB = {};
ctx.KB = ctx.window.KB;
vm.createContext(ctx);
for (const f of ['../../../legacy/js/data.js', '../../../legacy/js/data-docs.js'])
  vm.runInContext(readFileSync(new URL(f, import.meta.url), 'utf8'), ctx);
const KB = ctx.window.KB;

// --- deterministic ids ------------------------------------------------------
const uuidFrom = (s) => {
  const h = createHash('sha1').update(s).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const blockId = (slug) => uuidFrom('block:' + slug);
const docId = (legacyId) => uuidFrom('doc:' + legacyId);
const scriptId = (legacyId) => uuidFrom('script:' + legacyId);
/** Legacy ids like `pdf_001` are not valid slugs (underscore); `-` keeps them readable. */
const slugOf = (legacyId) => String(legacyId).toLowerCase().replace(/_/g, '-');
const at = (day) => new Date((day ?? '2025-01-01') + 'T12:00:00.000Z').toISOString();

const EXTRAS = ['signals', 'pillars', 'stages', 'objection', 'principles', 'icon'];

const mapStep = (s) => {
  const extras = {};
  for (const k of EXTRAS) if (s[k] !== undefined) extras[k] = s[k];
  const step = {
    key: s.id,
    num: String(s.num),
    title: s.title ?? '',
    description: s.desc,
    hint: s.hint,
    tone: s.tone,
    blockId: s.block ? blockId(s.block) : undefined,
    blockRefs: (s.blockRefs ?? []).map(blockId),
    script: s.script,
    sourceRef: s.source,
    deps: s.deps ?? [],
    actions: (s.actions ?? []).map((a) => ({ id: a.id, text: a.text })),
    outcomes: (s.outcomes ?? []).map((o) => ({ kind: o.kind, text: o.text, goto: o.goto })),
    branch: s.branch,
    extras: Object.keys(extras).length ? extras : undefined,
  };
  for (const k of Object.keys(step)) if (step[k] === undefined) delete step[k];
  return step;
};

const mapDoc = (d) => ({
  id: docId(d.id),
  slug: slugOf(d.id),
  code: d.code,
  title: d.title,
  description: d.desc ?? '',
  category: d.cat,
  wave: d.wave,
  priority: d.pri ?? 'm',
  kind: d.kind === 'retain' ? 'retention' : 'steps',
  status: d.status ?? 'published',
  currentVersion: d.version ?? 1,
  sourceId: null,
  sourceRef: d.sourceDoc?.ref,
  phases: (d.phases ?? []).map((p) => ({
    id: p.id,
    label: p.label ?? '',
    note: p.note,
    route: p.route,
    steps: (p.steps ?? []).map(mapStep),
  })),
  related: (d.related ?? []).map((r) => ({ documentId: docId(r.docId), why: r.why })),
  createdAt: at(d.updated),
  updatedAt: at(d.updated),
});

const withAuthor = (doc, author, topicId) => ({ ...doc, _author: author ?? null, _topicId: topicId ?? null });

// --- documents --------------------------------------------------------------
const topicByDoc = new Map(KB.TOPICS.filter((t) => t.docId).map((t) => [t.docId, t.id]));
const documents = KB.SEED.docs.map((d) => {
  const mapped = mapDoc(d);
  DocumentSchema.parse(mapped); // fail loudly if the legacy shape drifts from the contract
  return withAuthor(mapped, d.author, d.topicId ?? topicByDoc.get(d.id) ?? null);
});

// --- card-only topics -------------------------------------------------------
const cards = KB.TOPICS.filter((t) => !t.docId).map((t) => ({
  topicId: t.id,
  id: uuidFrom('card:' + t.id),
  slug: 'topic-' + t.id,
  title: t.title,
  description: t.desc ?? '',
  category: t.cat,
  wave: t.wave,
  priority: t.pri ?? 'm',
}));

// --- blocks / fields / scripts ---------------------------------------------
const blocks = KB.BLOCKS.map((b) => ({
  id: blockId(b.id),
  slug: b.id,
  title: b.title,
  kind: b.kind ?? 'step',
  description: b.desc,
  script: b.script,
  actions: (b.actions ?? []).map((a) => ({ id: a.id, text: a.text })),
  outcomes: (b.outcomes ?? []).map((o) => ({ kind: o.kind, text: o.text, goto: o.goto })),
  currentVersion: b.version ?? 1,
  updatedAt: at(b.updated),
  _author: b.author ?? null,
}));

const fields = KB.CRM_FIELDS.map((f) => ({
  name: f.name,
  status: f.status ?? 'ok',
  renamedTo: f.renamedTo,
  path: f.path ?? '',
  updatedAt: at(f.updated),
}));

const scripts = KB.SCRIPTS.map((s) => ({
  id: scriptId(s.id),
  title: s.title,
  text: s.text,
  tags: s.tags ?? [],
  updatedAt: at(),
  _usedIn: (s.usedIn ?? []).map(docId),
}));

// --- versions ---------------------------------------------------------------
// Replays legacy `KB.docAtVersion`: the newest patch at or below the requested version describes
// the document's state then; `remove: true` drops a step and a `null` value deletes a key.
const clone = (x) => JSON.parse(JSON.stringify(x));
const legacyAtVersion = (legacyDoc, entries, v) => {
  const target = entries.find((e) => e.v === v);
  if (target?.snapshot) return target.snapshot;
  const base = clone(legacyDoc);
  if (target?.current) return base; // the head version is the document as it stands
  const patches = entries.filter((e) => e.v <= v && e.patch).sort((a, b) => b.v - a.v);
  if (patches.length)
    for (const pp of patches[0].patch)
      for (const ph of base.phases) {
        const i = (ph.steps ?? []).findIndex((s) => s.id === pp.stepId);
        if (i < 0) continue;
        if (pp.remove) {
          ph.steps.splice(i, 1);
          continue;
        }
        const cp = { ...pp };
        delete cp.stepId;
        for (const k of Object.keys(cp)) {
          if (cp[k] === null) delete ph.steps[i][k];
          else ph.steps[i][k] = cp[k];
        }
      }
  base.version = v;
  return base;
};

const versions = [];
for (const [legacyId, entries] of Object.entries(KB.SEED.versions ?? {})) {
  const legacyDoc = KB.SEED.docs.find((d) => d.id === legacyId);
  if (!legacyDoc) continue;
  for (const e of entries) {
    const snapshot = mapDoc({ ...legacyAtVersion(legacyDoc, entries, e.v), version: e.v });
    DocumentSchema.parse(snapshot);
    versions.push({
      slug: slugOf(legacyId),
      version: e.v,
      label: e.label ?? '',
      kind: e.kind ?? 'published',
      author: e.author ?? null,
      at: new Date(e.ts ?? Date.now()).toISOString(),
      snapshot,
    });
  }
}

// --- notes ------------------------------------------------------------------
const notes = KB.SEED.docs.flatMap((d) =>
  (d.notes ?? []).map((n) => ({
    slug: slugOf(d.id),
    stepKey: n.stepId ?? null,
    author: n.author ?? 'מערכת',
    text: n.text,
    likes: n.likes ?? 0,
    at: new Date(n.ts ?? Date.now()).toISOString(),
  })),
);

// --- write ------------------------------------------------------------------
mkdirSync(here, { recursive: true });
const write = (name, data) => {
  writeFileSync(new URL('./' + name, here), JSON.stringify(data, null, 1) + '\n');
  console.log(`${name}: ${Array.isArray(data) ? data.length : 1}`);
};
write('documents.json', documents);
write('cards.json', cards);
write('blocks.json', blocks);
write('fields.json', fields);
write('scripts.json', scripts);
write('versions.json', versions);
write('notes.json', notes);
