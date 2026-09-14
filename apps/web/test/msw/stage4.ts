/**
 * msw fixtures + handlers for the stage-4 ("connected data") routes, kept beside the stage-1 set
 * rather than inside it so the two can be reviewed independently.
 *
 * As with `handlers.ts`, every response mirrors the **published contract**
 * (`docs/api/CONTRACTS-stage4-5.md`, schemas in `packages/shared/src/schemas/stage45.ts`) and is
 * parsed by the matching zod schema in `fixtures.test.ts`, so a mock cannot drift from the shape
 * backend lane A is building without a test failing.
 *
 * The graph is the single source the impact answers are *derived* from — `GET /graph/impact/:id`
 * walks the same edge list the graph route returns, exactly as the real route walks `document_links`.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Category } from '@wecom/shared';
import { fx, BLK_DEV, BLK_SIM, D_BROWSING, D_CHURN, D_INTL } from './fixtures.js';

/** Same frozen instant the stage-1 fixtures use, so every "updated at" in the app agrees. */
const T = '2025-06-12T12:48:00.000Z';
import type {
  BlockPage,
  ColumnMapping,
  Dashboard,
  DataFile,
  DataPreview,
  FieldPage,
  GraphEdge,
  GraphNode,
  GraphResponse,
  ImpactResponse,
} from '../../src/api/stage4.js';

const B = '/api/v1';

/* ── ids ──────────────────────────────────────────────────────────────────── */

export const SRC_TOPICS = 'bbbbbbbb-0000-4000-8000-00000000d001';
export const SRC_INTL_JSON = 'bbbbbbbb-0000-4000-8000-00000000d002';
export const SRC_CRM_JSON = 'bbbbbbbb-0000-4000-8000-00000000d003';
export const SRC_SCRIPTS_JSON = 'bbbbbbbb-0000-4000-8000-00000000d004';
export const SRC_AGENTS_CSV = 'bbbbbbbb-0000-4000-8000-00000000d005';
const REV_NEW = 'bbbbbbbb-0000-4000-8000-00000000e001';

const D_ESIM = 'aaaaaaaa-1111-4111-8111-000000000004';
const D_BILL = 'aaaaaaaa-1111-4111-8111-000000000005';
const D_ROAM = 'aaaaaaaa-1111-4111-8111-000000000007';

/** The renamed field the design walks through ("שירות נדידה" → "שירותי נדידה"). */
export const FIELD_ROAMING = 'שירות נדידה';

/* ── data explorer ────────────────────────────────────────────────────────── */

const mapping = (rows: [string, ColumnMapping['field'], string][]): ColumnMapping[] =>
  rows.map(([column, field, sample]) => ({ column, field, sample }));

const topicsMapping = mapping([
  ['title', 'title', 'איטיות גלישה'],
  ['desc', 'description', 'בדיקת מהירות ואז ריענון'],
  ['cat', 'category', 'tech'],
  ['wave', 'wave', '2'],
  ['pri', 'priority', 'high'],
  ['owner', 'ignore', 'alon@wecom.co.il'],
]);

