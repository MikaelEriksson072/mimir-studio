/* A VICE snapshot (.vsf) of a Sindri machine state, written in the layout x64sc 3.x uses for the modules Sindri reads
 * (C64MEM, MAINCPU, CIA1, CIA2, VIC-II 1.3), the rest of each module zero, for the tests of vsfMachine and resume. */
import type { Cia, MachineState } from '../src/c64.ts';

const ascii = (s: string, n: number) => { const b = new Uint8Array(n); for (let i = 0; i < s.length && i < n; i++) b[i] = s.charCodeAt(i); return b; };
const le = (v: number, n: number) => Uint8Array.from({ length: n }, (_, i) => (v >>> (8 * i)) & 0xff);

function module(name: string, major: number, minor: number, data: Uint8Array): Uint8Array {
  return Uint8Array.from([...ascii(name, 16), major, minor, ...le(22 + data.length, 4), ...data]);
}

function cia(c: Cia): Uint8Array {
  const d = new Uint8Array(77);
  d.set([c.pra, c.prb, c.ddra, c.ddrb, ...le(c.ta, 2), ...le(c.tb, 2), ...c.tod, c.sdr, c.mask, c.cra, c.crb, ...le(c.tal, 2), ...le(c.tbl, 2), c.icr]);
  return d;
}

export function writeVsf(s: MachineState): Uint8Array {
  const mem = new Uint8Array(4 + 0x10000 + 19);
  mem.set([s.port, s.ddr, 0, 0]); mem.set(s.ram, 4);
  const cpu = new Uint8Array(8 + 7 + 10);
  cpu.set([s.cpu.a, s.cpu.x, s.cpu.y, s.cpu.s, ...le(s.cpu.pc, 2), s.cpu.p], 8);
  const vic = new Uint8Array(761 + 0x400 + 64);
  vic[0] = 1; vic.set(s.vic.regs, 1);
  vic.set(le(s.vic.lineCycle, 4), 65); vic.set(le(s.vic.line, 4), 73); vic[78] = s.vic.flags; vic.set(le(s.vic.compare, 4), 79);
  vic.set(s.color, 761);
  return Uint8Array.from([
    ...ascii('VICE Snapshot File\x1a', 19), 2, 0, ...ascii('C64SC', 16),
    ...ascii('VICE Version\x1a', 13), 3, 10, 0, 0, 0, 0, 0, 0,
    ...module('MAINCPU', 1, 4, cpu), ...module('C64MEM', 0, 1, mem),
    ...module('CIA1', 2, 5, cia(s.cia[0])), ...module('CIA2', 2, 5, cia(s.cia[1])),
    ...module('VIC-II', 1, 3, vic),
  ]);
}
