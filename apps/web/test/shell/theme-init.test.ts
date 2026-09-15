import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const indexHtml = read('../../index.html');
const themeInit = read('../../public/theme-init.js');

/**
 * W-4 — the pre-paint theme stamp, and the CSP it has to survive.
 *
 * `deploy/nginx-security-headers.conf` sends `script-src 'self'`, and the stamp was an inline
 * `<script>` in `index.html`. Every page load in the deployed stack logged
 *
 *   Executing inline script violates the following Content Security Policy directive
 *   'script-src 'self''. Either the 'unsafe-inline' keyword, a hash ('sha256-5tmkAgkg…') …
 *
 * so it had never run in production: the light→dark flash it exists to prevent was exactly what a
 * dark-mode user saw. It is a file under `public/` now — plain `'self'`, no hash to keep in step
 * with an edit to the script, no nonce for nginx to mint.
 *
 * The end-to-end half of this is `e2e/compose/tls-and-headers.spec.ts`, which loads the built app
 * through the real nginx and asserts the theme is stamped with no CSP violation in the console.
 * These are the cheap assertions that keep the mechanism intact between compose runs.
 */
describe('the pre-paint theme stamp', () => {
  it('index.html carries no inline script for the CSP to block', () => {
    // Comments first: the one above the tag talks about `<script src>` in prose.
    const markup = indexHtml.replace(/<!--[\s\S]*?-->/g, '');
    const scripts = [...markup.matchAll(/<script\b([^>]*)>/g)].map((m) => m[1]);
    expect(scripts.length, 'index.html has script tags').toBeGreaterThan(0);
    for (const attrs of scripts) expect(attrs, `<script${attrs}> is inline`).toMatch(/\ssrc=/);
  });

  it('loads it as a blocking classic script, ahead of the module bundle', () => {
    const at = indexHtml.indexOf('<script src="/theme-init.js"></script>');
    expect(at, 'index.html loads /theme-init.js').toBeGreaterThan(-1);
    // Before the entry, or the flash happens anyway.
    expect(at).toBeLessThan(indexHtml.indexOf('src="/src/main.tsx"'));
    // `type="module"` would defer it past the document, which is past the first paint.
    expect(indexHtml).not.toMatch(/<script[^>]*type="module"[^>]*theme-init/);
    // In `<head>`: a stamp that runs after `<body>` has been parsed has already lost.
    expect(at).toBeLessThan(indexHtml.indexOf('</head>'));
  });

  describe('what it stamps', () => {
    beforeEach(() => {
      localStorage.clear();
      delete document.documentElement.dataset.theme;
    });
    const run = () => new Function(themeInit)();

    it('is the stored choice when there is one', () => {
      localStorage.setItem('wecom.ui-prefs', JSON.stringify({ theme: 'dark' }));
      run();
      expect(document.documentElement.dataset.theme).toBe('dark');
    });

    it('falls back to the OS preference — the same rule `useUiPrefs` applies', () => {
      run();
      // jsdom's `matchMedia` answers `matches: false`, i.e. an OS that is not in dark mode.
      expect(document.documentElement.dataset.theme).toBe('light');
    });

    it('survives blocked storage rather than throwing before the app loads', () => {
      localStorage.setItem('wecom.ui-prefs', 'not json');
      expect(run).not.toThrow();
      expect(document.documentElement.dataset.theme).toBeUndefined();
    });
  });
});
