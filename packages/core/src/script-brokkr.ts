/* =====================================================================
 * Brokkr for a JavaScript script (spec 10.3): what Brokkr, Mimir's cruncher, can do, as `brokkr` in a script's code
 * (script-js.ts). A script that makes files (save) can pack them as Pack with Brokkr does, or crunch any bytes:
 *
 *   brokkr.formats                     the stream formats: "exomizer" (Exomizer 3's, the default), "brokkr" (Brokkr's
 *                                      own: smaller, slower to decrunch) and "fast" (a little larger, quick)
 *   brokkr.pack(prg, { format, start, effect, effort, port, irq, maxSeconds })
 *                                      a PRG (the program's first file when none is given) as a file that unpacks
 *                                      itself when it is run: { prg, bytes, load, end, size, from, saved, format,
 *                                      entry, basic, port, cycles, seconds, areas, warnings }. start: "sys" (the SYS
 *                                      of its BASIC line, the default), "basic" (RUN) or an address; format may be
 *                                      "auto": the smallest that decrunches within maxSeconds
 *   brokkr.crunch(bytes, { format, backward, effort })
 *                                      a bare stream of the bytes (as `exomizer raw` writes one): { bytes, size, from,
 *                                      saved, format }
 *   brokkr.decrunch(stream, { format, backward })
 *                                      the bytes of a bare stream again
 *   brokkr.mem(bytes, start, { format, forward, load, effort })
 *                                      a stream with the data's address, loaded where it decrunches in place (as
 *                                      `exomizer mem` writes one): { bytes, start, end, inPlace, size, from, saved,
 *                                      format, warnings }; bytes is the file, its load address first unless load is
 *                                      "none"
 *   brokkr.decruncher({ format, zp, at })
 *                                      the 6510 source (Kick Assembler) of the routine that decrunches a mem file
 *
 * Everything is Brokkr's own code, the one Pack with Brokkr and the command line run; what it gives is checked by
 * Brokkr as there (a packed file is run in its emulated C64 before it is given).
 * ===================================================================== */
import {
  brkDecrunchSource, decrunchSource, fastDecrunchSource, mem as memFile, memBrk, memFast, PAL_HZ, raw, rawBrk, rawFast, readBrk, readFast, readStream, sfx,
  DEFAULT_PROTOCOL, type Effort, type SfxFormat, type SfxOptions,
} from '@mimir/brokkr';

/** what `brokkr` needs of the run it is in: the script's memory, its names and the program's files */
export interface BrokkrContext {
  mem: Uint8Array;
  addr: (where: unknown) => number;
  files: readonly { start: number; end: number }[];
}

export const BROKKR_FORMATS: readonly SfxFormat[] = ['exomizer', 'brokkr', 'fast'];

const bytesOf = (v: unknown, what: string): Uint8Array => {
  if (v instanceof Uint8Array) return v;
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new TypeError(`${what}: bytes are wanted (a Uint8Array, such as mem.subarray(…), a scratchpad or disk.read(…))`);
};
const formatOf = (v: unknown, what: string, auto = false): SfxFormat | 'auto' => {
  if (v == null) return 'exomizer';
  if (v === 'auto' && auto) return 'auto';
  if (typeof v === 'string' && (BROKKR_FORMATS as readonly string[]).includes(v)) return v as SfxFormat;
  throw new RangeError(`${what}: the format is "exomizer", "brokkr" or "fast"${auto ? ', or "auto"' : ''} (not ${JSON.stringify(v)})`);
};
const effortOf = (v: unknown, what: string): Effort | undefined => {
  if (v == null) return undefined;
  if (v === 'fast' || v === 'normal' || v === 'max') return v;
  throw new RangeError(`${what}: the effort is "fast", "normal" or "max" (not ${JSON.stringify(v)})`);
};
/** how much smaller, in per cent with one decimal (negative: larger) */
const saved = (from: number, size: number): number => (from ? Math.round((1 - size / from) * 1000) / 10 : 0);

