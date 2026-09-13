import { z } from 'zod';
import { CategorySchema, DocumentStatusSchema, IdSchema, IsoDateSchema, PaginationQuerySchema, PrioritySchema, WaveSchema, paginated } from './common.js';
import { ActionSchema, BlockSchema, CrmFieldStatusSchema, DocumentCardSchema, DocumentSchema, OutcomeSchema, PhaseSchema } from './content.js';
import { SuggestionPayloadSchema } from './pipeline.js';
import { PermissionSchema } from './identity.js';

const bool = z.union([z.boolean(), z.enum(['true', 'false']).transform((v) => v === 'true')]);

export const ListDocumentsQuerySchema = PaginationQuerySchema.extend({
  q: z.string().optional(), category: CategorySchema.optional(), wave: z.coerce.number().pipe(WaveSchema).optional(),
  priority: PrioritySchema.optional(), status: DocumentStatusSchema.optional(), pinned: bool.optional(), recent: bool.optional(),
  drafts: bool.optional(), updatedSince: IsoDateSchema.optional(), sort: z.enum(['wave', 'updated', 'title', 'views']).default('wave'),
});
export const ListDocumentsResponseSchema = paginated(DocumentCardSchema);

export const CreateDocumentBodySchema = DocumentSchema.pick({ title: true, description: true, category: true, wave: true, priority: true, kind: true }).extend({ slug: z.string().optional(), topicId: z.number().int().optional(), phases: z.array(PhaseSchema).optional() });
export const PatchDocumentBodySchema = DocumentSchema.pick({ title: true, description: true, category: true, wave: true, priority: true, code: true, sourceRef: true }).partial();
export const StructureBodySchema = z.object({ phases: z.array(PhaseSchema).min(1), related: DocumentSchema.shape.related.optional() });
export const PublishBodySchema = z.object({ label: z.string().min(1).max(200), markPartial: z.boolean().optional() });
export const DiffQuerySchema = z.object({ from: z.coerce.number().int().min(0), to: z.coerce.number().int().min(0).optional() });
export const RelatedDocSchema = z.object({ documentId: IdSchema, title: z.string(), category: CategorySchema, why: z.string() });

export const SearchHitSchema = z.object({
  type: z.enum(['document', 'step', 'block', 'field', 'script', 'action']), id: z.string(), title: z.string(), snippet: z.string(), meta: z.string(),
  score: z.number(), documentId: IdSchema.optional(), stepKey: z.string().optional(), num: z.string().optional(), kbd: z.string().optional(),
});
export const SearchQuerySchema = z.object({ q: z.string().default(''), types: z.string().optional(), limit: z.coerce.number().int().min(1).max(100).default(40) });
export const SearchResponseSchema = z.object({ groups: z.array(z.object({ type: z.enum(['documents', 'steps', 'blocks', 'fields', 'scripts', 'actions']), hits: z.array(SearchHitSchema) })), total: z.number().int(), tookMs: z.number(), files: z.number().int() });

export const TrashItemSchema = z.object({ type: z.enum(['document', 'block', 'field', 'script']), id: z.string(), title: z.string(), meta: z.string(), deletedBy: z.string(), deletedAt: IsoDateSchema, purgeAt: IsoDateSchema, impact: z.object({ brokenLinks: z.number().int(), documents: z.array(z.object({ id: IdSchema, title: z.string() })) }) });
export const TrashListSchema = z.object({ items: z.array(TrashItemSchema) });

export const CreateNoteBodySchema = z.object({ stepKey: z.string().nullable().default(null), text: z.string().min(1).max(2000) });
export const DraftBodySchema = z.object({ payload: z.record(z.unknown()) });

export const UpsertBlockBodySchema = BlockSchema.pick({ title: true, kind: true, description: true, script: true }).extend({ actions: z.array(ActionSchema).default([]), outcomes: z.array(OutcomeSchema).default([]), slug: z.string().optional(), label: z.string().optional() });
export const UpsertFieldBodySchema = z.object({ name: z.string().min(1), status: CrmFieldStatusSchema, renamedTo: z.string().optional(), path: z.string().default(''), note: z.string().optional() });
export const UpsertScriptBodySchema = z.object({ title: z.string().min(1), text: z.string().min(1), tags: z.array(z.string()).default([]) });

export const SuggestionDecisionBodySchema = z.object({ editedPayload: SuggestionPayloadSchema.optional() });
export const SuggestionsQuerySchema = PaginationQuerySchema.extend({ status: z.enum(['pending', 'accepted', 'rejected', 'applied']).optional(), sourceId: IdSchema.optional() });

export const HealthResponseSchema = z.object({ ok: z.boolean(), db: z.boolean(), model: z.boolean().nullable(), queue: z.number().int().nullable(), version: z.string(), uptimeSec: z.number() });

export const AdminUserPatchSchema = z.object({ active: z.boolean().optional(), roles: z.array(z.object({ roleId: IdSchema, categoryScope: z.array(CategorySchema).nullable() })).optional() });
export const RoleUpsertSchema = z.object({ name: z.string().min(1).max(40), description: z.string().default(''), permissions: z.array(PermissionSchema) });
export const GroupMapPutSchema = z.object({ entries: z.array(z.object({ idpGroupId: z.string(), idpGroupName: z.string(), roleId: IdSchema })) });
export const AuditQuerySchema = PaginationQuerySchema.extend({ actorId: IdSchema.optional(), entityType: z.string().optional(), entityId: z.string().optional(), from: IsoDateSchema.optional(), to: IsoDateSchema.optional() });
