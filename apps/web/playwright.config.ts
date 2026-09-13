import { defineConfig } from '@playwright/test';

/**
 * Two modes:
 *  - default: Vite dev server with `VITE_MOCK_API=1`, so the suite runs against the msw-backed
 *    build while L1/L2/L3 are still in flight.
 *  - `E2E_BASE_URL=…`: the Compose stack from deploy/, with a real API and (optionally, with
 *    `E2E_OIDC=1`) the local OIDC test issuer started by the global setup.
 */
const external = !!process.env.E2E_BASE_URL;
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5174';

export default defineConfig({
  testDir: 'e2e',
  // `e2e/real/` is the no-mocks suite; it needs a real API and is driven by `pnpm e2e:real`
  // through `playwright.real.config.ts`. Running it here would point it at the msw build.
  testIgnore: /e2e\/real\//,
  globalSetup: './e2e/fixtures/oidc-issuer.ts',
  use: { baseURL, locale: 'he-IL', viewport: { width: 1400, height: 860 } },
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  webServer: external
    ? undefined
    : {
        command: 'pnpm vite --port 5174 --strictPort',
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        env: { VITE_MOCK_API: '1' },
        timeout: 120_000,
      },
});
