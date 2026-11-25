/* Integration (spec 10.7): macros, functions, pseudo commands and segments (Kick Assembler), macros and sections
 * (64tass) give in Mimir's own assembler the bytes the real KickAss.jar and 64tass write: the program (<main>.prg, or
 * the file a .file writes) and every other file. Runs when the assemblers are found (KICKASS_JAR / JAVA / TASS64 env
 * vars or the usual install folders); otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm } from '../src/asm-project';
import { find64tass, findKickAssJar, runKickAssembler, writeVfs } from '../src/node';
import { makePsid } from '../src/c64/psid';
import type { ScriptLang, Vfs } from '../src/types';

const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const kick = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;
const tass = find64tass();

export const KICK: Record<string, string> = {
  macros: `* = $1000
 SetBorder(2)
m1: Wait(3)
 lda m1.loop
 lda #twice(4)
 Rec(3)
.macro SetBorder(c) {
 lda #c
 sta $d020
}
.macro Wait(n) {
 ldx #n
loop: dex
 bne loop
}
.function twice(x) {
 .var y = x*2
 .return y
}
.macro Rec(n) {
 .byte n
 .if (n>0) Rec(n-1)
}
:SetBorder(5)
 Wait(1)
 Wait(2)
`,
  functions: `* = $1000
.function f() { .return 1 }
.function f(a) { .return a+1 }
 .byte f(), f(7)
.function g(a) {
 .if (a > 2) .return a
 .eval a = a + 10
 .return a
}
 .byte g(1), g(5)
.function h(n) { .var s = 0
 .for (var i=0; i<n; i++) .eval s = s + i
 .return s }
 .byte h(5)
`,
  pseudocommands: `* = $1000
.pseudocommand mov src : dst {
 lda src
 sta dst
}
.pseudocommand mov16 src : dst {
 lda src
 sta dst
 lda next(src)
 sta next(dst)
}
.function next(arg) {
 .if (arg.getType()==AT_IMMEDIATE) .return CmdArgument(arg.getType(), >arg.getValue())
 .return CmdArgument(arg.getType(), arg.getValue()+1)
}
 mov #1 : $d020
 mov $10 : $11
 mov $1234,x : ($fb),y
 mov16 #$1234 : $fb
 mov16 $c000 : $2000,y
`,
  'a file of segments': `.file [name="game.prg", segments="Code,Data"]
.segmentdef Code [start=$0801]
.segmentdef Data [startAfter="Code", align=$10]
.segment Code
BasicUpstart2(start)
start: lda tab
 jsr more
 rts
.segment Data
tab: .byte 1,2,3
.segment Code
more: inc $d020
 rts
`,
  'Default and other files': `.segmentdef Code [start=$0801, outPrg="code.prg"]
.segmentdef Tab [start=$3000, outBin="tab.bin"]
.segment Code
 .byte 1,2
.segment Tab
 .fill 16, i*3
.segment Default
* = $2000
 lda $3000
.file [name="both.prg", segments="Code,Tab"]
`,
  'virtual, fill and segmentout': `.segmentdef Zp [start=$02, virtual]
.segment Zp
ptr: .word 0
cnt: .byte 0
.segment Default
* = $1000 "x"
 lda ptr
 sta cnt
.segment Data [start=$1100, min=$1100, max=$113f, fill, fillByte=$ea]
 .byte 7
.segment Default
 .segmentout [segments="Data"]
 rts
`,
  'segments made of segments': `.segmentdef A [start=$1000, segments="X,Y"]
.segmentdef X [start=$1000]
.segmentdef Y [startAfter="X", align=$100]
.segment X
 .byte 1
.segment Y
 .byte 2
.segment X "Second"
 .byte 3
.memblock "Third"
 .byte 4
.segment Default
* = $2000
.segmentout [segments="A"]
`,
  'macros in segments': `.segmentdef Code [start=$c000]
.file [name="main.prg", segments="Code"]
.segment Code
.macro Copy(from, to, n) {
 ldx #n-1
!: lda from,x
 sta to,x
 dex
 bpl !-
}
 Copy($0400, $0800, 40)
 Copy($d800, $0c00, 40)
 rts
`,
};

/** the files the sources load (prgFiles, sidFiles) */
const DATA: Vfs = {
  'data/pic.prg': Uint8Array.from([0x00, 0x40, ...Array.from({ length: 700 }, (_, i) => (i * 7) & 0xff)]),
  'music/tune.sid': makePsid(Uint8Array.from({ length: 300 }, (_, i) => (i * 5 + 1) & 0xff), 0x1000, 0x1000, 0x1003, 'Tune'),
};
/** a segment of n bytes at $1000 */
const big = (name: string, n: number) => `.segment ${name} [start=$1000]\n .fill ${n}, i * 3 + ${name.length}\n`;

