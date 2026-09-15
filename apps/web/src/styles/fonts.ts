/**
 * The product's three families, self-hosted.
 *
 * `app.css` used to open with
 *
 *     @import url('https://fonts.googleapis.com/css2?family=Rubik…&family=IBM+Plex+Sans+Hebrew…');
 *
 * which the deployed stack never loaded (walkthrough W-5). `style-src 'self' 'unsafe-inline'`
 * refuses the stylesheet and `font-src 'self'` refuses the font files, so the browser logged a
 * violation on every page load and rendered the whole product in system fallbacks — and the pilot
 * is a LAN VM with no route to `fonts.googleapis.com` anyway, so even without the CSP the request
 * would only have cost every user a DNS timeout on first paint. Where there *is* a route, it
 * leaks every page load to a third party.
 *
 * `@fontsource/*` ships the same OFL-licensed faces as npm packages — the woff2 files come from
 * the registry with the lockfile, not hand-downloaded into `public/` — and Vite emits them as
 * hashed assets under `/assets/`, which is `'self'` and already `immutable`-cached by
 * `deploy/nginx.conf`.
 *
 * Imported from `main.tsx` **before** `app.css`, so the `@font-face` rules are in the sheet by
 * the time the first `font-family: var(--font)` is resolved.
 *
 * Only the subsets and weights the product uses, because every one of these is a file the LAN
 * has to serve: `latin` and `hebrew` for the two text faces, `latin` alone for the monospace one,
 * which only ever sets IDs, cron expressions and URLs. The weights are the ones the old Google
 * Fonts query asked for — Rubik 300–700, Plex Sans Hebrew 400–700, Plex Mono 400/500. Adding a
 * weight to `app.css` means adding its import here; `test/shell/fonts.test.ts` is what notices.
 */

/* IBM Plex Sans Hebrew — `--font`, the body face. */
import '@fontsource/ibm-plex-sans-hebrew/hebrew-400.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-500.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-600.css';
import '@fontsource/ibm-plex-sans-hebrew/hebrew-700.css';
import '@fontsource/ibm-plex-sans-hebrew/latin-400.css';
import '@fontsource/ibm-plex-sans-hebrew/latin-500.css';
import '@fontsource/ibm-plex-sans-hebrew/latin-600.css';
import '@fontsource/ibm-plex-sans-hebrew/latin-700.css';

/* Rubik — the legacy face, still `html[data-font="rubik"]` and every logo lockup. */
import '@fontsource/rubik/hebrew-300.css';
import '@fontsource/rubik/hebrew-400.css';
import '@fontsource/rubik/hebrew-500.css';
import '@fontsource/rubik/hebrew-600.css';
import '@fontsource/rubik/hebrew-700.css';
import '@fontsource/rubik/latin-300.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/rubik/latin-700.css';

/* IBM Plex Mono — `--mono`: ids, cron expressions, URLs, all of them LTR. */
import '@fontsource/ibm-plex-mono/latin-400.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
