/* =====================================================================
 * Building and running for a JavaScript script (spec 10.3): what Verify (F7) and Build & Run (F5, Shift+F5) do, as
 * `build` in a script's code (script-js.ts). A script reads the last build, asks for a new one, and has the program,
 * or a file of its own, started in the emulator:
 *
 *   build.assembler                the assembler the project builds with: "kickass" or "64tass"
 *   build.emulator                 the emulator Build & Run starts: "VICE"
 *   build.debugger                 the debugger Build & Run in a debugger starts: its name
 *   build.last                     the last build, or null when the project has not been built since it was opened:
 *       last.ok                    every file came out byte for byte
 *       last.fresh                 it is of the project as it is now (false: something changed since)
 *       last.by                    what built it: "built-in" (Verify), or the assembler's name (Build & Run)
 *       last.files                 [{ name, source, ok, same, total, start, end, bytes, prg, errors }]: each built
 *                                  file, its PRG (null when it did not assemble) and what the assembler said
 *       last.log                   the build log, a text
 *   build.verify()                 Verify, when the run has ended well: the round-trip check, as F7
 *   build.run({ debugger })        Build & Run, as F5: built, verified and started in VICE (debugger: true as
 *                                  Shift+F5, in the debugger)
 *   build.start(prg, { name, start, debugger })
 *                                  a PRG of the script's own (a file packed with brokkr.pack, a file of the loader)
 *                                  started in the emulator: loaded and RUN, or started with SYS at `start`
 *   build.requests                 what the script has asked for so far, a text each
 *
 * Nothing is built or started during the run: the run ends with the requests (ScriptRun.builds) and the app does
 * them in the order asked, unless the script is in safe mode, where Last run says what it would do.
 * ===================================================================== */

/** what the app hands a script's run of the build as it is now */
export interface ScriptBuildData {
  assembler: string;
  emulator: string;
  debugger: string;
  last: {
    ok: boolean; fresh: boolean; by: string; log: string;
    files: { name: string; source: string; ok: boolean; same: number; total: number; prg: Uint8Array | null; errors: string[] }[];
  } | null;
}

/** what a script asked for: done by the app, in this order, when the run has ended well */
export type ScriptBuildRequest =
  | { kind: 'verify' }
  | { kind: 'run'; debugger: boolean }
  | { kind: 'start'; name: string; prg: Uint8Array; start: number | null; debugger: boolean };

/** the most a script asks for in one run */
export const BUILD_REQUESTS = 8;

/** What a request does, in words: for Last run and the messages. */
export function buildRequestText(r: ScriptBuildRequest, d: Pick<ScriptBuildData, 'emulator' | 'debugger'> = { emulator: 'VICE', debugger: 'the debugger' }): string {
  if (r.kind === 'verify') return 'Verify: the round-trip check (as F7)';
  if (r.kind === 'run') return r.debugger ? `Build & Run in ${d.debugger} (as Shift+F5)` : `Build & Run in ${d.emulator} (as F5)`;
  const at = r.prg[0] | (r.prg[1] << 8);
  return `${r.name} (${r.prg.length - 2} bytes, loads at $${at.toString(16).padStart(4, '0')}) started in ${r.debugger ? d.debugger : d.emulator}${r.start != null ? ` with SYS ${r.start}` : ' with RUN'}`;
}

/** `build` for a script's run; `asked` is called with each request. */
export function buildApi(data: ScriptBuildData | null, addr: (where: unknown) => number, asked: (r: ScriptBuildRequest) => void): Record<string, unknown> {
  const need = (): ScriptBuildData => { if (!data) throw new Error('build: there is nothing to build here (the project has no file, or the script runs where building is not given: Run on files, Run with values, before Build & Run)'); return data; };
  const made: ScriptBuildRequest[] = [];
  const ask = (r: ScriptBuildRequest, what: string) => {
    if (made.length >= BUILD_REQUESTS) throw new RangeError(`${what}: a run asks for ${BUILD_REQUESTS} builds and starts at most`);
    made.push(r); asked(r);
  };
  const api: Record<string, unknown> = {
    verify() { need(); ask({ kind: 'verify' }, 'build.verify'); },
    run(o: { debugger?: boolean } = {}) { need(); ask({ kind: 'run', debugger: !!o?.debugger }, 'build.run'); },
    start(prg: unknown, o: { name?: unknown; start?: unknown; debugger?: boolean } = {}) {
      need();
      if (!(prg instanceof Uint8Array) && !Array.isArray(prg)) throw new TypeError('build.start: a PRG is wanted, its load address first (the prg of brokkr.pack, sindri.prg(start, end), a file\'s prg)');
      const bytes = Uint8Array.from(prg as ArrayLike<number>);
      if (bytes.length < 3) throw new RangeError('build.start: a PRG is its load address and at least a byte');
      if (bytes.length > 0x10002) throw new RangeError('build.start: a PRG holds 64 KB at most');
      const name = (String(o?.name ?? 'script.prg').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[.\-\s]+/, '').slice(0, 60) || 'script').replace(/(\.prg)?$/i, '.prg');
      ask({ kind: 'start', name, prg: bytes, start: o?.start == null ? null : addr(o.start), debugger: !!o?.debugger }, 'build.start');
    },
  };
  const get = (name: string, f: () => unknown) => Object.defineProperty(api, name, { enumerable: true, get: f });
  get('assembler', () => need().assembler); get('emulator', () => need().emulator); get('debugger', () => need().debugger);
  get('requests', () => { const d = need(); return made.map(r => buildRequestText(r, d)); });
  get('last', () => {
    const l = need().last;
    if (!l) return null;
    return { ok: l.ok, fresh: l.fresh, by: l.by, log: l.log, files: l.files.map(f => {
      const start = f.prg && f.prg.length >= 2 ? f.prg[0] | (f.prg[1] << 8) : null;
      return { name: f.name, source: f.source, ok: f.ok, same: f.same, total: f.total, start, end: start != null ? start + f.prg!.length - 2 : null, bytes: f.prg ? f.prg.slice(2) : null, prg: f.prg ? f.prg.slice() : null, errors: [...f.errors] };
    }) };
  });
  return api;
}
