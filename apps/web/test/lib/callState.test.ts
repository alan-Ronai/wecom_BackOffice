import { describe, it, expect } from 'vitest';
import { callState } from '../../src/lib/callState.js';

describe('callState', () => {
  it('persists per document in sessionStorage', () => {
    callState.set('d1', {
      started: 1,
      active: 's2',
      results: { s1: { kind: 'out', idx: 0, label: 'x', ts: 1 } },
    });
    expect(JSON.parse(sessionStorage.getItem('kb.call.d1')!).active).toBe('s2');
    expect(callState.get('d1').results.s1.label).toBe('x');
    callState.reset('d1');
    expect(callState.get('d1').active).toBeNull();
  });

  it('is isolated per document and survives corrupt data', () => {
    callState.set('a', { started: null, active: 'sA', results: {} });
    callState.set('b', { started: null, active: 'sB', results: {} });
    expect(callState.get('a').active).toBe('sA');
    expect(callState.get('b').active).toBe('sB');
    sessionStorage.setItem('kb.call.c', 'not json');
    expect(callState.get('c')).toEqual({ started: null, active: null, results: {} });
  });
});
