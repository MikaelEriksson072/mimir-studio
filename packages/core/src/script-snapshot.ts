/* =====================================================================
 * The VICE snapshot for a JavaScript script (spec 10.3, 13.7), as `snapshot`: the C64, its VIC-II and its disk drive
 * as they were when the snapshot was saved, read and changed. null when the project was not opened from a snapshot.
 *
 *   snapshot.name, machine, vice, format   the file, "C64SC", the VICE version that wrote it, the snapshot format
 *   snapshot.modules, snapshot.module(name)   the modules it is made of; a module's bytes, to read and to write
 *   snapshot.cpu      { pc, a, x, y, sp, status, flags }
 *   snapshot.port     { data, dir, config }: the 6510 port ($01, $00) and the memory configuration it gives
 *   snapshot.ram      all 64 KB of RAM, the zero page, the stack and the RAM under ROM and I/O too
 *   snapshot.cia1, snapshot.cia2   { pra, prb, ddra, ddrb, timerA, timerB, latchA, latchB, tod, sdr, mask, cra, crb, flags }
 *   snapshot.sid      { regs, volume }: the registers $d400-$d418 as last written
 *   snapshot.vic      { model, regs, colorRam, line, cycle, irqLine, irqFlags } and what the registers come to:
 *                     bank, mode, screenAt, charsetAt, bitmapAt, charRom, displayOn, rows, cols, border, background,
 *                     sprites
 *   snapshot.drive    drive 8: { type, model, halfTrack, track, cpu, ram (its 2 KB), via1, via2, motor, led }
 *   snapshot.changes  what the script has changed so far, a text a module
 *   snapshot.file()   the snapshot as the script has it now: the bytes of a .vsf
 *   snapshot.write()  asks for the project's snapshot to be the one the script has now
 *
 * What is read is the script's own copy of the snapshot, and what is set goes into that copy: `snapshot.cpu.pc =
 * 0x1000`, `snapshot.vic.regs[0x20] = 0`, `snapshot.drive.ram[0x22] = 18`. Nothing of the project changes before the
 * run has ended well and `snapshot.write()` was called: then the app keeps the changed snapshot with the file, so that
 * Build & Run restarts that one (the built program in its RAM), the analysis reads its VIC-II and the overview shows
 * it. The RAM the program has is the program's own (`mem`): Build & Run puts the built program there.
 *
 * The modules as x64sc writes them (VICE 3.x): C64MEM, MAINCPU, CIA1/CIA2, SID and VIC-II as c64/vsf.ts and Sindri's
 * vsf.ts read them; the drive's, measured against VICE 3.10's monitor:
 *   DRIVE8      (2.0) the half track the head is on (word at 16), the drive's type (dword at 40: 1541, 1542 a 1541-II, …)
 *   DRIVECPU0   (1.3) the clock, A, X, Y, SP, PC (word), status; the drive's 2 KB of RAM 92 bytes in
 *   1541VIA1D0, VIA2D0 (2.2) PRA, DDRA, PRB, DDRB, timer 1's latch and counter (words), timer 2's counter (word
 *               at 12), SR, ACR, PCR, IFR, IER (at 15 on)
 * ===================================================================== */
import { parseVsf, type VsfModule } from './c64/vsf';
import { vicState } from './c64/vicscreen';
import { h2, h4 } from './util/hex';

/** the project's snapshot as it is now, for `snapshot` */
export interface ScriptSnapshotData { name: string; vsf: Uint8Array }
/** what a script asked for with snapshot.write(): the snapshot it made, and what it changed in it */
export interface ScriptSnapshotRequest { name: string; vsf: Uint8Array; changes: string[] }

/** a request in a line: what would be (or was) kept */
export const snapshotRequestText = (r: ScriptSnapshotRequest): string => `${r.name}: ${r.changes.length ? r.changes.join('; ') : 'as it was'}`;

const DRIVE_TYPES: Record<number, string> = { 1540: '1540', 1541: '1541', 1542: '1541-II', 1551: '1551', 1570: '1570', 1571: '1571', 1573: '1571CR', 1581: '1581', 2000: 'FD-2000', 4000: 'FD-4000', 4844: 'CMD HD' };

