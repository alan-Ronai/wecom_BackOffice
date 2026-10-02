import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useServerDraft } from '../../src/lib/useServerDraft.js';

type Copy = { v: string };
const S0: Copy = { v: 's0' };
const S1: Copy = { v: 's1' };
const S2: Copy = { v: 's2' };

const mount = () =>
  renderHook(({ server }: { server: Copy }) => useServerDraft(server), { initialProps: { server: S0 } });

/** Wave Y review: the base the draft is compared against must never go stale. */
describe('useServerDraft — the base follows the server', () => {
  it('(a) a copy that lands mid-edit is adopted once the draft is edited back to the old base', () => {
    const h = mount();
    act(() => h.result.current.setDraft({ v: 'mine' }));
    h.rerender({ server: S1 }); // another manager saved while I was editing
    expect(h.result.current.draft).toEqual({ v: 'mine' });
    expect(h.result.current.dirty).toBe(true);

    act(() => h.result.current.setDraft({ ...S0 })); // I undo my edit
    expect(h.result.current.draft).toEqual(S1);
    expect(h.result.current.dirty).toBe(false);
  });

  it('(a) a draft edited to match the newer copy is clean, and the next copy is adopted', () => {
    const h = mount();
    act(() => h.result.current.setDraft({ v: 'mine' }));
    h.rerender({ server: S1 });
    act(() => h.result.current.setDraft({ ...S1 }));
    expect(h.result.current.dirty).toBe(false);
    h.rerender({ server: S2 });
    expect(h.result.current.draft).toEqual(S2);
  });

  it('(b) edit during a save, revert to the saved copy, then a later copy is adopted', async () => {
    const h = mount();
    act(() => h.result.current.setDraft({ ...S1 }));
    let finish!: (c: Copy) => void;
    let saving!: Promise<Copy>;
    act(() => {
      saving = h.result.current.commit(
        () => new Promise<Copy>((r) => (finish = r)),
        (c) => c,
      );
    });
    act(() => h.result.current.setDraft({ v: 'typed while saving' }));
    await act(async () => {
      finish(S1);
      await saving;
    });
    // The in-flight edit is kept: the save's answer is not adopted over it.
    expect(h.result.current.draft).toEqual({ v: 'typed while saving' });
    h.rerender({ server: S1 }); // the refetch after the save
    expect(h.result.current.draft).toEqual({ v: 'typed while saving' });

    act(() => h.result.current.setDraft({ ...S1 })); // revert to what was saved
    expect(h.result.current.dirty).toBe(false);
    h.rerender({ server: S2 }); // another manager saves later
    expect(h.result.current.draft).toEqual(S2);
    expect(h.result.current.dirty).toBe(false);
  });

  it('still keeps a genuinely dirty draft when a new copy arrives', () => {
    const h = mount();
    act(() => h.result.current.setDraft({ v: 'mine' }));
    h.rerender({ server: S1 });
    h.rerender({ server: S2 });
    expect(h.result.current.draft).toEqual({ v: 'mine' });
    expect(h.result.current.dirty).toBe(true);
  });
});
