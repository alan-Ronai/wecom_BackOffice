export interface CallResult {
  kind: 'out' | 'branch';
  idx: number;
  label: string;
  goto?: string;
  ts: number;
}
export interface CallState {
  started: number | null;
  active: string | null;
  results: Record<string, CallResult>;
}

const empty = (): CallState => ({ started: null, active: null, results: {} });
const key = (docId: string) => 'kb.call.' + docId;

/** Call-mode progress is per call, so it stays in sessionStorage rather than on the API. */
export const callState = {
  get(docId: string): CallState {
    try {
      const raw = sessionStorage.getItem(key(docId));
      return { ...empty(), ...((raw ? JSON.parse(raw) : null) ?? {}) } as CallState;
    } catch {
      return empty();
    }
  },
  set(docId: string, s: CallState): void {
    try {
      sessionStorage.setItem(key(docId), JSON.stringify(s));
    } catch {
      /* private mode — progress just is not restored */
    }
  },
  reset(docId: string): void {
    try {
      sessionStorage.removeItem(key(docId));
    } catch {
      /* ignore */
    }
  },
};
