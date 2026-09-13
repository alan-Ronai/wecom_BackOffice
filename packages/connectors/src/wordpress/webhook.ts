import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const signBody = (secret: string, rawBody: string): string =>
  createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');

export function verifySignature(secret: string, rawBody: string, signature: string | undefined): boolean {
  if (!signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const a = Buffer.from(signBody(secret, rawBody), 'hex');
  const b = Buffer.from(signature, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

export const WebhookBodySchema = z.object({
  event: z.enum(['save_post', 'delete_post']),
  post_type: z.string().min(1),
  post_id: z.number().int().positive(),
  modified_gmt: z.string(),
});
export type WebhookBody = z.infer<typeof WebhookBodySchema>;