export const dataFiles: DataFile[] = [
  {
    sourceId: SRC_TOPICS,
    title: 'topics.json',
    kind: 'json',
    rows: 38,
    columns: ['title', 'desc', 'cat', 'wave', 'pri', 'owner'],
    mapping: topicsMapping,
    syncState: 'synced',
    lastSyncedAt: T,
    linkedDocuments: 38,
    pendingSuggestions: 0,
  },
  {
    sourceId: SRC_INTL_JSON,
    title: 'intl-roaming.json',
    kind: 'json',
    rows: 14,
    columns: ['title', 'desc', 'cat'],
    mapping: mapping([
      ['title', 'title', 'אין גלישה בחו"ל'],
      ['desc', 'description', 'בדיקת נדידה'],
      ['cat', 'category', 'intl'],
    ]),
    syncState: 'synced',
    lastSyncedAt: T,
    linkedDocuments: 14,
    pendingSuggestions: 0,
  },
  {
    sourceId: SRC_CRM_JSON,
    title: 'crm-fields.json',
    kind: 'json',
    rows: 14,
    columns: ['name', 'path', 'status'],
    mapping: mapping([
      ['name', 'title', 'שירות נדידה'],
      ['path', 'description', 'CRM ↗ שירותים'],
      ['status', 'ignore', 'renamed'],
    ]),
    syncState: 'pending',
    lastSyncedAt: T,
    linkedDocuments: 0,
    pendingSuggestions: 3,
  },
  {
    sourceId: SRC_SCRIPTS_JSON,
    title: 'scripts.json',
    kind: 'json',
    rows: 7,
    columns: ['title', 'text'],
    mapping: mapping([
      ['title', 'title', 'פתיחת שיחה'],
      ['text', 'stepAction', 'אני מבינה את ההרגשה…'],
    ]),
    syncState: 'synced',
    lastSyncedAt: T,
    linkedDocuments: 7,
    pendingSuggestions: 0,
  },
  {
    sourceId: SRC_AGENTS_CSV,
    title: 'agents-scripts.csv',
    kind: 'csv',
    rows: 120,
    columns: ['agent', 'topic', 'line'],
    mapping: mapping([
      ['agent', 'ignore', 'ענבר ל.'],
      ['topic', 'ignore', 'tech'],
      ['line', 'ignore', 'בוא נבדוק יחד'],
    ]),
    syncState: 'error',
    lastSyncedAt: null,
    linkedDocuments: 0,
    pendingSuggestions: 0,
  },
];

const previewRows: Record<string, Record<string, string>[]> = {
  [SRC_TOPICS]: [
    {
      title: 'איטיות גלישה',
      desc: 'בדיקת מהירות ואז ריענון',
      cat: 'tech',
      wave: '2',
      pri: 'high',
      owner: 'alon@wecom.co.il',
    },
    {
      title: 'אין קליטה / אין שירות',
      desc: 'בדיקות רשת במכשיר',
      cat: 'tech',
      wave: '1',
      pri: 'high',
      owner: 'inbar@wecom.co.il',
    },
    {
      title: 'בעיות SMS',
      desc: 'שליחה וקבלה',
      cat: 'tech',
      wave: '3',
      pri: 'low',
      owner: 'alon@wecom.co.il',
    },
  ],
  [SRC_AGENTS_CSV]: [
    { agent: 'ענבר ל.', topic: 'tech', line: 'בוא נבדוק יחד את ההגדרות' },
    { agent: 'אלון מ.', topic: 'intl', line: 'אבדוק מול ספק הנדידה' },
  ],
};

const previewFor = (sourceId: string): DataPreview => {
  const file = dataFiles.find((f) => f.sourceId === sourceId);
  const rows = previewRows[sourceId] ?? [];
  return { columns: file?.columns ?? [], rows, total: file?.rows ?? rows.length };
};

/* ── graph ────────────────────────────────────────────────────────────────── */

const docNode = (id: string, label: string, category: Category, degree: number): GraphNode => ({
  id: `doc:${id}`,
  kind: 'document',
  label,
  category,
  status: 'published',
  degree,
});

export const graphNodes: GraphNode[] = [
  docNode(D_BROWSING, fx.docBrowsing.title, 'tech', 7),
  docNode(D_INTL, fx.docIntl.title, 'intl', 5),
  docNode(D_CHURN, 'דיבאג נטישה', 'ops', 3),
  docNode(D_ESIM, 'הפעלת eSIM – קוד QR', 'sim', 2),
  docNode(D_BILL, 'בירור חיוב גבוה / לא מזוהה', 'billing', 2),
  docNode(D_ROAM, 'רכישת חבילת חו"ל לפני טיסה', 'intl', 2),
  { id: `block:${BLK_SIM}`, kind: 'block', label: 'ריענון SIM', degree: 4 },
  { id: `block:${BLK_DEV}`, kind: 'block', label: 'בדיקות במכשיר הלקוח', degree: 2 },
  { id: `field:sim block lbl`, kind: 'field', label: 'sim block lbl', degree: 2 },
  { id: `field:${FIELD_ROAMING}`, kind: 'field', label: FIELD_ROAMING, status: 'renamed', degree: 3 },
  { id: `source:${fx.sources[0].id}`, kind: 'source', label: 'נהלי תמיכה טכנית', degree: 2 },
  { id: `script:${fx.scriptCards[0].id}`, kind: 'script', label: fx.scriptCards[0].title, degree: 1 },
];

