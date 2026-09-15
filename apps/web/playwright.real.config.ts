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
  /**
   * 150 s, not 60 s. `POST /auth/local` allows five attempts a minute per IP — a real defence —
   * and this gate signs in as several fresh people per spec from one address, so a spec can
   * legitimately spend a minute waiting the window out before its first click lands
   * (`helpers/users.ts` does that waiting). At 60 s the budget ran out inside the wait and the
   * failure read as "the queue never rendered", nowhere near the cause.
   */
  timeout: 150_000,
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
    /**
     * The SSO round trip, and the only project that must start signed *out*.
     *
     * It runs first and without the setup dependency: `storageState` is what every other project
     * needs and the one thing this one cannot have, since the whole point is to watch a browser
     * with no session take the Microsoft button through the issuer and back. It is also the only
     * project that writes to the database's user table by logging in, which is why it is ordered
     * ahead of the shared-state suite rather than beside it.
     */
    ...(process.env.E2E_OIDC === '1' ? [{ name: 'sso', testMatch: /real\/login\.spec\.ts/ }] : []),
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      ...(process.env.E2E_OIDC === '1' ? { dependencies: ['sso'] } : {}),
    },
    {
      name: 'real',
      testIgnore: /auth\.setup\.ts|real\/login\.spec\.ts/,
      dependencies: ['setup'],
      // Every other spec reuses the session the setup project signed in with.
      use: { storageState: 'e2e/.auth/admin.json' },
    },
  ],
});
