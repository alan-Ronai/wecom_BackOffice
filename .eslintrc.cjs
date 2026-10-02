module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint', 'react'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended', 'prettier'],
  ignorePatterns: ['dist', 'legacy', 'node_modules', '*.d.ts', 'apps/api/migrations', 'design', 'docs'],
  // Pinned rather than 'detect': `react` is a dependency of `apps/web`, not of the root where
  // eslint runs, so detection prints a warning on every lint and falls back to "latest" anyway.
  settings: { react: { version: '18.3' } },
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    /**
     * D-I11 — a component declared inside another component's render is a *different* component
     * on every render, so React unmounts and remounts its whole subtree: state is lost, inputs
     * lose focus mid-typing, and effects re-run. The ruling on the wave-4 finding was "otherwise
     * just hoist", which is the right fix and was applied by hand; this is what catches the next
     * one at lint time rather than at review time.
     *
     * Only this rule, not `plugin:react/recommended`: the rest of that preset is a large ruleset
     * this codebase has never been held to, and turning it on wholesale would bury the one thing
     * the finding actually asked for.
     */
    'react/no-unstable-nested-components': 'error',
  },
  overrides: [
    {
      /**
       * B-M6 (wave 5) — a focusable non-native control must answer the keyboard, not only the
       * mouse. `jsx-a11y` is not a dependency, so the two shapes the review found are refused with
       * core `no-restricted-syntax`: a `role="button"` on anything but a `<button>`, and a
       * `tabIndex={0}` + `onClick` on a non-native element, each without an `onKeyDown`. The fix
       * is a real `<button type="button">`, or `onKeyDown={pressKeys}` from `src/lib/keyboard.ts`.
       * Both spellings of each value are caught (wave Y review): `role="button"` and
       * `role={'button'}`, `tabIndex={0}` and `tabIndex="0"`.
       * `test/lib/a11yGuard.test.ts` proves the rule fires.
       */
      files: ['apps/web/src/**/*.tsx'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "JSXOpeningElement:not([name.name='button']):has(> JSXAttribute[name.name='role']:matches([value.value='button'], [value.expression.value='button'])):not(:has(> JSXAttribute[name.name='onKeyDown']))",
            message:
              'B-M6: role="button" needs Enter/Space — use a real <button type="button">, or add onKeyDown={pressKeys} (src/lib/keyboard.ts).',
          },
          {
            selector:
              "JSXOpeningElement:not([name.name=/^(button|input|select|textarea|summary)$/]):has(> JSXAttribute[name.name='tabIndex']:matches([value.expression.value=0], [value.value='0'], [value.expression.value='0'])):has(> JSXAttribute[name.name='onClick']):not(:has(> JSXAttribute[name.name='onKeyDown'])):not(:has(> JSXAttribute[name.name='href'])):not(:has(> JSXAttribute[name.name='role']:matches([value.value='button'], [value.expression.value='button'])))",
            message:
              'B-M6: a focusable element with onClick needs key handling — use a native control, or add onKeyDown={pressKeys} (src/lib/keyboard.ts).',
          },
        ],
      },
    },
  ],
};
