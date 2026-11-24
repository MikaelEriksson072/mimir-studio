/* =====================================================================
 * User scripts in JavaScript (spec 10.3, UserScript.code 'js'): the same job as a script in assembler (work on the
 * program's bytes, with what it changes written into the program as its patches), written in a language that has loops,
 * arrays and strings, and that borrows the program's own 6510 routines when it needs them.
 *
 * The script is the body of a function, run once. It has one memory, `mem`: 64 KB with the program's files at their
 * load addresses, as LOAD leaves them, and the script's scratchpads at their addresses (a scratchpad is a stretch of
 * `mem`, so the program's code sees it). What the script gets, and nothing else:
 *
 *   mem                      Uint8Array(65536): read and write it; what changes in the program's bytes is the result
 *   addr("name")             the address of a name: a label or variable of the program, a hardware name, a scratchpad
 *                            (pad1, pad1_end, pad1_load); a number is given back as it is
 *   pad("pad1")              a scratchpad's bytes: a Uint8Array that is a view of mem
 *   word(a), setWord(a, v)   a 16-bit value, low byte first
 *   cpu.call(where, regs)    run the program's 6510 code at an address or a name until it returns (RTS, or a BRK), with
 *                            { a, x, y, c } as its registers and carry; gives { a, x, y, p, c, z, n, brk } as it left
 *                            them. It throws when the code jams or does not return (cpu.limit instructions, 50 million)
 *   print(...)               a line of output (Last run)
 *   hex(v, digits)           "$1a2b"
 *   mark(start, end, "type"), name(a, "name"), note(a, "text"), junk(start, end)
 *                            what script-actions.ts's directives do, done when the run ends
 *   files                    the program's files in memory: [{ start, end }], end the address after the last byte
 *   loader, loaders          the loader of the mounted disk or tape, as its loader tab shows it (script-loader.ts): or null;
 *                            loader.files, loader.groups, loader.script, loader.find(name), loader.load(name)
 *   build                    building and running (script-build.ts): build.last, build.verify(), build.run({ debugger }),
 *                            build.start(prg) for a file of the script's own in the emulator
 *   exporter                 the export (script-export.ts): exporter.files, exporter.read(name), exporter.add(name, content),
 *                            exporter.edit(name, text => …), exporter.remove(name), exporter.write() to have it written
 *   brokkr                   Brokkr, Mimir's cruncher (script-brokkr.ts): brokkr.pack(prg) for a file that unpacks itself,
 *                            brokkr.crunch(bytes) and brokkr.decrunch(stream), brokkr.mem(bytes, start), brokkr.decruncher()
 *   sindri                   Sindri, Mimir's C64 and unpacker (script-sindri.ts): sindri.unpack(prg), sindri.c64() for a
 *                            whole C64 to run code in, sindri.disassemble(at), sindri.basic(at), sindri.prg(start, end)
 *   sid                      SID music (script-sid.ts): sid.tunes (the program's music), a tune's sid() file and run(),
 *                            sid.parse(file), sid.make(bytes, { load, init, play }), sid.run({ init, play }), sid.play(tune)
 *   library                  the library of SIDs, sprites, charsets and bitmaps (script-library.ts): library.items,
 *                            library.find(name), an item's bytes and put(at), library.add(kind, bytes, { name })
 *   save(name, bytes, load)  a file the run made, listed under Last run (To the project…, Save…); load: where it
 *                            loads, left out for a file without a load address
 *   disk                     the mounted disk, or null: { name, id, tracks, files: [{ name, type, blocks, track,
 *                            sector }], sector(track, sector) → its 256 bytes, read(file or name) → the file's bytes }
 *   screen                   the script's C64 screen (script-screen.ts): screen.print(...), write, chrout, at, clear,
 *                            color, border, background, poke, show, charset; 40×25, larger in extended mode. What the
 *                            program's own code prints through CHROUT and the other printing routines of the KERNAL
 *                            and BASIC (where the program has no bytes) goes there too. It is in mem, as on the C64:
 *                            the top left 40×25 at $0400 (mem[0x0400 + 40 * row + col]), their colours at $d800, the
 *                            border at $d020 and the background at $d021 (where no file and no scratchpad is), so that
 *                            what the script or the program's code writes there is on it
 *
 * It runs in the scripts' worker, which has no network and no file system to give; the names that would reach out of
 * it (fetch, importScripts, self, …) are not there for the script. An error it throws ends the run and is said with
 * its line. Nothing is checked before it runs but its scratchpads: a syntax error is said by the run.
 * ===================================================================== */
