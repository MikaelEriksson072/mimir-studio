/* Starting a program in Retro Debugger or C64 Debugger (spec 13.2b) as Build & Run starts it in VICE.
 *
 * The debuggers load a PRG into RAM (as VICE's monitor does with `bank ram`, under the I/O area and the ROMs too) once
 * the C64 is at READY, and jump: Retro Debugger to `-jmp` (after `-wait`), C64 Debugger to the PRG's load address
 * (`-alwaysjmp`; it resets and waits for READY itself, and loses a `-jmp`). They take none of VICE's `-keybuf` or
 * monitor commands. So the start is code at the load address of a copy of the PRG, next to the program: it does what
 * VICE types at READY (`run`, `sys <start>`, the drive's initialise before them), or, for a program VICE starts from
 * its monitor, what the monitor does (the drive reads the disk first, $ba, $01, go). */
import type { Addr } from '../types';
import { makePrg, startsFromMonitor } from './prg';

/**
 * The disk command "I" (initialise) on the command channel, typed before `run` or `sys <start>`. Without a string:
 * BASIC copies a string typed at READY into string space, and a program that loads up to $a000 or beyond (an
 * unpacked one, $0801-$f344 say) leaves none, so `open15,8,15,"i"` stops with ?OUT OF MEMORY before the program
 * starts. The channel is opened without a name, and the KERNAL sends the "I": CHKOUT 15 (X in 781), CHROUT $49
 * (A in 780), CLRCHN (unlisten: the drive runs the command). 69 characters: with `sys` and five digits the line
 * stays within BASIC's 80.
 */
export const DRIVE_INIT = 'open15,8,15:poke781,15:sys65481:poke780,73:sys65490:sys65484:close15:';

/** How the program starts in the debugger: as VICE types it at READY (`run`, `sys`), as VICE's monitor starts it, or
 *  (`load`, no program) what VICE's autostart of a disk or a tape types: LOAD, then RUN. */
export type DebuggerVia = 'run' | 'sys' | 'monitor' | 'load';

export interface DebuggerStart {
  /** the PRG the debugger loads: the program with the start code at its load address (or the start code alone) */
  prg: Uint8Array;
  /** where the debugger jumps: the load address of `prg` (null: nowhere, the program is only loaded) */
  jmp: Addr | null;
  via: DebuggerVia;
  /** the code put next to the program, $start-$end (exclusive): the start code, a JMP to it, the copy of a carried
   *  program; null when the program itself starts at its load address */
  code: { start: Addr; end: Addr } | null;
  /** the program is carried: loaded elsewhere, and the start code copies it into place first */
  carried?: boolean;
  /** what is typed (via run, sys or load), as it shows on the debugger's screen */
  typed?: string;
  /** what could not be done as VICE does it: no room for the start code next to the program */
  warning?: string;
}

/* RAM nothing uses at READY, where the CPU sees RAM with $01 = $37: BASIC's free memory ($0800 stays BASIC's 0), the
 * $c000 block, the tape buffer and $02a7-$02ff. Typed code copies its line into BASIC's input buffer ($0200-$0258), so
 * only code that types nothing may be there, or at the bottom of the stack page below what READY uses (it moves the
 * stack below itself first). A JMP may also go just below $0800 (the sprite pointers, which READY does not use). A
 * carried program is loaded into BASIC's free memory or the $c000 block, past BASIC's empty program ($0801-$0802). */
const FREE_TYPED: Array<[Addr, Addr]> = [[0x0801, 0xa000], [0xc000, 0xd000], [0x0334, 0x0400], [0x02a7, 0x0300]];
const FREE_MONITOR: Array<[Addr, Addr]> = [...FREE_TYPED, [0x0130, 0x0259]];
const FREE_JMP: Array<[Addr, Addr]> = [...FREE_MONITOR, [0x07e8, 0x0800]];
const FREE_CARRY: Array<[Addr, Addr]> = [[0x0803, 0xa000], [0xc000, 0xd000]];

