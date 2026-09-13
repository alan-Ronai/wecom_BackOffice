import { describe, it, expect } from 'vitest';
import { signBody, verifySignature, WordPressConnector, WpConfigSchema } from '../src/index.js';

const cfg = WpConfigSchema.parse({
  baseUrl: 'http://wp',
  username: 'u',
  applicationPassword: 'p',
  postTypes: ['posts'],
  webhookSecret: 'topsecret1',
});
const raw = JSON.stringify({
  event: 'save_post',
  post_type: 'posts',
  post_id: 7,
  modified_gmt: '2025-06-12T10:00:00',
});

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
});
