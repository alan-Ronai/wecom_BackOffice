import { describe, it, expect } from 'vitest';
import { encryptConfig, decryptConfig } from '../src/modules/connectors/crypto.js';

const key = 'ab'.repeat(32);

describe('connector config encryption', () => {
  it('round-trips and is non-deterministic', () => {
    const a = encryptConfig(key, { applicationPassword: 'xxxx yyyy', baseUrl: 'http://wp' });
    const b = encryptConfig(key, { applicationPassword: 'xxxx yyyy', baseUrl: 'http://wp' });
    expect(a.equals(b)).toBe(false);
    expect(decryptConfig(key, a)).toEqual({ applicationPassword: 'xxxx yyyy', baseUrl: 'http://wp' });
  });
  it('fails on tampering or wrong key', () => {
    const a = encryptConfig(key, { x: 1 });
    a[a.length - 1] ^= 0xff;
    expect(() => decryptConfig(key, a)).toThrow();
    expect(() => decryptConfig('cd'.repeat(32), encryptConfig(key, { x: 1 }))).toThrow();
  });
});
