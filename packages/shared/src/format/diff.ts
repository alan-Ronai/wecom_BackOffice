import { escapeHtml, stripFmt } from './bidi.js';

export function wordDiff(a: string, b: string): { a: string; b: string; changed: boolean } {
  const A = stripFmt(a)
      .split(/(\s+)/)
      .filter((x) => x.length),
    B = stripFmt(b)
      .split(/(\s+)/)
      .filter((x) => x.length);
  const n = A.length,
    m = B.length;
  const L: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  let i = 0,
    j = 0;
  const outA: string[] = [],
    outB: string[] = [];
  while (i < n && j < m) {
    if (A[i] === B[j]) {
      outA.push(escapeHtml(A[i]));
      outB.push(escapeHtml(B[j]));
      i++;
      j++;
    } else if (L[i + 1][j] >= L[i][j + 1]) outA.push(`<del class="d">${escapeHtml(A[i++])}</del>`);
    else outB.push(`<ins class="d">${escapeHtml(B[j++])}</ins>`);
  }
  while (i < n) outA.push(`<del class="d">${escapeHtml(A[i++])}</del>`);
  while (j < m) outB.push(`<ins class="d">${escapeHtml(B[j++])}</ins>`);
  return {
    a: outA.join(''),
    b: outB.join(''),
    changed: outA.some((x) => x.startsWith('<del')) || outB.some((x) => x.startsWith('<ins')),
  };
}

const bigrams = (s: string): Map<string, number> => {
  const w = stripFmt(s).toLowerCase().split(/\s+/).filter(Boolean);
  const m = new Map<string, number>();
  if (w.length === 1) m.set(w[0], 1);
  for (let i = 0; i < w.length - 1; i++) {
    const k = w[i] + ' ' + w[i + 1];
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return m;
};
export function similarity(a: string, b: string): number {
  const A = bigrams(a),
    B = bigrams(b);
  if (!A.size && !B.size) return 1;
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) ?? 0);
  const sizeA = [...A.values()].reduce((x, y) => x + y, 0),
    sizeB = [...B.values()].reduce((x, y) => x + y, 0);
  return (2 * inter) / (sizeA + sizeB);
}
