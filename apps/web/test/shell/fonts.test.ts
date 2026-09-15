import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** Vitest runs with `apps/web` as its root, which is where the installed packages are. */
const WEB = process.cwd();
const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const appCss = read('../../src/styles/app.css');
const fontsTs = read('../../src/styles/fonts.ts');
const mainTsx = read('../../src/main.tsx');
const indexHtml = read('../../index.html');

/** Every `font-family:` the stylesheet declares, flattened to the individual family names. */
const familiesUsed = (): Set<string> => {
  const out = new Set<string>();
  for (const m of appCss.matchAll(/font-family:\s*([^;}]+)/g))
    for (const part of m[1].split(',')) out.add(part.trim().replace(/^['"]|['"]$/g, ''));
  return out;
};

/**
 * W-5 — the Hebrew web font, which nobody has ever seen.
 *
 * `app.css` opened with an `@import` of a Google Fonts stylesheet. `style-src 'self'
 * 'unsafe-inline'` refuses that stylesheet and `font-src 'self'` refuses the files behind it, so
 * the deployed stack logged a violation on every load and rendered in system fallbacks; and the
 * pilot is a LAN VM with no route off the network, where the same request is a DNS timeout on
 * first paint and, where there is a route, a page-load beacon to a third party.
 *
 * The compose suite asserts the other half — that first paint reaches no host but the origin
 * (`e2e/compose/tls-and-headers.spec.ts`). This file is what keeps the `@import` from coming
 * back, and keeps the self-hosted set in step with what the stylesheet actually asks for.
 */
describe('web fonts', () => {
  it('app.css fetches nothing from a third party', () => {
    expect(appCss).not.toContain('fonts.googleapis.com');
    expect(appCss).not.toContain('fonts.gstatic.com');
    // Any remote `@import`/`url()` at all, not just the one that was there.
    expect(appCss).not.toMatch(/@import\s+url\(\s*['"]?https?:/);
    expect(appCss).not.toMatch(/url\(\s*['"]?(https?:)?\/\//);
  });

  it('self-hosts them from the @fontsource packages, ahead of the stylesheet', () => {
    for (const pkg of ['@fontsource/ibm-plex-sans-hebrew', '@fontsource/rubik', '@fontsource/ibm-plex-mono'])
      expect(fontsTs, `${pkg} is imported`).toContain(pkg);
    // The `@font-face` rules must be in the sheet before anything resolves `var(--font)`.
    expect(mainTsx.indexOf("'./styles/fonts.js'")).toBeGreaterThan(-1);
    expect(mainTsx.indexOf("'./styles/fonts.js'")).toBeLessThan(mainTsx.indexOf("'./styles/app.css'"));
    // And nothing reintroduces the hosted sheet through the document instead.
    expect(indexHtml).not.toContain('fonts.googleapis.com');
  });

  /**
   * The set is hand-written (one import per family × weight × subset), because every entry is a
   * file the LAN has to serve. Hand-written means it can fall behind `app.css`, so: every family
   * the stylesheet names, other than the generic and system fallbacks, is one we ship.
   */
  it('ships every family app.css names', () => {
    const generic = new Set([
      'system-ui',
      'sans-serif',
      'serif',
      'monospace',
      'ui-monospace',
      'Menlo',
      'var(--font)',
      'var(--mono)',
      'inherit',
    ]);
    for (const family of familiesUsed()) {
      if (generic.has(family)) continue;
      const slug = family.toLowerCase().replace(/\s+/g, '-');
      expect(fontsTs, `${family} is used in app.css but not self-hosted`).toContain(`@fontsource/${slug}/`);
    }
  });

  /**
   * And every weight, at both subsets, is actually in the installed package — a typo'd import is
   * otherwise a build error only on a clean install, and a missing weight is a face the browser
   * synthesises (a faux-bold Hebrew, which is the thing this whole finding is about).
   */
  it('imports files that exist in the installed packages', () => {
    const imports = [...fontsTs.matchAll(/^import '@fontsource\/([^/]+)\/([^']+)';$/gm)];
    expect(imports.length).toBeGreaterThan(10);
    for (const [, pkg, file] of imports) {
      const dir = readdirSync(join(WEB, 'node_modules/@fontsource', pkg));
      expect(dir, `@fontsource/${pkg}/${file}`).toContain(file);
    }
  });
});
