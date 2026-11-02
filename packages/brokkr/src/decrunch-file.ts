/* The decruncher of mem files as files of its own (`brokkr decruncher`): the Kick Assembler source to #import into a
 * program, and the same code assembled to a PRG at an address, to load and call. One decruncher serves every file
 * crunched in its format with the same options: set `stream` to the address after a file's last byte and jsr
 * `decrunch`. checkDecruncher runs a crunched file through the PRG in the emulated C64 and compares what it wrote. */
import { AsmError, assemble } from './asm.ts';
import { decrunchSource, ZP_BYTES } from './decruncher.ts';
import { brkDecrunchSource, BRK_ZP_BYTES } from './brk-decruncher.ts';
import { fastDecrunchSource, FAST_ZP_BYTES } from './fast-decruncher.ts';
import { Machine } from './emulate.ts';
import { BrokkrError, h2, h4, span } from './errors.ts';
import { ramFor, type SfxFormat } from './sfx.ts';

/** where the PRG goes when no address is given */
export const DECRUNCHER_AT = 0xc000;

export interface DecruncherOptions {
  format?: SfxFormat;
  /** the first of its zero page bytes (default: the last ones, up to $ff) */
  zp?: number;
  /** its tables: Exomizer's format $0334 by default; Brokkr's own the start of a page, by default the page after the
   * decruncher; the fast format has none */
  table?: number;
  /** where the PRG goes (default DECRUNCHER_AT); the source starts with `* =` only when it is given */
  at?: number;
  /** Brokkr's own format: 0.5 KB of tables instead of 1.5 KB, the decruncher a third slower */
  small?: boolean;
  /** Exomizer's format: for streams crunched with -P+16, with -P-32 (reuse false), with -c (literalSequences false)
   * or without -T4 (anyLength) */
  four?: boolean; reuse?: boolean; literalSequences?: boolean; anyLength?: boolean;
  /** flash the border while it decrunches (not in the fast format) */
  effect?: boolean;
  /** lines put at the top of the source as comments */
  notes?: string[];
}

export interface DecruncherFile {
  format: SfxFormat;
  /** Kick Assembler source with its constants at the top */
  source: string;
  /** the PRG, its load address first */
  prg: Uint8Array;
  /** the code in the PRG, [start, end) */
  start: number; end: number;
  /** jsr here once `stream` is set */
  entry: number;
  /** the two bytes to set to the address after the crunched data's last byte (in the code, or in its zero page) */
  stream: number;
  zp: { start: number; end: number };
  tables: { start: number; end: number } | null;
}

const ZP: Record<SfxFormat, { at: number; bytes: number }> = {
  exomizer: { at: 0x100 - ZP_BYTES, bytes: ZP_BYTES }, brokkr: { at: 0x100 - BRK_ZP_BYTES, bytes: BRK_ZP_BYTES }, fast: { at: 0x100 - FAST_ZP_BYTES, bytes: FAST_ZP_BYTES },
};

