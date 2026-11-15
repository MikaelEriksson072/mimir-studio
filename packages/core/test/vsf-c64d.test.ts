/* A VICE 3.10 snapshot written again as C64 Debugger 0.64.58 (VICE 3.1) reads one (spec 13.2b). The layouts read here
 * are VICE 3.1's readers, from the debugger's source; the real debugger restarting such a snapshot, with its disk, was
 * checked by hand (DEVELOPMENT.md). */
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { trackSectors } from '@mimir/sindri';
import { parseVsf, snapshotForC64Debugger } from '../src';
import { prepareDebugger } from '../src/node';

const fixture = (p: string) => new Uint8Array(readFileSync(new URL(`../../../fixtures/${p}`, import.meta.url)));
const vsf = fixture('vsf/raster-demo.vsf');
const dw = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
const mod = (snap: Uint8Array, name: string) => {
  const m = parseVsf(snap).modules.find(x => x.name === name);
  return m ? { ...m, data: snap.subarray(m.offset, m.offset + m.size) } : null;
};
/** the snapshot with a module's bytes changed */
const patched = (name: string, change: (d: Uint8Array) => void): Uint8Array => {
  const out = vsf.slice(), m = parseVsf(out).modules.find(x => x.name === name)!;
  change(out.subarray(m.offset, m.offset + m.size));
  return out;
};

