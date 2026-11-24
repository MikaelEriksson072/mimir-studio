/* The VICE snapshot for a JavaScript script (spec 10.3, 13.7): the C64, the VIC-II and the drive as they were saved,
 * read and changed, and the snapshot a run asks the project to keep. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openC64File, parseVsf, runJs, snapshotRequestText, snapshotVicBank, type ScriptEnv, type UserScript } from '../src';

const vsf = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/vsf/raster-demo.vsf')));
const sprites = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/vsf/vic-sprites.vsf')));
const opened = openC64File('raster-demo.vsf', vsf);
const env: ScriptEnv = { files: [opened], names: new Map([['irq', 0x08b7]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const run = (lines: string[], file = vsf) => runJs(env, js(lines), { snapshot: { name: 'raster-demo.vsf', vsf: file } });

describe('snapshot in a JavaScript script', () => {
  it('says what the snapshot is and what the C64 was doing', () => {
    const r = run([
      'print(snapshot.name, snapshot.machine, snapshot.vice, snapshot.format, snapshot.size, snapshot.modules.length, snapshot.modules[0].name, snapshot.modules[0].version, snapshot.has("C64MEM"), snapshot.has("REU"));',
      'const c = snapshot.cpu;', 'print(hex(c.pc), hex(c.a, 2), hex(c.x, 2), hex(c.y, 2), hex(c.sp, 2), hex(c.status, 2), c.flags);',
      'print(hex(snapshot.port.data, 2), hex(snapshot.port.dir, 2), snapshot.port.config, snapshot.ram.length, hex(word(0x0314)) === hex(snapshot.ram[0x0314] | snapshot.ram[0x0315] << 8), snapshot.ram[0x0801] === mem[0x0801]);',
      'print(hex(snapshot.cia2.pra, 2), hex(snapshot.cia2.ddra, 2), snapshot.cia1.tod.length, hex(snapshot.cia1.latchA), snapshot.cia1.mask, snapshot.sid.regs.length, snapshot.sid.volume);',
      'print(snapshot.module("MAINCPU").length, snapshot.changed, snapshot.changes.length);',
      'try { snapshot.module("NOPE"); } catch (e) { print(e.message.slice(0, 60)); }',
    ]);
    expect(r.error).toBeUndefined();
    const s = parseVsf(vsf);
    expect(r.prints).toEqual([
      `raster-demo.vsf C64SC ${s.vice} 2.0 ${vsf.length} ${s.modules.length} MAINCPU 1.4 true false`,
      `$08c7 $${s.cpu!.a.toString(16).padStart(2, '0')} $${s.cpu!.x.toString(16).padStart(2, '0')} $${s.cpu!.y.toString(16).padStart(2, '0')} $${s.cpu!.sp.toString(16).padStart(2, '0')} $${s.cpu!.status.toString(16).padStart(2, '0')} ${[...'NV-BDIZC'].map((c, i) => (s.cpu!.status & (0x80 >> i) ? c : '.')).join('')}`,
      '$37 $2f 7 65536 true true',
      `$${s.cia2!.pra.toString(16).padStart(2, '0')} $${s.cia2!.ddra.toString(16).padStart(2, '0')} 4 $4025 0 25 ${s.sid![0x18] & 15}`,
      '103 false 0',
      'snapshot.module: the snapshot has no module "NOPE" (it has M',
    ]);
    expect(r.snapshot).toBeUndefined();
  });

  it('reads the VIC-II: its registers, what they come to, and the sprites', () => {
    const r = run([
      'const v = snapshot.vic;',
      'print(v.model, v.regs.length, v.colorRam.length, v.line, v.cycle, v.irqLine, v.irqFlags, v.bank, v.mode, hex(v.screenAt), hex(v.charsetAt), hex(v.bitmapAt), v.charRom, v.displayOn, v.rows, v.cols, v.border, v.background);',
      'print(v.sprites.length, v.sprites.filter(s => s.on).map(s => s.n + ":" + s.x + "," + s.y + " c" + s.color + (s.mc ? " mc" : "") + " p" + s.pointer + " " + hex(s.dataAt)).join(" | "));',
    ], sprites);
    expect(r.error).toBeUndefined();
    const s = parseVsf(sprites), v = s.vic!;
    const on = [0, 1, 2, 3, 4, 5, 6, 7].filter(n => v.regs[0x15] & (1 << n));
    expect(on.length).toBeGreaterThan(0);
    expect(r.prints![0]).toBe(`${v.model} 64 1024 ${v.line} ${v.cycle} ${v.irqLine} ${v.irqFlags} ${snapshotVicBank(s)} mc-text $0400 $3000 $2000 false true 24 38 ${v.regs[0x20] & 15} ${v.regs[0x21] & 15}`);
    expect(r.prints![1].startsWith(`8 ${on[0]}:${v.regs[on[0] * 2] | (v.regs[0x10] & (1 << on[0]) ? 256 : 0)},${v.regs[on[0] * 2 + 1]} c${v.regs[0x27 + on[0]] & 15}`)).toBe(true);
    expect(r.prints![1].split(' | ')).toHaveLength(on.length);
  });

  it('reads the disk drive: its type, where its head is, its CPU, its RAM and its VIAs', () => {
    const r = run([
      'const d = snapshot.drive;',
      'print(d.unit, d.type, d.model, d.halfTrack, d.track, hex(d.cpu.pc), hex(d.cpu.sp, 2), d.cpu.flags.length, d.ram.length, hex(d.via1.ddrb, 2), hex(d.via2.ddrb, 2), hex(d.via2.pcr, 2), d.motor, d.led);',
    ]);
    expect(r.error).toBeUndefined();
    // a 1541-II idle after its reset, as VICE 3.10 has it: in its idle loop at $ebff-$ec9b, the head half a track past 18
    const p = r.prints![0].split(' ');
    expect(p.slice(0, 5)).toEqual(['8', '1542', '1541-II', '37', '18.5']);
    expect(parseInt(p[5].slice(1), 16)).toBeGreaterThanOrEqual(0xebff);
    expect(parseInt(p[5].slice(1), 16)).toBeLessThan(0xed00);
    expect(p.slice(6)).toEqual(['$45', '8', '2048', '$1a', '$6f', '$ec', 'false', 'false']);
  });

  it('changes its own copy, and the project\'s snapshot only when it is asked for', () => {
    const r = run([
      'snapshot.cpu.pc = "irq"; snapshot.cpu.a = 0x12; snapshot.port.data = 0x35;',
      'snapshot.ram[0x00fb] = 0x99; snapshot.vic.border = 2; snapshot.vic.background = 6; snapshot.vic.colorRam[0] = 7; snapshot.vic.irqLine = 0x130;',
      'snapshot.vic.sprites[3].x = 300; snapshot.vic.sprites[3].on = true; snapshot.vic.sprites[3].color = 5;',
      'snapshot.cia1.latchA = 0x1234; snapshot.sid.volume = 9; snapshot.drive.track = 1; snapshot.drive.ram[0x22] = 1; snapshot.drive.cpu.pc = 0xeaa0; snapshot.drive.via2.prb = 0xff;',
      'print(hex(snapshot.cpu.pc), snapshot.port.config, snapshot.vic.border, snapshot.vic.irqLine, hex(snapshot.vic.regs[0x12], 2), snapshot.vic.regs[0x11] >> 7, snapshot.vic.sprites[3].x, snapshot.vic.regs[0x10] & 8, snapshot.drive.halfTrack, snapshot.drive.led);',
      'snapshot.changes.forEach(c => print(c));',
      'const file = snapshot.file();', 'print(file.length, snapshot.changed);',
      'for (const f of [() => { snapshot.cpu.a = 256; }, () => { snapshot.vic.border = 16; }, () => { snapshot.drive.track = 50; }, () => { snapshot.cpu.pc = "nowhere"; }]) try { f(); } catch (e) { print(e.message); }',
      'snapshot.write();',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      '$08b7 5 2 304 $30 1 300 8 2 true',
      'MAINCPU: 2 bytes changed (the CPU, now at $08b7)', 'C64MEM: 2 bytes changed (the port, $01 = $35)', 'CIA1: 2 bytes changed', 'SID: 1 byte changed',
      expect.stringMatching(/^DRIVE8: 1 byte changed$/), expect.stringMatching(/^DRIVECPU0: \d bytes changed$/), 'VIA2D0: 1 byte changed', expect.stringMatching(/^VIC-II: \d+ bytes changed$/),
      `${vsf.length} true`,
      'snapshot: cpu.a is 0 to $ff (not 256)', 'snapshot: vic.border is 0 to $f (not 16)', 'snapshot: drive.track is 1 to 42, in halves (not 50)', '"nowhere" is not a name of the program or a scratchpad',
    ]);
    // the snapshot it asked to be kept is one VICE's readers read, with what was set
    const s = parseVsf(r.snapshot!.vsf);
    expect([s.cpu!.pc, s.cpu!.a, s.port.data, s.ram[0xfb], s.vic!.regs[0x20], s.vic!.regs[0x21], s.vic!.colorRam[0], s.vic!.irqLine]).toEqual([0x08b7, 0x12, 0x35, 0x99, 2, 6, 7, 0x130]);
    expect(r.snapshot!.name).toBe('raster-demo.vsf');
    expect(r.snapshot!.changes).toHaveLength(8);
    expect(snapshotRequestText(r.snapshot!)).toMatch(/^raster-demo\.vsf: MAINCPU: 2 bytes changed \(the CPU, now at \$08b7\); C64MEM/);
    // the one given is as it was
    expect(parseVsf(vsf).cpu!.pc).toBe(0x08c7);
  });

  it('is null without a snapshot, asks for nothing when the run stops with an error, and reset() takes the changes back', () => {
    expect(runJs(env, js(['print(snapshot);'])).prints).toEqual(['null']);
    expect(runJs(env, js(['print(snapshot);']), { snapshot: { name: 'x.vsf', vsf: Uint8Array.of(1, 2, 3) } }).prints).toEqual(['null']);
    const bad = run(['snapshot.cpu.a = 1;', 'snapshot.write();', 'throw new Error("no");']);
    expect(bad.snapshot).toBeUndefined();
    const back = run(['snapshot.cpu.a = (snapshot.cpu.a + 1) & 255;', 'snapshot.reset();', 'print(snapshot.changed);', 'print(snapshot.write().length);']);
    expect(back.prints).toEqual(['false', '0']);
    expect(back.snapshot!.changes).toEqual([]);
  });
});
