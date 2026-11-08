/* VICE snapshots: vsfMachine reads the machine a .vsf holds, and a run goes on from it (resume). The snapshot is taken
 * of a program packed twice with a wait for a key between, as a cracked game's trainer menu waits in front of the
 * packed game: going on from the wait, the keys Sindri presses get past it, and the program behind it is unpacked. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isVsf, unpack, vsfMachine, type MachineState } from '../src/index.ts';
import { findRoms } from '../src/node.ts';
import { asm, byteLines } from './asm.ts';
import { pack, PROGRAM } from './packers.ts';
import { writeVsf } from './vsf.ts';

const roms = findRoms();

/** $07f8: cli, wait for a key (GETIN), then the program packed by pack() from its stub at $080d; packed once more */
const inner = pack(PROGRAM).prg;
const menu = asm(`
* = $07f8
       cli
wait:  jsr $ffe4
       beq wait
       jmp $080d
${byteLines(inner.subarray(2))}
`);
const twice = pack(menu).prg;

describe.skipIf(!roms)('VICE snapshots', () => {
  // the machine as it waits for the key, in Sindri's run of the file
  let state: MachineState | null = null;
  unpack(twice, { roms, keys: false, maxCycles: 30_000_000, onStep: (pc, c64) => { if (pc === menu.labels.wait && !state) state = c64.save(); } });

  it('are read as the machine they hold: RAM, colour RAM, the CPU, its port, the VIC-II and both CIAs', () => {
    expect(state).not.toBeNull();
    const s = state!, vsf = writeVsf(s);
    expect(isVsf(vsf)).toBe(true);
    const m = vsfMachine(vsf);
    expect(m.ram).toEqual(s.ram);
    expect(m.color).toEqual(s.color);
    expect([m.port, m.ddr]).toEqual([s.port, s.ddr]);
    expect(m.cpu).toEqual(s.cpu);
    expect(m.vic).toMatchObject({ regs: s.vic.regs, line: s.vic.line, lineCycle: s.vic.lineCycle, compare: s.vic.compare, flags: s.vic.flags });
    for (const i of [0, 1]) {
      const { pra, prb, ddra, ddrb, ta, tb, tal, tbl, cra, crb, icr, mask, sdr } = s.cia[i];
      expect(m.cia[i]).toMatchObject({ pra, prb, ddra, ddrb, ta, tb, tal, tbl, cra, crb, icr, mask, sdr, tod: s.cia[i].tod });
    }
    expect(() => vsfMachine(new Uint8Array(100))).toThrow('not a VICE snapshot');
  });

  it('go on where they were taken: past the wait for a key to the program packed behind it', () => {
    const m = vsfMachine(writeVsf(state!));
    const file = Uint8Array.from([0x00, 0x02, ...m.ram.subarray(0x0200)]);
    const r = unpack(file, { roms, resume: m });
    expect(r.layers.map(l => [l.entry, l.kind])).toEqual([[menu.labels.wait, 'mover'], [0x0100, 'decruncher'], [0x1000, 'program']]);
    expect(r.layers[0].presses.length).toBeGreaterThan(0);
    const s = r.saved!, at = 2 + 0x1000 - s.start;
    expect(s.entry).toBe(0x1000);
    expect([...s.prg.subarray(at, at + PROGRAM.prg.length - 2)]).toEqual([...PROGRAM.prg.subarray(2)]);
  });

  it('are taken by the command line, by their header, and go on from where they were', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sindri-vsf-'));
    try {
      writeFileSync(join(dir, 'menu.snap'), writeVsf(state!));
      const r = spawnSync(process.execPath, [fileURLToPath(new URL('../src/cli.ts', import.meta.url)), 'menu.snap', '-i'], { cwd: dir, env: { ...process.env, INIT_CWD: dir }, encoding: 'utf8' });
      const out = r.stdout.split('\n');
      expect(out[0]).toBe(`menu.snap: a snapshot, the CPU at $${menu.labels.wait.toString(16).padStart(4, '0')}: $0200-$ffff (63.5 KB)`);
      expect(out.filter(l => /^layer \d/.test(l)).map(l => l.split(/\s+/).slice(0, 3).join(' '))).toEqual(['layer 0 $07f9', 'layer 1 $0100', 'layer 2 $1000']);
      expect(r.stdout).toContain('would save layer 2:');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('need the ROMs', () => {
    const m = vsfMachine(writeVsf(state!));
    const r = unpack(Uint8Array.from([0x00, 0x02, ...m.ram.subarray(0x0200)]), { roms: null, resume: m });
    expect(r.stop).toMatchObject({ reason: 'needs-rom' });
  });
});
