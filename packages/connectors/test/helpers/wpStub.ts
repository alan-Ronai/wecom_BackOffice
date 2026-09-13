import http from 'node:http';
import type { AddressInfo } from 'node:net';

export interface WpPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  modified_gmt: string;
  link: string;
  status: string;
  categories?: number[];
}
export interface WpStub {
  url: string;
  posts: Map<string, WpPost>;
  puts: { type: string; id: number | null; body: unknown }[];
  lastAuth: string | null;
  close(): Promise<void>;
}

/** Minimal in-process stand-in for the WordPress REST API (no real WordPress in tests). */
export async function startWpStub(seed: WpPost[]): Promise<WpStub> {
  const posts = new Map<string, WpPost>(seed.map((p) => ['posts:' + p.id, p]));
  const puts: WpStub['puts'] = [];
  let lastAuth: string | null = null;
  let nextId = 1000;
  const server = http.createServer((req, res) => {
    lastAuth = req.headers.authorization ?? null;
    const url = new URL(req.url ?? '/', 'http://x');
    const m = /^\/wp-json\/wp\/v2\/(\w+)(?:\/(\d+))?$/.exec(url.pathname);
    const json = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(code, { 'content-type': 'application/json', ...headers });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/wp-json/') return json(200, { name: 'stub', namespaces: ['wp/v2'] });
    if (!m) return json(404, { code: 'rest_no_route' });
    const [, type, id] = m;
    let raw = '';
    req.on('data', (c) => {
      raw += c;
    });
    req.on('end', () => {
      if (req.method === 'GET' && !id) {
        const perPage = Number(url.searchParams.get('per_page') ?? 10);
        const page = Number(url.searchParams.get('page') ?? 1);
        const after = url.searchParams.get('modified_after');
        const all = [...posts.entries()]
          .filter(([k]) => k.startsWith(type + ':'))
          .map(([, p]) => p)
          .filter((p) => !after || p.modified_gmt > after)
          .sort((a, b) => a.id - b.id);
        const totalPages = Math.max(1, Math.ceil(all.length / perPage));
        return json(200, all.slice((page - 1) * perPage, page * perPage), {
          'x-wp-totalpages': String(totalPages),
          'x-wp-total': String(all.length),
        });
      }
      if (req.method === 'GET' && id) {
        const p = posts.get(type + ':' + id);
        return p ? json(200, p) : json(404, { code: 'rest_post_invalid_id' });
      }
      if (req.method === 'POST') {
        const body = JSON.parse(raw || '{}') as { title?: string; content?: string; status?: string };
        const pid = id ? Number(id) : nextId++;
        const prev = posts.get(type + ':' + pid);
        const p: WpPost = {
          id: pid,
          title: { rendered: body.title ?? prev?.title.rendered ?? '' },
          content: { rendered: body.content ?? prev?.content.rendered ?? '' },
          modified_gmt: new Date().toISOString().slice(0, 19),
          link: 'http://wp/' + pid,
          status: body.status ?? 'publish',
        };
        posts.set(type + ':' + pid, p);
        puts.push({ type, id: id ? pid : null, body });
        return json(id ? 200 : 201, p);
      }
      json(405, {});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const url = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
  return {
    url,
    posts,
    puts,
    get lastAuth() {
      return lastAuth;
    },
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
