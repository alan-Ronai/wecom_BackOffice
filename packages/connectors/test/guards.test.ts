import { describe, it, expect } from 'vitest';
import { assertAllowedHost, resolveWithin } from '../src/guards.js';

describe('resolveWithin', () => {
  it('passes a path through when no root is configured', () => {
    expect(resolveWithin(undefined, '/anywhere/data.json')).toBe('/anywhere/data.json');
  });
  it('accepts a file inside the root, absolute or relative', () => {
    expect(resolveWithin('/data/connectors', '/data/connectors/a.json')).toBe('/data/connectors/a.json');
    expect(resolveWithin('/data/connectors', 'a.json')).toBe('/data/connectors/a.json');
  });
  it('refuses an absolute path elsewhere and a traversal out of the root', () => {
    expect(() => resolveWithin('/data/connectors', '/app/deploy/.env')).toThrow(/outside/);
    expect(() => resolveWithin('/data/connectors', '/proc/self/environ')).toThrow(/outside/);
    expect(() => resolveWithin('/data/connectors', '../../etc/passwd')).toThrow(/outside/);
  });
});

describe('assertAllowedHost', () => {
  it('allows any host when the allowlist is empty (LAN deployment)', () => {
    expect(() => assertAllowedHost('http://192.168.1.10/wp-json', [])).not.toThrow();
    expect(() => assertAllowedHost('http://127.0.0.1:8080', undefined)).not.toThrow();
  });
  it('always refuses link-local metadata', () => {
    expect(() => assertAllowedHost('http://169.254.169.254/latest/meta-data', [])).toThrow(/link-local/);
  });
  it('enforces a configured allowlist, with .suffix matching subdomains', () => {
    const allow = ['wp.wecom.local', '.example.com'];
    expect(() => assertAllowedHost('https://wp.wecom.local/wp-json', allow)).not.toThrow();
    expect(() => assertAllowedHost('https://a.example.com/x', allow)).not.toThrow();
    expect(() => assertAllowedHost('https://example.com/x', allow)).not.toThrow();
    expect(() => assertAllowedHost('https://evil.test/x', allow)).toThrow(/CONNECTOR_HOST_ALLOWLIST/);
  });
  /**
   * §5: production must set CONNECTOR_HOST_ALLOWLIST, so `*` exists as the written-down way to
   * say "any public host" — what an empty value silently did. It must not weaken the
   * unconditional link-local refusal.
   */
  it('treats `*` as any public host, but still refuses link-local', () => {
    expect(() => assertAllowedHost('https://anything.test/x', ['*'])).not.toThrow();
    expect(() => assertAllowedHost('https://wp.wecom.local/x', ['*', 'other.test'])).not.toThrow();
    expect(() => assertAllowedHost('http://169.254.169.254/latest/meta-data', ['*'])).toThrow(/link-local/);
  });

  /**
   * Deploy review M5. `*` was documented in four places as "any *public* host, private and
   * loopback still refused" and implemented as "anything but link-local". An operator who wrote
   * the setting the documentation told them was the open-but-safe one was in fact exposing
   * `http://127.0.0.1:11434` (the model) and the database port to anyone holding
   * `connectors.manage`. The implementation is now the documented one.
   */
  it('refuses loopback, private and unique-local addresses under `*`', () => {
    for (const host of [
      'http://127.0.0.1:11434/api/tags',
      'http://127.9.9.9/x',
      'http://localhost:5432/x',
      'http://db.localhost/x',
      'http://10.0.0.5/x',
      'http://172.20.0.3/x',
      'http://192.168.1.10/wp-json',
      'http://100.64.0.1/x',
      'http://0.0.0.0/x',
      'http://[::1]:5432/x',
      'http://[fd00::1]/x',
      'http://[fc00::1]/x',
      // An IPv4-mapped IPv6 loopback is a loopback, not an opaque v6 unicast.
      'http://[::ffff:127.0.0.1]/x',
    ])
      expect(() => assertAllowedHost(host, ['*']), host).toThrow(/CONNECTOR_HOST_ALLOWLIST=\*/);
    // Public addresses and names still pass, which is the whole point of the setting.
    expect(() => assertAllowedHost('http://8.8.8.8/x', ['*'])).not.toThrow();
    expect(() => assertAllowedHost('https://[2606:4700::1111]/x', ['*'])).not.toThrow();
  });

  it('lets an explicit entry admit a private or loopback host, `*` present or not', () => {
    // "always refused unless listed explicitly" — this is the listing.
    expect(() => assertAllowedHost('http://127.0.0.1:8085/wp-json', ['*', '127.0.0.1'])).not.toThrow();
    expect(() => assertAllowedHost('http://192.168.1.10/wp-json', ['192.168.1.10'])).not.toThrow();
    expect(() => assertAllowedHost('http://wp.lan/wp-json', ['.lan', '*'])).not.toThrow();
    // …and the empty list is still the unrestricted dev shape production cannot reach.
    expect(() => assertAllowedHost('http://127.0.0.1:11434', [])).not.toThrow();
  });
});
