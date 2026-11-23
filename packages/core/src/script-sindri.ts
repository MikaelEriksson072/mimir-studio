/* =====================================================================
 * Sindri for a JavaScript script (spec 10.3): what Sindri, Mimir's C64 and unpacker, can do, as `sindri` in a script's
 * code (script-js.ts). A script that needs more than its memory and the program's own routines called on it gets:
 *
 *   sindri.roms                        where the ROMs are from ("VICE's …"), or "stand-ins" when there are none
 *   sindri.prg(start, end)             the bytes of mem from start up to (not with) end as a PRG, load address first
 *   sindri.unpack(prg, { disk, entry, port })
 *                                      Sindri's unpacker run on a PRG (the program's first file when none is given),
 *                                      with the mounted disk in its 1541 unless disk is false: { unpacked, packer,
 *                                      start, end, entry, port, basic, bytes, prg, layers, listing, stop, cycles }
 *   sindri.disassemble(at, count, bytes)
 *                                      count instructions of mem (or of bytes) from at, a line each
 *   sindri.basic(at), sindri.sys(at)   the BASIC program at an address (by default $0801) as its lines, and the
 *                                      address its SYS goes to (null: none)
 *   sindri.c64({ disk, program })      a whole C64 at the READY prompt (the ROMs are needed), the mounted disk in its
 *                                      1541 and the program's files in its RAM unless told not to:
 *       m.mem                          its RAM
 *       m.a, m.x, m.y, m.s, m.p, m.pc  its registers, read and set
 *       m.cycles                       the cycles it has run
 *       m.load(bytes, at)              bytes into its RAM; m.loadPrg(prg) for a PRG, which gives its load address
 *       m.peek(a)                      a byte as the CPU reads it (a ROM where one is mapped in)
 *       m.run({ until, cycles })       run on from its PC until it gets to an address (or one of several), or for
 *                                      so many cycles (20 million when none is said): { reason, pc, cycles }
 *       m.call(where, { a, x, y, c })  call a routine and run until it returns, with the ROMs, the I/O and the
 *                                      interrupts there: the registers as it left them
 *       m.type(text)                   keys into the keyboard buffer (at most 10; "\r" is RETURN)
 *       m.screen()                     the text screen as its 25 lines
 *
 * The machine is Sindri's own, the one Unpack runs a program in: cycle by cycle, with the VIC, the CIAs, the SID's
 * third oscillator and a true 1541.
 * ===================================================================== */
import { basicLines, disassemble as disasm, driveWith, findSys, listLine, readyC64, unpack, type C64, type Roms } from '@mimir/sindri';
import { monitorChar } from './c64/monitor';
import { depackerText, packerNames } from './sindri';
import { h2, h4 } from './util/hex';

/** what `sindri` needs of the run it is in: the script's memory, its names, the program's files, the ROMs and the disk */
export interface SindriContext {
  mem: Uint8Array;
  addr: (where: unknown) => number;
  files: readonly { start: number; end: number }[];
  roms?: Roms | null;
  disk?: Uint8Array | null;
  /** the cycles everything a script runs in Sindri may take together */
  budget: { left: number };
}

/** the cycles one run of a machine takes when the script does not say */
export const SINDRI_RUN_CYCLES = 20_000_000;
/** the cycles all of a script's runs in Sindri's machines may take together (twenty minutes of the C64's time) */
export const SINDRI_BUDGET = 1_200_000_000;

