import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const keyOf = (hex: string): Buffer => {
  if (!/^[0-9a-f]{64}$/i.test(hex)) throw new Error('CONNECTOR_KEY must be 32 bytes hex');
  return Buffer.from(hex, 'hex');
};

/** AES-256-GCM: 12-byte IV ‖ 16-byte auth tag ‖ ciphertext. */
export function encryptConfig(keyHex: string, obj: unknown): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', keyOf(keyHex), iv);
  const enc = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), enc]);
}

export function decryptConfig<T = unknown>(keyHex: string, buf: Buffer): T {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const d = createDecipheriv('aes-256-gcm', keyOf(keyHex), iv);
  d.setAuthTag(tag);
  return JSON.parse(Buffer.concat([d.update(enc), d.final()]).toString('utf8')) as T;
}