const edge = (
  from: string,
  to: string,
  type: GraphEdge['type'],
  fromStepKey: string | null = null,
): GraphEdge => ({
  from,
  to,
  type,
  fromStepKey,
  origin: type === 'link' || type === 'next' || type === 'related' ? 'explicit' : 'detected',
});

export const graphEdges: GraphEdge[] = [
  edge(`doc:${D_CHURN}`, `doc:${D_BROWSING}`, 'link', 's2'),
  edge(`doc:${D_BILL}`, `doc:${D_BROWSING}`, 'link', 's3'),
  edge(`doc:${D_BROWSING}`, `doc:${D_INTL}`, 'next', 's15'),
  edge(`doc:${D_ESIM}`, `doc:${D_BROWSING}`, 'prerequisite', 's1'),
  edge(`doc:${D_ROAM}`, `doc:${D_INTL}`, 'related', 's4'),
  edge(`doc:${D_BROWSING}`, `block:${BLK_SIM}`, 'shares_block', 's11'),
  edge(`doc:${D_INTL}`, `block:${BLK_SIM}`, 'shares_block', 's7'),
  edge(`doc:${D_CHURN}`, `block:${BLK_DEV}`, 'shares_block', 's4'),
  edge(`doc:${D_BROWSING}`, `field:sim block lbl`, 'same_field', 's11'),
  edge(`doc:${D_INTL}`, `field:${FIELD_ROAMING}`, 'same_field', 's5'),
  edge(`doc:${D_ROAM}`, `field:${FIELD_ROAMING}`, 'same_field', 's3'),
  edge(`doc:${D_BILL}`, `field:${FIELD_ROAMING}`, 'same_field', 's2'),
  edge(`doc:${D_BROWSING}`, `source:${fx.sources[0].id}`, 'derived_from_source', null),
  edge(`doc:${D_CHURN}`, `script:${fx.scriptCards[0].id}`, 'related', 's1'),
];

const titleOf = (nodeId: string): string => graphNodes.find((n) => n.id === nodeId)?.label ?? nodeId;

/**
 * `?focus=` + `?depth=` walk the edge list undirected, so the returned subgraph is what is
 * reachable within `depth` hops — the same shape the route's recursive CTE produces.
 */
export const graphFor = (q: URLSearchParams): GraphResponse => {
  const types = (q.get('types') ?? '').split(',').filter(Boolean);
  const kinds = (q.get('kinds') ?? '').split(',').filter(Boolean);
  const category = q.get('category');
  const focus = q.get('focus');
  const depth = Number(q.get('depth') ?? 2);
  const limit = Number(q.get('limit') ?? 400);

  let edges = graphEdges;
  if (types.length) edges = edges.filter((e) => types.includes(e.type));

  let ids: Set<string> | null = null;
  if (focus) {
    let reached = new Set<string>([focus]);
    for (let hop = 0; hop < depth; hop++) {
      const next = new Set<string>(reached);
      for (const e of edges) {
        if (reached.has(e.from)) next.add(e.to);
        if (reached.has(e.to)) next.add(e.from);
      }
      reached = next;
    }
    ids = reached;
  }

  let nodes = graphNodes.filter((n) => !ids || ids.has(n.id));
  if (kinds.length) nodes = nodes.filter((n) => kinds.includes(n.kind));
  if (category) nodes = nodes.filter((n) => n.kind !== 'document' || n.category === category);

  const truncated = nodes.length > limit;
  nodes = nodes.slice(0, limit);
  const keep = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => keep.has(e.from) && keep.has(e.to)), truncated };
};

