import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type PaletteMode = 'search' | 'newtab' | 'split';
export interface PaletteOptions {
  mode?: PaletteMode;
  type?: string;
  query?: string;
}
interface PaletteApi {
  state: (PaletteOptions & { open: true }) | { open: false };
  open: (o?: PaletteOptions) => void;
  close: () => void;
}

const Ctx = createContext<PaletteApi | null>(null);

export function PaletteProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<PaletteApi['state']>({ open: false });
  const open = useCallback((o: PaletteOptions = {}) => setState({ ...o, open: true }), []);
  const close = useCallback(() => setState({ open: false }), []);
  const value = useMemo(() => ({ state, open, close }), [state, open, close]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const NOOP: PaletteApi = { state: { open: false }, open: () => {}, close: () => {} };
export const usePalette = (): PaletteApi => useContext(Ctx) ?? NOOP;
