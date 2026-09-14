/**
 * The msw source-document handlers must answer the shapes `docs/api/CONTRACTS-wave4.md` publishes,
 * so a drifting mock fails here rather than in a component test. Mirrors what
 * `test/msw/fixtures.test.ts` does for the stage-1 routes; kept in this lane's own file so W4-web
 * does not edit a file another wave-4 lane also appends to.
 */
import { describe, it, expect } from 'vitest';
import { AssetSchema, SourceDocumentSchema, SourceDocumentVersionsResponseSchema } from '@wecom/shared';
import { fx } from '../msw/fixtures.js';
import { state } from '../msw/handlers.js';

const B = 'http://kb.test/api/v1';
const DOC = fx.docBrowsing.id;
const json = { 'content-type': 'application/json' };

describe('msw source document handlers', () => {
  it('answers 204 while no source document exists', async () => {
    const res = await fetch(`${B}/documents/${DOC}/source`);
    expect(res.status).toBe(204);
  });

  it('PUT and GET answer SourceDocumentSchema, and versions the list schema', async () => {
    const put = await fetch(`${B}/documents/${DOC}/source`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ html: '<p>גוף</p>', label: 'ראשונה' }),
    });
    const saved = SourceDocumentSchema.parse(await put.json());
    expect(saved.version).toBe(1);
    expect(put.headers.get('etag')).toBe(saved.etag);

    const got = SourceDocumentSchema.parse(await (await fetch(`${B}/documents/${DOC}/source`)).json());
    expect(got.html).toBe('<p>גוף</p>');

    const list = SourceDocumentVersionsResponseSchema.parse(
      await (await fetch(`${B}/documents/${DOC}/source/versions`)).json(),
    );
    expect(list.items.map((v) => v.version)).toEqual([1]);
    SourceDocumentSchema.parse(await (await fetch(`${B}/documents/${DOC}/source/versions/1`)).json());
  });

  it('rejects a stale If-Match with 412 ETAG_MISMATCH', async () => {
    state.sourceDocs.set(DOC, { html: '<p>a</p>', text: 'a', version: 1, etag: 'e1', versions: [] });
    const res = await fetch(`${B}/documents/${DOC}/source`, {
      method: 'PUT',
      headers: { ...json, 'if-match': 'stale' },
      body: JSON.stringify({ html: '<p>b</p>' }),
    });
    expect(res.status).toBe(412);
    expect((await res.json()).code).toBe('ETAG_MISMATCH');
  });

  it('POST /assets answers AssetSchema', async () => {
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1, 2, 3])], 'x.png', { type: 'image/png' }));
    const a = AssetSchema.parse(await (await fetch(`${B}/assets`, { method: 'POST', body: form })).json());
    expect(a.url).toBe(`/api/v1/assets/${a.id}`);
  });

  it('the draft route round-trips and a saved version clears it', async () => {
    expect((await fetch(`${B}/documents/${DOC}/source/draft`)).status).toBe(204);
    await fetch(`${B}/documents/${DOC}/source/draft`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ html: '<p>טיוטה</p>' }),
    });
    expect((await (await fetch(`${B}/documents/${DOC}/source/draft`)).json()).html).toBe('<p>טיוטה</p>');
    await fetch(`${B}/documents/${DOC}/source`, {
      method: 'PUT',
      headers: json,
      body: JSON.stringify({ html: '<p>גרסה</p>' }),
    });
    expect(state.sourceDrafts.has(DOC)).toBe(false);
  });
});