Object.assign(KICK, {
  'a disk': `.disk [filename="MyDisk.d64", name="THE DISK", id="2021!"] {
  [name="----------------", type="rel"],
  [name="BORDER", type="prg", segments="Code"],
  [name="DATA", type="prg", segments="Data"],
  [name="SEQ", type="seq", segments="Data"],
  [name="HIDDEN", type="prg", segments="Code", hide],
  [name="Locked", type="usr<", segments="Data"],
  [name="PIC", type="prg", prgFiles="data/pic.prg"],
  [name="TUNE", type="prg", sidFiles="music/tune.sid"],
  [name="RAW", type="prg", segments="Data", noStartAddr],
  [name="slow", segments="Code", interleave=3],
}
.segment Code [start=$0801]
BasicUpstart2(start)
start: inc $d020
 jmp start
.segment Data [start=$2000]
 .fill 600, i
`,
  'a disk without a name, the program on it': `.disk [filename="game.d64"] {
  [name="GAME", segments="Code"],
}
.segment Code [start=$0801]
BasicUpstart2(start)
start: rts
`,
  'a full disk over track 18': `.disk [filename="big.d64", name="BIG", interleave=4] {
  [name="A", segments="A"], [name="B", segments="B"], [name="C", segments="C"], [name="D", segments="D"],
}
${big('A', 30000)}${big('B', 30000)}${big('C', 30000)}${big('D', 12000)}`,
  'a disk whose files do not cross track 18': `.disk [filename="split.d64", dontSplitFilesOverDir, format="speeddos"] {
  [name="A", segments="A"], [name="B", segments="B"], [name="C", segments="C"],
}
${big('A', 40000)}${big('B', 40000)}${big('C', 15000)}`,
  'files on the directory track': `.disk [filename="dir.d64", storeFilesInDir, format="dolphindos"] {
  [name="A", segments="A"], [name="B", segments="B"], [name="C", segments="C"],
}
${big('A', 50000)}${big('B', 40000)}${big('C', 9000)}`,
  'a directory of many files': `.disk [filename="many.d64", name="MANY"] {
${Array.from({ length: 17 }, (_, i) => `  [name="FILE ${i}", segments="S${i}"],`).join('\n')}
}
${Array.from({ length: 17 }, (_, i) => `.segment S${i} [start=$${(0x1000 + i * 0x100).toString(16)}]\n .fill ${20 + i * 40}, i + ${i}\n`).join('')}`,
  'files per memory block (mbfiles)': `.file [name="mb.prg", mbfiles, segments="Code"]
.file [name="all.bin", type="bin", segments="Code"]
.segment Code [start=$1000]
 .byte 1,2
* = $2000 "Second"
 .byte 3
.memblock "Third"
 .byte 4
`,
  'the BasicUpstart modifier': `.segmentdef Code [start=$0810, modify="BasicUpstart", _start=start]
.file [name="up.prg", segments="Code"]
.file [name="up2.prg", segments="Data", modify="BasicUpstart", _start=$2000]
.segment Code
start: inc $d020
 jmp start
.segment Data [start=$2000]
 rts
`,
});

export const TASS: Record<string, string> = {
  functions: `*       = $1000
        .byte add(2), add(2, 5)
add     .function a, b=1
        .endf a + b
mva     .function value, target
        lda value
        sta target
        .endf
        mva #1, $d020
        mva $10, $11
        #mva #2, $d021
        .mva #3, $d022
dbl     .sfunction x, x * 2
        .byte dbl(4)
two     .function
        .endf 3, 4
        .byte two()
lbl     mva #5, $d020
        jmp lbl
vals    add 3, 4
        .byte vals
loc     .function n
x       := n * 2
        .endf x + 1
        .byte loc(10), loc(20)
idx     .function p
        lda p,x
        .endf
        idx $1234
rest    .function a, *r
        .endf len(r)
        .byte rest(1), rest(1, 2, 3)
wait    .function n
        ldx #n
lp      dex
        bne lp
        .endf
        wait 3
        wait 4
`,
  macros: `*       = $1000
copy    .macro
        ldx #\\2
lp      lda \\1,x
        dex
        bpl lp
        .endmacro
        #copy $2000, 3
        .copy $3000, 4
var     .lohi 1234, 5678
        lda var.lo
lohi    .macro
lo      .byte <(\\@)
hi      .byte >(\\@)
        .endmacro
name    .macro first, b=2, , last
        .byte \\first, \\b, \\3, \\last, \\{first}
        .endm
        #name 1, , 3, 4
msg     .macro
        .text "Hi @1!"
        .text \\1
        .endm
        #msg "wth"
seg     .segment v
segl    .byte \\v
        .endsegment
        #seg 9
        lda segl
lab     #copy $4000, 1
        jmp lab
        lda #<lab.lp
`,
  sections: `*       = $02
        .dsection zp
        .cerror * > $30, "Too many zero page variables"
*       = $0801
        .dsection code
*       = $1000
        .dsection data
        .section code
        .word ss, 2005
        .null $9e, format("%4d", start)
ss      .word 0
start   sei
        .section zp
p2      .addr ?
        .send zp
        lda (p2),y
        lda #<label
        .section data
label   .null "message"
        .send data
        jmp start
        .section zp
p3      .byte ?
        .send zp
        lda p3
        .send code
`,
  'macros in sections': `*       = $0801
        .dsection code
        .dsection data
put     .macro
        .section data
_d      .byte \\1
        .send data
        lda _d
        .endm
        .section code
        #put 5
        #put 6
        rts
        .send code
`,
};

