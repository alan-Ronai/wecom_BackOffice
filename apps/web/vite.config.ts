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

/**
 * The framework, split off from the app.
 *
 * React, the router, the query client and zod change when a dependency is upgraded — a handful of
 * times a year. The app changes every deploy. Keeping them in one file meant every deploy
 * invalidated all ~520 kB of it for every user on a LAN with a warm cache. Split, a deploy
 * re-downloads the app chunk and the route chunks that changed, and the framework stays cached.
 *
 * This is not a first-paint win on a cold cache — those bytes are all genuinely needed before the
 * first screen renders, which is why they are not lazy. The first-paint win is the route splitting
 * in `src/routes.tsx`, which is what stopped an agent opening the library from downloading the
 * entire admin console first.
 */
const FRAMEWORK = ['react', 'react-dom', 'react-router', 'react-router-dom', 'scheduler'];

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks: (id: string) => {
          if (!id.includes('node_modules')) return undefined;
          // Match on the package directory, so `react-router-dom` does not also catch, say, a
          // package merely named `…-react`.
          if (FRAMEWORK.some((p) => id.includes(`/node_modules/${p}/`))) return 'framework';
          if (id.includes('/node_modules/zod/')) return 'zod';
          if (id.includes('/node_modules/@tanstack/')) return 'query';
          return undefined;
        },
      },
    },
  },
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
