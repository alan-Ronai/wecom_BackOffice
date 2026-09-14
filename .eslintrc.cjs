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
};
