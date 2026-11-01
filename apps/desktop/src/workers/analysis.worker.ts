/* Analysis worker (spec 4.3): runs @mimir/core off the UI thread. analyze() only re-runs when
 * the files, overrides, entries, program start, bank zones, relocated blocks or settings changed (the caller bumps `aKey`); labels and comments
 * only re-render, which keeps renames instant. A cartridge's banks are spaces of their own (spec 13.9b): the cache keeps
 * each one's analysis, so an edit in one bank analyses that bank only, and the analyses of the single spaces stay here. */
import * as Comlink from 'comlink';
import { analyze, render, verify, type AnalysisResult, type Project, type RenderOptions, type RenderResult, type SpaceCache, type VerifyResult } from '@mimir/core';

let current: { aKey: number; A: AnalysisResult } | null = null;
const spaces: SpaceCache = new Map();

export interface RunResult {
  aKey: number;
  /** only present when the analysis was recomputed (saves a structured clone of 64 KB tables) */
  A: AnalysisResult | null;
  R: RenderResult;
  renderMs: number;
}

/** what the window gets: without the results of the single spaces, which only render and verify here use */
const toWindow = <T extends { parts?: unknown }>(x: T): T => (x.parts ? { ...x, parts: undefined } : x);

const analysed = (project: Project, aKey: number) => {
  if (current && current.aKey === aKey) return { A: current.A, fresh: false };
  if (!project.cart) spaces.clear();
  current = { aKey, A: analyze(project, spaces) };
  return { A: current.A, fresh: true };
};

const api = {
  /** `opts` only changes the listing (data as code); files and verification never see it */
  run(project: Project, aKey: number, opts: RenderOptions = {}): RunResult {
    const { A, fresh } = analysed(project, aKey);
    const t0 = performance.now();
    const R = render(A, project, opts);
    return { aKey, A: fresh ? toWindow(A) : null, R: toWindow(R), renderMs: performance.now() - t0 };
  },

  /** Round trip with the built-in Kick-subset assembler (render is cheap, so it is redone here). */
  verify(project: Project, aKey: number): VerifyResult & { ms: number } {
    const t0 = performance.now();
    const { A } = analysed(project, aKey);
    return { ...verify(A, render(A, project)), ms: performance.now() - t0 };
  },
};

export type AnalysisApi = typeof api;

Comlink.expose(api);
