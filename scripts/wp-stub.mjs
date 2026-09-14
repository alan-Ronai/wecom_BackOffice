#!/usr/bin/env node
/**
 * Runs the connectors' WordPress stub as a standalone server for `pnpm e2e:real`, and prints
 * `WP_STUB_URL=<url>` on its first line so the gate can pick the port up.
 *
 * The stub itself is the same TypeScript module the connector unit tests use
 * (`packages/connectors/test/helpers/wpStub.ts`) — running the *same* fake against the real API
 * is the point: an e2e that reimplemented WordPress would be testing the reimplementation.
 *
 * Run it with `tsx`, not bare `node`: the stub lives under `test/` and is deliberately not part
 * of the package's build output, so the `.ts` import has to be transformed on the fly.
 *
 * `WP_STUB_PUBLIC_PORT=<port>` additionally puts a plain TCP forwarder in front of it on
 * `WP_STUB_PUBLIC_HOST` (default `0.0.0.0`) and prints `WP_STUB_PUBLIC_URL=<url>`. `startWpStub`
 * binds `127.0.0.1` — right for an in-process unit test, and unreachable from another container,
 * which is what `pnpm e2e:compose` needs. The forwarder lives here rather than in the stub
 * because the stub is shared with the connector unit tests and is not this lane's to change.
 */
import net from 'node:net';
import { startWpStub } from '../packages/connectors/test/helpers/wpStub.ts';

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

const publicPort = Number(process.env.WP_STUB_PUBLIC_PORT ?? 0);
const publicHost = process.env.WP_STUB_PUBLIC_HOST ?? '0.0.0.0';
const stubPort = Number(new URL(stub.url).port);
let forwarder = null;
if (publicPort) {
  forwarder = net.createServer((client) => {
    const upstream = net.connect(stubPort, '127.0.0.1');
    // A half-open pipe would leave the peer waiting for a response that can never come.
    const drop = () => {
      client.destroy();
      upstream.destroy();
    };
    client.on('error', drop);
    upstream.on('error', drop);
    client.pipe(upstream).pipe(client);
  });
  await new Promise((r) => forwarder.listen(publicPort, publicHost, r));
  console.log(`WP_STUB_PUBLIC_URL=http://${publicHost}:${publicPort}`);
}

const stop = () => {
  forwarder?.close();
  void stub.close().then(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
// Nothing else holds the loop open once `listen` has a handle, so keep it alive explicitly.
setInterval(() => {}, 1 << 30);
