import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Document } from '@wecom/shared';
import { callState, type CallResult, type CallState } from '../../lib/callState.js';
import type { ResolvedStep } from '../../lib/steps.js';

export interface Call {
  state: CallState;
  activeKey: string | null;
  setActive: (key: string, scroll?: boolean) => void;
  move: (dir: number) => void;
  pickOutcome: (key: string, res: Omit<CallResult, 'ts'>) => void;
  skipped: Set<string>;
  summaryText: () => string;
  reset: () => void;
  elapsed: string;
  done: number;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Port of the legacy call-mode state machine (goto resolution, auto-advance, summary). */
export function useCall(doc: Document | undefined, steps: ResolvedStep[], enabled: boolean): Call {
  const go = useNavigate();
  const docId = doc?.id ?? '';
  const [state, setState] = useState<CallState>(() =>
    docId ? callState.get(docId) : { started: null, active: null, results: {} },
  );
  const [tick, setTick] = useState(0);
  const loaded = useRef('');

  useEffect(() => {
    if (!docId || loaded.current === docId) return;
    loaded.current = docId;
    setState(callState.get(docId));
  }, [docId]);

  useEffect(() => {
    if (docId) callState.set(docId, state);
  }, [docId, state]);

  useEffect(() => {
    if (!enabled) return;
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [enabled]);

  const activeKey = useMemo(() => {
    if (state.active && steps.some((s) => s.key === state.active)) return state.active;
    return steps[0]?.key ?? null;
  }, [state.active, steps]);

  const setActive = useCallback(
    (key: string, scroll = true) => {
      if (!steps.some((s) => s.key === key)) return;
      setState((s) => ({ ...s, active: key, started: s.started ?? (enabled ? Date.now() : null) }));
      if (docId) go(`/doc/${docId}/${key}`, { replace: true });
      if (scroll)
        setTimeout(() => document.getElementById(`step-${key}`)?.scrollIntoView({ block: 'center' }), 30);
    },
    [docId, enabled, go, steps],
  );

  const move = useCallback(
    (dir: number) => {
      const i = steps.findIndex((s) => s.key === activeKey);
      const j = Math.min(steps.length - 1, Math.max(0, i + dir));
      if (j !== i && steps[j]) setActive(steps[j].key);
    },
    [activeKey, setActive, steps],
  );

  const pickOutcome = useCallback(
    (key: string, res: Omit<CallResult, 'ts'>) => {
      setState((s) => ({
        ...s,
        started: s.started ?? Date.now(),
        results: { ...s.results, [key]: { ...res, ts: Date.now() } },
      }));
      const i = steps.findIndex((s) => s.key === key);
      const next = res.goto && steps.some((s) => s.key === res.goto) ? res.goto : steps[i + 1]?.key;
      if (next) setActive(next);
    },
    [setActive, steps],
  );

  const skipped = useMemo(() => {
    const ai = steps.findIndex((s) => s.key === activeKey);
    const set = new Set<string>();
    steps.slice(0, Math.max(0, ai)).forEach((s) => {
      if (!state.results[s.key]) set.add(s.key);
    });
    return set;
  }, [activeKey, state.results, steps]);

  const summaryText = useCallback(() => {
    const parts = [doc?.title ?? ''];
    steps.forEach((s) => {
      const r = state.results[s.key];
      if (r)
        parts.push(`ש${s.num} ` + (r.kind === 'out' && /^[✓⚑→]/.test(r.label) ? r.label : `✓ ${r.label}`));
      else if (s.key === activeKey) parts.push(`ש${s.num} ▶`);
    });
    return parts.filter(Boolean).join(' · ');
  }, [activeKey, doc?.title, state.results, steps]);

  const reset = useCallback(() => {
    if (docId) callState.reset(docId);
    setState({ started: enabled ? Date.now() : null, active: steps[0]?.key ?? null, results: {} });
  }, [docId, enabled, steps]);

  const elapsed = useMemo(() => {
    void tick;
    if (!state.started) return '00:00';
    const s = Math.floor((Date.now() - state.started) / 1000);
    return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
  }, [state.started, tick]);

  const done = Object.keys(state.results).filter((k) => steps.some((s) => s.key === k)).length;

  return { state, activeKey, setActive, move, pickOutcome, skipped, summaryText, reset, elapsed, done };
}
