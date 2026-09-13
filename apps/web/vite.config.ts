import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * `E2E_API_URL` lets the real-stack gate (`pnpm e2e:real`) point the preview server at an API on
 * an ephemeral port; everything else defaults to the usual dev API on :3000.
 */
const apiTarget = process.env.E2E_API_URL ?? 'http://localhost:3000';
const proxy = {
  // Covers `/api/v1/events` too, so SSE needs no separate entry — but keep `/events` for any
  // caller still using the unprefixed path.
  '/api': { target: apiTarget, changeOrigin: false },
  '/events': { target: apiTarget, changeOrigin: false },
};

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // `vite preview` needs its own proxy block; it does not inherit `server.proxy`.
  preview: { port: 4173, proxy },
  test: {
    environment: 'jsdom',
    // Pinned so the same-origin API base is deterministic and never reaches a real dev server.
    environmentOptions: { jsdom: { url: 'http://kb.test/' } },
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts?(x)'],
    globals: false,
    css: false,
    testTimeout: 15000,
  },
});
