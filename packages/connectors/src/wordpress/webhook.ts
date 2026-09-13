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

/**
 * How far a webhook's `sent_at` may be from our clock. The body carries the
 * timestamp and the body is what is signed, so a captured request cannot be
 * replayed to force repeated syncs once this window has passed. (Replay *within*
 * the window is still possible; closing that needs a stored nonce, which stage 1
 * does not have a table for.) The WP plugin sends `gmdate('c')`.
 */
export const MAX_WEBHOOK_SKEW_MS = 5 * 60_000;

export const WebhookBodySchema = z.object({
  event: z.enum(['save_post', 'delete_post']),
  post_type: z.string().min(1),
  post_id: z.number().int().positive(),
  modified_gmt: z.string(),
  /** ISO-8601 UTC instant the plugin sent the request; part of the signed payload. */
  sent_at: z.string().min(1),
});
export type WebhookBody = z.infer<typeof WebhookBodySchema>;

/** Throws when `sent_at` is unparseable or outside the freshness window. */
export function assertFresh(sentAt: string, now = Date.now()): void {
  const t = Date.parse(sentAt.endsWith('Z') || /[+-]\d{2}:?\d{2}$/.test(sentAt) ? sentAt : sentAt + 'Z');
  if (Number.isNaN(t)) throw new Error('invalid signature: unparseable sent_at');
  if (Math.abs(now - t) > MAX_WEBHOOK_SKEW_MS) throw new Error('invalid signature: stale webhook');
}