/** Everything pointing *at* the node — literally "what breaks if I delete this". */
export const impactFor = (nodeId: string): ImpactResponse => {
  const node = graphNodes.find((n) => n.id === nodeId) ?? {
    id: nodeId,
    kind: 'document' as const,
    label: nodeId,
    degree: 0,
  };
  const inbound = graphEdges
    .filter((e) => e.to === nodeId && e.from.startsWith('doc:'))
    .map((e) => ({
      documentId: e.from.slice('doc:'.length),
      title: titleOf(e.from),
      stepKey: e.fromStepKey,
      type: e.type,
    }));
  return {
    node,
    inbound,
    brokenLinks: inbound.filter((i) => i.type === 'link' || i.type === 'next').length,
    affectedDocuments: new Set(inbound.map((i) => i.documentId)).size,
  };
};

/* ── field page ───────────────────────────────────────────────────────────── */

export const fieldPageFor = (name: string): FieldPage | null => {
  const field = fx.fields.find((f) => f.name === name);
  if (!field) return null;
  const usage =
    name === FIELD_ROAMING
      ? [
          {
            documentId: D_INTL,
            title: fx.docIntl.title,
            category: 'intl' as Category,
            stepKey: 's5',
            stepNum: '5',
            stepTitle: 'בדיקת שירות נדידה',
            text: 'ודא ש**שירות נדידה** פעיל בכרטיס',
          },
          {
            documentId: D_ROAM,
            title: 'רכישת חבילת חו"ל לפני טיסה',
            category: 'intl' as Category,
            stepKey: 's3',
            stepNum: '3',
            stepTitle: 'הפעלת נדידה',
            text: 'אם **שירות נדידה** כבוי — הפעל',
          },
          {
            documentId: D_BILL,
            title: 'בירור חיוב גבוה / לא מזוהה',
            category: 'billing' as Category,
            stepKey: 's2',
            stepNum: '2',
            stepTitle: 'מקור החיוב',
            text: 'בדוק מתי **שירות נדידה** הופעל',
          },
        ]
      : [
          {
            documentId: D_BROWSING,
            title: fx.docBrowsing.title,
            category: 'tech' as Category,
            stepKey: 's11',
            stepNum: '11',
            stepTitle: 'ריענון SIM',
            text: `CRM ← מצב עריכה ← **${name}** ← שמור`,
          },
        ];
  const alerts: FieldPage['alerts'] =
    field.status === 'renamed'
      ? [
          {
            kind: 'renamed',
            message: `שונה שם ל-${field.renamedTo} · ${usage.length} הפניות עדיין על השם הישן`,
          },
        ]
      : field.status === 'new'
        ? [{ kind: 'new', message: 'שדה חדש — נוסף השבוע' }]
        : [];
  return {
    field,
    usage,
    documents: new Set(usage.map((u) => u.documentId)).size,
    history: [
      { at: T, actorName: 'ייבוא', action: 'created', before: null, after: { path: field.path } },
      ...(field.status === 'renamed'
        ? [
            {
              at: T,
              actorName: 'ענבר ל.',
              action: 'renamed',
              before: { name },
              after: { name: field.renamedTo },
            },
          ]
        : []),
    ],
    alerts,
  };
};

/* ── block page ───────────────────────────────────────────────────────────── */

export const blockPageFor = (id: string): BlockPage | null => {
  const block = fx.blocks.find((b) => b.id === id);
  if (!block) return null;
  const usage: BlockPage['usage'] =
    id === BLK_SIM
      ? [
          {
            documentId: D_BROWSING,
            title: fx.docBrowsing.title,
            category: 'tech',
            stepKey: 's11',
            stepNum: '11',
            mode: 'embedded',
          },
          {
            documentId: D_INTL,
            title: fx.docIntl.title,
            category: 'intl',
            stepKey: 's7',
            stepNum: '7',
            mode: 'embedded',
          },
          {
            documentId: D_CHURN,
            title: 'דיבאג נטישה',
            category: 'ops',
            stepKey: 's3',
            stepNum: '3',
            mode: 'reference',
          },
        ]
      : [];
  return {
    block,
    usage,
    versions: Array.from({ length: block.currentVersion }, (_, i) => ({
      version: i + 1,
      label: i === 0 ? 'נוצר' : `עדכון v${i + 1}`,
      authorName: 'ענבר ל.',
      createdAt: T,
    })),
  };
};