const bytesOf = (v: unknown, what: string): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…), a scratchpad or disk.read(…))`);
};

/** `sindri` for a script's run. */
export function sindriApi(ctx: SindriContext): Record<string, unknown> {
  const { mem, addr, files } = ctx;
  const prg = (start: unknown, end: unknown): Uint8Array => {
    const s = addr(start), e = typeof end === 'number' && end === 0x10000 ? 0x10000 : addr(end);
    if (e <= s) throw new RangeError(`sindri.prg: the end ($${h4(e & 0xffff)}) is not after the start ($${h4(s)})`);
    const out = new Uint8Array(e - s + 2);
    out[0] = s & 0xff; out[1] = s >> 8; out.set(mem.subarray(s, e), 2);
    return out;
  };
  const needRoms = (what: string): Roms => {
    if (!ctx.roms) throw new Error(`${what} needs the C64's ROM files: they come with VICE (Settings, Toolchain)`);
    return ctx.roms;
  };
  const spend = (cycles: number) => { ctx.budget.left -= cycles; };

  return {
    roms: ctx.roms?.source ?? 'stand-ins',
    prg,
    unpack(file?: unknown, o: { disk?: boolean; entry?: unknown; port?: number } = {}) {
      if (file == null && !files.length) throw new Error('sindri.unpack: the program has no file: give it a PRG');
      const input = file == null ? prg(files[0].start, files[0].end) : bytesOf(file, 'sindri.unpack');
      if (input.length < 3) throw new RangeError('sindri.unpack: a PRG is its load address and at least a byte');
      const disk = o.disk === false ? null : ctx.disk ?? null;
      const r = unpack(input, { roms: ctx.roms ?? null, disk, ...(o.entry != null ? { entry: addr(o.entry), ...(o.port != null ? { port: o.port & 0xff } : {}) } : {}) });
      spend(r.cycles);
      const s = r.saved;
      return {
        unpacked: r.unpacked, packer: packerNames(r), start: s?.start ?? null, end: s ? s.start + s.prg.length - 2 : null, entry: s?.entry ?? null, port: s?.port ?? null, basic: !!s?.basic,
        prg: s?.prg ?? null, bytes: s ? s.prg.slice(2) : null,
        layers: r.layers.map(l => ({ index: l.index, entry: l.entry, kind: l.kind, packer: l.packer?.name ?? null, instructions: l.instructions, written: l.written.map(w => ({ start: w.start, end: w.end + 1 })), what: depackerText(l) })),
        listing: r.basic, stop: `${r.stop.reason}: ${r.stop.detail}`, drive: r.drive, cycles: r.cycles, ms: Math.round(r.ms),
      };
    },
    disassemble(at: unknown, count: unknown = 16, bytes?: unknown): string[] {
      const from = bytes == null ? null : bytesOf(bytes, 'sindri.disassemble');
      // (bytes given are taken as lying at `at`)
      const base = addr(at), read = (a: number) => (from ? from[(a - base) & 0xffff] ?? 0 : mem[a & 0xffff]);
      const out: string[] = [];
      let pc = base;
      for (let i = 0, n = Math.max(1, Math.min(4096, Number(count) || 16)); i < n && pc < 0x10000 && (!from || pc - base < from.length); i++) {
        const d = disasm(read, pc);
        out.push(`$${h4(pc)}  ${Array.from({ length: d.len }, (_, k) => h2(read(pc + k))).join(' ').padEnd(8)}  ${d.text}`);
        pc += d.len;
      }
      return out;
    },
    basic: (at: unknown = 0x0801): string[] => basicLines(a => mem[a & 0xffff], addr(at)).map(listLine),
    sys: (at: unknown = 0x0801): number | null => findSys(a => mem[a & 0xffff], addr(at)),
    c64(o: { disk?: boolean; program?: boolean } = {}) {
      const roms = needRoms('sindri.c64');
      const c = readyC64(roms);
      if (!c) throw new Error('sindri.c64: the C64 did not start with these ROMs');
      if (o.disk !== false && ctx.disk) {
        if (!roms.drive) throw new Error('sindri.c64: the ROMs have no 1541 DOS ROM, so the disk cannot be used (pass { disk: false }, or point Settings, Toolchain at VICE)');
        c.attachDrive(driveWith(roms.drive, ctx.disk));
      }
      // the program as LOAD leaves it, from the script's memory as it is now
      if (o.program !== false) for (const f of files) {
        c.ram.set(mem.subarray(Math.max(2, f.start), f.end), Math.max(2, f.start));
        // a BASIC program's end, where LOAD puts it: RUN keeps its variables after the program
        if (f.start === 0x0801) for (const p of [0x2d, 0x2f, 0x31, 0xae]) { c.ram[p] = f.end & 0xff; c.ram[p + 1] = (f.end >> 8) & 0xff; }
      }
      return machine(c, ctx);
    },
  };
}

/** the C64 behind each machine sindri.c64() gave (screen.show(c64) shows its screen) */
const machines = new WeakMap<object, C64>();
/** The C64 of a machine a script got from sindri.c64(), or null when the value is none. */
export const sindriMachine = (v: unknown): C64 | null => (v && typeof v === 'object' ? machines.get(v) ?? null : null);

/** One step of a machine as Sindri runs it; false when the CPU jammed. */
function step(c: C64): boolean {
  const cpu = c.cpu, iWas = cpu.i;
  c.dmaWait();
  const cycles = cpu.step();
  c.icount++;
  if (cpu.jammed) return false;
  c.advance(cycles);
  if (c.irqDue() && !(cpu.lastOp === 0x40 ? cpu.i : iWas)) c.advance(c.takeIrq());
  if (c.nmiDue()) c.advance(c.takeNmi());
  return true;
}

