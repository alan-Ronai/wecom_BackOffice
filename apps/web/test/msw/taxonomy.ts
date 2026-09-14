/**
 * msw handlers for the wave-4 taxonomy routes (`docs/api/CONTRACTS-wave4.md`, W1 rows).
 *
 * Kept in its own module — like `stage4.ts` / `stage45.ts` — so the wave-4 lanes can land their
 * handler groups side by side without touching the same lines of `handlers.ts`. The routes are
 * not in `docs/api/openapi.json` yet (the API half of W1 is landing concurrently), so the shapes
 * here are validated against the **zod contract** in `packages/shared/src/schemas/wave4.ts` by
 * `fixtures.test.ts`, exactly as the generated routes are validated against theirs.
 *
 * Mutable state lives on the shared `state` object in `handlers.ts` (`state.worlds`,
 * `state.topics`) so tests assert side effects the same way they do everywhere else; the
 * handlers are built once from that object, which `resetState()` refills in place.
 */
import { http, HttpResponse, type RequestHandler } from 'msw';
import type { Topic, World } from '@wecom/shared';
import { fx } from './fixtures.js';

const B = '/api/v1';

/** The slice of msw state this group owns. */
export interface TaxonomyState {
  worlds: World[];
  topics: Topic[];
  /** Topic ids `GET /topics/:id/items` was asked to record a view for (i.e. without `record=false`). */
  topicViews: string[];
}

export const initialTaxonomy = (): TaxonomyState => ({
  worlds: fx.worlds.map((w) => ({ ...w })),
  topics: fx.topics.map((t) => ({ ...t })),
  topicViews: [],
});

const notFound = () => HttpResponse.json({ code: 'NOT_FOUND', message: 'לא נמצא' }, { status: 404 });
const noContent = () => new HttpResponse(null, { status: 204 });
const byPosition = <T extends { position: number }>(a: T, b: T): number => a.position - b.position;

/**
 * Built once against the live `state` object, which is refilled in place by `resetState()`,
 * so every handler always reads the current fixtures.
 */
export const taxonomyHandlers = (state: TaxonomyState): RequestHandler[] => [
  http.get(`${B}/worlds`, ({ request }) => {
    const inactive = new URL(request.url).searchParams.get('includeInactive') === 'true';
    return HttpResponse.json({
      items: state.worlds.filter((w) => inactive || w.active).sort(byPosition),
    });
  }),
  http.post(`${B}/worlds`, async ({ request }) => {
    const body = (await request.json()) as {
      slug: string;
      name: string;
      description?: string;
      active?: boolean;
    };
    if (state.worlds.some((w) => w.slug === body.slug))
      return HttpResponse.json({ code: 'WORLD_EXISTS', message: 'קיים' }, { status: 409 });
    const w: World = {
      ...fx.worlds[0]!,
      id: crypto.randomUUID(),
      slug: body.slug,
      name: body.name,
      description: body.description ?? '',
      active: body.active ?? true,
      position: state.worlds.length,
      topicCount: 0,
      itemCount: 0,
    };
    state.worlds.push(w);
    return HttpResponse.json(w, { status: 201 });
  }),
  // `reorder` before `:slug`, or the collection route would swallow it.
  http.put(`${B}/worlds/reorder`, async ({ request }) => {
    const { ids } = (await request.json()) as { ids: string[] };
    ids.forEach((id, i) => {
      const w = state.worlds.find((x) => x.id === id);
      if (w) w.position = i;
    });
    return HttpResponse.json({ items: [...state.worlds].sort(byPosition) });
  }),
  http.patch(`${B}/worlds/:slug`, async ({ params, request }) => {
    const w = state.worlds.find((x) => x.slug === params.slug);
    if (!w) return notFound();
    Object.assign(w, (await request.json()) as Partial<World>);
    return HttpResponse.json(w);
  }),
  http.delete(`${B}/worlds/:slug`, ({ params, request }) => {
    const w = state.worlds.find((x) => x.slug === params.slug);
    if (!w) return notFound();
    const force = new URL(request.url).searchParams.get('force') === 'true';
    if (w.itemCount > 0 && !force)
      return HttpResponse.json({ code: 'WORLD_IN_USE', message: 'בשימוש' }, { status: 409 });
    w.active = false;
    return noContent();
  }),
  http.get(`${B}/worlds/:slug/topics`, ({ params, request }) => {
    const inactive = new URL(request.url).searchParams.get('includeInactive') === 'true';
    return HttpResponse.json({
      items: state.topics
        .filter((t) => t.worldSlug === params.slug && (inactive || t.active))
        .sort(byPosition),
    });
  }),
  http.post(`${B}/worlds/:slug/topics`, async ({ params, request }) => {
    const body = (await request.json()) as { slug: string; name: string; description?: string };
    const t: Topic = {
      id: crypto.randomUUID(),
      worldSlug: String(params.slug),
      slug: body.slug,
      name: body.name,
      description: body.description ?? '',
      position: state.topics.length,
      active: true,
      itemCount: 0,
    };
    state.topics.push(t);
    return HttpResponse.json(t, { status: 201 });
  }),
  http.put(`${B}/worlds/:slug/topics/reorder`, async ({ params, request }) => {
    const { ids } = (await request.json()) as { ids: string[] };
    ids.forEach((id, i) => {
      const t = state.topics.find((x) => x.id === id);
      if (t) t.position = i;
    });
    state.topics.sort(byPosition);
    return HttpResponse.json({ items: state.topics.filter((t) => t.worldSlug === params.slug) });
  }),
  http.patch(`${B}/topics/:id`, async ({ params, request }) => {
    const t = state.topics.find((x) => x.id === params.id);
    if (!t) return notFound();
    Object.assign(t, (await request.json()) as Partial<Topic>);
    return HttpResponse.json(t);
  }),
  http.delete(`${B}/topics/:id`, ({ params }) => {
    const t = state.topics.find((x) => x.id === params.id);
    if (!t) return notFound();
    t.active = false;
    return noContent();
  }),
  /**
   * `?record=false` suppresses the server-side topic view (W1). The stub counts what it was asked
   * to record so a test can assert that an article open does not write one.
   */
  http.get(`${B}/topics/:id/items`, ({ params, request }) => {
    if (params.id !== fx.topics[0]!.id) return notFound();
    if (new URL(request.url).searchParams.get('record') !== 'false') state.topicViews.push(String(params.id));
    return HttpResponse.json(fx.topicView);
  }),
  http.get(`${B}/tags`, ({ request }) => {
    const q = new URL(request.url).searchParams.get('q') ?? '';
    return HttpResponse.json({ items: fx.tags.filter((t) => t.tag.includes(q)) });
  }),
];