import { Cpu, type Bus, type Roms } from '@mimir/sindri';
import { SINDRI_BUDGET, sindriApi, sindriMachine } from './script-sindri';
import { brokkrApi } from './script-brokkr';
import { loaderApi, type ScriptLoaderData } from './script-loader';
import { exportApi, type ScriptExportData, type ScriptExportRequest } from './script-export';
import { buildApi, type ScriptBuildData, type ScriptBuildRequest } from './script-build';
import { libraryApi, type ScriptLibraryData, type ScriptLibraryRequest } from './script-library';
import { sidApi, type ScriptSidData, type ScriptSidRequest } from './script-sid';
import { SCREEN_C64, screenApi, screenMemory, screenRanges, screenRoutine, screenTraps, TextScreen, type ScreenSize } from './script-screen';
import type { Addr, UserScript } from './types';
import { diskSectors, parseD64, readD64File, sectorOffset, type D64File } from './c64/d64';
import { MARK_NAMES, type ScriptAction } from './script-actions';
import { maskRanges, padStart, runChanges, SCRIPT_P, scriptNames, type ScriptCheck, type ScriptEnv, type ScriptProblem, type ScriptRun } from './script';
import { h2, h4 } from './util/hex';

/** what a JavaScript script may be given besides the program: the mounted disk's image (a D64 or a G64) */
export interface JsExtras { disk?: Uint8Array | null;
  /** the C64's ROMs, for sindri.unpack (the stand-ins run without them) and sindri.c64 (which needs them) */
  roms?: Roms | null;
  /** the loaders of the mounted disk and tape, with their files (the app reads them: script-loader.ts) */
  loaders?: readonly ScriptLoaderData[] | null;
  /** the export as it is now, for `exporter` (null: it is not given to this run) */
  export?: ScriptExportData | null;
  /** the build as it is now, for `build` (null: it is not given to this run) */
  build?: ScriptBuildData | null;
  /** the program's music and where it plays, for `sid` (null: the run has no tunes, and plays none) */
  sid?: ScriptSidData | null;
  /** the library as it is now, for `library` (null: it is not given to this run) */
  library?: ScriptLibraryData | null;
  /** the size of the script's C64 screen (40×25 when not said) */
  screen?: Partial<ScreenSize> | null }

/** the instructions one cpu.call may take, and all of a run's together */
export const JS_CALL_LIMIT = 50_000_000;
export const JS_RUN_LIMIT = 400_000_000;

/** names of the worker (and of a window) a script is not to reach: they are undefined in its code */
const HIDDEN = ['self', 'globalThis', 'window', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'importScripts', 'postMessage', 'indexedDB', 'caches', 'navigator',
  'Worker', 'SharedWorker', 'BroadcastChannel', 'setTimeout', 'setInterval', 'queueMicrotask', 'require', 'process', 'Function'];

const NOTHING = new Uint8Array(0x10000), NO_LINES = new Int32Array(0x10000);

/** A JavaScript script checked: its scratchpads looked at (`padProblems`: script.ts's check of them). Its code is not
 *  read before it runs, so it has no code addresses, labels or uses. */
export function checkJs(problems: ScriptProblem[]): ScriptCheck {
  return {
    ok: !problems.some(p => p.level === 'error'), problems, entry: null, code: [], bytes: 0, place: 'own', prints: [],
    mem: NOTHING, written: NOTHING, lines: NO_LINES, starts: NOTHING, ops: NOTHING, labels: new Map(), uses: [], access: [], actions: [],
  };
}

/** the line of the script an error came from, from its stack (the function's body starts on its third line) */
function errorLine(e: unknown): number | undefined {
  const m = /<anonymous>:(\d+):\d+/.exec(String((e as { stack?: unknown })?.stack ?? ''));
  const n = m ? +m[1] - 2 : 0;
  return n >= 1 ? n : undefined;
}