/* ── dashboards ───────────────────────────────────────────────────────────── */

export const dashboard: Dashboard = {
  generatedAt: T,
  coverage: {
    cards: 52,
    withDocument: 23,
    partial: 2,
    drafts: 5,
    byCategory: [
      { category: 'tech', cards: 18, withDocument: 13 },
      { category: 'intl', cards: 12, withDocument: 6 },
      { category: 'ops', cards: 12, withDocument: 3 },
      { category: 'billing', cards: 10, withDocument: 1 },
    ],
  },
  freshness: {
    updatedLast30d: 32,
    staleOver180d: 4,
    byCategory: [
      { category: 'tech', lastUpdatedAt: T, median_days: 12 },
      { category: 'intl', lastUpdatedAt: T, median_days: 46 },
      { category: 'ops', lastUpdatedAt: T, median_days: 121 },
      { category: 'billing', lastUpdatedAt: null, median_days: 198 },
    ],
  },
  usage: {
    views7d: 1222,
    views30d: 4870,
    topDocuments: [
      { documentId: D_BROWSING, title: fx.docBrowsing.title, views: 412 },
      { documentId: D_ESIM, title: 'הפעלת eSIM – קוד QR', views: 318 },
      { documentId: D_INTL, title: fx.docIntl.title, views: 164 },
      { documentId: D_CHURN, title: 'דיבאג נטישה', views: 121 },
      { documentId: D_BILL, title: 'בירור חיוב גבוה / לא מזוהה', views: 97 },
    ],
    outcomesPicked7d: 486,
    callsCompleted7d: 301,
  },
  pipeline: {
    pending: 2,
    accepted: 9,
    rejected: 3,
    applied: 14,
    bySource: [
      { sourceId: fx.sources[0].id, title: 'נהלי תמיכה טכנית', pending: 2, applied: 8 },
      { sourceId: fx.sources[1].id, title: 'חו"ל ונדידה – מדריך מלא', pending: 0, applied: 4 },
    ],
  },
  sync: {
    links: 38,
    synced: 33,
    pendingImport: 3,
    pendingPush: 1,
    conflicts: 1,
    lastRunAt: T,
  },
};

/* ── mutable state ────────────────────────────────────────────────────────── */

interface Stage4State {
  files: DataFile[];
  reimported: string[];
  uploads: string[];
  renames: { name: string; newName: string; updateReferences: boolean; label: string }[];
  telemetry: { kind: string; documentId?: string }[];
}

const initial = (): Stage4State => ({
  files: dataFiles.map((f) => ({ ...f, mapping: f.mapping.map((m) => ({ ...m })) })),
  reimported: [],
  uploads: [],
  renames: [],
  telemetry: [],
});

export const stage4State: Stage4State = initial();
export const resetStage4State = (): void => {
  Object.assign(stage4State, initial());
};

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });

/* ── handlers ─────────────────────────────────────────────────────────────── */

