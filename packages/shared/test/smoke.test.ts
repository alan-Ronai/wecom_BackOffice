import { describe, it, expect } from 'vitest';
import { VERSION } from '../src/index.js';

describe('shared', () => {
  it('exposes a contract version', () => {
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