/** a few 6510 instructions, with labels resolved when the code is done */
class Code {
  private readonly b: number[] = [];
  private readonly labels = new Map<string, Addr>();
  private readonly fixes: Array<{ i: number; label: string; rel: boolean; add: number }> = [];
  constructor(readonly org: Addr) {}
  get pc(): Addr { return this.org + this.b.length; }
  op(...xs: number[]): this { for (const x of xs) this.b.push(x & 0xff); return this; }
  /** an instruction with a 16-bit operand: an address, or a label's (plus `add`) */
  abs(opcode: number, to: Addr | string, add = 0): this {
    if (typeof to === 'string') { this.fixes.push({ i: this.b.length + 1, label: to, rel: false, add }); return this.op(opcode, 0, 0); }
    return this.op(opcode, to + add, (to + add) >> 8);
  }
  branch(opcode: number, label: string): this { this.fixes.push({ i: this.b.length + 1, label, rel: true, add: 0 }); return this.op(opcode, 0); }
  label(name: string): this { this.labels.set(name, this.pc); return this; }
  bytes(xs: ArrayLike<number>): this { for (let i = 0; i < xs.length; i++) this.b.push(xs[i] & 0xff); return this; }
  fill(n: number): this { for (let i = 0; i < n; i++) this.b.push(0); return this; }
  done(): Uint8Array {
    for (const f of this.fixes) {
      const at = this.labels.get(f.label);
      if (at == null) throw new Error(`start code: no label ${f.label}`);
      const to = at + f.add;
      if (f.rel) {
        const d = to - (this.org + f.i + 1);
        if (d < -128 || d > 127) throw new Error(`start code: branch to ${f.label} out of range`);
        this.b[f.i] = d & 0xff;
      } else { this.b[f.i] = to & 0xff; this.b[f.i + 1] = (to >> 8) & 0xff; }
    }
    return Uint8Array.from(this.b);
  }
}

const SEI = 0x78, CLI = 0x58, TSX = 0xba, TXS = 0x9a, INX = 0xe8, INY = 0xc8, DEX = 0xca, DEY = 0x88;
const LDA_IMM = 0xa9, LDA_ZP = 0xa5, LDA_ABS = 0xad, LDA_ABSX = 0xbd, LDA_ABSY = 0xb9, LDA_ZPX = 0xb5;
const STA_ZP = 0x85, STA_ABS = 0x8d, STA_ABSX = 0x9d, STA_ABSY = 0x99, STA_ZPX = 0x95, INC_ABS = 0xee;
const LDX_IMM = 0xa2, LDX_ABS = 0xae, STX_ABS = 0x8e, LDY_IMM = 0xa0, STY_ZP = 0x84;
const JSR = 0x20, JMP = 0x4c, BEQ = 0xf0, BNE = 0xd0, BPL = 0x10;

/** typed text as the screen editor puts it in BASIC's input buffer: lower case typed is PETSCII's unshifted letters */
const petscii = (s: string): number[] => [...s].map(c => (c >= 'a' && c <= 'z' ? c.toUpperCase() : c).charCodeAt(0));

/** where the program is carried from and to: the start code copies it into place first, with all RAM in view */
interface Carry { from: Addr; to: Addr; length: number }

/** code that copies a carried program into place: page by page, then the rest, with $01 = $34 (RAM under the I/O
 *  area and the ROMs), then $37 as at READY */
function copier(c: Code, k: Carry): void {
  const pages = k.length >> 8, rest = k.length & 0xff, done = pages << 8;
  c.op(SEI, LDA_IMM, 0x34, STA_ZP, 0x01);
  if (pages) {
    c.op(LDX_IMM, pages, LDY_IMM, 0).label('page').abs(LDA_ABSY, k.from).abs(STA_ABSY, k.to).op(INY).branch(BNE, 'page');
    c.abs(INC_ABS, 'page', 2).abs(INC_ABS, 'page', 5).op(DEX).branch(BNE, 'page');
  }
  if (rest) c.op(LDY_IMM, rest).label('rest').abs(LDA_ABSY, k.from + done - 1).abs(STA_ABSY, k.to + done - 1).op(DEY).branch(BNE, 'rest');
  c.op(LDA_IMM, 0x37, STA_ZP, 0x01);
}

