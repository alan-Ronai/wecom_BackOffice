import { defineConfig } from '@playwright/test';

/**
 * The no-mocks configuration. `scripts/e2e-real.mjs` brings up Postgres, the API and the built
 * SPA, then runs this; it never starts a server itself, and there is no msw anywhere in the
 * stack it points at.
 *
 * Run it with `pnpm e2e:real` from the repo root — running this config directly will fail at the
 * first navigation because nothing is listening.
 */
const baseURL = process.env.E2E_REAL_BASE_URL;

export default defineConfig({
  testDir: 'e2e/real',
  // Shared server-side state (documents get published, deleted and restored), so serial.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    locale: 'he-IL',
    viewport: { width: 1400, height: 860 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'real',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['setup'],
      // Every other spec reuses the session the setup project signed in with.
      use: { storageState: 'e2e/.auth/admin.json' },
    },
  ],
});