export const stage4Handlers: RequestHandler[] = [
  http.get(`${B}/graph`, ({ request }) => HttpResponse.json(graphFor(new URL(request.url).searchParams))),
  http.get(`${B}/graph/impact/:nodeId`, ({ params }) =>
    HttpResponse.json(impactFor(decodeURIComponent(String(params.nodeId)))),
  ),

  http.get(`${B}/fields/:name/page`, ({ params }) => {
    const page = fieldPageFor(decodeURIComponent(String(params.name)));
    return page ? HttpResponse.json(page) : notFound();
  }),
  http.post(`${B}/fields/:name/rename`, async ({ params, request }) => {
    const name = decodeURIComponent(String(params.name));
    const body = (await request.json()) as { newName: string; updateReferences?: boolean; label: string };
    const field = fx.fields.find((f) => f.name === name);
    if (!field) return notFound();
    const updateReferences = body.updateReferences ?? true;
    stage4State.renames.push({ name, newName: body.newName, updateReferences, label: body.label });
    const usage = fieldPageFor(name)?.usage ?? [];
    const updatedDocuments = updateReferences ? new Set(usage.map((u) => u.documentId)).size : 0;
    return HttpResponse.json({
      updatedDocuments,
      versionsCreated: updatedDocuments,
      field: { ...field, name: body.newName, status: 'ok', renamedTo: undefined, updatedAt: T },
    });
  }),

  http.get(`${B}/blocks/:id/page`, ({ params }) => {
    const page = blockPageFor(String(params.id));
    return page ? HttpResponse.json(page) : notFound();
  }),

  http.get(`${B}/data/files`, () => HttpResponse.json({ items: stage4State.files })),
  http.get(`${B}/data/files/:sourceId/preview`, ({ params, request }) => {
    const file = stage4State.files.find((f) => f.sourceId === String(params.sourceId));
    if (!file) return notFound();
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 25);
    const p = previewFor(file.sourceId);
    return HttpResponse.json({ ...p, rows: p.rows.slice(0, limit) });
  }),
  http.put(`${B}/data/files/:sourceId/mapping`, async ({ params, request }) => {
    const file = stage4State.files.find((f) => f.sourceId === String(params.sourceId));
    if (!file) return notFound();
    const body = (await request.json()) as { mapping: ColumnMapping[] };
    file.mapping = body.mapping;
    file.syncState = 'pending';
    return HttpResponse.json(file);
  }),
  http.post(`${B}/data/files/:sourceId/reimport`, ({ params }) => {
    const file = stage4State.files.find((f) => f.sourceId === String(params.sourceId));
    if (!file) return notFound();
    stage4State.reimported.push(file.sourceId);
    file.syncState = 'processing';
    file.pendingSuggestions = 3;
    return HttpResponse.json({ revisionId: REV_NEW, duplicate: false, suggestionsQueued: true });
  }),
  /**
   * The multipart body is deliberately *not* parsed here. Under jsdom the `FormData` global is
   * jsdom's, which node's undici `fetch` does not recognise as a body — it stringifies it to
   * `[object FormData]` with `content-type: text/plain`, so `request.formData()` throws. That is
   * a test-environment artifact (the browser, and therefore `pnpm e2e`, sends real multipart), so
   * the mock records the upload and answers the contract's `DataFileSchema` rather than asserting
   * on a body jsdom cannot produce.
   */
  http.post(`${B}/data/files`, () => {
    const created: DataFile = {
      sourceId: SRC_AGENTS_CSV,
      title: 'agents-scripts.csv',
      kind: 'csv',
      rows: 120,
      columns: ['agent', 'topic', 'line'],
      mapping: [{ column: 'agent', field: 'ignore' }],
      syncState: 'processing',
      lastSyncedAt: null,
      linkedDocuments: 0,
      pendingSuggestions: 0,
    };
    stage4State.uploads.push(created.title);
    stage4State.files = stage4State.files.map((f) => (f.sourceId === created.sourceId ? created : f));
    return HttpResponse.json(created, { status: 201 });
  }),

  http.get(`${B}/dashboards`, () => HttpResponse.json(dashboard)),
  // `POST /telemetry` is registered once, in `stage45.ts`, and records into `stage4State.telemetry`
  // as well as `stage45State.telemetry` — see the comment there. Registering it in both modules
  // meant msw answered from whichever came first and the other lane's log never filled.

  http.get(`${B}/documents/:id/backlinks`, ({ params }) =>
    HttpResponse.json({ items: impactFor(`doc:${String(params.id)}`).inbound }),
  ),
];

export const stage4Fixtures = {
  dataFiles,
  dashboard,
  graphNodes,
  graphEdges,
  fieldPageFor,
  blockPageFor,
  impactFor,
  previewFor,
};
