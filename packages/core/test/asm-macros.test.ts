/* Macros, functions, pseudo commands and segments in Mimir's own Kick Assembler, macros and sections in its 64tass
 * (spec 10.7): what each gives, where its bytes' lines are, and what the check says of what is wrong. The bytes are
 * measured against the real assemblers in asm-macros.integration.test.ts. */
import { describe, expect, it } from 'vitest';
import { assemble } from '../src/verify/kick-subset-assembler';
import { assembleTass } from '../src/verify/tass-subset-assembler';
import { checkAsm } from '../src/asm-project';
import { asmNames } from '../src/asm-names';
import type { AssembleResult } from '../src/types';

const kick = (text: string, more: Record<string, string> = {}) => assemble({ 'main.asm': text, ...more }, 'main.asm', { allFiles: true });
const tass = (text: string, more: Record<string, string> = {}) => assembleTass({ 'main.asm': text, ...more }, 'main.asm', { allFiles: true });
const bytes = (r: AssembleResult, from: number, n: number) => [...r.mem.subarray(from, from + n)];
const msgs = (r: AssembleResult) => r.errors.map(e => `${e.file}:${e.line} ${e.msg}`);

describe("Kick Assembler's macros, functions and pseudo commands in Mimir's check", () => {
  it('runs a macro where it is called, before or after its definition, its bytes the call line\'s', () => {
    const r = kick('* = $1000\n Border(2)\n Border(5)\n.macro Border(c) {\n lda #c\n sta $d020\n}\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 10)).toEqual([0xa9, 2, 0x8d, 0x20, 0xd0, 0xa9, 5, 0x8d, 0x20, 0xd0]);
    expect([...r.lines.subarray(0x1000, 0x100a)]).toEqual([2, 2, 2, 2, 2, 3, 3, 3, 3, 3]);
    // each instruction starts a statement: a debugger stops at each, on the call's line
    expect(r.starts[0x1000]).toBe(1); expect(r.starts[0x1002]).toBe(1); expect(r.ops[0x1002]).toBe(1);
  });

  it("gives a macro in an imported file's bytes to the line in the file that calls it", () => {
    const r = kick('#import "lib/macros.asm"\n* = $c000\n Clear(1)\n rts\n', { 'lib/macros.asm': '.macro Clear(v) {\n lda #v\n sta $0400\n}\n' });
    expect(msgs(r)).toEqual([]);
    expect(r.fileNames![r.fileOf![0xc000] - 1]).toBe('main.asm');
    expect(r.lines[0xc000]).toBe(3);
  });

  it('keeps a macro\'s labels to each call, and names them by a label before the call', () => {
    const r = kick('* = $1000\nw1: Wait(3)\n Wait(4)\n lda w1.loop\n.macro Wait(n) {\n ldx #n\nloop: dex\n bne loop\n}\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x100a, 3)).toEqual([0xad, 0x02, 0x10]);
    expect(r.symbols.get('w1')).toBe(0x1000);
  });

  it("sees the top level's names in a macro, not the caller's", () => {
    const r = kick('* = $1000\n.const top = 7\n.for (var i = 0; i < 2; i++) { M() }\n.macro M() {\n .byte top, i\n}\n');
    expect(msgs(r)).toEqual(['main.asm:5 Unknown symbol "i" (in M(), called on line 3)']);
  });

  it('says where a problem in a macro is and which call it came from', () => {
    const r = kick('* = $1000\n Bad(1)\n M(1, 2)\n Nope()\n.macro Bad(x) {\n lda undefinedthing\n}\n.macro M(a) {\n .byte a\n}\n');
    // (a name still unknown is said by the final pass, after what each pass says)
    expect(msgs(r)).toEqual([
      'main.asm:3 Invalid number of arguments for macro M: it takes 1, not 2',
      'main.asm:4 Unknown macro "Nope"',
      'main.asm:6 Unknown symbol "undefinedthing" (in Bad(), called on line 2)',
    ]);
  });

  it('refuses a macro defined twice, and one calling itself without end', () => {
    expect(msgs(kick('* = $1000\n.macro A() {\n nop\n}\n.macro A() {\n nop\n}\n'))).toEqual(["main.asm:5 The macro 'A' is already defined"]);
    const r = kick('* = $1000\n R()\n.macro R() {\n R()\n}\n');
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.errors[0].msg).toMatch(/does a macro or function call itself without end/);
  });

  it('runs functions: one per number of arguments, .var, .if, .for and .return in them', () => {
    const r = kick('* = $1000\n.function f() { .return 1 }\n.function f(a) { .return a+1 }\n.function s(n) {\n .var t = 0\n .for (var i = 0; i < n; i++) .eval t = t + i\n .if (t > 5) .return t\n .return 0\n}\n .byte f(), f(7), s(5), s(2), twice(21)\n.function twice(x) { .return x * 2 }\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 5)).toEqual([1, 8, 10, 0, 42]);
  });

  it('refuses bytes written in a function and .return outside one', () => {
    expect(msgs(kick('* = $1000\n.function f() {\n .byte 1\n .return 2\n}\n .byte f()\n.return 3\n'))).toEqual([
      'main.asm:3 A .function cannot write bytes: write them in a .macro (in f(), called on line 6)',
      'main.asm:7 .return outside a .function',
    ]);
  });

  it('gives a pseudo command its arguments with their addressing modes', () => {
    const r = kick('* = $1000\n.pseudocommand mov src : dst {\n lda src\n sta dst\n}\n mov #1 : $d020\n mov $10 : $11\n mov $1234,x : ($fb),y\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 13)).toEqual([0xa9, 1, 0x8d, 0x20, 0xd0, 0xa5, 0x10, 0x85, 0x11, 0xbd, 0x34, 0x12, 0x91]);
  });
});

describe("Kick Assembler's segments in Mimir's check", () => {
  it('gives <main>.prg as the program: the Default segment, without the segments no file has (with a warning)', () => {
    const r = kick('BasicUpstart2(start)\n.segment Code [start=$1000]\nstart: lda #1\n rts\n');
    expect(msgs(r)).toEqual([]);
    expect(r.min).toBe(0x0801); expect(r.max).toBe(0x080c);
    expect(r.written[0x1000]).toBe(0);
    expect(r.programFile).toBe('main.prg');
    expect(r.warnings?.map(w => `${w.line} ${w.msg}`)).toEqual([`2 The segment 'Code' is in no file: Kick Assembler writes main.prg from the Default segment only (name it in a .file [segments="Code"], or give it outPrg="…")`]);
  });

  it('gives the file a .file writes as the program when Default is empty, its segments one after another', () => {
    const src = '.file [name="game.prg", segments="Code,Data"]\n.segmentdef Code [start=$0801]\n.segmentdef Data [startAfter="Code", align=$100]\n.segment Code\nBasicUpstart2(start)\nstart: lda tab\n rts\n.segment Data\ntab: .byte 1,2,3\n.segment Code\n nop\n';
    const r = kick(src);
    expect(msgs(r)).toEqual([]);
    expect(r.programFile).toBe('game.prg');
    expect(r.symbols.get('tab')).toBe(0x0900);
    expect(r.min).toBe(0x0801); expect(r.max).toBe(0x0902);
    expect(r.lines[0x0900]).toBe(9);
    const c = checkAsm({ 'main.asm': src }, 'main.asm', 'kickass');
    expect(c.ok).toBe(true);
    expect(c.programFile).toBe('game.prg');
    expect(c.entry).toBe(0x080e);
  });

  it('writes outPrg, outBin and every .file, a virtual segment nowhere, fill from min to max, .segmentout where it is', () => {
    const r = kick('.segmentdef Zp [start=$02, virtual]\n.segment Zp\nptr: .word 0\n.segment Default\n* = $1000\n lda ptr\n.segment Data [start=$1100, min=$1100, max=$1103, fill, fillByte=$ea, outBin="data.bin"]\n .byte 7\n.segment Default\n .segmentout [segments="Data"]\n');
    expect(msgs(r)).toEqual([]);
    expect(r.written[0x02]).toBe(0);
    expect(bytes(r, 0x1000, 6)).toEqual([0xa5, 0x02, 7, 0xea, 0xea, 0xea]);
    expect(r.files?.map(f => [f.name, f.type, [...(f.bytes ?? [])]])).toEqual([['data.bin', 'bin', [7, 0xea, 0xea, 0xea]]]);
    expect(r.warnings).toBeUndefined();
  });

  it('says what Kick Assembler says of segments used wrong', () => {
    expect(msgs(kick('* = $1000\n.segment Code\n .byte 1\n'))).toEqual(["main.asm:2 Undefined segment 'Code'"]);
    expect(msgs(kick('.segmentdef A [start=$1000, fill]\n'))).toEqual(["main.asm:1 Can't use fill without both min and max"]);
    expect(msgs(kick('.segmentdef A [start=$1000, bogus=1]\n'))).toEqual(['main.asm:1 Unknown parameter "bogus" of the segment A']);
    expect(msgs(kick('.segmentdef A [start=$1000]\n.segmentdef B [start=$1000]\n.segment A\n .byte 1\n.segment B\n .byte 2\n.file [name="ab.prg", segments="A,B"]\n'))).toEqual(["main.asm:2 In the file 'ab.prg' the segment 'B' overlaps 'A' at $1000"]);
    expect(msgs(kick('.file [name="main.prg", segments="Default"]\n* = $1000\n .byte 1\n'))).toEqual(["main.asm:1 Can't output default segment since a file called 'main.prg' already exist"]);
  });

  it("starts Kick Assembler's program counter at $2000 in the Assembler's check, as KickAss does", () => {
    const c = checkAsm({ 'main.asm': 'start: inc $d020\n jmp start\n' }, 'main.asm', 'kickass');
    expect(c.ok).toBe(true);
    expect(c.entry).toBe(0x2000);
  });
});

describe("64tass's macros and sections in Mimir's check", () => {
  it('runs a macro with its parameters as text, its bytes the call line\'s', () => {
    const r = tass('*       = $1000\nput     .macro a, b=2\n        .byte \\a, \\b, \\1, \\@\n        .endm\n        #put 7\n        .put 9, 3\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 9)).toEqual([7, 2, 7, 7, 9, 3, 9, 9, 3]);
    expect([...r.lines.subarray(0x1000, 0x1009)]).toEqual([5, 5, 5, 5, 6, 6, 6, 6, 6]);
  });

  it("keeps a .macro's labels to each call (a label before the call names them and is its address), a .segment's not", () => {
    const r = tass('*       = $1000\nm       .macro\nx       nop\n        .endm\ns       .segment\ny       nop\n        .endsegment\nlab     #m\n        #m\n        #s\n        jmp lab\n        lda #<lab.x\n        lda #<y\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1003, 7)).toEqual([0x4c, 0x00, 0x10, 0xa9, 0x00, 0xa9, 0x02]);
    expect(msgs(tass('*       = $1000\ns       .segment\ny       nop\n        .endsegment\n        #s\n        #s\n'))).toEqual(["main.asm:3 duplicate definition 'y' (in the macro s, called on line 6)"]);
  });

  it('expands a macro that calls itself only as far as its .if lets it', () => {
    const r = tass('*       = $1000\nrec     .macro\n        .byte \\1\n        .if \\1 > 0\n        #rec \\1-1\n        .endif\n        .endm\n        #rec 3\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 4)).toEqual([3, 2, 1, 0]);
  });

  it('says where a macro is missing or not closed', () => {
    expect(msgs(tass('        #nope 1\n'))).toEqual(["main.asm:1 not defined symbol 'nope' (no macro of that name)"]);
    expect(msgs(tass('m       .macro\n        nop\n'))[0]).toMatch(/closing directive '\.endmacro' not found for 'm'/);
  });

  it('puts the fragments of a section where its .dsection is, before or after them, nested too', () => {
    const r = tass('*       = $0801\n        .section data\nd1      .byte 1\n        .send data\n        .dsection code\n        .dsection data\n        .section code\n        lda d1\n        .section data\nd2      .byte 2\n        .send\n        lda d2\n        .send code\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x0801, 8)).toEqual([0xad, 0x07, 0x08, 0xad, 0x08, 0x08, 1, 2]);
    expect(r.lines[0x0807]).toBe(3);
  });

  it('takes room for .byte ?, .word ? and .addr ? without writing it', () => {
    const r = tass('*       = $02\np       .addr ?\nq       .byte ?, ?\nw       .word ?\n*       = $1000\n        lda w\n');
    expect(msgs(r)).toEqual([]);
    expect(r.symbols.get('w')).toBe(6);
    expect(r.min).toBe(0x1000);
  });

  it('says what is wrong with sections', () => {
    expect(msgs(tass('*       = $1000\n        .send\n'))).toEqual(['main.asm:2 .send without .section']);
    expect(msgs(tass('*       = $1000\n        .section x\n        nop\n        .send x\n'))).toEqual(["main.asm:2 not defined section 'x': its bytes go where a .dsection x is"]);
    expect(msgs(tass('*       = $1000\n        .dsection x\n        .section x\n        nop\n'))[0]).toMatch(/\.section without \.send \(x\)/);
  });
});

describe('the names of macros for references and rename', () => {
  it("defines a Kick Assembler macro, function and pseudo command where its directive names it", () => {
    const n = asmNames('.macro Border(c) {\n lda #c\n}\n Border(1)\n.function f(x) { .return x }\n.pseudocommand mov a : b {\n}\n', 'kickass');
    expect(n.filter(x => x.def).map(x => `${x.name}:${x.how}`)).toEqual(['Border:macro', 'f:macro', 'mov:macro']);
    expect(n.filter(x => x.name === 'Border').length).toBe(2);
  });

  it("reads 64tass's .name as a macro's call when the source defines that macro", () => {
    const n = asmNames('copy    .macro\n        .endm\n        .copy 1\n        #copy 2\n        .byte 3\n', '64tass');
    expect(n.filter(x => x.name === 'copy').map(x => `${x.line}:${x.def}`)).toEqual(['1:true', '3:false', '4:false']);
    expect(n.some(x => x.name === 'byte')).toBe(false);
  });
});

describe("Kick Assembler's disks, files per memory block and its modifier in Mimir's check", () => {
  const DISK = '.disk [filename="game.d64", name="MY GAME", id="2025!"] {\n  [name="----", type="rel"],\n  [name="GAME", type="prg", segments="Code"],\n  [name="NOTES", type="seq<", segments="Code"],\n}\n.segment Code [start=$0801]\nBasicUpstart2(start)\nstart: rts\n';

  it('writes a .disk as Kick Assembler lays it out, and gives its first program as the program', () => {
    const r = kick(DISK);
    expect(msgs(r)).toEqual([]);
    expect(r.programFile).toBe('game.d64');
    expect(r.min).toBe(0x0801);
    const d = r.files!.find(f => f.name === 'game.d64')!;
    expect(d.type).toBe('d64');
    const img = d.bytes!, bam = 0x16500, dir = 0x16600;
    expect([...img.subarray(bam + 0x90, bam + 0x97)]).toEqual([...'MY GAME'].map(c => c.charCodeAt(0)));
    expect([...img.subarray(bam + 0xa2, bam + 0xa7)]).toEqual([...'2025!'].map(c => c.charCodeAt(0)));
    // the directory: the separator (no blocks), the program at 1/0, the locked SEQ (no load address) at 1/10
    expect([img[dir + 2], img[dir + 3], img[dir + 4], img[dir + 30]]).toEqual([0x84, 0, 0, 0]);
    expect([img[dir + 32 + 2], img[dir + 32 + 3], img[dir + 32 + 4], img[dir + 32 + 30]]).toEqual([0x82, 1, 0, 1]);
    expect([img[dir + 64 + 2], img[dir + 64 + 3], img[dir + 64 + 4]]).toEqual([0xc1, 1, 10]);
    expect([...img.subarray(2, 4)]).toEqual([0x01, 0x08]);
    expect([...img.subarray(10 * 256 + 2, 10 * 256 + 4)]).toEqual([0x0b, 0x08]);
    const c = checkAsm({ 'main.asm': DISK }, 'main.asm', 'kickass');
    expect(c.ok).toBe(true);
    expect(c.programFile).toBe('game.d64');
    expect(c.entry).toBe(0x080e);
  });

  it('says what Kick Assembler says of a disk it cannot make', () => {
    expect(msgs(kick('.disk [filename="a.d64"] {\n  [name="A", type="xyz", segments="Default"],\n}\n'))).toEqual(["main.asm:1 Error while generating 'a.d64': Unknown type: xyz"]);
    const full = `.disk [filename="f.d64"] {\n${Array.from({ length: 4 }, (_, i) => `  [name="F${i}", segments="S${i}"],`).join('\n')}\n}\n${Array.from({ length: 4 }, (_, i) => `.segment S${i} [start=$0400]\n .fill 60000, i\n`).join('')}`;
    expect(msgs(kick(full))).toEqual(["main.asm:1 Error while generating 'f.d64': Disk is full!"]);
    expect(msgs(kick('.disk [name="X"] {\n}\n'))[0]).toMatch(/\.disk needs its parameters/);
    expect(msgs(kick('.disk [filename="a.d64", bogus] {\n}\n'))).toEqual(['main.asm:1 Unknown parameter "bogus" of .disk']);
  });

  it('writes a file per memory block with mbfiles, named after the block', () => {
    const r = kick('.file [name="mb.prg", mbfiles, segments="Code"]\n.segment Code [start=$1000]\n .byte 1,2\n* = $2000 "Second"\n .byte 3\n');
    expect(msgs(r)).toEqual([]);
    expect(r.files?.map(f => [f.name, [...(f.bytes ?? [])]])).toEqual([['mb_Code.prg', [0x00, 0x10, 1, 2]], ['mb_Second.prg', [0x00, 0x20, 3]]]);
    expect(r.programFile).toBe('mb_Code.prg');
  });

  it('puts a BASIC line at $0801 for modify="BasicUpstart", and refuses the modifiers that are plugins', () => {
    const r = kick('.file [name="up.prg", segments="Code"]\n.segment Code [start=$0810, modify="BasicUpstart", _start=start]\nstart: rts\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x0801, 16)).toEqual([0x0b, 0x08, 0x0a, 0x00, 0x9e, 0x32, 0x30, 0x36, 0x34, 0, 0, 0, 0, 0, 0, 0x60]);
    expect(msgs(kick('.segmentdef Code [start=$0810, modify="Packer"]\n'))[0]).toMatch(/cannot run the modifier "Packer" of the segment Code: only BasicUpstart/);
    expect(msgs(kick('.segmentdef Code [start=$0810, modify="BasicUpstart"]\n'))[0]).toMatch(/needs _start/);
    expect(msgs(kick('* = $1000\n.modify Packer() {\n}\n'))[0]).toMatch(/cannot run a modifier plugin \(\.modify\)/);
  });
});

describe("64tass's functions in Mimir's check", () => {
  it('gives a function\'s result in a value, runs its lines as an instruction (bytes on the call\'s line), a label before it its result', () => {
    const r = tass('*       = $1000\nadd     .function a, b=1\n        .endf a + b\nset     .function v, t\n        lda v\n        sta t\n        .endf\n        .byte add(2), add(2, 5)\n        set #1, $d020\nsum     add 3, 4\n        .byte sum\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 8)).toEqual([3, 7, 0xa9, 1, 0x8d, 0x20, 0xd0, 7]);
    expect([...r.lines.subarray(0x1002, 0x1007)]).toEqual([9, 9, 9, 9, 9]);
    expect(r.symbols.get('sum')).toBe(7);
  });

  it('says what is wrong with a call', () => {
    expect(msgs(tass('f       .function a\n        .endf a\n        .byte f(1, 2)\n'))[0]).toMatch(/too many arguments for f: it takes 1, not 2/);
    expect(msgs(tass('f       .function a\n        nop\n'))[0]).toMatch(/closing directive '\.endfunction' not found for 'f'/);
  });
});

describe("64tass's loops in Mimir's check", () => {
  it('repeats a loop\'s lines, each byte on its line, and keeps a b-loop\'s labels to each round', () => {
    const r = tass('*       = $1000\n        .for i := 0, i < 3, i += 1\n        .byte i\n        .next\nlst     .brept 2\nl       nop\n        .endrept\n        jmp lst[1].l\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 8)).toEqual([0, 1, 2, 0xea, 0xea, 0x4c, 0x04, 0x10]);
    expect([...r.lines.subarray(0x1000, 0x1003)]).toEqual([3, 3, 3]);
  });

  it('says what is wrong with a loop', () => {
    expect(msgs(tass('        .for i := 0, i < 3, i += 1\n        .byte i\n'))).toEqual(["main.asm:1 closing directive '.endfor' not found"]);
    expect(msgs(tass('        .break\n'))).toEqual(['main.asm:1 .break or .continue must be used within a loop']);
    expect(msgs(tass('        .endrept\n'))).toEqual(['main.asm:1 .endrept without a loop']);
    expect(msgs(tass('*       = $1000\n        .rept 2\nx       nop\n        .endrept\n'))).toEqual(["main.asm:3 duplicate definition 'x'"]);
    const t0 = Date.now();
    // (its nops run past $ffff first, which is said too)
    expect(msgs(tass('*       = $1000\nn       := 0\n        .while n < 1\n        nop\n        .endwhile\n'))).toContain('main.asm:3 .while went round 100000 times: does its condition ever turn false?');
    // (one pass finds it stuck: the check does not go on for 12)
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe("64tass's floats, structures, unions, .virtual and .goto in Mimir's check", () => {
  it('divides as floats when either side is one and rounds down where an integer is needed', () => {
    const r = tass('*       = $1000\n        .byte 7 / 2, 7.0 / 2 * 2, -1.5 & 255, 128 + 127 * sin(pi / 2), 1.5p2\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 5)).toEqual([3, 7, 254, 255, 6]);
  });

  it('lays out structures and unions: offsets from the definition, an instance\'s bytes on its line, a union as long as its longest', () => {
    const r = tass('*       = $1000\npt      .struct x=1, y=2\nx       .byte \\x\ny       .byte \\y\n        .ends\nhere    .dstruct pt, 5\n        lda #pt.y\n        lda here.y\n        .union\na       .byte 1\nb       .word $0302\n        .endu\n        rts\n');
    expect(msgs(r)).toEqual([]);
    expect(bytes(r, 0x1000, 10)).toEqual([5, 2, 0xa9, 1, 0xad, 0x01, 0x10, 0x02, 0x03, 0x60]);
    expect(r.lines[0x1000]).toBe(6);
  });

  it('writes nothing in .virtual, and goes back to a .lbl with .goto', () => {
    const r = tass('*       = $1000\n        .virtual $c000\nv1      .word ?\nv2      .byte 9\n        .endv\n        lda v2\nn       .var 2\nagain   .lbl\n        nop\nn       .var n - 1\n        .ifne n\n        .goto again\n        .endif\n');
    expect(msgs(r)).toEqual([]);
    expect(r.written[0xc002]).toBe(0);
    expect(bytes(r, 0x1000, 5)).toEqual([0xad, 0x02, 0xc0, 0xea, 0xea]);
  });

  it('says what is wrong with them', () => {
    expect(msgs(tass('        .endv\n'))).toEqual(['main.asm:1 .endv without .virtual']);
    expect(msgs(tass('        .ends\n'))).toEqual(['main.asm:1 .ends without .struct']);
    expect(msgs(tass('        .goto nowhere\n'))).toEqual(["main.asm:1 not defined symbol 'nowhere' (.goto goes back to a .lbl before it)"]);
    expect(msgs(tass('x       .dstruct nothing, 1\n'))).toEqual(["main.asm:1 not defined symbol 'nothing' (no .struct of that name)"]);
  });
});
