/* A VICE 3.x snapshot (.vsf) as C64 Debugger reads one (spec 13.2b).
 *
 * C64 Debugger 0.64.58 is built on VICE 3.1, whose snapshots are format 1.1 with 32-bit clocks; VICE 3.6 and later
 * write format 2.0 with 64-bit clocks and newer modules, which the debugger refuses ("Snapshot loading failed"). The
 * state is the same, so each module is written again as VICE 3.1's `c64_snapshot_read` takes it (checked against the
 * debugger's source, github.com/slajerek/RetroDebugger tag v0.64.60.04E, and VICE 3.10's writers):
 *
 *   MAINCPU      clocks 32-bit; without ane/lxa log level and the jammed flag
 *   C64MEM       as it is (RAM, CPU port); C64CART only without a cartridge; GLUE, C64MEMHACKS as they are
 *   CIA1, CIA2   the TOD clock 32-bit; without the newer serial-port and interrupt-delay state
 *   SID          without the model byte; SIDEXTENDED (reSID's or fastSID's state) as it is; one SID
 *   DRIVE        units 8 and 9 in one module (VICE 3.10: DRIVE8, DRIVE9 …), clocks 32-bit; DRIVECPUn without the
 *                last bus value; the drive's VIAs without the newer timer 2 state. 1540/1541/1541-II only
 *   VIC-II       the light pen's trigger cycle 32-bit; the raster state after it is not read
 *   TAPEPORT, USERPORT   no device; JOYPORTn a joystick with nothing pressed; KEYBOARD left out (no key held)
 *
 *   GCRIMAGEn    a disk saved in the snapshot, as it is; or the disk given here (a D64 or a G64) as drive 8's, since
 *                the debugger takes no disk on its command line next to a snapshot
 *
 * Left out: the datasette's state, the virtual drives, the event history. A clock past 2^31 cycles is moved back
 * with all the others of its CPU.
 *
 * The debugger refuses a snapshot whose VIC-II model is not its own, so the model is written as the first of its
 * video standard (6569 for PAL, 6567 for NTSC), the debugger's C64 PAL and C64 NTSC. */
import { d64ToDisk, g64ToDisk, isG64 } from '@mimir/sindri';
import { isVsf, parseVsf, type VsfModule } from './vsf';

export interface DebuggerSnapshot {
  /** the snapshot as C64 Debugger's `-snapshot` loads it */
  snap: Uint8Array;
  /** the VIC-II model the snapshot says, which the debugger's own must be: 6569 (C64 PAL) or 6567 (C64 NTSC) for a
   *  snapshot of those video standards */
  model: string;
  /** the given disk is in the snapshot, as drive 8's */
  disk: boolean;
  /** what the debugger does not get: a second SID, a drive type it cannot restore … */
  notes: string[];
}

export interface DebuggerSnapshotOptions {
  /** a disk image (D64 or G64) to put in drive 8, written into the snapshot */
  disk?: Uint8Array | null;
}

/** the model the debugger has for a snapshot's: PAL ones 6569, NTSC ones 6567 */
const DEBUGGER_MODEL = [0, 0, 0, 3, 3, 5, 6];
const MODELS = ['6569 (C64 PAL)', '8565 (C64C PAL)', '6569R1 (old PAL)', '6567 (C64 NTSC)', '8562 (C64C NTSC)', '6567R56A (old NTSC)', '6572 (PAL-N)'];
const DRIVE_TYPES = new Set([1540, 1541, 1542]);
const MAX32 = 0xffffffff;

