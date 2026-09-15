import { describe, it, expect } from 'vitest';
import { signBody, verifySignature, WordPressConnector, WpConfigSchema } from '../src/index.js';
import { WebhookBodySchema } from '../src/wordpress/webhook.js';

const cfg = WpConfigSchema.parse({
  baseUrl: 'http://wp',
  username: 'u',
  applicationPassword: 'p',
  postTypes: ['posts'],
  webhookSecret: 'topsecret1',
});
const rawWith = (sentAt: string) =>
  JSON.stringify({
    event: 'save_post',
    post_type: 'posts',
    post_id: 7,
    modified_gmt: '2025-06-12T10:00:00',
    sent_at: sentAt,
  });
const raw = rawWith(new Date().toISOString());

describe('webhook', () => {
  it('signs and verifies', () => {
    const sig = signBody('topsecret1', raw);
    expect(sig).toMatch(/^[a-f0-9]{64}$/);
    expect(verifySignature('topsecret1', raw, sig)).toBe(true);
    expect(verifySignature('topsecret1', raw + ' ', sig)).toBe(false);
    expect(verifySignature('topsecret1', raw, 'zz')).toBe(false);
  });
  it('parses a signed save_post into a RemoteChange', async () => {
    const changes = await new WordPressConnector().parseWebhook(
      cfg,
      { 'x-kb-signature': signBody('topsecret1', raw) },
      { raw },
    );
    expect(changes).toEqual([{ externalId: 'posts:7', kind: 'updated', at: '2025-06-12T10:00:00Z' }]);
  });
  it('rejects a bad signature', async () => {
    await expect(
      new WordPressConnector().parseWebhook(cfg, { 'x-kb-signature': 'nope' }, { raw }),
    ).rejects.toThrow(/invalid signature/);
  });
  it('rejects a correctly-signed replay of an old request', async () => {
    // The capture is genuine — body and signature both valid — but stale, so a
    // recorded request can no longer be resent forever to force repeated syncs.
    const old = rawWith(new Date(Date.now() - 30 * 60_000).toISOString());
    await expect(
      new WordPressConnector().parseWebhook(
        cfg,
        { 'x-kb-signature': signBody('topsecret1', old) },
        { raw: old },
      ),
    ).rejects.toThrow(/stale webhook/);
  });
  /**
   * Post-pilot L1. The API's replay key hashes the exact signed bytes and `sent_at` has second
   * resolution, so the per-delivery `nonce` inside the body is the only thing that keeps two
   * genuine saves of the same post in the same second from being byte-identical requests — the
   * second of which is refused `409 REPLAY`, dropping an editor's correction. `docs/connectors.md`
   * has always asked plugins for it; the schema is what puts it in the contract.
   */
  it('carries the per-delivery nonce through the body schema', () => {
    const b = { event: 'save_post', post_type: 'posts', post_id: 7, modified_gmt: 'x', sent_at: 'y' };
    expect(WebhookBodySchema.parse({ ...b, nonce: 'b3f1c2a0e9d84f17' }).nonce).toBe('b3f1c2a0e9d84f17');
    // Optional, because WEBHOOK_REQUIRE_NONCE=false has to buy a real release of grace for
    // plugins that predate it.
    expect(WebhookBodySchema.parse(b).nonce).toBeUndefined();
    // But a plugin that sends the wrong *type* fails loudly rather than having it dropped.
    expect(WebhookBodySchema.safeParse({ ...b, nonce: 17 }).success).toBe(false);
    expect(WebhookBodySchema.safeParse({ ...b, nonce: '' }).success).toBe(false);
  });

  it('two saves in the same second are distinct deliveries when each carries a nonce', () => {
    const at = '2026-09-15T08:30:01+00:00';
    const save = (nonce: string) =>
      JSON.stringify({
        event: 'save_post',
        post_type: 'posts',
        post_id: 7,
        modified_gmt: '2026-09-15T08:30:00',
        sent_at: at,
        nonce,
      });
    // The replay key is a hash of these bytes; without the nonce the two are the same request.
    expect(save('a')).not.toBe(save('b'));
    expect(signBody('topsecret1', save('a'))).not.toBe(signBody('topsecret1', save('b')));
    expect(WebhookBodySchema.parse(JSON.parse(save('a'))).nonce).toBe('a');
  });

  it('rejects an unparseable sent_at', async () => {
    const bad = rawWith('not-a-date');
    await expect(
      new WordPressConnector().parseWebhook(
        cfg,
        { 'x-kb-signature': signBody('topsecret1', bad) },
        { raw: bad },
      ),
    ).rejects.toThrow(/sent_at/);
  });
});