describe('a VICE 3.10 snapshot for C64 Debugger', () => {
  const was = parseVsf(vsf), r = snapshotForC64Debugger(vsf, 'raster-demo.vsf'), now = parseVsf(r.snap);

  it('is format 1.1 of the same machine and VICE version, with the modules VICE 3.1 reads, at its versions', () => {
    expect(was.version).toEqual([2, 0]);
    expect(now).toMatchObject({ version: [1, 1], machine: 'C64SC', vice: was.vice });
    expect(now.modules.map(m => `${m.name} ${m.major}.${m.minor} ${m.size}`)).toEqual([
      'MAINCPU 1.1 59', 'C64MEM 0.1 65555', 'C64CART 0.1 1', 'CIA1 2.2 45', 'CIA2 2.2 45', 'SID 1.3 35', 'SIDEXTENDED 1.3 133',
      'DRIVE 1.4 246', 'DRIVECPU0 1.1 2111', '1541VIA1D0 2.1 25', 'VIA2D0 2.1 25', 'VIC-II 1.1 123411', 'GLUE 1.0 3', 'C64MEMHACKS 0.0 1',
      'TAPEPORT 0.0 2', 'JOYPORT0 0.0 1', 'JOYSTICK0 1.1 1', 'JOYPORT1 0.0 1', 'JOYSTICK1 1.1 1', 'USERPORT 0.0 3',
    ]);
    expect(r.disk).toBe(false);
  });

  it('keeps the RAM, the CPU port and the CPU where they were', () => {
    expect(now.ram).toEqual(was.ram);
    expect(now.port).toEqual(was.port);
    expect(now.cpu).toEqual(was.cpu);
    expect(now.cia2).toEqual(was.cia2);
    expect(now.sid).toEqual(was.sid);
  });

  it('writes the CPU clock and the interrupt clocks in 32 bits, without the newer fields', () => {
    const a = mod(vsf, 'MAINCPU')!.data, b = mod(r.snap, 'MAINCPU')!.data;
    expect(dw(b, 0)).toBe(dw(a, 0));
    expect(dw(a, 4)).toBe(0);
    // registers and the last opcode, then the BA flags (after ane, lxa and jammed in VICE 3.10)
    expect(b.subarray(4, 15)).toEqual(a.subarray(8, 19));
    expect(dw(b, 15)).toBe(dw(a, 31));
    // irq, nmi and pending clocks, the stolen cycles and their clock; nirq, nnmi, pending; the two delays
    for (let k = 0; k < 5; k++) expect(dw(b, 19 + 4 * k)).toBe(dw(a, 35 + 8 * k));
    expect(b.subarray(39, 51)).toEqual(a.subarray(75, 87));
    expect([dw(b, 51), dw(b, 55)]).toEqual([dw(a, 87), dw(a, 95)]);
  });

  it('writes the CIAs with a 32-bit TOD clock, and the VIC-II with a 32-bit light pen cycle and the 6569 as its model', () => {
    for (const n of ['CIA1', 'CIA2']) {
      const a = mod(vsf, n)!.data, b = mod(r.snap, n)!.data;
      expect(b.subarray(0, 33)).toEqual(a.subarray(0, 33));
      expect(dw(b, 33)).toBe(dw(a, 33));
      expect(b.subarray(37, 45)).toEqual(a.subarray(41, 49));
    }
    const a = mod(vsf, 'VIC-II')!.data, b = mod(r.snap, 'VIC-II')!.data;
    expect([a[0], b[0]]).toEqual([1, 0]);
    expect(r.model).toBe('6569 (C64 PAL)');
    expect(r.notes).toEqual([expect.stringMatching(/of a 8565 \(C64C PAL\); it is written as a 6569/)]);
    expect(b.subarray(1, 735)).toEqual(a.subarray(1, 735));
    // the registers, the colour RAM (after 761 bytes in VICE 3.10, 757 here) and the rest
    expect(b.subarray(739)).toEqual(a.subarray(743));
    expect(b.subarray(757, 757 + 1024)).toEqual(a.subarray(761, 761 + 1024));
  });

  it('puts drive 8 and no drive 9 in one DRIVE module, with the drive CPU, its RAM and its VIAs', () => {
    const a = mod(vsf, 'DRIVE8')!.data, b = mod(r.snap, 'DRIVE')!.data;
    // the video standard, then drive 8: half track, the head's offset, the 1541-II as its type (after 28 bytes)
    expect(dw(b, 0)).toBe(dw(a, 2));
    expect([b[4 + 6], b[4 + 7]]).toEqual([a[6 + 10], a[6 + 11]]);
    expect(dw(b, 4 + 15)).toBe(dw(a, 6 + 21));
    expect(dw(b, 4 + 28)).toBe(1542);
    // drive 9: none
    expect(dw(b, 4 + 115 + 28)).toBe(0);
    const ca = mod(vsf, 'DRIVECPU0')!.data, cb = mod(r.snap, 'DRIVECPU0')!.data;
    expect(dw(cb, 0)).toBe(dw(ca, 0));
    expect(cb.subarray(4, 15)).toEqual(ca.subarray(8, 19));
    // the drive's 2 KB of RAM, after the interrupt clocks
    expect(cb.subarray(51, 51 + 0x800)).toEqual(ca.subarray(92, 92 + 0x800));
    expect(mod(r.snap, 'VIA2D0')!.data).toEqual(mod(vsf, 'VIA2D0')!.data.subarray(0, 25));
  });

  it('writes one SID with the sound on and the engine\'s state as it is, and a joystick with nothing pressed', () => {
    const a = mod(vsf, 'SID')!.data, b = mod(r.snap, 'SID')!.data;
    expect([...b.subarray(0, 3)]).toEqual([0, 1, a[2]]);
    expect(b.subarray(3)).toEqual(a.subarray(4));
    expect(mod(r.snap, 'SIDEXTENDED')!.data).toEqual(mod(vsf, 'SIDEXTENDED')!.data);
    expect([...mod(r.snap, 'JOYPORT1')!.data, ...mod(r.snap, 'JOYSTICK1')!.data]).toEqual([1, 0]);
    expect(mod(r.snap, 'KEYBOARD')).toBeNull();
  });

  it('puts a disk in the snapshot as drive 8\'s, its tracks as GCR bytes by half track', () => {
    const d64 = fixture('d64/mimir-demo.d64'), w = snapshotForC64Debugger(vsf, 'raster-demo.vsf', { disk: d64 });
    expect(w.disk).toBe(true);
    const g = mod(w.snap, 'GCRIMAGE0')!;
    expect([g.major, g.minor, dw(g.data, 0)]).toEqual([3, 1, 84]);
    const tracks: (Uint8Array | null)[] = [];
    for (let h = 0, p = 4; h < 84; h++) { const n = dw(g.data, p); tracks.push(n ? g.data.subarray(p + 4, p + 4 + n) : null); p += 4 + n; }
    // whole tracks 1-35, no half tracks; track 18's sector 0 is the D64's BAM
    expect(tracks.map(t => !!t)).toEqual(Array.from({ length: 84 }, (_, h) => h % 2 === 0 && h < 70));
    const bam = trackSectors(tracks[34], 18).find(x => x.sector === 0)!;
    expect(bam.data).toEqual(d64.subarray(357 * 256, 358 * 256));
  });

  it('moves the clocks back when they no longer fit in 31 bits, each as far from the CPU\'s clock as it was', () => {
    // 2^33 cycles later: the CPU's clock and the interrupts' (those that are set)
    const late = patched('MAINCPU', d => { for (const at of [0, 35, 43, 51, 67]) if (dw(d, at) || dw(d, at + 4)) d[at + 4] += 2; });
    const a = mod(vsf, 'MAINCPU')!.data, b = mod(snapshotForC64Debugger(late).snap, 'MAINCPU')!.data;
    expect(dw(b, 0)).toBe(0x01000000);
    for (let k = 0; k < 3; k++) if (dw(a, 35 + 8 * k)) expect(dw(b, 0) - dw(b, 19 + 4 * k)).toBe(dw(a, 0) - dw(a, 35 + 8 * k));
    // a clock that is "never" stays so
    const never = patched('MAINCPU', d => d.fill(0xff, 35, 43));
    expect(dw(mod(snapshotForC64Debugger(never).snap, 'MAINCPU')!.data, 19)).toBe(0xffffffff);
  });

  it('passes a snapshot of format 1.x on as it is, and refuses x64\'s, a cartridge and what is no snapshot', () => {
    const old = vsf.slice(); old[19] = 1; old[20] = 1;
    expect(snapshotForC64Debugger(old)).toMatchObject({ snap: old, model: '8565 (C64C PAL)', disk: false, notes: [] });
    const x64 = vsf.slice(); x64[24] = 0;
    expect(() => snapshotForC64Debugger(x64, 'a.vsf')).toThrow(/a\.vsf was saved by x64 .*save it in x64sc/);
    expect(() => snapshotForC64Debugger(patched('C64CART', d => { d[0] = 1; }), 'a.vsf')).toThrow(/has a cartridge attached/);
    expect(() => snapshotForC64Debugger(patched('SID', d => { d[2] = 5; }), 'a.vsf')).toThrow(/SID engine C64 Debugger does not have/);
    expect(() => snapshotForC64Debugger(new Uint8Array(100), 'a.vsf')).toThrow(/not a VICE snapshot/);
  });
});

