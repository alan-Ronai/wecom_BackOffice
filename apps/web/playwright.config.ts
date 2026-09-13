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
