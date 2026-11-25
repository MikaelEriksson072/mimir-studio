/* An Assembler project (spec 10.7) in the project window: what the Assembler tab and the rest of the window tell each
 * other. The tab checks the sources as they are typed and puts the program they make here (the project's views,
 * Graphics, Memory, the inspector and the Explorer, show it); the window asks it to show an address's line in the
 * sources, to run or build, and to write what is not written yet before the window closes or the project does. */
import { create } from 'zustand';
import type { Addr, AsmCheck, AsmProgram } from '@mimir/core';

export interface AsmAsk { what: 'run' | 'build' | 'debug'; n: number }

interface AsmLinkState {
  /** the program the sources make, as the project's views take it: the last check that assembled (null: none yet) */
  program: AsmProgram | null;
  /** that check (an address's file and line), and whether the sources as they are now assemble */
  check: AsmCheck | null;
  assembles: boolean;
  /** an address whose line the Assembler tab is to show (`n` tells one request from the next) */
  show: { addr: Addr; n: number } | null;
  /** Run, Build or Debug asked for outside the tab (the title bar, F5 on another tab) */
  ask: AsmAsk | null;
  /** a build is running */
  building: boolean;
  /** what is not written yet, written (the tab sets it) */
  flush: () => Promise<unknown>;
  set: (p: Partial<Omit<AsmLinkState, 'set' | 'reset' | 'request' | 'showAddr'>>) => void;
  request: (what: AsmAsk['what']) => void;
  showAddr: (addr: Addr) => void;
  /** the project closed: nothing is kept */
  reset: () => void;
}

const none = () => Promise.resolve();
export const useAsmLink = create<AsmLinkState>(set => ({
  program: null, check: null, assembles: false, show: null, ask: null, building: false, flush: none,
  set: p => set(p),
  request: what => set(s => ({ ask: { what, n: (s.ask?.n ?? 0) + 1 } })),
  showAddr: addr => set(s => ({ show: { addr, n: (s.show?.n ?? 0) + 1 } })),
  reset: () => set({ program: null, check: null, assembles: false, show: null, ask: null, building: false, flush: none }),
}));
