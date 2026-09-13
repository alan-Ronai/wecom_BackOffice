import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { startPaloAltoStub } from '../helpers/l3/paloalto.js';
import { integration } from '../helpers/l3/db.js';
import {
  PaloAltoClient,
  parseSubnets,
  ipInSubnets,
  parseUserIdXml,
} from '../../src/modules/auth/paloalto.js';

describe('paloalto helpers', () => {
  it('parses subnets and checks membership', () => {
    const s = parseSubnets('10.1.0.0/16, 192.168.5.0/24');
    expect(ipInSubnets('10.1.2.3', s)).toBe(true);
    expect(ipInSubnets('10.2.2.3', s)).toBe(false);
    expect(ipInSubnets('::ffff:192.168.5.9', s)).toBe(true);
    expect(ipInSubnets('not-an-ip', s)).toBe(false);
  });
  it('parses the XML answer', () => {
    expect(
      parseUserIdXml(
        '<response status="success"><result><entry><ip>10.1.2.3</ip><user>WECOM\\inbar</user></entry></result></response>',
      ),
    ).toBe('WECOM\\inbar');
    expect(parseUserIdXml('<response status="success"><result><entry></entry></result></response>')).toBeNull();
    expect(parseUserIdXml('garbage')).toBeNull();
  });
});

const run = integration ? describe : describe.skip;
run('PaloAltoClient', () => {
  let stub: Awaited<ReturnType<typeof startPaloAltoStub>>;
  beforeAll(async () => {
    stub = await startPaloAltoStub(8089);
  });
  afterAll(async () => {
    await stub.stop();
  });
  it('returns the mapped user', async () => {
    stub.setMapping('10.1.2.3', 'WECOM\\inbar');
    const c = new PaloAltoClient('127.0.0.1:8089', 'k', fetch, 'http');
    expect(await c.lookup('10.1.2.3')).toEqual({ domain: 'WECOM', user: 'inbar' });
    expect(await c.lookup('10.1.2.4')).toBeNull();
  });
  it('returns null on auth failure instead of throwing', async () => {
    const c = new PaloAltoClient('127.0.0.1:8089', 'wrong', fetch, 'http');
    expect(await c.lookup('10.1.2.3')).toBeNull();
  });
});
