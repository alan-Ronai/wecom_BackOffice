/**
 * Wave 6 — the seam between X2's chat half of the `ai` module and X1's admin half.
 *
 * Both lanes need `/api/v1/ai/**` and `/api/v1/admin/ai/**` registered, and `modules/index.ts`
 * must gain exactly **one** line for the wave rather than one per lane — two lanes editing the
 * same list in parallel is a merge conflict for no benefit. So `ai/index.ts` owns the single
 * registration and calls whatever is registered here.
 *
 * X1 replaces the no-op by calling `registerAdmin` from its own module file:
 *
 * ```ts
 * // modules/ai/admin.ts (X1)
 * registerAdmin(async (app) => { await app.register(adminAiRoutes); });
 * ```
 *
 * and `ai/index.ts` imports `./admin.js` for the side effect once X1 lands. Until then the
 * default is a no-op, so this lane compiles and runs with X1 absent — which is the point.
 *
 * **In the end X1 did not use it** (A-M11): the admin routes landed under
 * `modules/admin/routes.ts`, so `registrar` is the no-op in every configuration that ships and
 * `registerAdmin` has no caller. The hook stays because `runAdminRegistrar` is what lets the
 * chat half boot with the admin half absent, but `ai/index.ts` no longer re-exports
 * `registerAdmin` — a seam nothing drives should not look like a live one from outside.
 */
import type { FastifyInstance } from 'fastify';

export type AdminRegistrar = (app: FastifyInstance) => Promise<void>;

const noop: AdminRegistrar = async () => {};

let registrar: AdminRegistrar = noop;

/** Called at import time by X1's `ai/admin.ts`. Last one wins; there is only ever one. */
export const registerAdmin = (fn: AdminRegistrar): void => {
  registrar = fn;
};

export const runAdminRegistrar = (app: FastifyInstance): Promise<void> => registrar(app);

export const hasAdminRegistrar = (): boolean => registrar !== noop;
