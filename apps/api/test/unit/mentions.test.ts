import { describe, it, expect } from 'vitest';
import { parseMentions } from '../../src/modules/collab/mentions.js';
import { diffRows } from '../../src/modules/admin/audit-diff.js';

const users = [
  { id: 'u1', displayName: 'ענבר לוי' },
  { id: 'u2', displayName: 'ענבר' },
  { id: 'u3', displayName: 'דנה רוזן' },
  { id: 'u4', displayName: 'Dana Cohen' },
];

describe('parseMentions', () => {
  it('prefers the longest matching display name', () => {
    expect(parseMentions('@ענבר לוי תבדקי בבקשה', users)).toEqual([
      { userId: 'u1', displayName: 'ענבר לוי' },
    ]);
  });
  it('matches a single-word name exactly', () => {
    expect(parseMentions('שאלה ל@ענבר, מה קורה?', users)).toEqual([{ userId: 'u2', displayName: 'ענבר' }]);
  });
  it('is case-insensitive for latin names', () => {
    expect(parseMentions('@dana cohen please look', users)).toEqual([
      { userId: 'u4', displayName: 'Dana Cohen' },
    ]);
  });
  it('names nobody when a prefix is ambiguous', () => {
    expect(parseMentions('@ענ', users)).toEqual([]);
  });
  it('resolves an unambiguous prefix', () => {
    expect(parseMentions('@דנה ר', users)).toEqual([{ userId: 'u3', displayName: 'דנה רוזן' }]);
  });
  it('ignores an email address and never repeats a person', () => {
    expect(parseMentions('כתבו ל-inbar@wecom.co.il ואז @ענבר לוי ושוב @ענבר לוי', users)).toEqual([
      { userId: 'u1', displayName: 'ענבר לוי' },
    ]);
  });
  it('finds several people in one comment', () => {
    expect(parseMentions('@ענבר לוי ו@דנה רוזן — נא לבדוק', users).map((m) => m.userId)).toEqual([
      'u1',
      'u3',
    ]);
  });
});

describe('diffRows', () => {
  it('reports only the fields that changed, by path', () => {
    expect(diffRows({ active: true, name: 'א' }, { active: false, name: 'א' })).toEqual([
      { path: 'active', before: true, after: false },
    ]);
  });
  it('descends into nested objects', () => {
    expect(
      diffRows({ oidc: { issuer: 'a', clientId: 'x' } }, { oidc: { issuer: 'b', clientId: 'x' } }),
    ).toEqual([{ path: 'oidc.issuer', before: 'a', after: 'b' }]);
  });
  it('treats an array as one row rather than exploding it', () => {
    expect(diffRows({ roles: ['a'] }, { roles: ['a', 'b'] })).toEqual([
      { path: 'roles', before: ['a'], after: ['a', 'b'] },
    ]);
  });
  it('reports added and removed keys', () => {
    expect(
      diffRows({ a: 1 }, { b: 2 })
        .map((r) => r.path)
        .sort(),
    ).toEqual(['a', 'b']);
  });
  it('is empty when nothing changed', () => {
    expect(diffRows({ a: 1 }, { a: 1 })).toEqual([]);
  });
  it('reports a whole-value replacement when a side is not an object', () => {
    expect(diffRows(null, { a: 1 })).toEqual([{ path: '(root)', before: null, after: { a: 1 } }]);
  });
});
