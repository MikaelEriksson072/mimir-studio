/* Brokkr for a JavaScript script (spec 10.3): a file packed to unpack itself, bytes crunched and decrunched again, a
 * mem file, the decruncher's source; and with Sindri in the same script, what Brokkr packs unpacked again. */
import { describe, expect, it } from 'vitest';
import { makeDemo, parsePrg, runJs, type ScriptEnv, type UserScript } from '../src';

const demo = makeDemo();
const demoFile = parsePrg(demo.name, demo.prg);
const env: ScriptEnv = { files: [demoFile], names: new Map([['start', 0x0810]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });

describe('brokkr in a JavaScript script', () => {
  it('packs the program\'s file as one that unpacks itself, in each format, and Sindri unpacks it to the program again', () => {
    const run = runJs(env, js([
      'print(brokkr.formats.join(","));',
      'for (const format of brokkr.formats) {',
      '  const p = brokkr.pack(undefined, { format, effect: false });',
      '  const back = sindri.unpack(p.prg, { disk: false });',
      '  const same = files[0].end - files[0].start, at = files[0].start - back.start;',
      '  let ok = back.unpacked && at >= 0;',
      '  for (let i = 0; ok && i < same; i++) ok = back.bytes[at + i] === mem[files[0].start + i];',
      '  print(p.format, hex(p.load), p.size < p.from, p.size === p.prg.length, p.bytes.length === p.size - 2, p.end === p.load + p.bytes.length, hex(p.entry), p.basic, hex(p.port, 2), p.saved > 0, p.seconds > 0, p.areas.some(a => a.name === "Decruncher"), ok);',
      '}',
      'save("packed.prg", brokkr.pack().bytes, 0x0801);',
    ]));
    expect(run.error).toBeUndefined();
    expect(run.prints).toEqual(['exomizer,brokkr,fast', ...['exomizer', 'brokkr', 'fast'].map(f => `${f} $0801 true true true true $0810 false $37 true true true true`)]);
    expect(run.made!.map(m => [m.name, m.load])).toEqual([['packed.prg', 0x0801]]);
    expect(run.changes).toEqual([]);
  });

  it('packs a PRG it is given, to start at an address or with RUN, and says what it does not take', () => {
    const run = runJs(env, js([
      'const prg = sindri.prg(files[0].start, files[0].end);',
      'const a = brokkr.pack(prg, { start: "start", port: 0x35, irq: false, effort: "fast" });',
      'print(hex(a.entry), hex(a.port, 2), a.basic);',
      'print(brokkr.pack(prg, { start: "basic" }).basic, brokkr.pack(prg, { format: "auto", maxSeconds: 60 }).format);',
      'for (const bad of [() => brokkr.pack([1, 2]), () => brokkr.pack("x"), () => brokkr.pack(prg, { format: "zip" }), () => brokkr.pack(prg, { effort: "more" })]) try { bad(); } catch (e) { print(e.message); }',
    ]));
    expect(run.error).toBeUndefined();
    expect(run.prints![0]).toBe('$0810 $35 false');
    expect(run.prints![1]).toMatch(/^true (exomizer|brokkr|fast)$/);
    expect(run.prints!.slice(2)).toEqual([
      'brokkr.pack: a PRG is its load address and at least a byte',
      'brokkr.pack: bytes are wanted (a Uint8Array, such as mem.subarray(…), a scratchpad or disk.read(…))',
      'brokkr.pack: the format is "exomizer", "brokkr" or "fast", or "auto" (not "zip")',
      'brokkr.pack: the effort is "fast", "normal" or "max" (not "more")',
    ]);
  });

  it('crunches bytes to a bare stream and decrunches it to the same bytes, forward and backward, in each format', () => {
    const run = runJs(env, js([
      'const data = mem.subarray(files[0].start, files[0].end);',
      'for (const format of brokkr.formats) for (const backward of [false, true]) {',
      '  const c = brokkr.crunch(data, { format, backward });',
      '  const d = brokkr.decrunch(c.bytes, { format, backward });',
      '  print(format, backward, c.size < c.from, c.from === data.length, c.saved > 0, d.length === data.length && d.every((b, i) => b === data[i]));',
      '}',
      'try { brokkr.crunch([]); } catch (e) { print(e.message); }',
      'try { brokkr.decrunch([1, 2, 3], { format: "brokkr" }); print("read"); } catch (e) { print("not a stream"); }',
    ]));
    expect(run.error).toBeUndefined();
    expect(run.prints!.slice(0, 6)).toEqual(['exomizer', 'brokkr', 'fast'].flatMap(f => [false, true].map(b => `${f} ${b} true true true true`)));
    expect(run.prints![6]).toBe('brokkr.crunch: there are no bytes to crunch');
    expect(run.prints).toHaveLength(8);
  });

  it('makes a mem file that loads where it decrunches in place, and gives the decruncher\'s source', () => {
    const run = runJs(env, js([
      'const data = mem.subarray(files[0].start, files[0].end);',
      'for (const format of brokkr.formats) {',
      '  const m = brokkr.mem(data, files[0].start, { format });',
      '  print(format, (m.bytes[0] | m.bytes[1] << 8) === m.start, m.end - m.start === m.bytes.length - 2, m.size < m.from, m.inPlace.end > m.inPlace.start, brokkr.decruncher({ format }).includes("lda"));',
      '}',
      'const bare = brokkr.mem(data, files[0].start, { load: "none", forward: true });',
      'print(bare.start, bare.end, bare.size < bare.from);',
      'print(brokkr.mem(data, files[0].start, { load: 0x4000 }).start);',
      'try { brokkr.mem(data, files[0].start, { format: "fast", forward: true }); } catch (e) { print(e.message); }',
      'try { brokkr.mem(data, 0xfff0); } catch (e) { print(e.message); }',
    ]));
    expect(run.error).toBeUndefined();
    expect(run.prints!.slice(0, 3)).toEqual(['exomizer', 'brokkr', 'fast'].map(f => `${f} true true true true true`));
    expect(run.prints!.slice(3)).toEqual(['null null true', String(0x4000), 'brokkr.mem: the fast format is crunched backward only', 'brokkr.mem: the bytes do not fit in memory from that address']);
  });
});
