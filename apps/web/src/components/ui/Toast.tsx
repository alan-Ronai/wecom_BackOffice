import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastKind = '' | 'ok' | 'warn';
interface Item {
  id: number;
  msg: string;
  kind: ToastKind;
  undo?: () => void;
}
interface ToastApi {
  toast: (msg: string, kind?: ToastKind, undo?: () => void) => void;
}

const Ctx = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const seq = useRef(0);

  const toast = useCallback((msg: string, kind: ToastKind = '', undo?: () => void) => {
    const id = ++seq.current;
    setItems((list) => [...list, { id, msg, kind, undo }]);
    setTimeout(() => setItems((list) => list.filter((t) => t.id !== id)), undo ? 6000 : 3200);
  }, []);

  const value = useMemo(() => ({ toast }), [toast]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.msg}</span>
            {t.undo ? (
              <span
                className="u"
                role="button"
                tabIndex={0}
                onClick={() => {
                  t.undo?.();
                  setItems((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                בטל
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

/** Safe outside a provider (e.g. the login route) — the toast is then a no-op. */
export const useToast = (): ToastApi['toast'] => useContext(Ctx)?.toast ?? (() => {});