/** `brokkr` for a script's run. */
export function brokkrApi(ctx: BrokkrContext): Record<string, unknown> {
  const { mem, addr, files } = ctx;
  return {
    formats: [...BROKKR_FORMATS],
    pack(file?: unknown, o: { format?: unknown; start?: unknown; effect?: boolean; effort?: unknown; port?: number; irq?: boolean; maxSeconds?: number } = {}) {
      let input: Uint8Array;
      if (file == null) {
        if (!files.length) throw new Error('brokkr.pack: the program has no file: give it a PRG');
        const f = files[0];
        input = new Uint8Array(f.end - f.start + 2);
        input[0] = f.start & 0xff; input[1] = f.start >> 8; input.set(mem.subarray(f.start, f.end), 2);
      } else input = bytesOf(file, 'brokkr.pack');
      if (input.length < 3) throw new RangeError('brokkr.pack: a PRG is its load address and at least a byte');
      const effort = effortOf(o.effort, 'brokkr.pack');
      const opts: SfxOptions = {
        format: formatOf(o.format, 'brokkr.pack', true),
        ...(o.start != null ? { start: o.start === 'sys' || o.start === 'basic' ? o.start : addr(o.start) } : {}),
        ...(o.effect != null ? { effect: !!o.effect } : {}), ...(o.port != null ? { ramExit: o.port & 0xff } : {}), ...(o.irq != null ? { irqExit: !!o.irq } : {}),
        ...(o.maxSeconds != null ? { maxSeconds: Number(o.maxSeconds) } : {}), ...(effort ? { crunch: { effort } } : {}),
      };
      const r = sfx(input.subarray(2), input[0] | (input[1] << 8), opts);
      const load = r.prg[0] | (r.prg[1] << 8);
      return {
        prg: r.prg, bytes: r.prg.slice(2), load, end: load + r.prg.length - 2, size: r.prg.length, from: input.length, saved: saved(input.length, r.prg.length),
        format: r.format, entry: r.entry, basic: r.basic, port: r.ramExit, cycles: r.cycles, seconds: Math.round((r.cycles / PAL_HZ) * 100) / 100,
        areas: r.areas.map(a => ({ name: a.name, start: a.start, end: a.end })), warnings: [...r.warnings],
      };
    },
    crunch(data: unknown, o: { format?: unknown; backward?: boolean; effort?: unknown } = {}) {
      const d = bytesOf(data, 'brokkr.crunch'), format = formatOf(o.format, 'brokkr.crunch') as SfxFormat, effort = effortOf(o.effort, 'brokkr.crunch');
      if (!d.length) throw new RangeError('brokkr.crunch: there are no bytes to crunch');
      const opts = { backward: !!o.backward, ...(effort ? { crunch: { effort } } : {}) };
      const bytes = format === 'brokkr' ? rawBrk(d, opts).bytes : format === 'fast' ? rawFast(d, opts).bytes : raw(d, opts).bytes;
      return { bytes, size: bytes.length, from: d.length, saved: saved(d.length, bytes.length), format };
    },
    decrunch(stream: unknown, o: { format?: unknown; backward?: boolean } = {}): Uint8Array {
      const given = bytesOf(stream, 'brokkr.decrunch'), format = formatOf(o.format, 'brokkr.decrunch');
      // a backward stream is the bytes from their end, the file from its end
      const s = o.backward ? given.slice().reverse() : given;
      const data = format === 'brokkr' ? readBrk(s, 0x10000).data : format === 'fast' ? readFast(s, 0x10000).data : readStream(s, DEFAULT_PROTOCOL, undefined, 0x10000).data;
      return o.backward ? data.slice().reverse() : data;
    },
    mem(data: unknown, start: unknown, o: { format?: unknown; forward?: boolean; load?: unknown; effort?: unknown } = {}) {
      const d = bytesOf(data, 'brokkr.mem'), at = addr(start), format = formatOf(o.format, 'brokkr.mem') as SfxFormat, effort = effortOf(o.effort, 'brokkr.mem');
      if (!d.length) throw new RangeError('brokkr.mem: there are no bytes to crunch');
      if (at + d.length > 0x10000) throw new RangeError('brokkr.mem: the bytes do not fit in memory from that address');
      const load = o.load == null || o.load === 'auto' ? 'auto' as const : o.load === 'none' ? 'none' as const : addr(o.load);
      if (o.forward && format !== 'exomizer') throw new RangeError(`brokkr.mem: the ${format} format is crunched backward only`);
      const crunch = effort ? { crunch: { effort } } : {};
      const r = format === 'brokkr' ? memBrk(d, at, { load, ...crunch }) : format === 'fast' ? memFast(d, at, { load, ...crunch }) : memFile(d, at, { load, forward: !!o.forward, ...crunch });
      return {
        bytes: r.bytes, start: r.at?.start ?? null, end: r.at?.end ?? null, inPlace: { start: r.inPlace.start, end: r.inPlace.end },
        size: r.bytes.length, from: d.length, saved: saved(d.length, r.bytes.length), format, warnings: [...r.warnings],
      };
    },
    decruncher(o: { format?: unknown; zp?: number; at?: unknown } = {}): string {
      const format = formatOf(o.format, 'brokkr.decruncher'), opts = { ...(o.zp != null ? { zp: o.zp & 0xff } : {}), ...(o.at != null ? { at: addr(o.at) } : {}) };
      return format === 'brokkr' ? brkDecrunchSource(opts) : format === 'fast' ? fastDecrunchSource(opts) : decrunchSource(opts);
    },
  };
}
