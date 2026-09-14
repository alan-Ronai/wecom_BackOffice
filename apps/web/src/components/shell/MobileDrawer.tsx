import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

interface Drawer {
  open: boolean;
  setOpen: (v: boolean) => void;
}
const Ctx = createContext<Drawer>({ open: false, setOpen: () => {} });

export function DrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return (
    <Ctx.Provider value={value}>
      {children}
      {open ? <div className="scrim" onClick={() => setOpen(false)} /> : null}
    </Ctx.Provider>
  );
}

export const useDrawer = (): Drawer => useContext(Ctx);

/** The ☰ button every topbar renders (legacy KB.hamburger). */
export function Hamburger() {
  const { setOpen } = useDrawer();
  return (
    <button
      className="btn ghost hamburger"
      title="תפריט"
      aria-label="פתח תפריט ניווט"
      onClick={() => setOpen(true)}
    >
      ☰
    </button>
  );
}
