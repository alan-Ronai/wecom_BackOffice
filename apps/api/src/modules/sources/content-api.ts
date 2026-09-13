import type pg from 'pg';
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
 * (`src/modules/content/{documents,blocks,fields}.ts` re-exported from
 * `src/modules/content/index.ts`); L5 only ever programs against this interface so the
 * two lanes can land independently. The DB-backed test double lives in
 * `test/helpers/l5/stubs.ts` and satisfies the same type.
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

const unavailable = (): never => {
  throw Object.assign(new Error('מודול התוכן אינו זמין'), {
    statusCode: 503,
    code: 'CONTENT_UNAVAILABLE',
  });
};

/**
 * Used until L2's content module lands: every call fails loudly with 503 instead of
 * breaking app start-up (buildApp must stay usable for the other lanes and for `pnpm openapi`).
 */
export const unavailableContent: ContentApi = {
  getDocument: unavailable,
  publishDocument: unavailable,
  createDocument: unavailable,
  listDocumentRefs: unavailable,
  getBlock: unavailable,
  publishBlock: unavailable,
  listBlocks: unavailable,
  listFields: unavailable,
  upsertField: unavailable,
};

let override: ContentApi | null = null;

/**
 * Test-only injection point (`test/helpers/l5/stubs.ts`). Product code never calls this;
 * once L2's `modules/content/index.ts` exists `resolveContentApi()` picks it up on its own.
 */
export function setContentApi(api: ContentApi | null): void {
  override = api;
}

/** L2-owned module path, resolved at runtime so this lane can land before L2. */
const CONTENT_MODULE = '../content/index.js';

export async function resolveContentApi(): Promise<ContentApi> {
  if (override) return override;
  try {
    const mod = (await import(/* @vite-ignore */ CONTENT_MODULE)) as Partial<ContentApi>;
    if (typeof mod.publishDocument === 'function') return mod as ContentApi;
  } catch {
    /* L2 has not landed yet */
  }
  return unavailableContent;
}