/**
 * Code that types a line at READY, as VICE's -keybuf does: the cursor goes off and its character back (as the KERNAL
 * does when a key comes), the line is printed and copied into the input buffer, and BASIC takes it from there as if
 * RETURN was pressed ($a486: TXTPTR, direct mode, tokenise, execute). Before it, `end` (a program loaded) sets BASIC's
 * end pointers as VICE's loading does, and `queue` goes into the keyboard buffer, typed at the next READY (RUN after a
 * LOAD). `port`: a routine after the code that sets $01 and jumps to `start`; `line` gets its address (the line calls
 * it). The code starts at its first byte.
 */
function typing(org: Addr, line: (port: Addr) => string, o: { end?: Addr; queue?: string; port?: { value: number; start: Addr }; carry?: Carry }): { code: Uint8Array; line: string } {
  const c = new Code(org);
  if (o.carry) copier(c, o.carry);
  c.op(SEI, LDA_ZP, 0xcf).branch(BEQ, 'off').op(LDA_ZP, 0xce).abs(LDX_ABS, 0x0287).op(LDY_IMM, 0, STY_ZP, 0xcf).abs(JSR, 0xea13);
  c.label('off').op(LDA_IMM, 1, STA_ZP, 0xcc);
  if (o.end != null) {
    c.op(LDA_IMM, o.end & 0xff, STA_ZP, 0x2d, STA_ZP, 0x2f, STA_ZP, 0x31, STA_ZP, 0xae);
    c.op(LDA_IMM, (o.end >> 8) & 0xff, STA_ZP, 0x2e, STA_ZP, 0x30, STA_ZP, 0x32, STA_ZP, 0xaf);
  }
  if (o.queue) c.op(LDX_IMM, o.queue.length - 1).label('queue').abs(LDA_ABSX, 'keys').abs(STA_ABSX, 0x0277).op(DEX).branch(BPL, 'queue').op(LDA_IMM, o.queue.length, STA_ZP, 0xc6);
  // the stack as BASIC has it at READY; the line printed, then RETURN
  c.op(LDX_IMM, 0xfb, TXS, CLI, LDX_IMM, 0);
  c.label('copy').abs(LDA_ABSX, 'line').abs(STA_ABSX, 0x0200).branch(BEQ, 'typed').abs(JSR, 0xffd2).op(INX).branch(BNE, 'copy');
  c.label('typed').op(LDA_IMM, 0x0d).abs(JSR, 0xffd2).op(LDX_IMM, 0xff, LDY_IMM, 0x01).abs(JMP, 0xa486);
  const port = c.pc;
  if (o.port) c.op(LDA_IMM, o.port.value, STA_ZP, 0x01).abs(JMP, o.port.start);
  const text = line(port);
  c.label('line').bytes(petscii(text)).op(0);
  if (o.queue) c.label('keys').bytes(petscii(o.queue));
  return { code: c.done(), line: text };
}

/**
 * Code that does what VICE's monitor does before `g <start>`: with a disk, the drive reads it (VICE types the drive's
 * initialise before it loads the program; here the program is in memory already, so the KERNAL is called directly,
 * past the program's vectors, with no interrupts, and the zero page and file tables it uses are put back as they
 * were) and $ba is 8 (unless the program loaded over it); $01 as the program starts; the stack pointer as at READY.
 * Code at the bottom of the stack page moves the stack below itself while it runs.
 */
