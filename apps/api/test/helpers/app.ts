import type pg from 'pg';
import { buildApp } from '../../src/app.js';
import fakeAuth from './fakeAuth.js';

export const buildTestApp = (pool: pg.Pool, url: string) =>
  buildApp({
    config: { DATABASE_URL: url, NODE_ENV: 'test' },
    pool,
    boss: false,
    plugins: [fakeAuth],
  });