/**
 * Run a JavaScript script to its end: the function its code is the body of, with the things above as its arguments. A
 * run that throws ends with 'error' and what was thrown; what it changed until then is still its result.
 */
export function runJs(env: ScriptEnv, script: Pick<UserScript, 'source' | 'pads' | 'init'>, extras: JsExtras = {}): ScriptRun {
  const t0 = Date.now();
  const mem = new Uint8Array(0x10000), own = new Uint8Array(0x10000);
  for (const f of env.files) mem.set(f.bytes.subarray(0, Math.max(0, 0x10000 - f.load)), f.load);
  const pads = script.pads.filter(p => p.start >= 0 && p.size >= 1 && p.start + p.size <= 0x10000);
  for (const p of pads) { mem.set(padStart(p), p.start); own.fill(1, p.start, p.start + p.size); }
  for (const z of script.init?.zp ?? []) { mem[z.at & 0xff] = z.value & 0xff; if (z.word) mem[(z.at + 1) & 0xff] = (z.value >> 8) & 0xff; }
  // the C64 screen, in mem at $0400, $d800 and $d020/$d021 (where no file and no scratchpad is), and where the
  // program's code calling CHROUT (and the others) prints on it
  const scr = new TextScreen(extras.screen ?? SCREEN_C64, screenMemory(mem, env.files, pads)), traps = screenTraps(env.files, own);
  const before = mem.slice();
  const names = scriptNames(env, script.pads);
  const prints: string[] = [], actions: ScriptAction[] = [];
  const made: NonNullable<ScriptRun['made']> = [];
  let exports: ScriptExportRequest | undefined;
  const builds: ScriptBuildRequest[] = [];
  const sidPlays: ScriptSidRequest[] = [];
  const libraryAdds: ScriptLibraryRequest[] = [];
  let instructions = 0, cycles = 0;
  let regs = { a: 0, x: 0, y: 0, s: 0xff, p: SCRIPT_P, pc: 0 };

  const addr = (n: unknown): Addr => {
    if (typeof n === 'number') { if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new RangeError(`${n} is not an address ($0000-$ffff)`); return n; }
    const v = names.get(String(n));
    if (v == null) throw new ReferenceError(`"${String(n)}" is not a name of the program or a scratchpad`);
    return v;
  };
  const pad = (name: unknown): Uint8Array => {
    const p = pads.find(x => x.name === name);
    if (!p) throw new ReferenceError(`"${String(name)}" is not a scratchpad of the script (it has ${pads.length ? pads.map(x => x.name).join(', ') : 'none'})`);
    return mem.subarray(p.start, p.start + p.size);
  };
  const bus: Bus = { read: a => mem[a], write: (a, v) => { mem[a] = v; }, fetch: a => mem[a] };
  const cpu = {
    limit: JS_CALL_LIMIT,
    call(where: unknown, r: { a?: number; x?: number; y?: number; c?: boolean | number; p?: number } = {}) {
      const start = addr(where), c = new Cpu(bus);
      c.a = (r.a ?? 0) & 0xff; c.x = (r.x ?? 0) & 0xff; c.y = (r.y ?? 0) & 0xff;
      c.p = r.p != null ? r.p & 0xff : SCRIPT_P | (r.c ? 1 : 0);
      // called like SYS: the return address $ffff on the stack, so its RTS lands at $0000 with the stack empty
      c.s = 0xfd; mem[0x1ff] = 0xff; mem[0x1fe] = 0xff; c.pc = start;
      const budget = Math.max(1, Math.min(Number(cpu.limit) || JS_CALL_LIMIT, JS_RUN_LIMIT - instructions)), top = instructions + budget;
      let brk = false;
      for (;;) {
        if (instructions >= top) throw new Error(`the code called at $${h4(start)} did not return after ${budget.toLocaleString('en-US')} instructions (it was at $${h4(c.pc)}): does it loop for ever?`);
        // a printing routine of the KERNAL's or BASIC's, where the program has no bytes: done on the screen
        if (traps[c.pc]) {
          screenRoutine(scr, c, a => mem[a]); instructions++;
          if (c.s === 0xff && c.pc === 0) break;
          continue;
        }
        const pc = c.pc;
        cycles += c.step(); instructions++;
        if (c.jammed) throw new Error(`the code called at $${h4(start)} jammed at $${h4(pc)} (a JAM opcode): did it run into data?`);
        if (c.lastOp === 0x00) { brk = true; break; }
        if (c.lastOp === 0x60 && c.s === 0xff && c.pc === 0) break;
      }
      regs = { a: c.a, x: c.x, y: c.y, s: c.s, p: c.p, pc: c.pc };
      return { a: c.a, x: c.x, y: c.y, p: c.p, c: (c.p & 1) !== 0, z: (c.p & 2) !== 0, n: (c.p & 0x80) !== 0, brk };
    },
  };
  const show = (v: unknown): string => (v instanceof Uint8Array ? Array.from(v.subarray(0, 64), b => h2(b)).join(' ') + (v.length > 64 ? ' …' : '') : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v));
  const print = (...a: unknown[]) => { if (prints.length < 2000) prints.push(a.map(show).join(' ')); };
  const hex = (v: unknown, digits = 4) => `$${(Number(v) >>> 0).toString(16).padStart(Number(digits) || 4, '0')}`;
  const word = (a: unknown) => { const x = addr(a); return mem[x] | (mem[(x + 1) & 0xffff] << 8); };
  const setWord = (a: unknown, v: unknown) => { const x = addr(a), n = Number(v) & 0xffff; mem[x] = n & 0xff; mem[(x + 1) & 0xffff] = n >> 8; };
  const span = (s: unknown, e: unknown): [Addr, Addr] => {
    const start = addr(s), end = typeof e === 'number' && e === 0x10000 ? 0x10000 : addr(e);
    if (end <= start) throw new RangeError(`the end (${hex(end)}) is not after the start (${hex(start)}): the end is the address after the last byte`);
    return [start, end];
  };
  const api = {
    mark(s: unknown, e: unknown, type: unknown) {
      const [start, end] = span(s, e), as = String(type).toLowerCase();
      if (!MARK_NAMES.includes(as)) throw new TypeError(`mark: "${as}" is no type: ${MARK_NAMES.join(', ')}`);
      actions.push({ kind: 'mark', line: 0, start, end, as: as === 'data' ? 'bytes' : as });
    },
    name(a: unknown, n: unknown) {
      if (typeof n !== 'string' || !/^[A-Za-z][A-Za-z0-9_]*$/.test(n)) throw new TypeError(`name: "${String(n)}" is no label: letters, digits and _, starting with a letter`);
      actions.push({ kind: 'name', line: 0, at: addr(a), name: n });
    },
    note(a: unknown, t: unknown) {
      const text = String(t ?? '').trim();
      if (!text) throw new TypeError('note: the text is empty');
      actions.push({ kind: 'note', line: 0, at: addr(a), text: text.slice(0, 200) });
    },
    junk(s: unknown, e: unknown) { const [start, end] = span(s, e); actions.push({ kind: 'junk', line: 0, start, end }); },
  };
  const disk = (() => {
    if (!extras.disk) return null;
    const image = diskSectors(extras.disk), img = parseD64(extras.disk);
    const fileOf = (f: unknown): D64File => {
      const x = typeof f === 'string' ? img.files.find(y => y.name === f) : img.files.find(y => y === f || (!!f && y.track === (f as D64File).track && y.sector === (f as D64File).sector));
      if (!x) throw new ReferenceError(`disk.read: ${typeof f === 'string' ? `no file "${f}" on the disk` : 'not a file of the disk'}`);
      return x;
    };
    return {
      name: img.name, id: img.id, tracks: img.tracks,
      files: img.files.map(f => ({ name: f.name, type: f.type, blocks: f.blocks, track: f.track, sector: f.sector })),
      sector(t: unknown, s: unknown): Uint8Array {
        const o = sectorOffset(Number(t), Number(s), img.tracks);
        if (!(o >= 0) || o + 256 > image.length) throw new RangeError(`disk.sector: there is no track ${String(t)} sector ${String(s)} on the disk`);
        return image.slice(o, o + 256);
      },
      read: (f: unknown): Uint8Array => readD64File(extras.disk!, fileOf(f)),
    };
  })();

  let error: ScriptRun['error'];
  try {
    const files = env.files.map(f => ({ start: f.load, end: Math.min(0x10000, f.load + f.bytes.length) })).filter(f => f.end > f.start);
    const sindri = sindriApi({ mem, addr, files, roms: extras.roms ?? null, disk: extras.disk ?? null, budget: { left: SINDRI_BUDGET } });
    const brokkr = brokkrApi({ mem, addr, files });
    const { loader, loaders } = loaderApi(extras.loaders ?? [], { mem, addr });
    const exporter = exportApi(extras.export ?? null, r => { exports = r; });
    const build = buildApi(extras.build ?? null, addr, r => { builds.push(r); });
    const sid = sidApi(extras.sid ?? null, { mem, addr, files }, r => { sidPlays.push(r); });
    const library = libraryApi(extras.library ?? null, { mem, addr }, r => { libraryAdds.push(r); });
    const save = (name: unknown, bytes: unknown, load?: unknown) => {
      if (!(bytes instanceof Uint8Array) && !Array.isArray(bytes)) throw new TypeError('save: bytes are wanted (a Uint8Array, such as mem.subarray(…) or what sindri.unpack gave)');
      const n = String(name ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/^[.\-\s]+/, '').slice(0, 100) || 'file';
      if (made.length >= 64) throw new RangeError('save: a run makes 64 files at most');
      made.push({ name: n, load: load == null ? null : addr(load), bytes: Uint8Array.from(bytes as ArrayLike<number>).slice(0, 0x10000) });
    };
    const screen = screenApi(scr, { mem, addr, show, machine: sindriMachine });
    const given = { mem, addr, pad, cpu, print, hex, word, setWord, ...api, files, disk, sindri, brokkr, loader, loaders, exporter, build, sid, library, save, screen };
    // the code in a block of its own: a name it declares (const screen = …) is its own, in place of the one it is given,
    // as it was before the name was given (the block's brace is on the first line: the lines keep their numbers)
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    const fn = new Function(...Object.keys(given), ...HIDDEN, `"use strict";{${script.source}\n}`) as (...a: unknown[]) => unknown;
    fn(...Object.values(given));
  } catch (e) {
    const line = errorLine(e);
    error = { msg: e instanceof Error ? `${e.name}: ${e.message}` : String(e), ...(line ? { line } : {}) };
  }
  // what changed, taken as what the run wrote: of the program's memory (not the scratchpads), and of each scratchpad;
  // not the screen's memory (what is there is on the screen)
  scr.sync();
  const changed = new Uint8Array(0x10000), skip = own.slice();
  for (let a = 0x200; a < 0x10000; a++) if (mem[a] !== before[a]) changed[a] = 1;
  for (const r of screenRanges(scr.memory)) { changed.fill(0, r.start, r.end); skip.fill(1, r.start, r.end); }
  const padRuns = script.pads.map(p => {
    const w = changed.subarray(p.start, p.start + p.size), first = w.indexOf(1);
    return { name: p.name, bytes: mem.slice(p.start, p.start + p.size), ...(first >= 0 ? { wrote: [first, w.lastIndexOf(1) + 1] as [number, number] } : {}) };
  });
  const { changes, other } = runChanges(mem, before, env.files, skip);
  for (let a = 0; a < 0x10000; a++) if (own[a]) changed[a] = 0;
  return {
    js: true, end: error ? 'error' : 'rts', at: regs.pc, instructions, cycles, regs, pads: padRuns, changes, other, mem, own: mem, wrote: maskRanges(changed, 0x200), ms: Date.now() - t0,
    ...(error ? { error } : {}), ...(prints.length ? { prints } : {}), ...(actions.length ? { actions } : {}), ...(made.length ? { made } : {}), ...(exports && !error ? { exports } : {}), ...(builds.length && !error ? { builds } : {}), ...(sidPlays.length && !error ? { plays: sidPlays } : {}), ...(libraryAdds.length && !error ? { library: libraryAdds } : {}),
    ...(scr.wrote ? { screen: scr.state() } : {}),
  };
}
