/* What the Scripts tab keeps while the window is open (spec 10.3): which script is shown, the last run of each
 * (its scratchpads are kept in the project, the rest of a run is not), the one running, and the output's height. */
import { create } from 'zustand';
import type { ScriptRun } from '@mimir/core';

/** what the output shows: a scratchpad (by index) or a change the run made in the program (by index) */
export type ScriptShown = { kind: 'pad'; i: number } | { kind: 'change'; i: number };
export type PadMode = 'hex' | 'code' | 'text';

export interface ScriptRunKept { run: ScriptRun; source: string; at: number }

interface ScriptsState {
  selected: string | null;
  runs: Record<string, ScriptRunKept>;
  running: string | null;
  shown: ScriptShown;
  mode: PadMode;
  /** the text column: PETSCII or screen codes */
  screen: boolean;
  outH: number;
  set: (s: Partial<Omit<ScriptsState, 'set'>>) => void;
}

export const useScripts = create<ScriptsState>(set => ({
  selected: null, runs: {}, running: null, shown: { kind: 'pad', i: 0 }, mode: 'hex', screen: false, outH: 300,
  set: s => set(s),
}));
