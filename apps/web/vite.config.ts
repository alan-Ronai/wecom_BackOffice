import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
      '/events': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts?(x)'],
  },
});