function monitorStart(org: Addr, o: { start: Addr; port: number | null; disk: boolean; setDevice: boolean; carry?: Carry }): Uint8Array {
  const c = new Code(org);
  if (o.carry) copier(c, o.carry);
  c.op(SEI, TSX).abs(STX_ABS, 'sp');
  if (org < 0x0200) c.op(LDX_IMM, (org - 1) & 0xff, TXS);
  if (o.disk) {
    c.op(LDA_IMM, 0x7f).abs(STA_ABS, 0xdc0d).abs(LDA_ABS, 0xdc0d);
    c.op(LDX_IMM, 0x2c).label('save1').op(LDA_ZPX, 0x90).abs(STA_ABSX, 'zp').op(DEX).branch(BPL, 'save1');
    c.op(LDX_IMM, 0x1d).label('save2').abs(LDA_ABSX, 0x0259).abs(STA_ABSX, 'files').op(DEX).branch(BPL, 'save2');
    // the KERNAL as at READY: no file open, keyboard in, screen out, no byte waiting for the serial bus
    c.op(LDA_IMM, 0, STA_ZP, 0x90, STA_ZP, 0x94, STA_ZP, 0x98, STA_ZP, 0x99, STA_ZP, 0xb7, LDA_IMM, 3, STA_ZP, 0x9a);
    // OPEN 15,8,15 (no name), CHKOUT 15, CHROUT "I", CLRCHN, CLOSE 15
    c.op(LDA_IMM, 0x0f, STA_ZP, 0xb8, STA_ZP, 0xb9, LDA_IMM, 8, STA_ZP, 0xba).abs(JSR, 0xf34a);
    c.op(LDX_IMM, 0x0f).abs(JSR, 0xf250).op(LDA_IMM, 0x49).abs(JSR, 0xf1ca).abs(JSR, 0xf333).op(LDA_IMM, 0x0f).abs(JSR, 0xf291);
    // (the KERNAL's serial routines end with CLI)
    c.op(SEI, LDX_IMM, 0x2c).label('back1').abs(LDA_ABSX, 'zp').op(STA_ZPX, 0x90, DEX).branch(BPL, 'back1');
    c.op(LDX_IMM, 0x1d).label('back2').abs(LDA_ABSX, 'files').abs(STA_ABSX, 0x0259).op(DEX).branch(BPL, 'back2');
    c.abs(LDA_ABS, 0xdc0d).op(LDA_IMM, 0x81).abs(STA_ABS, 0xdc0d);
  }
  if (o.setDevice) c.op(LDA_IMM, 8, STA_ZP, 0xba);
  if (o.port != null) c.op(LDA_IMM, o.port, STA_ZP, 0x01);
  c.abs(LDX_ABS, 'sp').op(TXS, CLI).abs(JMP, o.start);
  c.label('sp').op(0);
  if (o.disk) c.label('zp').fill(0x2d).label('files').fill(0x1e);
  return c.done();
}

const inside = (from: number, to: number, free: Array<[Addr, Addr]>): boolean => free.some(([a, b]) => from >= a && to <= b);

/**
 * The program at `load` and start code `make` makes at an address, in one PRG whose load address is where the code
 * starts: the code right before the program; else right after it, with a JMP to it right before (below $0800 for a
 * program at $0801, whose $0800 stays 0); else, for a program with no room around it, the code and the program
 * carried in free RAM, where the code copies the program into place first. `n`: the longest the code gets (without
 * a copier).
 */
function arrange(load: Addr, bytes: Uint8Array, n: number, free: Array<[Addr, Addr]>, make: (at: Addr, carry?: Carry) => Uint8Array): { prg: Uint8Array; code: { start: Addr; end: Addr }; carried?: boolean } | null {
  const end = load + bytes.length;
  if (inside(load - n, load, free)) {
    const at = load - n, code = make(at), pad = new Uint8Array(n);
    pad.set(code);
    return { prg: makePrg(at, concat(pad, bytes)), code: { start: at, end: load } };
  }
  if (inside(end, end + n, free)) {
    const t = load === 0x0801 ? 0x07fd : load - 3;
    if (inside(t, t + 3, FREE_JMP)) {
      const code = make(end), head = new Uint8Array(load - t);
      head.set([JMP, end & 0xff, end >> 8]);
      return { prg: makePrg(t, concat(head, bytes, code)), code: { start: t, end: end + code.length } };
    }
  }
  // (measured high up, where a `sys` to the code has five digits)
  const sized = make(0xfff0, { from: 0xfff0, to: load, length: bytes.length }).length, m = sized + bytes.length;
  for (const [a, b] of FREE_CARRY) {
    const at = a + m <= load || a >= end ? a : end;
    if (at < a || at + m > b || (at < end && at + m > load)) continue;
    const code = new Uint8Array(sized);
    code.set(make(at, { from: at + sized, to: load, length: bytes.length }));
    return { prg: makePrg(at, concat(code, bytes)), code: { start: at, end: at + m }, carried: true };
  }
  return null;
}

