/**
 * Wave 6 (X2) — the SSE writer for the one route that streams a POST response.
 *
 * Same shape as `modules/events/routes.ts`: hijack the reply, write the headers by hand, and
 * keep the socket alive with comment frames. The difference is the abort: a closed tab has to
 * stop the inference, because the VM has one CPU-only slot and a browser that navigated away
 * would otherwise keep it for the length of a whole answer.
 */
import type { FastifyReply } from 'fastify';
import type { ChatEvent } from '@wecom/shared';

const HEARTBEAT_MS = 15_000;

export interface SseChannel {
  send(e: ChatEvent): void;
  close(): void;
  /** Aborted when the client disconnects; handed to the model client. */
  signal: AbortSignal;
}

export function openSse(reply: FastifyReply): SseChannel {
  reply.hijack();
  const res = reply.raw;
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(': connected\n\n');
  const ctl = new AbortController();
  const hb = setInterval(() => {
    if (!res.writableEnded) res.write(': hb\n\n');
  }, HEARTBEAT_MS);
  let closed = false;
  const stop = () => {
    if (closed) return;
    closed = true;
    clearInterval(hb);
  };
  res.on('close', () => {
    stop();
    ctl.abort();
  });
  return {
    send: (e) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(e)}\n\n`);
    },
    close: () => {
      stop();
      if (!res.writableEnded) res.end();
    },
    signal: ctl.signal,
  };
}

/** Parse an SSE body back into frames. Exported for the integration tests and for X6. */
export const parseSseFrames = (body: string): ChatEvent[] =>
  body
    .split('\n\n')
    .filter((f) => f.startsWith('data: '))
    .map((f) => JSON.parse(f.slice('data: '.length)) as ChatEvent);
