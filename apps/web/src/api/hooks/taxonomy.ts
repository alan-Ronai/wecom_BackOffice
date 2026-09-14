/**
 * Wave-4 taxonomy queries and mutations (`docs/api/CONTRACTS-wave4.md`, W1 rows).
 *
 * The routes are published now, so every call goes through the generated client (`api`, typed by
 * `schema.d.ts` from `docs/api/openapi.json`) like the rest of the app, and every answer is
 * parsed with `checked` against the zod contract in `@wecom/shared`. The two layers are not
 * redundant: the generated types describe what the contract *says* and are erased at build time;
 * `checked` is what notices a fixture or a server that disagrees with it.
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
import { api } from '../client.js';
import { keys } from '../keys.js';
import { unwrap } from '../unwrap.js';
import { checked } from '../stage45.js';
import { invalidateContent } from '../invalidate.js';

export interface TagCount {
  tag: string;
  count: number;
}

export const useWorlds = (includeInactive = false) =>
  useQuery({
    queryKey: keys.worlds(includeInactive),
    queryFn: async (): Promise<World[]> =>
      checked(
        WorldsResponseSchema,
        await api.GET('/worlds', {
          params: { query: includeInactive ? { includeInactive: true } : {} },
        }),
      ).items,
    staleTime: 60_000,
  });

export const useTopics = (worldSlug: string | undefined) =>
  useQuery({
    queryKey: keys.topics(worldSlug ?? ''),
    enabled: !!worldSlug,
    queryFn: async (): Promise<Topic[]> =>
      checked(
        TopicsResponseSchema,
        await api.GET('/worlds/{slug}/topics', { params: { path: { slug: worldSlug! } } }),
      ).items,
    staleTime: 60_000,
  });

export const useTopicView = (id: string | undefined) =>
  useQuery({
    queryKey: keys.topic(id ?? ''),
    enabled: !!id,
    queryFn: async (): Promise<TopicView> =>
      checked(TopicViewSchema, await api.GET('/topics/{id}/items', { params: { path: { id: id! } } })),
  });

export const useTags = (q = '') =>
  useQuery({
    queryKey: keys.tags(q),
    queryFn: async (): Promise<TagCount[]> =>
      checked(
        TagsResponseSchema,
        await api.GET('/tags', { params: { query: { ...(q ? { q } : {}), limit: 20 } } }),
      ).items,
    staleTime: 30_000,
  });

/**
 * Every taxonomy mutation can change what a document list shows and what a world or topic counts,
 * so it goes through the shared helper rather than a taxonomy-only list — renaming a world used to
 * leave every cached library card and search result on the old name.
 */
const invalidateTaxonomy = (qc: ReturnType<typeof useQueryClient>): void => invalidateContent(qc);

export const useCreateWorld = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      slug: string;
      name: string;
      description: string;
      active: boolean;
    }): Promise<World> => checked(WorldSchema, await api.POST('/worlds', { body })),
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
      checked(WorldSchema, await api.PATCH('/worlds/{slug}', { params: { path: { slug } }, body })),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

/** Deactivates (never deletes). Without `force` a world that still carries items answers 409. */
export const useDeactivateWorld = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ slug, force }: { slug: string; force?: boolean }): Promise<void> => {
      unwrap(
        await api.DELETE('/worlds/{slug}', {
          params: { path: { slug }, query: force ? { force: true } : {} },
        }),
      );
    },
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useReorderWorlds = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]): Promise<World[]> =>
      checked(WorldsResponseSchema, await api.PUT('/worlds/reorder', { body: { ids } })).items,
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
      checked(
        TopicSchema,
        await api.POST('/worlds/{slug}/topics', { params: { path: { slug: worldSlug } }, body }),
      ),
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
      checked(TopicSchema, await api.PATCH('/topics/{id}', { params: { path: { id } }, body })),
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useDeactivateTopic = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      unwrap(await api.DELETE('/topics/{id}', { params: { path: { id } } }));
    },
    onSuccess: () => invalidateTaxonomy(qc),
  });
};

export const useReorderTopics = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ worldSlug, ids }: { worldSlug: string; ids: string[] }): Promise<Topic[]> =>
      checked(
        TopicsResponseSchema,
        await api.PUT('/worlds/{slug}/topics/reorder', {
          params: { path: { slug: worldSlug } },
          body: { ids },
        }),
      ).items,
    onSuccess: () => invalidateTaxonomy(qc),
  });
};