/** bytes read in order from a module */
class In {
  p = 0;
  constructor(readonly b: Uint8Array, readonly name: string) {}
  private need(n: number): void { if (this.p + n > this.b.length) throw new Error(`the snapshot's ${this.name} module is shorter than VICE 3.10 writes it`); }
  b8(): number { this.need(1); return this.b[this.p++]; }
  w(): number { this.need(2); const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  dw(): number { this.need(4); const b = this.b, p = this.p; this.p += 4; return (b[p] | (b[p + 1] << 8) | (b[p + 2] << 16) | (b[p + 3] << 24)) >>> 0; }
  /** a 64-bit clock, as a number (exact below 2^53); all ones is "never" */
  clock(): number { const lo = this.dw(), hi = this.dw(); return lo === MAX32 && hi === MAX32 ? Infinity : hi * 0x100000000 + lo; }
  bytes(n: number): Uint8Array { this.need(n); const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
  rest(): Uint8Array { const v = this.b.subarray(this.p); this.p = this.b.length; return v; }
  skip(n: number): this { this.need(n); this.p += n; return this; }
}

class Out {
  private readonly a: number[] = [];
  b8(v: number): this { this.a.push(v & 0xff); return this; }
  w(v: number): this { this.a.push(v & 0xff, (v >> 8) & 0xff); return this; }
  dw(v: number): this { const u = v >>> 0; this.a.push(u & 0xff, (u >>> 8) & 0xff, (u >>> 16) & 0xff, u >>> 24); return this; }
  bytes(v: ArrayLike<number>): this { for (let i = 0; i < v.length; i++) this.a.push(v[i] & 0xff); return this; }
  zeros(n: number): this { for (let i = 0; i < n; i++) this.a.push(0); return this; }
  done(): Uint8Array { return Uint8Array.from(this.a); }
}

/** a clock as VICE 3.1 has it: 32 bits, moved back by `base` (never below 0; "never" stays never) */
const clock32 = (c: number, base: number): number => (c === Infinity ? MAX32 : Math.min(MAX32 - 1, Math.max(0, c - base)));
/** a count of cycles kept in a clock-sized field */
const count32 = (c: number): number => (c === Infinity ? MAX32 : Math.min(MAX32, c));
/** where a CPU's clocks are moved back to, when they no longer fit in 31 bits */
const baseOf = (clk: number): number => (clk >= 0x80000000 ? clk - 0x01000000 : 0);

/** the interrupt state after a CPU's registers: three clocks, the cycles last stolen and when */
function interrupts(i: In, o: Out, base: number): void {
  o.dw(clock32(i.clock(), base)).dw(clock32(i.clock(), base)).dw(clock32(i.clock(), base)).dw(count32(i.clock())).dw(clock32(i.clock(), base));
}

/**
 * The snapshot `vsf` (VICE 3.6-3.10, x64sc) as C64 Debugger 0.64.58 loads it. A snapshot VICE 3.1-3.5 wrote (format
 * 1.x) is passed as it is. Throws for what the debugger cannot be given: another machine than the C64 of x64sc, a
 * cartridge in the snapshot, a SID engine it does not have.
 */
export function snapshotForC64Debugger(vsf: Uint8Array, name = 'snapshot', opts: DebuggerSnapshotOptions = {}): DebuggerSnapshot {
  if (!isVsf(vsf)) throw new Error(`${name} is not a VICE snapshot`);
  const s = parseVsf(vsf, name), notes: string[] = [];
  if (s.machine !== 'C64SC') throw new Error(`${name} was saved by x64 (the snapshot says ${s.machine}), and C64 Debugger reads x64sc's: save it in x64sc`);
  const mod = (n: string): VsfModule | undefined => s.modules.find(m => m.name === n);
  const data = (m: VsfModule): Uint8Array => vsf.subarray(m.offset, m.offset + m.size);
  const need = (n: string): In => { const m = mod(n); if (!m) throw new Error(`${name}: the snapshot has no ${n} module`); return new In(data(m), n); };
  const vic = need('VIC-II');
  const was = vic.b[0], as = DEBUGGER_MODEL[was] ?? was;
  const model = MODELS[as] ?? `model ${as}`;
  if (s.version[0] < 2) return { snap: vsf.slice(), model: MODELS[was] ?? `model ${was}`, disk: false, notes };
  if (as !== was) notes.push(`The snapshot is of a ${MODELS[was]}; it is written as a ${model}, the model C64 Debugger has for it`);
  let disk = false;

  const out: Array<{ name: string; major: number; minor: number; data: Uint8Array }> = [];
  const put = (n: string, major: number, minor: number, d: Uint8Array) => out.push({ name: n, major, minor, data: d });
  const copy = (n: string, major: number, minor: number) => { const m = mod(n); if (m) put(n, major, minor, data(m).slice()); };

  // MAINCPU: clock, A X Y SP PC status, last opcode, (ane, lxa, jammed), BA flags, interrupts
  const cpu = need('MAINCPU'), clk = cpu.clock(), base = baseOf(clk);
  {
    const o = new Out().dw(clock32(clk, base)).bytes(cpu.bytes(7)).dw(cpu.dw());
    cpu.skip(12);
    o.dw(cpu.dw());
    interrupts(cpu, o, base);
    o.dw(cpu.dw()).dw(cpu.dw()).dw(cpu.dw()).dw(count32(cpu.clock())).dw(count32(cpu.clock()));
    put('MAINCPU', 1, 1, o.done());
  }

  // C64MEM: port, EXROM, GAME, RAM, port lines, then the two fall-off clocks of the port's unconnected bits
  {
    const m = need('C64MEM'), o = new Out().bytes(m.bytes(4 + 0x10000 + 3));
    if (m.p + 12 <= m.b.length) {
      // (VICE 3.10 writes the low 32 bits of each)
      for (let k = 0; k < 2; k++) { const c = (m.dw() - base) >>> 0; o.dw(base && c > clk - base ? 0 : c); }
      o.bytes(m.bytes(4));
    }
    put('C64MEM', 0, 1, o.done());
  }
  const cart = mod('C64CART');
  if (cart && cart.size >= 1 && data(cart)[0] !== 0) throw new Error(`${name} has a cartridge attached, which C64 Debugger cannot restore from a VICE 3.10 snapshot. Build & Run (F5) restarts it in VICE`);
  put('C64CART', 0, 1, Uint8Array.of(0));

  // CIA: 33 bytes of registers and TOD, the TOD alarm's clock (from now), the timers' states, shifter, SDR valid,
  // interrupt line, TOD ticks
  const cia = (n: string) => {
    const m = need(n), o = new Out().bytes(m.bytes(33)).dw(count32(m.clock())).bytes(m.bytes(8));
    put(n, 2, 2, o.done());
  };
  cia('CIA1'); cia('CIA2');

  // SID: extra SIDs, sound on, engine, (model), 32 registers
  {
    const m = need('SID');
    if (m.b8() > 0) notes.push('Only the first SID is restored: C64 Debugger gets the snapshot with one');
    m.b8();
    const engine = m.b8();
    if (engine > 1) throw new Error(`${name} was saved with a SID engine C64 Debugger does not have (engine ${engine}): pick reSID or fastSID in VICE and save it again`);
    if (s.modules.find(x => x.name === 'SID')!.minor >= 4) m.b8();
    put('SID', 1, 3, new Out().b8(0).b8(1).b8(engine).bytes(m.bytes(32)).done());
    const x = mod('SIDEXTENDED');
    if (!x) throw new Error(`${name}: the snapshot has no SIDEXTENDED module`);
    put('SIDEXTENDED', 1, 3, data(x).slice());
  }

  // DRIVE: units 8 and 9 with true drive emulation, each a 1540/1541
  const units = [0, 1].map(u => {
    const m = mod(`DRIVE${8 + u}`);
    if (!m || m.size < 6) return null;
    const i = new In(data(m), m.name);
    return i.b8() ? { i, drives: i.b8() } : null;
  });
  if (units[0]) {
    const o = new Out(), tail = new Out(), edges = new Out();
    let sync = 1, first = true;
    const cpus: Array<{ name: string; data: Uint8Array } | null> = [null, null];
    units.forEach((unit, u) => {
      let type = 0, rec: Uint8Array | null = null, attachDetach = 0, edge = 0, active = 0;
      if (unit) {
        const i = unit.i, at = i.skip(4).p;
        sync = (i.b[2] | (i.b[3] << 8) | (i.b[4] << 16) | (i.b[5] << 24)) >>> 0;
        // the unit's type is past the clocks: read the record once the drive's clock is known
        const typeAt = at + 8 + 1 + 1 + 2 + 8 + 1 + 4 + 5 + 4;
        type = i.b.length >= typeAt + 4 ? (i.b[typeAt] | (i.b[typeAt + 1] << 8) | (i.b[typeAt + 2] << 16) | (i.b[typeAt + 3] << 24)) >>> 0 : 0;
        const c = mod(`DRIVECPU${u}`);
        if (type && (!DRIVE_TYPES.has(type) || unit.drives !== 1 || !c)) {
          notes.push(`Drive ${8 + u} is left out: C64 Debugger gets a 1541's state only, and the snapshot's is ${type === 1542 ? 'a 1541-II' : `a ${type}`}${c ? '' : ' without its CPU'}`);
          type = 0;
        }
        if (type && c) {
          const d = new In(data(c), c.name), dclk = d.clock(), dbase = baseOf(dclk);
          // DRIVECPU: clock, registers, last opcode, last clock and stop clock (the C64's), cycles, interrupts, RAM
          const co = new Out().dw(clock32(dclk, dbase)).bytes(d.bytes(7)).dw(d.dw()).dw(clock32(d.clock(), base)).dw(count32(d.clock())).dw(count32(d.clock())).dw(clock32(d.clock(), base));
          d.b8();
          interrupts(d, co, dbase);
          co.bytes(d.rest());
          cpus[u] = { name: c.name, data: co.done() };
          const r = new Out();
          r.dw(clock32(i.clock(), dbase)).b8(i.b8()).b8(i.b8()).w(i.w()).dw(clock32(i.clock(), dbase)).b8(0).b8(0).b8(i.b8());
          r.dw(i.dw()).bytes(i.bytes(5)).dw(i.dw()).dw(i.dw()).dw(i.dw()).dw(clock32(i.clock(), dbase)).dw(i.dw()).dw(i.dw()).w(i.w()).b8(i.b8());
          // seed, speed zone … xorShift32, SO delay, cycle index
          for (let k = 0; k < 14; k++) r.dw(i.dw());
          r.dw(count32(i.clock())).dw(i.dw());
          attachDetach = clock32(i.clock(), dbase); edge = i.b8(); active = i.b8();
          rec = r.done();
        }
      }
      if (!rec) {
        // no drive: a record of 115 bytes whose type (after 28) is 0
        rec = new Uint8Array(115);
      }
      if (first) { o.dw(sync); first = false; }
      o.bytes(rec); tail.dw(attachDetach); edges.b8(edge).b8(active);
    });
    put('DRIVE', 1, 4, new Out().bytes(o.done()).bytes(tail.done()).bytes(edges.done()).done());
    for (const c of cpus) if (c) {
      put(c.name, 1, 1, c.data);
      const u = c.name.slice(-1);
      for (const v of [`1541VIA1D${u}`, `VIA2D${u}`]) { const m = mod(v); if (m) put(v, 2, 1, data(m).slice(0, 25)); }
    }
    // the disks: the one given, in drive 8, as its tracks' GCR bytes by half track; else those saved in the snapshot
    if (opts.disk && cpus[0]) {
      const d = isG64(opts.disk) ? g64ToDisk(opts.disk) : d64ToDisk(opts.disk), g = new Out().dw(84);
      for (let h = 0; h < 84; h++) {
        const t = d.halves ? d.halves[h + 2] : h % 2 ? null : d.tracks[h / 2 + 1];
        g.dw(t?.length ?? 0);
        if (t) g.bytes(t);
      }
      put('GCRIMAGE0', 3, 1, g.done());
      disk = true;
    } else copy('GCRIMAGE0', 3, 1);
    if (cpus[1]) copy('GCRIMAGE1', 3, 1);
  } else if (mod('DRIVE8')) notes.push('Drive 8 had no true drive emulation in VICE, so C64 Debugger turns its own off');

  // VIC-II: the light pen's trigger cycle (after 735 bytes) is a clock
  put('VIC-II', 1, 1, new Out().b8(as).bytes(vic.skip(1).bytes(734)).dw(count32(vic.clock())).bytes(vic.rest()).done());

  copy('GLUE', 1, 0);
  copy('C64MEMHACKS', 0, 0);
  const active = (n: string): number => { const m = mod(n); return m && m.size ? data(m)[0] : 0; };
  put('TAPEPORT', 0, 0, Uint8Array.of(active('TAPEPORT'), 0));
  for (const p of [0, 1]) {
    const id = active(`JOYPORT${p}`) === 1 ? 1 : 0;
    put(`JOYPORT${p}`, 0, 0, Uint8Array.of(id));
    if (id) put(`JOYSTICK${p}`, 1, 1, Uint8Array.of(0));
  }
  put('USERPORT', 0, 0, Uint8Array.of(0, 0, 0));

  // the file: magic, format 1.1, the machine, VICE's version as the snapshot has it, then the modules
  const head = vsf.slice(0, s.modules[0].offset - 22);
  head[19] = 1; head[20] = 1;
  const f = new Out().bytes(head);
  for (const m of out) {
    const n = new Uint8Array(16);
    for (let k = 0; k < m.name.length; k++) n[k] = m.name.charCodeAt(k);
    f.bytes(n).b8(m.major).b8(m.minor).dw(m.data.length + 22).bytes(m.data);
  }
  return { snap: f.done(), model, disk, notes };
}
