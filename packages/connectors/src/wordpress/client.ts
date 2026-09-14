import type { WpConfig } from './config.js';

export interface WpPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  modified_gmt: string;
  link: string;
  status: string;
  categories?: number[];
}

export class WpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'WpError';
  }
}

export class WpClient {
  constructor(
    private cfg: WpConfig,
    private fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization:
        'Basic ' + Buffer.from(this.cfg.username + ':' + this.cfg.applicationPassword).toString('base64'),
      'content-type': 'application/json',
    };
  }

  private async req<T>(method: string, path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    const res = await this.fetchImpl(this.cfg.baseUrl + path, {
      method,
      headers: this.headers(),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new WpError(res.status, `WordPress ${method} ${path} → ${res.status}`);
    return { data: (await res.json()) as T, headers: res.headers };
  }

  /** Uploads one binary to the media library; WordPress wants raw bytes + Content-Disposition, not JSON. */
  async uploadMedia(
    bytes: Uint8Array,
    mime: string,
    filename: string,
  ): Promise<{ id: number; source_url: string }> {
    const res = await this.fetchImpl(this.cfg.baseUrl + '/wp-json/wp/v2/media', {
      method: 'POST',
      headers: {
        authorization: this.headers().authorization,
        'content-type': mime,
        'content-disposition': `attachment; filename="${filename.replace(/["\r\n]/g, '')}"`,
      },
      // `fetch` types accept a BufferSource; Uint8Array<ArrayBufferLike> needs the narrowing cast.
      body: bytes as unknown as BodyInit,
    });
    if (!res.ok) throw new WpError(res.status, `WordPress POST media → ${res.status}`);
    return (await res.json()) as { id: number; source_url: string };
  }

  async ping(): Promise<void> {
    await this.req('GET', '/wp-json/');
  }

  async listPosts(
    type: string,
    o: { modifiedAfter?: string; page: number; perPage: number },
  ): Promise<{ items: WpPost[]; totalPages: number }> {
    const q = new URLSearchParams({
      per_page: String(o.perPage),
      page: String(o.page),
      status: 'publish,draft',
      context: 'edit',
      _fields: 'id,title,content,modified_gmt,link,status,categories',
    });
    if (o.modifiedAfter) q.set('modified_after', o.modifiedAfter);
    const { data, headers } = await this.req<WpPost[]>('GET', `/wp-json/wp/v2/${type}?${q}`);
    return { items: data, totalPages: Number(headers.get('x-wp-totalpages') ?? 1) };
  }

  async getPost(type: string, id: number): Promise<WpPost> {
    return (await this.req<WpPost>('GET', `/wp-json/wp/v2/${type}/${id}?context=edit`)).data;
  }

  async createPost(type: string, body: { title: string; content: string; status: string }): Promise<WpPost> {
    return (await this.req<WpPost>('POST', `/wp-json/wp/v2/${type}`, body)).data;
  }

  async updatePost(type: string, id: number, body: { title: string; content: string }): Promise<WpPost> {
    return (await this.req<WpPost>('POST', `/wp-json/wp/v2/${type}/${id}`, body)).data;
  }
}
