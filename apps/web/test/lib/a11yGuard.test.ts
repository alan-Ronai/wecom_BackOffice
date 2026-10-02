import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { createRequire } from 'node:module';

/** The slice of ESLint 8's API this uses. `eslint` lives at the root and ships no types here. */
interface LintResult {
  filePath: string;
  messages: { ruleId: string | null; message: string; line: number }[];
}
interface ESLintApi {
  lintText(code: string, opts: { filePath: string }): Promise<LintResult[]>;
  lintFiles(patterns: string[]): Promise<LintResult[]>;
}
const { ESLint } = createRequire(__filename)('eslint') as {
  ESLint: new (opts: { cwd: string }) => ESLintApi;
};

/**
 * B-M6 (wave 5) — the guard that keeps keyboard-dead controls from landing again: the
 * `no-restricted-syntax` override in the root `.eslintrc.cjs`. These lint snippets as if they were
 * files under `apps/web/src`, so the test fails if the rule is dropped or its selector rots.
 */
const ROOT = path.resolve(__dirname, '../../../..') + path.sep;
const eslint = new ESLint({ cwd: ROOT });

const b6 = async (code: string): Promise<number> => {
  const [r] = await eslint.lintText(code, { filePath: `${ROOT}apps/web/src/__a11y_probe.tsx` });
  return r!.messages.filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.startsWith('B-M6'))
    .length;
};

describe('B-M6 lint guard', () => {
  it('refuses role="button" without key handling', async () => {
    expect(
      await b6(`export const A = () => <span role="button" tabIndex={0} onClick={() => 1}>x</span>;`),
    ).toBe(1);
    expect(await b6(`export const A = () => <a role="button" tabIndex={0} onClick={() => 1}>x</a>;`)).toBe(1);
  });

  it('refuses tabIndex={0} + onClick on a non-native element without key handling', async () => {
    expect(await b6(`export const A = () => <div role="tab" tabIndex={0} onClick={() => 1}>x</div>;`)).toBe(
      1,
    );
  });

  it('wave Y review: catches role={\'button\'} and tabIndex="0" spellings too', async () => {
    expect(
      await b6(`export const A = () => <span role={'button'} tabIndex={0} onClick={() => 1}>x</span>;`),
    ).toBe(1);
    expect(await b6(`export const A = () => <span role={"button"} onClick={() => 1}>x</span>;`)).toBe(1);
    expect(await b6(`export const A = () => <div tabIndex="0" onClick={() => 1}>x</div>;`)).toBe(1);
    expect(await b6(`export const A = () => <div tabIndex={'0'} onClick={() => 1}>x</div>;`)).toBe(1);
    // Exactly one report for role={'button'} + tabIndex="0": the role rule, not the tabIndex rule too.
    expect(
      await b6(`export const A = () => <span role={'button'} tabIndex="0" onClick={() => 1}>x</span>;`),
    ).toBe(1);
    expect(
      await b6(
        `declare const pressKeys: () => void;
         export const A = () => <span role={'button'} tabIndex="0" onKeyDown={pressKeys} onClick={() => 1}>x</span>;`,
      ),
    ).toBe(0);
  });

  it('accepts a real button, onKeyDown={pressKeys}, and native controls', async () => {
    expect(await b6(`export const A = () => <button type="button" onClick={() => 1}>x</button>;`)).toBe(0);
    expect(
      await b6(
        `declare const pressKeys: () => void;
         export const A = () => <span role="button" tabIndex={0} onKeyDown={pressKeys} onClick={() => 1}>x</span>;`,
      ),
    ).toBe(0);
    expect(await b6(`export const A = () => <a href="/x" tabIndex={0} onClick={() => 1}>x</a>;`)).toBe(0);
    expect(await b6(`export const A = () => <div tabIndex={0}>scroll region</div>;`)).toBe(0);
  });

  it('finds nothing in apps/web/src today', async () => {
    const results = await eslint.lintFiles([`${ROOT}apps/web/src/**/*.tsx`]);
    const hits = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === 'no-restricted-syntax' && m.message.startsWith('B-M6'))
        .map((m) => `${r.filePath}:${m.line}`),
    );
    expect(hits).toEqual([]);
  }, 60_000);
});
