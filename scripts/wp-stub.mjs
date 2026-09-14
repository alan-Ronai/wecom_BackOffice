#!/usr/bin/env node
/**
 * Runs the connectors' WordPress stub as a standalone server for `pnpm e2e:real`, and prints
 * `WP_STUB_URL=<url>` on its first line so the gate can pick the port up.
 *
 * The stub itself is the same TypeScript module the connector unit tests use
 * (`packages/connectors/test/helpers/wpStub.ts`) — running the *same* fake against the real API
 * is the point: an e2e that reimplemented WordPress would be testing the reimplementation.
 *
 * `tsx/esm` is registered here rather than the module being compiled, because the stub lives
 * under `test/` and is deliberately not part of the package's build output.
 */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('tsx/esm', pathToFileURL('./'));

const { startWpStub } = await import('../packages/connectors/test/helpers/wpStub.ts');

const stub = await startWpStub([
  {
    id: 101,
    title: { rendered: 'נוהל WordPress לבדיקה' },
    content: { rendered: '<h2>מבוא</h2><p>סף מהירות: 5 מגה.</p><ul><li>בדיקת APN</li></ul>' },
    modified_gmt: '2026-09-01T00:00:00',
    link: 'http://wp/101',
    status: 'publish',
  },
]);

console.log(`WP_STUB_URL=${stub.url}`);

const stop = () => {
  void stub.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// Nothing else holds the loop open once `listen` has a handle, so keep it alive explicitly.
setInterval(() => {}, 1 << 30);
