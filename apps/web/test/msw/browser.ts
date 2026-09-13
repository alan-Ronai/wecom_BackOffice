import { setupWorker } from 'msw/browser';
import { handlers } from './handlers.js';

/**
 * Browser-side mocks so the Playwright suite can drive the real app before the API lands.
 * Only imported when `VITE_MOCK_API=1`, so a production build never pulls it in.
 */
export const worker = setupWorker(...handlers);