describe('Build & Run of a snapshot in a debugger', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mimir-snap-'));
  const path = join(dir, 'demo.prg.vsf'), disk = join(dir, 'd.d64'), labels = join(dir, 'demo.vs');
  writeFileSync(path, vsf);
  writeFileSync(disk, fixture('d64/mimir-demo.d64'));

  it('C64 Debugger gets the snapshot written for it next to the .vsf, passed to a running debugger and given again', async () => {
    const p = await prepareDebugger({ kind: 'c64d', exe: 'x', args: ['-layout', '2'], prgPath: path, labelsPath: labels, disk, tape: join(dir, 't.tap'), wait: 2000 });
    const snap = join(dir, 'demo.prg.c64d.snap');
    expect(p.argv).toEqual(['-layout', '2', '-pass', '-symbols', labels, '-snapshot', snap]);
    expect(p).toMatchObject({ via: 'snapshot', snapshot: { path: snap, model: '6569 (C64 PAL)', disk: true }, again: 5000 });
    expect(new Uint8Array(readFileSync(snap))).toEqual(snapshotForC64Debugger(vsf, 'demo.prg.vsf', { disk: fixture('d64/mimir-demo.d64') }).snap);
    expect(p.notes).toEqual([
      expect.stringMatching(/written as a 6569/),
      expect.stringMatching(/^The disk is in the snapshot, as drive 8 had it/),
      expect.stringMatching(/^The tape is not in the datasette/),
      expect.stringMatching(/C64 model must be the 6569 \(C64 PAL\)/),
    ]);
  });

  it('a disk that is no D64 or G64 is left out with a note, and Retro Debugger is refused', async () => {
    const p = await prepareDebugger({ kind: 'c64d', exe: 'x', prgPath: path, disk: join(dir, 'd.d81') });
    expect(p.snapshot!.disk).toBe(false);
    expect(p.notes).toContainEqual(expect.stringMatching(/^The disk is not in drive 8 .*only a D64 or a G64/));
    await expect(prepareDebugger({ kind: 'retro', exe: 'x', prgPath: path })).rejects.toThrow(/Retro Debugger cannot restart a VICE snapshot.*C64 Debugger does/);
  });
});