/** `snapshot` for a script: null without a snapshot; `asked` takes what snapshot.write() asks for */
export function snapshotApi(data: ScriptSnapshotData | null, ctx: { addr: (where: unknown) => number }, asked: (r: ScriptSnapshotRequest) => void): Record<string, unknown> | null {
  if (!data) return null;
  let s;
  try { s = parseVsf(data.vsf, data.name); } catch { return null; }
  const orig = data.vsf, b = data.vsf.slice();
  const mod = (name: string): VsfModule | undefined => s.modules.find(m => m.name === name);
  const clk = s.version[0] >= 2 ? 8 : 4;
  const int = (v: unknown, top: number, what: string): number => {
    const n = typeof v === 'boolean' ? +v : Number(v);
    if (!Number.isInteger(n) || n < 0 || n > top) throw new RangeError(`snapshot: ${what} is 0 to $${top.toString(16)} (not ${String(v)})`);
    return n;
  };
  /** an object whose fields are bytes, words and dwords of the copy, low byte first, read and set in place */
  const fields = (base: number, def: Record<string, [at: number, size: 1 | 2 | 4, mask?: number]>, what: string, more: PropertyDescriptorMap = {}): Record<string, unknown> => {
    const o: Record<string, unknown> = {};
    for (const [k, [at, size, mask]] of Object.entries(def)) Object.defineProperty(o, k, {
      enumerable: true,
      get: () => { let v = 0; for (let i = size - 1; i >= 0; i--) v = v * 256 + b[base + at + i]; return mask != null ? v & mask : v; },
      set: (v: unknown) => { let n = int(k === 'pc' ? ctx.addr(v) : v, mask ?? 256 ** size - 1, `${what}.${k}`); for (let i = 0; i < size; i++) { b[base + at + i] = n & 0xff; n = Math.floor(n / 256); } },
    });
    Object.defineProperties(o, more);
    return Object.freeze(o) as Record<string, unknown>;
  };
  const view = (at: number, n: number): Uint8Array => b.subarray(at, at + n);
  const ro = (get: () => unknown): PropertyDescriptor => ({ enumerable: true, get });
  const flagsText = (p: number) => [...'NV-BDIZC'].map((c, i) => (p & (0x80 >> i) ? c : '.')).join('');

  /* ---- the C64 ---- */
  const mem = mod('C64MEM')!, cpuM = mod('MAINCPU'), c0 = (cpuM?.offset ?? 0) + clk;
  const cpu = cpuM && cpuM.size >= clk + 7 ? fields(c0, { a: [0, 1], x: [1, 1], y: [2, 1], sp: [3, 1], pc: [4, 2], status: [6, 1] }, 'cpu', { flags: ro(() => flagsText(b[c0 + 6])) }) : null;
  const port = fields(mem.offset, { data: [0, 1], dir: [1, 1] }, 'port', { config: ro(() => ((b[mem.offset] & b[mem.offset + 1]) | (~b[mem.offset + 1] & 0xff)) & 7) });
  const ram = view(mem.offset + 4, 0x10000);
  const cia = (name: string) => {
    const m = mod(name);
    if (!m || m.major !== 2 || m.size < 21) return null;
    return fields(m.offset, { pra: [0, 1], prb: [1, 1], ddra: [2, 1], ddrb: [3, 1], timerA: [4, 2], timerB: [6, 2], sdr: [12, 1], mask: [13, 1], cra: [14, 1], crb: [15, 1], latchA: [16, 2], latchB: [18, 2], flags: [20, 1] }, name.toLowerCase(),
      { tod: { enumerable: true, value: view(m.offset + 8, 4) } });
  };
  const cia1 = cia('CIA1'), cia2 = cia('CIA2');
  const sidM = mod('SID'), sidAt = sidM ? sidM.offset + (sidM.minor < 4 ? 3 : 4) : 0;
  const sid = sidM && sidM.major === 1 && sidM.size >= sidAt - sidM.offset + 0x19
    ? Object.freeze(Object.defineProperties({}, { regs: { enumerable: true, value: view(sidAt, 0x19) }, volume: { enumerable: true, get: () => b[sidAt + 0x18] & 15, set: (v: unknown) => { b[sidAt + 0x18] = (b[sidAt + 0x18] & 0xf0) | int(v, 15, 'sid.volume'); } } })) : null;

  /* ---- the VIC-II ---- */
  const vic = (() => {
    const m = mod('VIC-IISC') ?? mod('VIC-II');
    if (!m || m.major !== 1 || !s.vic) return null;
    const sc = m.name === 'VIC-IISC' || s.machine !== 'C64';
    const o = m.offset, regsAt = o + (sc ? 1 : 1119), colorAt = o + (sc ? 753 + clk : 43);
    const regs = view(regsAt, 0x40), colorRam = view(colorAt, 0x400);
    const bank = () => (cia2 ? 3 - ((((cia2.pra as number) & (cia2.ddra as number)) | (~(cia2.ddra as number) & 0xff)) & 3) : 0);
    const st = () => vicState(regs, bank(), ram);
    const colour = (reg: number, what: string): PropertyDescriptor => ({ enumerable: true, get: () => regs[reg] & 15, set: (v: unknown) => { regs[reg] = int(v, 15, `vic.${what}`); } });
    const sprite = (n: number) => {
      const bit = 1 << n;
      const flag = (reg: number, what: string): PropertyDescriptor => ({ enumerable: true, get: () => !!(regs[reg] & bit), set: (v: unknown) => { void what; regs[reg] = v ? regs[reg] | bit : regs[reg] & ~bit; } });
      return Object.freeze(Object.defineProperties({}, {
        n: { enumerable: true, value: n },
        on: flag(0x15, 'on'), mc: flag(0x1c, 'mc'), wide: flag(0x1d, 'wide'), tall: flag(0x17, 'tall'), behind: flag(0x1b, 'behind'),
        x: { enumerable: true, get: () => regs[n * 2] | (regs[0x10] & bit ? 0x100 : 0), set: (v: unknown) => { const x = int(v, 0x1ff, 'a sprite\'s x'); regs[n * 2] = x & 0xff; regs[0x10] = x & 0x100 ? regs[0x10] | bit : regs[0x10] & ~bit; } },
        y: { enumerable: true, get: () => regs[n * 2 + 1], set: (v: unknown) => { regs[n * 2 + 1] = int(v, 0xff, 'a sprite\'s y'); } },
        color: colour(0x27 + n, 'a sprite\'s color'),
        // its pointer is in the screen's last bytes, in RAM
        pointer: { enumerable: true, get: () => st().sprites[n].ptr, set: (v: unknown) => { ram[(st().screen + 0x3f8 + n) & 0xffff] = int(v, 0xff, 'a sprite\'s pointer'); } },
        dataAt: ro(() => st().sprites[n].addr),
      }));
    };
    const sprites = Object.freeze(Array.from({ length: 8 }, (_, n) => sprite(n)));
    const irqLineAt = sc ? o + 79 : -1;
    return Object.freeze(Object.defineProperties({}, {
      model: { enumerable: true, value: s.vic.model }, regs: { enumerable: true, value: regs }, colorRam: { enumerable: true, value: colorRam },
      line: { enumerable: true, value: s.vic.line }, cycle: { enumerable: true, value: s.vic.cycle },
      irqLine: { enumerable: true,
        get: () => (sc ? (b[irqLineAt] | (b[irqLineAt + 1] << 8)) & 0x1ff : regs[0x12] | ((regs[0x11] & 0x80) << 1)),
        // (the compare line is in $d012 and bit 7 of $d011 too)
        set: (v: unknown) => { const n = int(v, 0x1ff, 'vic.irqLine'); if (sc) { b[irqLineAt] = n & 0xff; b[irqLineAt + 1] = n >> 8; b[irqLineAt + 2] = 0; b[irqLineAt + 3] = 0; } regs[0x12] = n & 0xff; regs[0x11] = (regs[0x11] & 0x7f) | (n & 0x100 ? 0x80 : 0); } },
      irqFlags: { enumerable: true, get: () => b[o + (sc ? 78 : 1193)], set: (v: unknown) => { b[o + (sc ? 78 : 1193)] = int(v, 0xff, 'vic.irqFlags'); } },
      bank: ro(bank), mode: ro(() => st().mode), screenAt: ro(() => st().screen), charsetAt: ro(() => st().charset), bitmapAt: ro(() => st().bitmap), charRom: ro(() => st().charRom),
      displayOn: { enumerable: true, get: () => !!(regs[0x11] & 0x10), set: (v: unknown) => { regs[0x11] = v ? regs[0x11] | 0x10 : regs[0x11] & ~0x10; } },
      rows: ro(() => st().rows), cols: ro(() => st().cols),
      border: colour(0x20, 'border'), background: colour(0x21, 'background'),
      sprites: { enumerable: true, value: sprites },
    }));
  })();

  /* ---- the disk drive (drive 8) ---- */
  const drive = (() => {
    const d = mod('DRIVE8'), c = mod('DRIVECPU0');
    if (!d || d.major !== 2 || d.size < 44 || !c) return null;
    const type = () => (b[d.offset + 40] | (b[d.offset + 41] << 8) | (b[d.offset + 42] << 16)) >>> 0;
    if (!type()) return null;
    const cc = c.offset + clk;
    const dcpu = c.size >= clk + 7 ? fields(cc, { a: [0, 1], x: [1, 1], y: [2, 1], sp: [3, 1], pc: [4, 2], status: [6, 1] }, 'drive.cpu', { flags: ro(() => flagsText(b[cc + 6])) }) : null;
    // (the 2 KB of a 1540, 1541, 1541-II, 1570 or 1571, where VICE 3.x's module has them)
    const dram = c.major === 1 && clk === 8 && c.size === 2152 ? view(c.offset + 92, 0x800) : null;
    const via = (name: string, what: string) => {
      const m = mod(name);
      return m && m.major === 2 && m.size >= 20 ? fields(m.offset, { pra: [0, 1], ddra: [1, 1], prb: [2, 1], ddrb: [3, 1], latch1: [4, 2], timer1: [6, 2], timer2: [12, 2], sr: [15, 1], acr: [16, 1], pcr: [17, 1], ifr: [18, 1], ier: [19, 1] }, what) : null;
    };
    const via1 = via('1541VIA1D0', 'drive.via1'), via2 = via('VIA2D0', 'drive.via2');
    const half = (): number => b[d.offset + 16] | (b[d.offset + 17] << 8);
    return Object.freeze(Object.defineProperties({}, {
      unit: { enumerable: true, value: 8 }, type: ro(type), model: ro(() => DRIVE_TYPES[type()] ?? String(type())),
      halfTrack: { enumerable: true, get: half, set: (v: unknown) => { const n = int(v, 84, 'drive.halfTrack'); if (n < 2) throw new RangeError('snapshot: drive.halfTrack is 2 (track 1) to 84 (track 42)'); b[d.offset + 16] = n; b[d.offset + 17] = 0; } },
      track: { enumerable: true, get: () => half() / 2, set: (v: unknown) => { const n = Number(v) * 2; if (!Number.isInteger(n) || n < 2 || n > 84) throw new RangeError(`snapshot: drive.track is 1 to 42, in halves (not ${String(v)})`); b[d.offset + 16] = n; b[d.offset + 17] = 0; } },
      cpu: { enumerable: true, value: dcpu }, ram: { enumerable: true, value: dram }, via1: { enumerable: true, value: via1 }, via2: { enumerable: true, value: via2 },
      // VIA 2's port B as the drive's code set it: bit 2 the motor, bit 3 the LED
      motor: ro(() => (via2 ? !!((via2.prb as number) & 4) : null)), led: ro(() => (via2 ? !!((via2.prb as number) & 8) : null)),
    }));
  })();

  /* ---- the snapshot ---- */
  const changes = (): string[] => {
    const out: string[] = [];
    for (const m of s.modules) {
      let n = 0, first = -1;
      for (let i = 0; i < m.size; i++) if (b[m.offset + i] !== orig[m.offset + i]) { n++; if (first < 0) first = i; }
      if (!n) continue;
      const what = m.name === 'C64MEM' && first >= 4 ? `RAM from $${h4(first - 4)}` : m.name === 'MAINCPU' ? `the CPU, now at $${h4(b[c0 + 4] | (b[c0 + 5] << 8))}` : m.name === 'C64MEM' ? `the port, $01 = $${h2(b[mem.offset])}` : null;
      out.push(`${m.name}: ${n} byte${n === 1 ? '' : 's'} changed${what ? ` (${what})` : ''}`);
    }
    return out;
  };
  const modules = Object.freeze(s.modules.map(m => Object.freeze({ name: m.name, version: `${m.major}.${m.minor}`, size: m.size, offset: m.offset })));
  return Object.freeze({
    name: data.name, machine: s.machine, vice: s.vice, format: `${s.version[0]}.${s.version[1]}`, size: b.length,
    modules,
    module(name: unknown): Uint8Array {
      const m = mod(String(name));
      if (!m) throw new ReferenceError(`snapshot.module: the snapshot has no module "${String(name)}" (it has ${s.modules.map(x => x.name).join(', ')})`);
      return view(m.offset, m.size);
    },
    has: (name: unknown) => !!mod(String(name)),
    cpu, port, ram, cia1, cia2, sid, vic, drive,
    get changes() { return changes(); },
    get changed() { return changes().length > 0; },
    file: (): Uint8Array => b.slice(),
    /** the copy as it was when the run started again */
    reset() { b.set(orig); },
    write(): string[] {
      const c = changes();
      asked({ name: data.name, vsf: b.slice(), changes: c });
      return c;
    },
  });
}
