import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

/**
 * O-6: `create-admin --password 'S3cret…'` printed the new admin password to stdout (pnpm echoes
 * the resolved command line) and left it in shell history. These assertions are about the CLI
 * front door only — the upsert itself is covered by `test/int/create-admin.test.ts`.
 */
const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '../src/cli/create-admin.ts');
const TSX = resolve(dirname(fileURLToPath(import.meta.url)), '../node_modules/.bin/tsx');

const cli = (args: string[], input = '') =>
  spawnSync(TSX, [CLI, ...args], {
    input,
    encoding: 'utf8',
    // No DATABASE_URL: every case here must fail before it would open a pool.
    env: { ...process.env, DATABASE_URL: '' },
    timeout: 30_000,
  });

describe('create-admin CLI', () => {
  it('refuses --password and says why', () => {
    const r = cli(['--email', 'admin@wecom.local', '--password', 'hunter2hunter2']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--password is not accepted any more');
    expect(r.stderr).toContain('--password-stdin');
    // The point of the change: the secret must not be echoed back anywhere.
    expect(`${r.stdout}${r.stderr}`).not.toContain('hunter2hunter2');
  });

  it('prints usage when there is no password on stdin and no terminal to prompt on', () => {
    const r = cli(['--email', 'admin@wecom.local']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--password-stdin');
  });

  it('reports an empty pipe rather than creating an account with a blank password', () => {
    const r = cli(['--email', 'admin@wecom.local', '--password-stdin'], '');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('nothing arrived on stdin');
  });

  it('requires --email', () => {
    const r = cli(['--password-stdin'], 'a-long-enough-password');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage: create-admin');
  });
});
