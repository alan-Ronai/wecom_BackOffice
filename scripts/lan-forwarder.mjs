#!/usr/bin/env node
/**
 * A TCP forwarder, so that `pnpm e2e:compose` can play a client *on the LAN* honestly.
 *
 * The LAN identity path turns on `req.ip`, and `req.ip` is now whatever address the connection to
 * nginx actually came from (deploy/nginx.conf replaces `X-Forwarded-For` rather than appending to
 * it). A browser on the developer's machine reaches the published port from the docker bridge
 * gateway, which is deliberately outside `PALOALTO_SUBNETS` — so there is no header it can send
 * to look like a LAN client any more, and there should not be.
 *
 * What it can do is connect *through* something that is on the LAN. `deploy/docker-compose.e2e.yml`
 * runs one of these per address it needs — a container on a compose network whose subnet is the
 * simulated LAN, pinned to a fixed `ipv4_address`, publishing 443 to the host. nginx sees the
 * forwarder's address as `$remote_addr`, writes exactly that into `X-Forwarded-For`, and the API
 * identifies the request the way it would identify a real agent's laptop. Nothing forges a header
 * anywhere in the gate.
 *
 * Raw TCP, not HTTP: TLS is terminated by nginx, so this must not look inside the stream.
 *
 *   FORWARD_LISTEN_PORT   what to listen on inside the container (default 443)
 *   FORWARD_TARGET_HOST   the compose service to forward to (default `web`)
 *   FORWARD_TARGET_PORT   its port (default 443)
 *
 * No dependencies on purpose: it runs in a bare `node:22-alpine` with only this file mounted,
 * exactly like `scripts/paloalto-stub.mjs`.
 */
import net from 'node:net';

const LISTEN_PORT = Number(process.env.FORWARD_LISTEN_PORT ?? 443);
const TARGET_HOST = process.env.FORWARD_TARGET_HOST ?? 'web';
const TARGET_PORT = Number(process.env.FORWARD_TARGET_PORT ?? 443);

const server = net.createServer((client) => {
  const upstream = net.connect(TARGET_PORT, TARGET_HOST);
  upstream.on('connect', () => {
    client.pipe(upstream);
    upstream.pipe(client);
  });
  // Either side going away takes the pair down; without this a half-open socket leaks a
  // connection per navigation and the specs eventually stall on nginx's worker limit.
  const close = () => {
    client.destroy();
    upstream.destroy();
  };
  client.on('error', close);
  upstream.on('error', close);
  client.on('close', close);
  upstream.on('close', close);
});

server.on('error', (err) => {
  console.error(`lan-forwarder: ${err.message}`);
  process.exit(1);
});
server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`lan-forwarder: :${LISTEN_PORT} -> ${TARGET_HOST}:${TARGET_PORT}`);
});
