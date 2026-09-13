import type pg from 'pg';
import { contentAdapter } from './content-adapter.js';
import type { z } from 'zod';
import type {
  Block,
  CreateDocumentBodySchema,
  CrmField,
  Document,
  UpsertFieldBodySchema,
} from '@wecom/shared';

export type ContentClient = pg.PoolClient | pg.Pool;

/**
 * The slice of L2's content module this lane consumes. L2 owns the implementation
 * (`modules/documents/publish.ts`, `modules/blocks/publish.ts` and the repos);
 * `content-adapter.ts` binds this interface onto it statically. The DB-backed test
 * double lives in `test/helpers/l5/stubs.ts` and satisfies the same type.
 */
export interface ContentApi {
  getDocument(client: ContentClient, id: string): Promise<Document | null>;
  publishDocument(
    client: ContentClient,
    doc: Document,
    opts: {
      actorId: string | null;
      label: string;
      suggestionId?: string | null;
      kind?: 'published' | 'sync';
    },
  ): Promise<{ document: Document; versionId: string; version: number }>;
  createDocument(
    client: ContentClient,
    input: z.infer<typeof CreateDocumentBodySchema> & { sourceId?: string; sourceRef?: string },
    actorId: string | null,
  ): Promise<Document>;
  listDocumentRefs(client: ContentClient): Promise<{ id: string; title: string; code?: string }[]>;
  getBlock(client: ContentClient, id: string): Promise<Block | null>;
  publishBlock(
    client: ContentClient,
    block: Block,
    opts: { actorId: string | null; label: string },
  ): Promise<{ block: Block; version: number }>;
  listBlocks(client: ContentClient): Promise<Block[]>;
  listFields(client: ContentClient): Promise<CrmField[]>;
  upsertField(
    client: ContentClient,
    input: z.infer<typeof UpsertFieldBodySchema>,
    actorId: string | null,
  ): Promise<CrmField>;
}

let override: ContentApi | null = null;

/**
 * Unit-test injection point (`test/helpers/l5/stubs.ts`). Product code never calls it;
 * `resolveContentApi()` returns L2's real adapter unless a test has installed a double.
 */
export function setContentApi(api: ContentApi | null): void {
  override = api;
}

/**
 * The content module L5 runs against. Statically bound to L2 — there is no silent
 * fallback: if the adapter stops satisfying `ContentApi` the build fails.
 */
export function resolveContentApi(): ContentApi {
  return override ?? contentAdapter;
}
