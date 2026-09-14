/**
 * The stage-4 mocks are only useful if they are shaped like the routes backend lane A is
 * building, so every fixture and every handler response here is parsed with the zod schema from
 * `packages/shared/src/schemas/stage45.ts` that the route itself validates against.
 *
 * A mock that drifts from the contract fails here rather than in a component test, where the
 * failure would look like a UI bug.
 */
import { describe, expect, it } from 'vitest';
import {
  BlockPageSchema,
  DashboardSchema,
  DataFileSchema,
  DataFilesResponseSchema,
  DataPreviewSchema,
  FieldPageSchema,
  FieldRenameResultSchema,
  GraphEdgeSchema,
  GraphNodeSchema,
  GraphResponseSchema,
  ImpactResponseSchema,
  ReimportResultSchema,
} from '@wecom/shared';
import { fx, BLK_SIM, D_BROWSING } from './fixtures.js';
import { FIELD_ROAMING, SRC_AGENTS_CSV, SRC_TOPICS, stage4Fixtures, stage4State } from './stage4.js';

const B = 'http://kb.test/api/v1';
const get = async (path: string) => (await fetch(`${B}${path}`)).json();

describe('stage-4 fixtures validate against the shared schemas', () => {
  it('data files, graph nodes/edges and the dashboard', () => {
    stage4Fixtures.dataFiles.forEach((f) => DataFileSchema.parse(f));
    stage4Fixtures.graphNodes.forEach((n) => GraphNodeSchema.parse(n));
    stage4Fixtures.graphEdges.forEach((e) => GraphEdgeSchema.parse(e));
    DashboardSchema.parse(stage4Fixtures.dashboard);
  });

  it('covers every node kind and every link type the UI filters by', () => {
    const kinds = new Set(stage4Fixtures.graphNodes.map((n) => n.kind));
    expect(kinds).toEqual(new Set(['document', 'block', 'field', 'source', 'script']));
    const types = new Set(stage4Fixtures.graphEdges.map((e) => e.type));
    for (const t of ['next', 'prerequisite', 'link', 'shares_block', 'same_field', 'derived_from_source'])
      expect(types.has(t as 'next')).toBe(true);
  });
});

describe('stage-4 handlers answer the published envelopes', () => {
  it('GET /graph', async () => {
    const body = GraphResponseSchema.parse(await get('/graph'));
    expect(body.nodes.length).toBeGreaterThan(5);
    expect(body.truncated).toBe(false);
  });

  it('GET /graph honours ?focus= and ?depth=', async () => {
    const deep = GraphResponseSchema.parse(await get(`/graph?focus=doc:${D_BROWSING}&depth=2`));
    const shallow = GraphResponseSchema.parse(await get(`/graph?focus=doc:${D_BROWSING}&depth=1`));
    expect(shallow.nodes.length).toBeLessThanOrEqual(deep.nodes.length);
    expect(shallow.nodes.some((n) => n.id === `doc:${D_BROWSING}`)).toBe(true);
  });

  it('GET /graph honours ?types= as a comma list of LinkType', async () => {
    const body = GraphResponseSchema.parse(await get('/graph?types=shares_block'));
    expect(new Set(body.edges.map((e) => e.type))).toEqual(new Set(['shares_block']));
  });

  it('GET /graph/impact/:nodeId derives the inbound edges', async () => {
    const body = ImpactResponseSchema.parse(await get(`/graph/impact/doc%3A${D_BROWSING}`));
    expect(body.node.id).toBe(`doc:${D_BROWSING}`);
    expect(body.inbound.length).toBeGreaterThan(0);
    expect(body.affectedDocuments).toBe(new Set(body.inbound.map((i) => i.documentId)).size);
  });

  it('GET /fields/:name/page', async () => {
    const body = FieldPageSchema.parse(await get(`/fields/${encodeURIComponent(FIELD_ROAMING)}/page`));
    expect(body.field.status).toBe('renamed');
    expect(body.documents).toBe(3);
    expect(body.alerts[0].kind).toBe('renamed');
  });

  it('POST /fields/:name/rename reports the documents it rewrote', async () => {
    const res = await fetch(`${B}/fields/${encodeURIComponent(FIELD_ROAMING)}/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ newName: 'שירותי נדידה', updateReferences: true, label: 'שינוי שם' }),
    });
    const body = FieldRenameResultSchema.parse(await res.json());
    expect(body.updatedDocuments).toBe(3);
    expect(body.versionsCreated).toBe(3);
    expect(stage4State.renames).toHaveLength(1);
  });

  it('GET /blocks/:id/page separates embedded from reference usage', async () => {
    const body = BlockPageSchema.parse(await get(`/blocks/${BLK_SIM}/page`));
    expect(body.usage.filter((u) => u.mode === 'embedded')).toHaveLength(2);
    expect(body.usage.filter((u) => u.mode === 'reference')).toHaveLength(1);
    expect(body.versions).toHaveLength(fx.blocks[0].currentVersion);
  });

  it('GET /data/files and the preview', async () => {
    const list = DataFilesResponseSchema.parse(await get('/data/files'));
    expect(list.items).toHaveLength(5);
    const preview = DataPreviewSchema.parse(await get(`/data/files/${SRC_TOPICS}/preview?limit=2`));
    expect(preview.rows).toHaveLength(2);
    expect(preview.total).toBe(38);
  });

  it('PUT /data/files/:id/mapping returns the updated file', async () => {
    const res = await fetch(`${B}/data/files/${SRC_AGENTS_CSV}/mapping`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mapping: [{ column: 'line', field: 'stepAction' }] }),
    });
    const body = DataFileSchema.parse(await res.json());
    expect(body.mapping[0].field).toBe('stepAction');
  });

  it('POST /data/files/:id/reimport queues suggestions', async () => {
    const res = await fetch(`${B}/data/files/${SRC_TOPICS}/reimport`, { method: 'POST' });
    const body = ReimportResultSchema.parse(await res.json());
    expect(body.suggestionsQueued).toBe(true);
    expect(stage4State.reimported).toEqual([SRC_TOPICS]);
  });

  it('GET /dashboards', async () => {
    DashboardSchema.parse(await get('/dashboards'));
  });

  it('POST /telemetry answers 204 with no body', async () => {
    const res = await fetch(`${B}/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: [{ kind: 'outcome', documentId: D_BROWSING }] }),
    });
    expect(res.status).toBe(204);
    expect(stage4State.telemetry).toHaveLength(1);
  });
});
