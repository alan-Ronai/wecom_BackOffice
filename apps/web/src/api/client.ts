import createClient from 'openapi-fetch';
import type { KbPaths } from './paths.js';

/**
 * Typed by `paths.d.ts` until `docs/api/openapi.json` carries the stage-1 routes; the generated
 * `schema.d.ts` is still produced by `pnpm generate:client` and takes over once it does.
 */
export const api = createClient<KbPaths>({ baseUrl: '/api/v1', credentials: 'include' });
