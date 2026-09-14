/**
 * Wave-4 taxonomy queries and mutations (`docs/api/CONTRACTS-wave4.md`, W1 rows).
 *
 * The routes are not in `docs/api/openapi.json` yet — the API half of W1 is landing
 * concurrently — so `pnpm generate:client` cannot type them and `api.GET('/worlds')` would not
 * compile. They therefore go through `stageJson`/`stageVoid` (`src/api/stage45.ts`), the same
 * origin, credentials and `ApiError` as every other call, typed and validated against the **zod
 * contract** in `@wecom/shared` (`packages/shared/src/schemas/wave4.ts`) — which is exactly what
 * both sides are building against. When these paths appear in `openapi.json`, each function
 * becomes a one-line `api.GET(...)`; nothing else in the app changes.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  TagsResponseSchema,
  TopicSchema,
  TopicViewSchema,
  TopicsResponseSchema,
  WorldSchema,
  WorldsResponseSchema,
  type Topic,
  type TopicView,
  type World,
} from '@wecom/shared';
import { keys } from '../keys.js';
import { stageJson, stageVoid } from '../stage45.js';

export interface TagCount {
  tag: string;
  count: number;
}

export const useWorlds = (includeInactive = false) =>
  useQuery({
    queryKey: keys.worlds(includeInactive),
    queryFn: async (): Promise<World[]> =>
      (
        await stageJson(WorldsResponseSchema, '/worlds', {
          query: { includeInactive: includeInactive ? 'true' : undefined },
        })
      ).items,
    staleTime: 60_000,
  });

export const useTopics = (worldSlug: string | undefined) =>
  useQuery({
    queryKey: keys.topics(worldSlug ?? ''),
    enabled: !!worldSlug,
    queryFn: async (): Promise<Topic[]> =>
      (await stageJson(TopicsResponseSchema, `/worlds/${encodeURIComponent(worldSlug!)}/topics`)).items,
    staleTime: 60_000,
  });

export const useTopicView = (id: string | undefined) =>
  useQuery({
    queryKey: keys.topic(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<TopicView> =>
      stageJson(TopicViewSchema, `/topics/${encodeURIComponent(id!)}/items`),
  });

export const useTags = (q = '') =>
  useQuery({
    queryKey: keys.tags(q),
    queryFn: async (): Promise<TagCount[]> =>
      (await stageJson(TagsResponseSchema, '/tags', { query: { q: q || undefined, limit: 20 } })).items,
    staleTime: 30_000,
  });

/** Every taxonomy mutation can change counts on any of the three lists, so all three go stale. */
const invalidateTaxonomy = (qc: ReturnType<typeof useQueryClient>): void => {
  void qc.invalidateQueries({ queryKey: ['worlds'] });
  void qc.invalidateQueries({ queryKey: ['topics'] });
  void qc.invalidateQueries({ queryKey: ['topic'] });
};

export const useCreateWorld = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      slug: string;
      name: string;
      description: string;
      active: boolean;
    }): Promise<World> => stageJson(WorldSchema, '/worlds', { method: 'POST', body }),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const usePatchWorld = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      slug,
      ...body
    }: {
      slug: string;
      name?: string;
      description?: string;
      active?: boolean;
    }): Promise<World> =>
      stageJson(WorldSchema, `/worlds/${encodeURIComponent(slug)}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

/** Deactivates (never deletes). Without `force` a world that still carries items answers 409. */
export const useDeactivateWorld = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, force }: { slug: string; force?: boolean }): Promise<void> =>
      stageVoid(`/worlds/${encodeURIComponent(slug)}`, {
        method: 'DELETE',
        query: { force: force ? 'true' : undefined },
      }),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useReorderWorlds = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<World[]> =>
      (await stageJson(WorldsResponseSchema, '/worlds/reorder', { method: 'PUT', body: { ids } })).items,
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useCreateTopic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      worldSlug,
      ...body
    }: {
      worldSlug: string;
      slug: string;
      name: string;
      description: string;
      active: boolean;
    }): Promise<Topic> =>
      stageJson(TopicSchema, `/worlds/${encodeURIComponent(worldSlug)}/topics`, {
        method: 'POST',
        body,
      }),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const usePatchTopic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...body
    }: {
      id: string;
      name?: string;
      description?: string;
      active?: boolean;
      worldSlug?: string;
    }): Promise<Topic> =>
      stageJson(TopicSchema, `/topics/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useDeactivateTopic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> =>
      stageVoid(`/topics/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useReorderTopics = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ worldSlug, ids }: { worldSlug: string; ids: string[] }): Promise<Topic[]> =>
      (
        await stageJson(TopicsResponseSchema, `/worlds/${encodeURIComponent(worldSlug)}/topics/reorder`, {
          method: 'PUT',
          body: { ids },
        })
      ).items,
    onSuccess: () => invalidateTaxonomy(qc),
  });
};