/** The decruncher for mem files of a format, as source and as a PRG at an address, with what it takes. */
export function decruncherFile(o: DecruncherOptions = {}): DecruncherFile {
  const format = o.format ?? 'exomizer', at = o.at ?? DECRUNCHER_AT, z = ZP[format];
  const zp = o.zp ?? z.at;
  if (zp < 2 || zp + z.bytes > 0x100) throw new BrokkrError('BRK-E170', `The decruncher's ${z.bytes} zero page bytes from ${h2(zp)} do not fit in $02–$ff.`, `Give an address from $02 to ${h2(0x100 - z.bytes)}.`);
  if (at < 0 || at > 0xffff) throw new BrokkrError('BRK-E171', `${h4(at)} is not an address for the decruncher.`);
  if (format === 'brokkr' && o.table != null && o.table & 0xff) throw new BrokkrError('BRK-E173', `The tables of Brokkr's own format start a page ($c000), not ${h4(o.table)}.`);
  const source = (where: number | undefined, table: number | undefined) =>
    format === 'brokkr' ? brkDecrunchSource({ zp, table, small: o.small, effect: o.effect, at: where })
    : format === 'fast' ? fastDecrunchSource({ zp, at: where })
    : decrunchSource({ zp, table, at: where, four: o.four, reuse: o.reuse, effect: o.effect, literalSequences: o.literalSequences, anyLength: o.anyLength });
  let table = o.table;
  // at `at`, or what is wrong when it does not fit below $ffff (its length from where it would)
  const assembleAt = (t: number | undefined) => {
    try { return assemble(source(at, t)); } catch (e) {
      if (!(e instanceof AsmError) || !/past \$ffff/.test(e.message)) throw e;
      const bytes = assemble(source(0x1000, t)).end - 0x1000;
      throw new BrokkrError('BRK-E171', `The decruncher (${bytes} bytes) does not fit from ${h4(at)} below $ffff.`, `Put it at ${h4(0x10000 - bytes)} or lower.`);
    }
  };
  // Brokkr's own format: its tables on the page after the decruncher, unless told (the code is as long either way)
  if (format === 'brokkr' && table == null) table = (assembleAt(0xc000).end + 0xff) & 0x1ff00;
  const code = assembleAt(table);
  const size = format === 'brokkr' ? (o.small ? 512 : 1536) : format === 'exomizer' ? (o.four ? 204 : 156) : 0;
  const t = size ? { start: table ?? 0x0334, end: (table ?? 0x0334) + size } : null;
  if (t && t.end > 0x10000) throw new BrokkrError('BRK-E172', `The decruncher's ${size} bytes of tables do not fit from ${h4(t.start)} below $ffff.`);
  if (t && t.start < code.end && at < t.end) throw new BrokkrError('BRK-E172', `The decruncher's tables (${span(t.start, t.end)}) lie over the decruncher (${span(at, code.end)}).`, 'Put the tables or the decruncher elsewhere.');
  const prg = new Uint8Array(2 + code.bytes.length);
  prg[0] = at & 0xff; prg[1] = at >> 8;
  prg.set(code.bytes, 2);
  const notes = (o.notes ?? []).map(l => `// ${l}\n`).join('');
  return {
    format, source: notes + source(o.at, table), prg, start: at, end: code.end, entry: code.labels.decrunch, stream: code.labels.stream,
    zp: { start: zp, end: zp + z.bytes }, tables: t,
  };
}

/**
 * Run the crunched file (as loaded, `crunched`) through the decruncher in the emulated C64, with $01 set so that all
 * of it is RAM, and compare what it wrote with `data`; the cycles it took and that $01. `name` names the file in what
 * goes wrong.
 */
export function checkDecruncher(dec: DecruncherFile, crunched: { start: number; bytes: Uint8Array }, data: { start: number; bytes: Uint8Array }, name = 'The file'): { cycles: number; port: number } {
  const end = crunched.start + crunched.bytes.length, dataEnd = data.start + data.bytes.length;
  const parts: [string, number, number][] = [['the decruncher', dec.start, dec.end], ['its zero page', dec.zp.start, dec.zp.end]];
  if (dec.tables) parts.push(['its tables', dec.tables.start, dec.tables.end]);
  for (const [what, s, e] of parts) {
    const over = (a: number, b: number, how: string) => {
      if (s < b && a < e) throw new BrokkrError('BRK-E174', `${name} ${how} ${span(a, b)}, over ${what} (${span(s, e)}).`, 'Put the decruncher, its tables and its zero page where the files and what they decrunch to are not.');
    };
    over(crunched.start, end, 'loads at');
    over(data.start, dataEnd, 'decrunches to');
  }
  const port = ramFor([[crunched.start, end], [data.start, dataEnd], [dec.start, dec.end], ...(dec.tables ? [[dec.tables.start, dec.tables.end] as [number, number]] : [])]);
  const m = new Machine();
  m.port = port;
  m.ram.set(dec.prg.subarray(2), dec.start);
  m.ram.set(crunched.bytes, crunched.start);
  m.ram[dec.stream] = end & 0xff;
  m.ram[dec.stream + 1] = end >> 8;
  // as a jsr from $fffd: the decruncher's rts comes back to $0000
  m.ram[0x1ff] = 0xff; m.ram[0x1fe] = 0xff; m.cpu.s = 0xfd;
  const run = m.run(dec.entry, pc => pc === 0, 2_000_000_000);
  const fail = (why: string): never => { throw new BrokkrError('BRK-E911', `${name} does not decrunch with the decruncher in the emulated C64: ${why}.`); };
  if (m.trouble.length) fail(m.trouble.map(t => `at ${h4(t.pc)} it ${t.what} (${h4(t.addr)})`).join('; '));
  if (!run.stopped) fail(`it did not return within ${run.cycles} cycles`);
  for (let i = 0; i < data.bytes.length; i++) if (m.ram[data.start + i] !== data.bytes[i]) fail(`the byte at ${h4(data.start + i)} is ${h2(m.ram[data.start + i])}, not ${h2(data.bytes[i])}`);
  return { cycles: run.cycles, port };
}
