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
});
