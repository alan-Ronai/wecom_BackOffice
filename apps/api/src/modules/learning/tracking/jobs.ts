import type { FastifyInstance } from 'fastify';
import type { TrackingDeps } from './audiences.js';

/** Filled in by Task 6. */
export async function startTrackingJobs(
  _app: FastifyInstance,
  _deps: () => TrackingDeps,
): Promise<void> {}
