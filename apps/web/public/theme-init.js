/*
  Stamps the theme before the first paint.

  `applyPrefs` already resolves the same thing — the stored choice, or the OS preference when
  there is none — but it cannot run until `/me/preferences` has answered, so a user whose OS
  is dark, or who chose dark last week, got a full light-themed paint first and a flash when
  the app caught up. This reads the same `localStorage` mirror `useUiPrefs` writes and
  applies the same rule, so the two can never disagree about what "no choice" means.

  Deliberately not a `@media (prefers-color-scheme: dark)` block in the stylesheet: that
  would mean maintaining the dark palette twice, under two selectors, and a token added to
  one and not the other is a bug nothing would catch.

  It is a **file** rather than an inline `<script>` in `index.html` for the reason the operator
  walkthrough found (W-4): `deploy/nginx-security-headers.conf` sends `script-src 'self'`, so the
  inline version was blocked on every page load in the deployed stack and had never once run —
  the flash it exists to prevent was exactly what a dark-mode user saw. A hash in the CSP would
  have worked too, and would have had to be regenerated on every edit to these ten lines; served
  from `public/` it is plain `'self'`, and `index.html` loads it with a blocking `<script src>`
  ahead of the module bundle so it still runs before anything is painted.

  Not bundled on purpose: Vite would hash its name, and `index.html` would then have to reference
  the hashed name — which is fine for the module entry, but this has to be loadable by a path
  that never changes.
*/
(function () {
  try {
    var stored = JSON.parse(localStorage.getItem('wecom.ui-prefs') || '{}').theme;
    var dark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.dataset.theme = stored || (dark ? 'dark' : 'light');
  } catch (e) {
    /* private mode, blocked storage — the app applies the theme a moment later */
  }
})();
