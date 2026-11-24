/* Tape images for a JavaScript script (spec 10.3): a TAP and a T64 made, files added, removed and renamed, a TAP's
 * pulses, the one kind made the other, and what leaves the run: a file, or the tape for the datasette. */
import { describe, expect, it } from 'vitest';
import { isT64, isTap, makeT64, makeTap, readT64, readTape, runJs, tapeRequestText, tapPulses, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts', 'data: .byte 1, 2, 3, 4'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['start', 0x0810], ['data', 0x0811]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const run = (lines: string[], extras: Parameters<typeof runJs>[2] = {}) => runJs(env, js(lines), extras);

describe('tapes in a JavaScript script', () => {
  it('makes a T64: files added, read, renamed and removed', () => {
    const r = run([
      'const t = tapes.create("t64", { name: "my tape" });',
      'print(t.kind, t.name, t.files.length, String(t), tapes.kinds.join());',
      'const f = t.add("program", mem.subarray(0x0810, 0x0815), { load: "start" });',
      't.add("with address", [0x00, 0xc0, 9, 8, 7]);',
      't.add("third", [1], { load: 0x2000 });',
      'print(JSON.stringify(f), t.files.map(x => x.name + "@" + hex(x.load) + "+" + x.size).join());',
      'print(t.read("program").join(), t.read(1).join(), t.prg("WITH ADDRESS").join(), t.has("third"), t.has("fourth"), t.find("fourth"), t.find(2).name);',
      't.rename("third", "last"); t.name = "renamed";',
      'print(JSON.stringify(t.remove(0)), t.name, t.files.map(x => x.number + ":" + x.name).join());',
      't.list().forEach(l => print(l));',
      'print(t.size === t.bytes.length, t.file().length);',
      'for (const g of [() => t.add("x", [1]), () => t.add("a name of seventeen", [1], { load: 1 }), () => t.add("x", [1, 2], { load: 0xffff }), () => t.read("nothing"), () => t.read(9), () => t.add("x", "text", { load: 1 }), () => tapes.create("tzx"), () => tapes.open([1, 2, 3])]) try { g(); print("ok"); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints!.slice(0, 7)).toEqual([
      't64 my tape 0 T64 "my tape": 0 files tap,t64',
      '{"number":0,"name":"PROGRAM","format":"t64","type":"prg","load":2064,"end":2069,"size":5,"seconds":0,"errors":[]} PROGRAM@$0810+5,WITH ADDRESS@$c000+3,THIRD@$2000+1',
      '96,1,2,3,4 9,8,7 0,192,9,8,7 true false null THIRD',
      '{"name":"program","size":5} renamed 0:WITH ADDRESS,1:LAST',
      ' 0  "WITH ADDRESS"     PRG   $c000-$c002      3 bytes', ' 1  "LAST"             PRG   $2000-$2000      1 bytes',
      'true 132',
    ]);
    expect(r.prints!.slice(7)).toEqual([
      'add: the bytes start with a load address (two bytes) unless one is given: add(name, bytes, { load: 0x0801 })',
      'add: a file\'s name is 16 characters at most ("a name of seventeen" is 19)',
      'add: "x" is 2 bytes at $ffff, which ends past $ffff',
      'read: no file "nothing" on the tape', 'read: there is no file 9 on the tape (it has 2, numbered from 0)',
      expect.stringMatching(/^add: bytes are wanted/),
      'tapes.create: the kind is "tap" (a tape\'s pulses) or "t64" (a tape archive), not "tzx"',
      expect.stringMatching(/^tapes\.open: 3 bytes are not a tape image/),
    ]);
  });

  it('makes a TAP in the KERNAL\'s format: files added, read back from the pulses, renamed and removed', () => {
    const r = run([
      'const t = tapes.create("tap", { name: "side a" });',
      'print(t.kind, t.version, t.files.length, t.pulses.length, t.seconds, t.name);',
      'const f = t.add("first", mem.subarray(0x0810, 0x0815), { load: 0x0810 });',
      't.add("basic one", [0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0], { basic: true });',
      't.add("third", new Uint8Array(300).fill(0x55), { load: 0xc000 });',
      'print(f.name, f.format, f.type, hex(f.load), f.size, f.errors.length, t.files.map(x => x.name + ":" + x.type + ":" + x.size).join());',
      'print(t.read("first").join(), t.read(2).length, t.prg(0).join(), t.files.every(x => x.errors.length === 0), t.seconds > 30, t.unknown.length);',
      'const before = t.pulses.length;', 't.rename("first", "renamed");',
      'print(t.files.map(x => x.name).join(), t.read("renamed").join(), before > 0);',
      'print(JSON.stringify(t.remove("basic one")), t.files.map(x => x.name).join(), t.read("third").length);',
      't.list().forEach(l => print(l));',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'tap 1 0 0 0 side a.tap',
      'FIRST cbm prg $0810 5 0 FIRST:prg:5,BASIC ONE:basic:12,THIRD:prg:300',
      '96,1,2,3,4 300 16,8,96,1,2,3,4 true true 0',
      'RENAMED,BASIC ONE,THIRD 96,1,2,3,4 true',
      '{"name":"BASIC ONE","size":12} RENAMED,THIRD 300',
      ' 0  "RENAMED"          PRG   $0810-$0814      5 bytes', ' 1  "THIRD"            PRG   $c000-$c12b    300 bytes',
    ]);
  });

  it('writes the files as makeTap does, pulse for pulse: the tape VICE loads', () => {
    const r = run(['const t = tapes.create("tap");', 't.add("one", [0x60, 1, 2], { load: 0x0810 });', 't.add("two", new Uint8Array(40).fill(9), { load: 0x4000, basic: true });', 't.endOfTape();', 't.save("x");']);
    const ref = makeTap({ files: [{ name: 'one', data: Uint8Array.of(0x60, 1, 2), load: 0x0810 }, { name: 'two', data: new Uint8Array(40).fill(9), load: 0x4000, basic: true }], endOfTape: true });
    expect(r.error).toBeUndefined();
    expect(Buffer.from(r.made![0].bytes).equals(Buffer.from(ref))).toBe(true);
  });

  it('works on a TAP\'s pulses: a pause, pulses of its own, a cut, the end-of-tape marker', () => {
    const r = run([
      'const t = tapes.create("tap");', 't.add("a", [1, 2, 3], { load: 0x1000 });',
      'const n = t.pulses.length, s = t.seconds;', 't.pause(2.5);',
      'print(t.pulses.length - n, Math.round((t.seconds - s) * 10) / 10, t.pulses[n]);',
      't.addPulses([0x180, 0x181, 2000, 100000]);', 'print(Array.from(t.pulses.slice(-4)).join());',
      'print(t.cut(n, n + 1), t.pulses.length - n, t.files.length);',
      't.endOfTape();', 'print(t.files.map(x => x.type).join(), t.cut(n) > 1000, t.pulses.length === n);',
      'for (const g of [() => t.pause(0), () => t.addPulses([0]), () => t.addPulses("x"), () => t.cut(5, 5), () => t.cut(0, 1e9)]) try { g(); print("ok"); } catch (e) { print(e.message.split(/[:(]/)[0] + ":" + e.message.split(":")[1].slice(0, 24)); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      '1 2.5 2463120', '384,385,2000,100000', '1 4 1', 'prg,end true true',
      'pause: seconds, more than 0 an', 'addPulses: a pulse is 1 to 16 777 ', "addPulses: the pulses' lengths in ", 'cut: pulses 5 up to 5 are no', 'cut: pulses 0 up to 10000000',
    ]);
  });

  it('makes one kind the other, and works on a copy of the tape in the datasette', () => {
    const tap = makeTap({ files: [{ name: 'GAME', data: Uint8Array.of(0x60, 1, 2), load: 0x0810 }, { name: 'LEVEL', data: new Uint8Array(40).fill(9), load: 0x4000 }] });
    const before = tap.slice();
    const r = run([
      'const t = tapes.mounted;', 'print(t.kind, t.name, t.files.map(f => f.name + "@" + hex(f.load)).join());',
      'const a = t.toT64("archive");', 'print(a.kind, a.name, a.files.map(f => f.name + ":" + f.size).join(), a.read("level").length);',
      'const back = a.toTap();', 'print(back.kind, back.files.map(f => f.name + ":" + f.size + ":" + f.errors.length).join(), back.read("game").join());',
      't.remove("game");', 'print(t.files.map(f => f.name).join(), tapes.mounted.files.length);',
      'print(a.save(), back.save("copy"), t.save());', 'a.insert();',
    ], { tapes: { name: 'game.tap', bytes: tap } });
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual(['tap game.tap GAME@$0810,LEVEL@$4000', 't64 archive GAME:3,LEVEL:40 40', 'tap GAME:3:0,LEVEL:40:0 96,1,2', 'LEVEL 2', 'game.t64 copy.tap game.tap']);
    expect(tap).toEqual(before);
    // the files of the run are images the readers read
    const [a, back, t] = r.made!;
    expect([isT64(a.bytes), isTap(back.bytes), isTap(t.bytes)]).toEqual([true, true, true]);
    expect(readT64(a.bytes).files.map(f => [f.name, f.load, f.data.length])).toEqual([['GAME', 0x0810, 3], ['LEVEL', 0x4000, 40]]);
    expect(readTape(back.bytes).files.map(f => [f.name, f.load, f.data.length, f.errors])).toEqual([['GAME', 0x0810, 3, []], ['LEVEL', 0x4000, 40, []]]);
    expect(readTape(t.bytes).files.map(f => f.name)).toEqual(['LEVEL']);
    // (a TAP written again has the pulses it had)
    const same = run(['tapes.mounted.save("same");'], { tapes: { name: 'game.tap', bytes: tap } });
    expect(Array.from(tapPulses(same.made![0].bytes).cycles)).toEqual(Array.from(tapPulses(tap).cycles));
    expect([r.tape!.name, r.tape!.kind, r.tape!.files, isT64(r.tape!.bytes)]).toEqual(['game.t64', 't64', 2, true]);
    expect(tapeRequestText(r.tape!)).toBe('game.t64 put in the datasette (a T64, 2 files)');
    // a T64 in the datasette, and none
    const t64 = makeT64({ name: 'ARCHIVE', files: [{ name: 'ONE', load: 0x0801, data: Uint8Array.of(1, 2) }] });
    expect(run(['const t = tapes.mounted;', 't.add("two", [3], { load: 0x1000 });', 'print(t.kind, t.name, t.files.map(f => f.name).join());'], { tapes: { name: 'a.t64', bytes: t64 } }).prints).toEqual(['t64 ARCHIVE ONE,TWO']);
    expect(run(['print(tapes.mounted);']).prints).toEqual(['null']);
    expect(run(['tapes.create("tap").insert();', 'throw new Error("no");']).tape).toBeUndefined();
  });
});
