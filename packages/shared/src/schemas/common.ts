import { z } from 'zod';

/** A world slug. Was a six-value enum; worlds are data since wave 4 (W1) and the API validates against `worlds`. */
export const CategorySchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,40}$/);
export type Category = z.infer<typeof CategorySchema>;
export const PrioritySchema = z.enum(['hh', 'h', 'm', 'l']);
export type Priority = z.infer<typeof PrioritySchema>;
export const WaveSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);
export type Wave = z.infer<typeof WaveSchema>;
export const DocumentKindSchema = z.enum(['steps', 'retention', 'text']);
export const DocumentStatusSchema = z.enum([
  'draft',
  'review',
  'published',
  'partial',
  'invalid',
  'archived',
]);
export type DocumentStatus = z.infer<typeof DocumentStatusSchema>;

export const IdSchema = z.string().uuid();
export const IsoDateSchema = z.string().datetime();
export const SlugSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/);

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

export const paginated = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int().nonnegative(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });

export const ErrorEnvelopeSchema = z.object({
  code: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