/** A C64 as a script drives it. */
function machine(c: C64, ctx: SindriContext): Record<string, unknown> {
  const cpu = c.cpu;
  const budget = (want: number, what: string): number => {
    if (ctx.budget.left <= 0) throw new Error(`${what}: the script has run all the cycles a script may run in Sindri (${SINDRI_BUDGET.toLocaleString('en-US')})`);
    return Math.min(want, ctx.budget.left);
  };
  const m: Record<string, unknown> = {
    mem: c.ram,
    load(bytes: unknown, at: unknown) { const b = bytesOf(bytes, 'load'), a = ctx.addr(at); c.ram.set(b.subarray(0, Math.max(0, 0x10000 - a)), a); },
    loadPrg(prg: unknown): number { const b = bytesOf(prg, 'loadPrg'); if (b.length < 3) throw new RangeError('loadPrg: a PRG is its load address and at least a byte'); const a = b[0] | (b[1] << 8); c.ram.set(b.subarray(2, 2 + Math.max(0, 0x10000 - a)), a); return a; },
    peek: (a: unknown): number => c.peek(ctx.addr(a)),
    run(o: { until?: unknown; cycles?: number } = {}) {
      const stops = o.until == null ? [] : (Array.isArray(o.until) ? o.until : [o.until]).map(x => ctx.addr(x));
      const max = budget(Math.max(1, Number(o.cycles) || SINDRI_RUN_CYCLES), 'run'), c0 = c.cycles;
      let reason: 'until' | 'cycles' | 'jam' = 'cycles';
      for (let first = true; c.cycles - c0 < max; first = false) {
        if (!first && stops.includes(cpu.pc)) { reason = 'until'; break; }
        if (!step(c)) { reason = 'jam'; break; }
      }
      if (reason === 'cycles' && stops.includes(cpu.pc)) reason = 'until';
      ctx.budget.left -= c.cycles - c0;
      return { reason, pc: cpu.pc, cycles: c.cycles - c0 };
    },
    call(where: unknown, r: { a?: number; x?: number; y?: number; c?: boolean | number; cycles?: number } = {}) {
      const start = ctx.addr(where), max = budget(Math.max(1, Number(r.cycles) || SINDRI_RUN_CYCLES), 'call'), c0 = c.cycles;
      cpu.a = (r.a ?? 0) & 0xff; cpu.x = (r.x ?? 0) & 0xff; cpu.y = (r.y ?? 0) & 0xff;
      if (r.c != null) cpu.p = (cpu.p & 0xfe) | (r.c ? 1 : 0);
      // its return address on the stack: when the stack is back above it, the routine has returned
      const s0 = cpu.s, back = 0xfffe;
      c.ram[0x100 + s0] = back >> 8; c.ram[0x100 + ((s0 - 1) & 0xff)] = back & 0xff; cpu.s = (s0 - 2) & 0xff;
      cpu.pc = start;
      for (;;) {
        if (c.cycles - c0 >= max) { ctx.budget.left -= c.cycles - c0; throw new Error(`the routine called at $${h4(start)} did not return after ${max.toLocaleString('en-US')} cycles (it was at $${h4(cpu.pc)})`); }
        if (!step(c)) { ctx.budget.left -= c.cycles - c0; throw new Error(`the routine called at $${h4(start)} jammed at $${h4(cpu.pc)}`); }
        if (cpu.lastOp === 0x60 && cpu.s === s0 && cpu.pc === ((back + 1) & 0xffff)) break;
      }
      ctx.budget.left -= c.cycles - c0;
      return { a: cpu.a, x: cpu.x, y: cpu.y, p: cpu.p, c: (cpu.p & 1) !== 0, z: (cpu.p & 2) !== 0, n: (cpu.p & 0x80) !== 0, brk: false };
    },
    type(text: unknown) {
      const keys = [...String(text)].map(ch => (ch === '\r' || ch === '\n' ? 0x0d : ch.toUpperCase().charCodeAt(0) & 0xff)).slice(0, 10);
      c.ram.set(keys, 0x0277); c.ram[0xc6] = keys.length;
    },
    screen(): string[] {
      // where the VIC reads its text screen: its bank (CIA 2) and the matrix ($d018)
      const bank = 3 - ((c.cia2.pra | ~c.cia2.ddra) & 3), at = (bank << 14) | (((c.vic.regs[0x18] >> 4) & 15) << 10);
      const lower = (c.vic.regs[0x18] & 2) !== 0, out: string[] = [];
      for (let row = 0; row < 25; row++) {
        let line = '';
        for (let col = 0; col < 40; col++) line += monitorChar(c.ram[(at + row * 40 + col) & 0xffff], true, lower)?.ch ?? ' ';
        out.push(line.replace(/\s+$/, ''));
      }
      return out;
    },
  };
  for (const r of ['a', 'x', 'y', 's', 'pc'] as const) Object.defineProperty(m, r, { enumerable: true, get: () => cpu[r], set: (v: number) => { cpu[r] = r === 'pc' ? v & 0xffff : v & 0xff; } });
  Object.defineProperty(m, 'p', { enumerable: true, get: () => cpu.p, set: (v: number) => { cpu.p = v & 0xff; } });
  Object.defineProperty(m, 'cycles', { enumerable: true, get: () => c.cycles });
  machines.set(m, c);
  return m;
}
