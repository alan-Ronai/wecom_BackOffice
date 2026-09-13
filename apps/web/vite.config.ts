import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
    },
  },
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
