import { describe, it, expect } from 'vitest';
import { localContentHash, stableStringify } from '../../src/modules/sync/hash.js';
import { connectorCategories } from '../../src/modules/sync/parity.js';
import { createRemoteCache } from '../../src/modules/sync/remote-cache.js';
import { escapeODataString } from '../../src/modules/auth/oidc.js';

describe('local content hash', () => {
  const snapshot = {
    title: 'איטיות גלישה',
    phases: [{ id: 'p1', label: 'אבחון', steps: [{ key: 's1', num: '1', title: 'פתח CRM' }] }],
  };

  it('is stable across key order', () => {
    // A jsonb round trip does not preserve key order, so a digest over `JSON.stringify` of the row
    // would change every time Postgres felt like reordering — reporting drift that never happened.
    const reordered = {
      phases: [{ steps: [{ title: 'פתח CRM', num: '1', key: 's1' }], label: 'אבחון', id: 'p1' }],
      title: 'איטיות גלישה',
    };
    expect(localContentHash(reordered)).toBe(localContentHash(snapshot));
  });

  it('ignores fields that are not content', () => {
    expect(localContentHash({ ...snapshot, currentVersion: 8, updatedAt: 'x' })).toBe(
      localContentHash(snapshot),
    );
  });

  it('changes when the content does', () => {
    const edited = structuredClone(snapshot);
    edited.phases[0].steps[0].title = 'פתח CRM ובדוק';
    expect(localContentHash(edited)).not.toBe(localContentHash(snapshot));
  });

  it('answers for a document with no published snapshot', () => {
    expect(localContentHash(null)).toBe(localContentHash({ title: '', phases: [] }));
  });

  it('keeps array order significant', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });
});

describe('connector categories', () => {
  it('reads the WordPress category map, dropping slugs that name no world', () => {
    // Wave 4 made worlds rows, so "is this a real world?" is a question about the database, not
    // about a static enum — the caller passes the slugs that exist.
    expect(
      connectorCategories(
        { categoryMap: { support: 'tech', billing: 'billing', x: 'nope' } },
        [],
        ['tech', 'billing', 'sim'],
      ),
    ).toEqual(['billing', 'tech']);
  });

  it('accepts whatever is declared when the caller has no world list', () => {
    expect(connectorCategories({ categoryMap: { x: 'field' } }, [])).toEqual(['field']);
  });

  it('falls back to the categories already linked when the config declares none', () => {
    expect(connectorCategories({ mapping: { title: 'name' } }, ['intl', 'intl', 'sim'])).toEqual([
      'intl',
      'sim',
    ]);
  });

  it('is empty when nothing is declared and nothing is linked — no unlinked documents to report', () => {
    expect(connectorCategories({}, [])).toEqual([]);
  });
});

describe('remote listing cache', () => {
  it('serves one fetch per window and refetches after it', async () => {
    let now = 1_000;
    let calls = 0;
    const cache = createRemoteCache(60_000, () => now);
    const load = async () => {
      calls++;
      return [{ externalId: '1', title: 't', hash: 'h', updatedAt: '2026-01-01', kind: 'post' }];
    };
    await cache.get('c1', load);
    await cache.get('c1', load);
    expect(calls).toBe(1);
    now += 59_000;
    await cache.get('c1', load);
    expect(calls).toBe(1);
    now += 2_000;
    await cache.get('c1', load);
    expect(calls).toBe(2);
  });

  it('shares one round trip between concurrent callers', async () => {
    let calls = 0;
    const cache = createRemoteCache();
    const load = async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 5));
      return [];
    };
    await Promise.all([cache.get('c1', load), cache.get('c1', load), cache.get('c1', load)]);
    expect(calls).toBe(1);
  });

  it('caches a failure too, so an outage is not turned into a retry loop', async () => {
    let calls = 0;
    const cache = createRemoteCache();
    const load = async () => {
      calls++;
      throw new Error('ECONNREFUSED');
    };
    const first = await cache.get('c1', load);
    const second = await cache.get('c1', load);
    expect(calls).toBe(1);
    expect(first).toEqual({ ok: false, error: 'ECONNREFUSED' });
    expect(second).toEqual(first);
  });

  it('keys by connector', async () => {
    let calls = 0;
    const cache = createRemoteCache();
    const load = async () => {
      calls++;
      return [];
    };
    await cache.get('c1', load);
    await cache.get('c2', load);
    expect(calls).toBe(2);
  });
});

describe('OData string escaping', () => {
  it('doubles the quote so a name with an apostrophe searches for itself', () => {
    expect(escapeODataString("O'Brien")).toBe("O''Brien");
  });

  it('neutralises an attempt to close the literal and append filter syntax', () => {
    const injected = "x') or startswith(displayName,'";
    // Escaped, the whole thing stays one string literal: the search finds nothing, which is the
    // right answer, rather than matching every group in the directory.
    expect(escapeODataString(injected)).toBe("x'') or startswith(displayName,''");
    expect(escapeODataString(injected).split("'").length % 2).toBe(1);
  });

  it('leaves an ordinary name alone', () => {
    expect(escapeODataString('KB-Editors')).toBe('KB-Editors');
  });
});
