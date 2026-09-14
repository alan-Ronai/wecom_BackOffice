import { defineConfig } from '@playwright/test';

/**
 * The Compose configuration: Playwright against the stack `deploy/` describes — nginx terminating
 * TLS in front of the API, Postgres, a real Ollama, a Palo Alto User-ID stub and a WordPress stub.
 *
 * `scripts/e2e-compose.mjs` brings all of that up and then runs this; it never starts anything
 * itself, so running this config directly fails at the first navigation. Use `pnpm e2e:compose`.
 */
const baseURL = process.env.E2E_COMPOSE_BASE_URL;

export default defineConfig({
  testDir: 'e2e/compose',
  // One database, one library, one WordPress post: shared server-side state throughout.
  workers: 1,
  fullyParallel: false,
  retries: 0,
  // The stack runs CPU-only inference for the source pipeline, and nginx is a real hop; both are
  // slower than the loopback API `playwright.real.config.ts` points at.
  timeout: 120_000,
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    locale: 'he-IL',
    viewport: { width: 1400, height: 860 },
    // The certificate is the throwaway self-signed one the gate mints in deploy/certs. That the
    // connection is TLS at all is asserted in `tls-and-headers.spec.ts`; trusting this particular
    // certificate is not something a test machine can be made to do.
    ignoreHTTPSErrors: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  reporter: [['list']],
  projects: [
    {
      name: 'compose-setup',
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: 'compose',
      testIgnore: /auth\.setup\.ts/,
      dependencies: ['compose-setup'],
      // The break-glass admin. The specs that must arrive signed *out* — the whole LAN identity
      // file — open their own contexts with `browser.newContext()`, which inherits none of this.
      use: { storageState: 'e2e/.auth/compose-admin.json' },
    },
  ],
});
