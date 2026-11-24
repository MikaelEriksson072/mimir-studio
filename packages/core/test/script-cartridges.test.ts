/* Cartridge images for a JavaScript script (spec 10.3): the standard structures as templates, a cartridge made of one,
 * its chips read, written, added and removed, how it starts, one that starts a program, and what leaves the run: a
 * file, or the image to start in VICE. */
import { describe, expect, it } from 'vitest';
import { cartridgeRequestText, isCrt, makeCrt, parseCrt, runJs, type ScriptEnv, type UserScript } from '../src';
import { fromSource } from './helpers/programs';

const program = fromSource('p.prg', ['.pc = $0810', 'start: rts', 'data: .byte 1, 2, 3, 4'].join('\n'));
const env: ScriptEnv = { files: [program], names: new Map([['start', 0x0810], ['data', 0x0811]]) };
const js = (lines: string[]): UserScript => ({ id: 's', name: 's', lang: 'kickass', code: 'js', source: lines.join('\n'), pads: [] });
const run = (lines: string[], extras: Parameters<typeof runJs>[2] = {}) => runJs(env, js(lines), extras);

describe('cartridges in a JavaScript script', () => {
  it('lists the hardware types and the standard structures', () => {
    const r = run([
      'print(cartridges.types.length, JSON.stringify(cartridges.types[19]), cartridges.layouts.length);',
      'print(JSON.stringify(cartridges.layouts[0]), cartridges.layouts.filter(l => l.sizes.length > 4).map(l => l.key).join());',
      'const l = cartridges.layout("ocean", 32768);',
      'print(l.key, l.id, l.name, l.size, l.exrom, l.game, l.banks, JSON.stringify(l.chips[3]));',
      'print(cartridges.layout("easy").chips.length, cartridges.layout(19).key, cartridges.layout("Magic Desk 16K").key, cartridges.layout("simons").id);',
      'print(JSON.stringify(cartridges.structs.cbm80), Object.keys(cartridges.structs).join(), Array.from(cartridges.cbm80(0x8009)).map(v => hex(v, 2)).join(" "));',
      'for (const g of [() => cartridges.layout("nothing"), () => cartridges.layout("md", 1000), () => cartridges.create("ocean", { size: 8192 })]) try { g(); print("ok"); } catch (e) { print(e.message); }',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      '87 {"id":19,"name":"Magic Desk (Domark, HES Australia)"} 84',
      '{"key":"normal","id":0,"name":"Normal cartridge (8K or 16K mode)","sizes":[4096,8192,12288,16384]} md,md16,rgcd',
      'ocean 5 Ocean 32768 0 0 4 {"bank":3,"load":32768,"size":8192,"type":"rom"}',
      '128 md md16 4',
      '["cold: addr","warm: addr","signature: byte[5]"] cbm80,vectors,header,chip $09 $80 $5e $fe $c3 $c2 $cd $38 $30',
      'cartridges.layout: "nothing" is no standard structure: cartridges.layouts lists them (normal, ulti, ocean, md, easy, …), "custom" is one with no chips yet',
      'cartridges.layout: Magic Desk (Domark, HES Australia) (md) does not come with 1000 bytes of ROM: it comes with 32 KB, 64 KB, 96 KB, 128 KB, 256 KB, 512 KB, 1024 KB',
      'cartridges.create: Ocean (ocean) does not come with 8 KB of ROM: it comes with 32 KB, 128 KB, 256 KB, 512 KB',
    ]);
  });

  it('makes a cartridge of a standard structure: its header, its chips read and written, by number and by bank and address', () => {
    const r = run([
      'const c = cartridges.create("normal", { name: "MY CART", size: 8192 });',
      'print(c.name, c.fileName, c.hw, c.type, c.version, c.exrom, c.game, c.mode, c.chips.length, c.banks.join(), c.bootBank, c.total, c.size, String(c));',
      'print(JSON.stringify(c.chips[0]), c.read(0).length, c.read(0)[0], c.start);',
      'c.setStart(0x8009);',
      'c.put(0, 0x8009, [0x78, 0xee, 0x20, 0xd0, 0x4c, 0x0a, 0x80]);',
      'print(JSON.stringify(c.start), c.peek(0, 0x8009), Array.from(c.get(0, 0x8000, 9)).map(v => hex(v, 2)).join(" "), c.find(0, 0x9fff).number, c.find(0, 0xa000), c.find(1));',
      'c.poke(0, 0x9fff, 0x12); c.write(0, [1, 2, 3], 0x100); c.write(c.chips[0], [9]);',
      'print(c.peek(0, 0x9fff), c.read(0).subarray(0x100, 0x104).join(), c.peek(null, 0x8000));',
      'c.fill(0, 0xea); print(c.read(0).every(v => v === 0xea));',
      'c.name = "RENAMED"; c.hw = 19; c.revision = 2; c.exrom = true; c.game = false;',
      'print(c.name, c.type, c.revision, c.version, c.exrom, c.game, c.mode);',
      'c.list().forEach(l => print(l));',
      'for (const g of [() => c.peek(0, 0x7fff), () => c.peek(3, 0x8000), () => c.read(1), () => c.write(0, new Uint8Array(8193)), () => c.put(0, 0x9ffe, [1, 2, 3]), () => { c.name = "x".repeat(33); }, () => { c.exrom = 2; }, () => c.poke(0, 0x8000, 256)]) try { g(); print("ok"); } catch (e) { print(e.message.slice(0, 74)); }',
      'print(c.peek(0, 0x9ffe));',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'MY CART my cart.crt 0 Normal cartridge 1.0 0 1 8k 1 0 0 8192 8272 cartridge "MY CART": Normal cartridge, 1 chip, 8 KB',
      '{"number":0,"bank":0,"load":32768,"address":32768,"size":8192,"end":40960,"type":"rom","typeId":0} 8192 255 null',
      '{"kind":"cbm80","cold":32777,"warm":65118} 120 $09 $80 $5e $fe $c3 $c2 $cd $38 $30 0 null null',
      '18 1,2,3,255 9',
      'true',
      'RENAMED Magic Desk (Domark, HES Australia) 2 1.1 0 1 8k',
      '"RENAMED"  Magic Desk (Domark, HES Australia) (type 19, revision 2), 8K mode (EXROM 0, GAME 1), 1 chip, 8 KB',
      '  0  bank   0  $8000-$9fff   8192 bytes  ROM',
      'peek: bank 0 has no chip at $7fff (it has $8000-$9fff)',
      'peek: bank 3 has no chip at $8000: the cartridge has no such bank',
      'read: there is no chip 1 in the cartridge (it has 1, numbered from 0): a c',
      'write: 8193 bytes from 0 end past the chip\'s 8192 bytes: resize(chip, size',
      'put: bank 0 has no chip at $a000 (it has $8000-$9fff)',
      'a cartridge\'s name is 32 characters at most ("xxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'exrom: the line: 0 (active, pulled low) or 1 (inactive); true and false sa',
      'poke: a byte is 0 to 255 (not 256)',
      '234',
    ]);
  });

  it('fills a structure with data in the image\'s order, in the smallest size it fits in', () => {
    const r = run([
      'const data = new Uint8Array(40000); for (let i = 0; i < data.length; i++) data[i] = (i >> 13) + 1;',
      'const c = cartridges.create("md", { name: "BANKS", data });',
      'print(c.total, c.chips.length, c.chips.map(x => c.read(x)[0]).join(), c.peek(4, 0x9fff), c.peek(5, 0x8000));',
      'const z = cartridges.create("easy", { fill: 0 });',
      'print(z.mode, z.chips.length, z.chips[1].load, z.chips[1].address, z.chips[3].address, z.chips[0].type, z.read(1)[0]);',
      'z.setVectors({ reset: 0xe000, nmi: 0xe010 }); print(JSON.stringify(z.start), z.peek(0, 0xfffc), z.peek(0, 0xbffc));',
      'try { cartridges.create("normal", { data: new Uint8Array(20000) }); } catch (e) { print(e.message); }',
      'try { c.setStart(0x8009, 0x8010, 9); } catch (e) { print(e.message); }',
      'c.save();',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      '65536 8 1,2,3,4,5,255,255,255 255 255',
      'ultimax 128 40960 57344 40960 flash 0',
      '{"kind":"vectors","nmi":57360,"reset":57344,"irq":0} 0 0',
      'cartridges.create: 20000 bytes are more than Normal cartridge (8K or 16K mode) (normal) comes with: 4 KB, 8 KB, 12 KB, 16 KB',
      'setStart: bank 9 has no chip at $8000 for the CBM80 vectors (an Ultimax cartridge starts at its reset vector: setVectors({ reset }))',
    ]);
    expect(r.prints![0]).toContain('65536');
    const c = parseCrt(r.made![0].bytes, r.made![0].name);
    expect([r.made![0].name, c.hw, c.chips.length, c.chips[4].data[0x1fff], c.chips[4].data[0x1c3f], c.chips[4].data[0x1c40]]).toEqual(['banks.crt', 19, 8, 0xff, 5, 0xff]);
  });

  it('builds one chip by chip: chips added, moved, made another size and removed', () => {
    const r = run([
      'const c = cartridges.create("custom", { name: "OWN", hw: 5, exrom: 0, game: 0 });',
      'print(c.chips.length, c.type, c.mode, c.start);',
      'try { c.save(); } catch (e) { print(e.message); }',
      'const a = c.add(0, 0x8000, 0x2000);',
      'c.add(0, 0xa000, mem.subarray(0x0810, 0x0815), { type: "flash" });',
      'c.add(1, 0x8000, 4096, { fill: 0x55, type: 1 });',
      'c.add(2, "start", [1, 2, 3], { at: 0 });',
      'print(JSON.stringify(a), c.chips.map(x => x.number + ":" + x.bank + ":" + hex(x.load) + ":" + x.size + ":" + x.type).join(" "));',
      'c.resize(2, 8); c.set(2, { bank: 3, load: 0xe000, type: "eeprom" }); c.resize(3, 8192, 0);',
      'print(c.read(2).join(), JSON.stringify(c.chip(2)), c.read(3)[4095], c.read(3)[4096], c.banks.join());',
      'print(JSON.stringify(c.remove(0)), c.chips.length, c.total);',
      'for (const g of [() => c.add(0, 0x9000, 16), () => c.add(0, 0xfff0, 32), () => c.add(0, 0xc000, 0x10000), () => c.add(0, 0xc000, 1, { type: "prom" }), () => c.set(0, { size: 1 }), () => c.add(0, 0xc000, "text"), () => c.resize(0, 0)]) try { g(); print("ok"); } catch (e) { print(e.message.slice(0, 70)); }',
      'c.save("own"); c.run();',
    ]);
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      '0 Ocean 16k null',
      'save: the cartridge has no chips yet: add(bank, load, bytes) adds one',
      '{"number":0,"bank":0,"load":32768,"address":32768,"size":8192,"end":40960,"type":"rom","typeId":0} 0:2:$0810:3:rom 1:0:$8000:8192:rom 2:0:$a000:5:flash 3:1:$8000:4096:ram',
      '96,1,2,3,4,255,255,255 {"number":2,"bank":3,"load":57344,"address":57344,"size":8,"end":57352,"type":"eeprom","typeId":3} 85 0 0,1,2,3',
      '{"bank":2,"load":2064,"size":3} 3 16392',
      'add: bank 0 has a chip at $8000-$9fff already, which $9000-$900f would',
      'add: 32 bytes at $fff0 end past $ffff',
      'add: a chip is 1 to 65535 bytes (its size is two bytes in the image), ',
      'add: a chip\'s type is "rom", "ram", "flash" or "eeprom" (or its number',
      'set: a chip\'s bank, load and type are set, not "size"',
      'add: bytes are wanted (a Uint8Array, such as mem.subarray(…) or anothe',
      'resize: a chip is 1 to 65535 bytes (its size is two bytes in the image',
    ]);
    const c = parseCrt(r.made![0].bytes, 'own.crt');
    expect([r.made![0].name, r.made![0].bytes.length, c.hw, c.exrom, c.game, c.chips.map(x => [x.bank, x.load, x.data.length, x.type])]).toEqual(['own.crt', 0x40 + 3 * 16 + 16392, 5, 0, 0, [[0, 0x8000, 8192, 0], [3, 0xe000, 8, 3], [1, 0x8000, 8192, 1]]]);
    expect([r.cartridge!.name, r.cartridge!.chips, r.cartridge!.total, isCrt(r.cartridge!.bytes)]).toEqual(['own.crt', 3, 16392, true]);
    expect(cartridgeRequestText(r.cartridge!)).toBe('own.crt started in VICE (Ocean, 3 chips, 16392 bytes)');
  });

  it('makes a cartridge that starts a program, and works on a copy of the project\'s cartridge', () => {
    const r = run([
      'const c = cartridges.fromProgram(mem.subarray(0x0810, 0x0815), { load: 0x0810, name: "PROGRAM" });',
      'print(c.type, c.chips.length, JSON.stringify(c.start), c.fileName, c.peek(0, 0x8009));',
      'const b = cartridges.fromProgram([0x01, 0x08, 0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x31, 0, 0, 0]);',
      'print(b.fileName, b.total, Array.from(b.read(0)).join().includes("32,89,166,76,174,167,11,8,10,0,158"));',
      'for (const g of [() => cartridges.fromProgram([1, 2]), () => cartridges.fromProgram([1], { load: 0x80 }), () => cartridges.open([1, 2, 3])]) try { g(); print("ok"); } catch (e) { print(e.message.slice(0, 80)); }',
      'const p = cartridges.project;',
      'print(p.name, p.fileName, p.type, p.chips.length, p.peek(1, 0x8000));',
      'p.poke(1, 0x8000, 0x77); p.name = "CHANGED";',
      'print(cartridges.project.peek(1, 0x8000), cartridges.project.name, p.save(), cartridges.open(p.file()).peek(1, 0x8000));',
      'b.run("basic");',
    ], { cartridges: { name: 'game.crt', bytes: makeCrt({ name: 'GAME', hw: 19, exrom: 0, game: 1, chips: [0, 1].map(bank => ({ bank, load: 0x8000, bytes: new Uint8Array(8192).fill(bank + 1) })) }) } });
    expect(r.error).toBeUndefined();
    expect(r.prints).toEqual([
      'Magic Desk (Domark, HES Australia) 4 {"kind":"cbm80","cold":32777,"warm":65118} program.crt 120',
      'program.crt 32768 true',
      'cartridges.fromProgram: the bytes start with a load address (two bytes) unless o',
      'cartridges.fromProgram: the program loads at $0080: the cartridge\'s boot has its',
      'cartridges.open: 3 bytes are not a cartridge image: a .crt starts with "C64 CART',
      'GAME game.crt Magic Desk (Domark, HES Australia) 2 2',
      '2 GAME game.crt 119',
    ]);
    expect([r.made![0].name, parseCrt(r.made![0].bytes).name, r.cartridge!.name, r.cartridge!.type]).toEqual(['game.crt', 'CHANGED', 'basic.crt', 'Magic Desk (Domark, HES Australia)']);
    expect(run(['print(cartridges.project);']).prints).toEqual(['null']);
    expect(run(['cartridges.create("normal").run();', 'throw new Error("no");']).cartridge).toBeUndefined();
  });
});