const concat = (...parts: Uint8Array[]): Uint8Array => {
  const u = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let i = 0;
  for (const p of parts) { u.set(p, i); i += p.length; }
  return u;
};

/**
 * How Retro Debugger or C64 Debugger starts `prg` (a PRG file) as Build & Run starts it in VICE (see viceArgv): with
 * no start, RUN; with one, `sys <start>` typed (through a routine that sets $01 first, for another `port` than $37),
 * or, for a program over BASIC's work area or the screen at READY, started as from VICE's monitor. With a disk in drive
 * 8 the drive reads it first. Without `prg` (VICE autostarts a disk or a tape), `load` is what is typed: LOAD"*",8,1 or
 * LOAD, then RUN; the code goes at $02a7.
 */
export function debuggerStart(prg: Uint8Array | null, o: { start?: Addr | null; port?: number | null; disk?: boolean; load?: 'disk' | 'tape' } = {}): DebuggerStart {
  const port = o.port != null && (o.port & 0xff) !== 0x37 ? o.port & 0xff : null;
  if (!prg) {
    const { code, line } = typing(0x02a7, () => (o.load === 'tape' ? 'load' : 'load"*",8,1'), { queue: 'run\r' });
    return { prg: makePrg(0x02a7, code), jmp: 0x02a7, via: 'load', code: { start: 0x02a7, end: 0x02a7 + code.length }, typed: `${line}, then run` };
  }
  if (prg.length < 3) throw new Error('the program is too short to be a PRG');
  const load = prg[0] | (prg[1] << 8), bytes = prg.subarray(2), end = load + bytes.length;
  const start = o.start ?? null, disk = !!o.disk;
  if (start != null && startsFromMonitor(load, bytes.length)) {
    // nothing to do before the jump, and the program starts where it loads: the debugger jumps to it
    if (!disk && port == null && start === load) return { prg, jmp: start, via: 'monitor', code: null };
    const setDevice = disk && !(load <= 0xba && end > 0xba);
    const make = (at: Addr, carry?: Carry) => monitorStart(at, { start, port, disk, setDevice, carry });
    // (measured in the stack page, where it is longest: it moves the stack there)
    const r = arrange(load, bytes, make(0x0130).length, FREE_MONITOR, make);
    if (!r) return { prg, jmp: null, via: 'monitor', code: null, warning: `no room for the start code next to the program: it is loaded, start it at $${hex(start)}${port != null ? ` with $01 = $${hex(port, 2)}` : ''} in the debugger` };
    return { prg: r.prg, jmp: r.prg[0] | (r.prg[1] << 8), via: 'monitor', code: r.code, ...(r.carried ? { carried: true } : {}) };
  }
  const via: DebuggerVia = start == null ? 'run' : 'sys';
  const init = disk ? DRIVE_INIT : '';
  let typed = '';
  const make = (at: Addr, carry?: Carry) => {
    const t = typing(at, p => `${init}${start == null ? 'run' : `sys${port != null ? p : start}`}`, { end, ...(start != null && port != null ? { port: { value: port, start } } : {}), ...(carry ? { carry } : {}) });
    typed = t.line;
    return t.code;
  };
  // (the longest `sys`: five digits)
  const r = arrange(load, bytes, make(0xfff0).length, FREE_TYPED, make);
  if (!r) return { prg, jmp: null, via, code: null, warning: `no room for the start code next to the program: it is loaded, type ${start == null ? 'RUN' : `SYS${start}`} in the debugger` };
  return { prg: r.prg, jmp: r.prg[0] | (r.prg[1] << 8), via, code: r.code, typed, ...(r.carried ? { carried: true } : {}) };
}

const hex = (n: number, w = 4): string => n.toString(16).padStart(w, '0');