/** the files the real assembler writes from `text`, by name */
async function build(lang: ScriptLang, text: string, extra: Vfs = {}): Promise<Map<string, Uint8Array>> {
  const dir = await mkdtemp(join(tmpdir(), 'mimir-macros-'));
  try {
    await writeVfs(dir, { ...extra, 'main.asm': text });
    const out = new Map<string, Uint8Array>();
    if (lang === 'kickass') {
      const r = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'main.asm', outDir: 'out' });
      expect(r.output ?? '').not.toMatch(/error/i);
      for (const m of (r.output ?? '').matchAll(/Writing (?:prg|binary|bin|d64) file: (.+)/g)) out.set(m[1].trim(), new Uint8Array(await readFile(join(dir, 'out', m[1].trim()))));
      return out;
    }
    const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    if (existsSync(join(dir, 'main.prg'))) out.set('main.prg', new Uint8Array(await readFile(join(dir, 'main.prg'))));
    return out;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** '' when the bytes are the same, else where they first differ (a disk image's track and sector too) */
function differs(want: Uint8Array, got: Uint8Array | null): string {
  if (!got) return 'Mimir wrote nothing';
  const n = Math.min(want.length, got.length);
  for (let i = 0; i < n; i++) {
    if (want[i] === got[i]) continue;
    let s = i >> 8, t = 1;
    if (want.length >= 174848) for (const spt of [...Array(17).fill(21), ...Array(7).fill(19), ...Array(6).fill(18), ...Array(10).fill(17)]) { if (s < spt) break; s -= spt; t++; }
    return `at ${i}${want.length >= 174848 ? ` (track ${t} sector ${s} byte ${i & 255})` : ''}: KickAss ${want.slice(i, i + 8).join(',')} Mimir ${got.slice(i, i + 8).join(',')}`;
  }
  return want.length === got.length ? '' : `length: ${want.length}, Mimir ${got.length}`;
}

const cases: [ScriptLang, boolean, Record<string, string>][] = [['kickass', kick, KICK], ['64tass', !!tass, TASS]];
for (const [lang, there, sources] of cases) {
  describe.skipIf(!there)(`macros and segments built with the real ${lang === '64tass' ? '64tass' : 'Kick Assembler'}`, () => {
    for (const [what, text] of Object.entries(sources)) {
      it(`gives the bytes Mimir's assembler gives: ${what}`, async () => {
        const c = checkAsm({ ...DATA, 'main.asm': text }, 'main.asm', lang);
        expect(c.problems).toEqual([]);
        const real = await build(lang, text, DATA);
        const prog = c.asm.programFile ?? 'main.prg';
        expect(real.has(prog), [...real.keys()].join(', ')).toBe(true);
        // (a disk's program is its first PRG, compared as the disk below)
        if (!/\.d64$/i.test(prog)) expect(differs(real.get(prog)!, c.asm.prg!), prog).toBe('');
        // every other file the build writes
        for (const f of c.asm.files ?? []) {
          expect(real.has(f.name), f.name).toBe(true);
          expect(differs(real.get(f.name)!, f.bytes!), f.name).toBe('');
        }
        expect(real.size).toBe(new Set([...(c.asm.files ?? []).map(f => f.name), ...(c.asm.programFile !== undefined && c.asm.programFile !== null ? [c.asm.programFile] : ['main.prg'])]).size);
      }, 60_000);
    }
  });
}
