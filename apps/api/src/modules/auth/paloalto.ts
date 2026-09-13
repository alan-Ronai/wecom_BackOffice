import ipaddr from 'ipaddr.js';
import { XMLParser } from 'fast-xml-parser';
import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { IdentityService } from './identity.js';
import type { SessionStore } from './session-store.js';
import { resolvePermissions, type AuthUser } from './permissions.js';
import { SESSION_COOKIE, cookieOptions } from '../../lib/session.js';

export type Subnet = [ipaddr.IPv4 | ipaddr.IPv6, number];
export function parseSubnets(csv: string): Subnet[] {
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ipaddr.parseCIDR(s) as Subnet);
}
export function ipInSubnets(ip: string, subnets: Subnet[]): boolean {
  if (!ipaddr.isValid(ip)) return false;
  let addr = ipaddr.parse(ip);
  if (addr.kind() === 'ipv6' && (addr as ipaddr.IPv6).isIPv4MappedAddress())
    addr = (addr as ipaddr.IPv6).toIPv4Address();
  return subnets.some(([net, bits]) => net.kind() === addr.kind() && addr.match(net as never, bits));
}

const parser = new XMLParser({ ignoreAttributes: false });
export function parseUserIdXml(xml: string): string | null {
  try {
    const doc = parser.parse(xml) as {
      response?: { result?: { entry?: { user?: string } | { user?: string }[] } };
    };
    const entry = doc.response?.result?.entry;
    const e = Array.isArray(entry) ? entry[0] : entry;
    const user = e && typeof e === 'object' ? e.user : undefined;
    return typeof user === 'string' && user.trim() ? user.trim() : null;
  } catch {
    return null;
  }
}

export class PaloAltoClient {
  constructor(
    private host: string,
    private apiKey: string,
    private fetchImpl: typeof fetch = fetch,
    private scheme: 'https' | 'http' = 'https',
  ) {}
  async lookup(ip: string): Promise<{ domain: string | null; user: string } | null> {
    const cmd = `<show><user><ip-user-mapping><ip>${ip}</ip></ip-user-mapping></user></show>`;
    const url = `${this.scheme}://${this.host}/api/?type=op&key=${encodeURIComponent(this.apiKey)}&cmd=${encodeURIComponent(cmd)}`;
    try {
      const res = await this.fetchImpl(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return null;
      const raw = parseUserIdXml(await res.text());
      if (!raw) return null;
      const i = raw.indexOf('\\');
      return i >= 0 ? { domain: raw.slice(0, i), user: raw.slice(i + 1) } : { domain: null, user: raw };
    } catch {
      return null;
    }
  }
}

export function makeFallbackIdentify(opts: {
  db: pg.Pool;
  client: PaloAltoClient;
  subnets: Subnet[];
  identity: IdentityService;
  sessions: SessionStore;
  env: string;
  log: FastifyBaseLogger;
}) {
  const negative = new Map<string, number>();
  return async (req: FastifyRequest, reply: FastifyReply): Promise<AuthUser | null> => {
    const ip = req.ip;
    if (!ipInSubnets(ip, opts.subnets)) return null;
    const until = negative.get(ip);
    if (until && until > Date.now()) return null;
    const found = await opts.client.lookup(ip);
    if (!found) {
      negative.set(ip, Date.now() + 60_000);
      return null;
    }
    const subject = found.domain ? `${found.domain}\\${found.user}` : found.user;
    const { id } = await opts.identity.upsertUser({
      subject,
      source: 'paloalto',
      email: null,
      displayName: found.user,
    });
    const s = await opts.sessions.create(id, ip, req.headers['user-agent'] ?? null);
    reply.setCookie(SESSION_COOKIE, s.token, cookieOptions(opts.env));
    opts.log.info({ ip, subject }, 'paloalto fallback login');
    const resolved = await resolvePermissions(opts.db, id);
    return { id, displayName: found.user, sessionId: s.id, ...resolved };
  };
}
