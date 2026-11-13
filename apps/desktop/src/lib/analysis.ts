/* Renderer side of the analysis worker: Comlink proxy + a hook that re-analyses (debounced 30 ms)
 * whenever the project changes, and only re-renders when just labels or comments changed.
 *
 * The deep analysis (5.17) runs in two steps: the normal analysis of the same inputs shows at once, and the deep one,
 * in a worker of its own, takes its place when it is done. A deep analysis of inputs that an edit has replaced is not
 * waited for: its worker is ended and a new one started. */
import { useEffect, useMemo, useRef, useState } from 'react';
import * as Comlink from 'comlink';
import type { AnalysisResult, Project, RenderOptions, RenderResult, VerifyResult } from '@mimir/core';
import type { AnalysisApi, RunResult } from '../workers/analysis.worker';

interface Slot { worker: Worker; remote: Comlink.Remote<AnalysisApi> }
const slot = (worker: Worker): Slot => ({ worker, remote: Comlink.wrap<AnalysisApi>(worker) });
// (Vite bundles a worker from `new Worker(new URL(...), {...})` only with options it can read as they are written)
const startMain = () => slot(new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module', name: 'mimir-analysis' }));
const startDeep = () => slot(new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module', name: 'mimir-deep-analysis' }));

let main: Slot | null = null;

/** The worker of the normal analysis (and of every analysis without the deep one). */
export function analysisWorker(): Comlink.Remote<AnalysisApi> {
  if (!main) main = startMain();
  return main.remote;
}

/** The deep analysis's worker, the inputs (`aKey`) it is working on, and how to drop the calls waiting on it. */
let deep: Slot | null = null, deepKey: number | null = null;
const waiting = new Set<(e: Error) => void>();
const SUPERSEDED = 'superseded by a newer analysis';

/** The deep analysis's worker for the inputs `aKey`: one still at work on other inputs is ended for a new one. */
function deepWorker(aKey: number): Comlink.Remote<AnalysisApi> {
  if (deep && deepKey != null && deepKey !== aKey) {
    deep.worker.terminate();
    deep = null;
    for (const drop of waiting) drop(new Error(SUPERSEDED));
    waiting.clear();
  }
  if (!deep) deep = startDeep();
  return deep.remote;
}

/** A call to the deep analysis's worker for the inputs `aKey`; it fails with SUPERSEDED when the worker is ended. */
function onDeep<T>(aKey: number, call: (r: Comlink.Remote<AnalysisApi>) => Promise<T>): Promise<T> {
  const r = deepWorker(aKey);
  deepKey = aKey;
  return new Promise<T>((resolve, reject) => {
    waiting.add(reject);
    call(r).then(resolve, reject).finally(() => {
      waiting.delete(reject);
      if (!waiting.size && deepKey === aKey) deepKey = null;
    });
  });
}

let keyCounter = 0;

export interface Analysis {
  A: AnalysisResult;
  R: RenderResult;
  /** identifies the analysis inputs (files, overrides, entries, program start, bank zones, relocated blocks, junk,
   *  settings, the cartridge) */
  aKey: number;
  renderMs: number;
  /** the project this result was computed for (work that awaits compares it with the latest edit) */
  project: Project;
  /** the analysis the project's settings ask for: false while the normal one stands in for the deep one */
  final: boolean;
  /** how many times a deep analysis took the place of the normal one shown before it (the listing keeps its place) */
  swaps: number;
}

/** The project as the normal analysis takes it, without the deep analysis. */
const normalOf = (p: Project): Project => ({ ...p, settings: { ...p.settings, deepAnalysis: false } });

export function useAnalysis(project: Project, opts: RenderOptions = {}): { analysis: Analysis | null; error: string | null; busy: boolean; deepBusy: boolean } {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** the request the last result or error belongs to (a superseded one is dropped and never lands) */
  const [landed, setLanded] = useState(0);
  // Immer keeps unchanged branches referentially equal, so identity tells what changed
  const last = useRef<{ files: unknown; overrides: unknown; entries: unknown; entryPoint: unknown; entryPort: unknown; bankZones: unknown; relocs: unknown; junk: unknown; settings: unknown; cart: unknown; key: number } | null>(null);
  const aKey = useMemo(() => {
    const l = last.current;
    if (!l || l.files !== project.files || l.overrides !== project.overrides || l.entries !== project.entries || l.entryPoint !== project.entryPoint || l.entryPort !== project.entryPort || l.bankZones !== project.bankZones || l.relocs !== project.relocs || l.junk !== project.junk || l.settings !== project.settings || l.cart !== project.cart) {
      last.current = { files: project.files, overrides: project.overrides, entries: project.entries, entryPoint: project.entryPoint, entryPort: project.entryPort, bankZones: project.bankZones, relocs: project.relocs, junk: project.junk, settings: project.settings, cart: project.cart, key: ++keyCounter };
    }
    return last.current!.key;
  }, [project.files, project.overrides, project.entries, project.entryPoint, project.entryPort, project.bankZones, project.relocs, project.junk, project.settings, project.cart]);

  // what the effect below is asked to analyse: a new number in the render that commits an edit, so busy shows in that
  // same commit (set in the effect, it would render a task later, and a wait for "analysing" to go could pass before
  // the analysis even started)
  const asked = useMemo(() => ++keyCounter, [project, aKey, opts.dataAsCode]);
  const busy = landed !== asked;
  const deepOn = !!project.settings.deepAnalysis;
  // the deep analysis of these inputs has not landed yet (the normal one may stand in for it)
  const deepBusy = deepOn && !(analysis && analysis.final && analysis.aKey === aKey);

  const seq = useRef(0);
  const shown = useRef(analysis);
  shown.current = analysis;
  const hasResult = analysis != null;
  useEffect(() => {
    const mine = ++seq.current;
    const land = (res: RunResult, final: boolean) => setAnalysis(prev => {
      const A = res.A ?? (prev && prev.aKey === aKey && prev.final === final ? prev.A : null);
      if (!A) return prev;
      // the deep reading taking the place of the normal one: the listing keeps the line in view where it is
      const swaps = (prev?.swaps ?? 0) + (final && prev && prev.aKey === aKey && !prev.final ? 1 : 0);
      return { A, R: res.R, aKey, renderMs: res.renderMs, project, final, swaps };
    });
    const timer = setTimeout(async () => {
      try {
        if (!deepOn) {
          const res = await analysisWorker().run(project, aKey, opts);
          if (mine !== seq.current) return;
          land(res, true);
        } else {
          // the deep analysis of these inputs is there: only a new render of it; else the normal one shows meanwhile
          const have = shown.current, there = !!have && have.final && have.aKey === aKey;
          if (!there) {
            const res = await analysisWorker().run(normalOf(project), aKey, opts);
            if (mine !== seq.current) return;
            land(res, false);
            setError(null);
            setLanded(asked);
          }
          // (the worker may have it from a run whose result was dropped for an edit: then it is sent again)
          const res = await onDeep(aKey, r => r.run(project, aKey, opts, !there));
          if (mine !== seq.current) return;
          land(res, true);
        }
        setError(null);
      } catch (e) {
        const msg = String((e as Error)?.message ?? e);
        if (mine === seq.current && msg !== SUPERSEDED) setError(msg);
      } finally {
        if (mine === seq.current) setLanded(asked);
      }
    }, hasResult ? 30 : 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project, aKey, opts.dataAsCode]);

  return { analysis, error, busy, deepBusy };
}

/** Verify what the listing shows: with the deep analysis, in its worker (which has it). */
export const verifyInWorker = (project: Project, aKey: number): Promise<VerifyResult & { ms: number }> =>
  project.settings.deepAnalysis ? onDeep(aKey, r => r.verify(project, aKey)) : analysisWorker().verify(project, aKey);
