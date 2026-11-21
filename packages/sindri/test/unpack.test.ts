import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { FILE_ARG, FILE_RAN, FILE_READ, FILE_WRITTEN, notPacked, POWER_ON, unpack, type UnpackResult } from '../src/index.ts';
import { findRoms } from '../src/node.ts';
import { asm, basic, byteLines, SYS_LINE } from './asm.ts';
import { coded, noise, pack, PROGRAM } from './packers.ts';

const roms = findRoms();
const body = PROGRAM.prg.subarray(2);

function expectProgram(r: UnpackResult): void {
  expect(r.unpacked).toBe(true);
  const s = r.saved!;
  expect(s.entry).toBe(0x1000);
  expect(s.start).toBe(0x1000);
  expect(s.end).toBe(0x1000 + body.length - 1);
  expect([...s.prg.subarray(2)]).toEqual([...body]);
}

/** a program that writes code and calls it every frame, and installs an interrupt handler it wrote */
const WRITES_CODE = asm(`
* = $1000
       sei
       ldx #8
copy:  lda irq,x
       sta $2100,x
       dex
       bpl copy
       ldx #3
copy2: lda speed,x
       sta $2000,x
       dex
       bpl copy2
       lda #$00
       sta $0314
       lda #$21
       sta $0315
       cli
loop:  jsr $2000
       jmp loop
speed: inc $d020
       rts
irq:   inc $d019
       nop
       nop
       nop
       jmp $ea31
`);

/** a depacker in the zero page, as a freezer backup's: it copies the program to $1000, wipes its own copy loop and
 *  starts the program; the stub at $080d puts it there */
const WIPES_ITSELF = (() => {
  const zp = asm(`
* = $0040
       ldx #31
c:     lda $0900,x
       sta $1000,x
       dex
       bpl c
       jmp $0080
* = $0080
       ldx #$3f
w:     lda #0
       sta $40,x
       dex
       bpl w
       jmp $1000
`).prg.subarray(2);
  return asm(`${SYS_LINE}
       sei
       ldx #${zp.length - 1}
s:     lda zp,x
       sta $40,x
       dex
       bpl s
       jmp $0040
zp:
${byteLines(zp)}
* = $0900
       inc $d020
       jmp $1000
       .fill 26, $ea
`).prg;
})();

/** the music of TRACKMO's first part: a JMP table at $1000, play writes the SID from its tune and steps it on */
const MUSIC = asm(`
* = $1000
       jmp play
       jmp play
play:  ldx #24
pl:    lda tune,x
       sta $d400,x
       dex
       bpl pl
       inc tune
       rts
tune:
${byteLines(noise(128, 3))}
`);

/**
 * A trackmo's way in one file: the stub copies the first part (3 pages, at $0900 in the file) to $0e00 and starts
 * it; the part plays MUSIC in its interrupt, copies the next part (2 pages, at $0c00) to $4000 and starts that, and
 * the music plays on unless the next part stops it. `next` is the next part's code; `irq` is where the handler is.
 */
function trackmo(next: string): { prg: Uint8Array; irq: number } {
  const first = asm(`
* = $0e00
       sei
       lda #<irq
       sta $0314
       lda #>irq
       sta $0315
       cli
       lda #$00
       sta $fb
       sta $fd
       lda #$0c
       sta $fc
       lda #$40
       sta $fe
       ldx #2
       jsr pages
       jmp $4000
pages: ldy #0
pc:    lda ($fb),y
       sta ($fd),y
       iny
       bne pc
       inc $fc
       inc $fe
       dex
       bne pages
       rts
irq:   jsr $1003
       jmp $ea31
* = $1000
${byteLines(MUSIC.prg.subarray(2))}
* = $10ff
       .byte 0
`);
  const part1 = first.prg.subarray(2);
  const part2 = asm(`* = $4000\n${next}\n${byteLines(noise(300, 4))}\n* = $41ff\n .byte 0`).prg.subarray(2);
  return { prg: asm(`${SYS_LINE}
       lda #$00
       sta $fb
       sta $fd
       lda #$09
       sta $fc
       lda #$0e
       sta $fe
       ldx #3
cp:    ldy #0
c:     lda ($fb),y
       sta ($fd),y
       iny
       bne c
       inc $fc
       inc $fe
       dex
       bne cp
       jmp $0e00
* = $0900
${byteLines(part1)}
${byteLines(part2)}
`).prg, irq: first.labels.irq };
}

describe('the RAM as the C64 powers on', () => {
  it('is VICE\'s: four bytes of $00 and four of $ff from $0002, inverted in every other 16 KB', () => {
    // as x64sc 3.10 had it at Tusker's second stage (its random bit flips aside)
    const at = (a: number) => [...POWER_ON.subarray(a, a + 8)];
    expect(at(0x0000)).toEqual([0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0]);
    expect(at(0x8000)).toEqual([0, 0, 0xff, 0xff, 0xff, 0xff, 0, 0]);
    expect(at(0x4000)).toEqual([0xff, 0xff, 0, 0, 0, 0, 0xff, 0xff]);
    expect(at(0xf370)).toEqual([0xff, 0xff, 0, 0, 0, 0, 0xff, 0xff]);
  });
});

describe('a run that never settles into a program', () => {
  it('stops at 500 layers when the program keeps jumping into code it just wrote', () => {
    // two routines, at $c000 and $c100, each copying the other into place from the PRG and jumping there (as Ping
    // Pong's loader starts itself over): each jump is into code the running layer wrote, a new layer every time
    const p = asm(`${SYS_LINE}
       ldx #13
cp:    lda ra,x
       sta $c000,x
       dex
       bpl cp
       jmp $c000
ra:    .byte $a2,13,$bd,<rb,>rb,$9d,$00,$c1,$ca,$10,$f7,$4c,$00,$c1
rb:    .byte $a2,13,$bd,<ra,>ra,$9d,$00,$c0,$ca,$10,$f7,$4c,$00,$c0
`);
    const r = unpack(p.prg, { roms: null });
    expect(r.stop.reason).toBe('budget');
    expect(r.stop.detail).toMatch(/^500 layers: it keeps jumping into code it wrote/);
    expect(r.layers.length).toBe(500);
  });
});

for (const mode of roms ? ['stand-ins', 'ROMs'] as const : ['stand-ins'] as const) {
  const go = (prg: Uint8Array) => unpack(prg, { roms: mode === 'ROMs' ? roms : null });

  describe(`unpacking with the ${mode}`, () => {
    it('starts with the RAM as VICE powers it on, not one byte all over: a loader that looks goes on (Cyberload, Tusker)', () => {
      // Cyberload's second stage compares the RAM under the KERNAL with itself and wipes itself when it is all one byte
      const p = asm(`${SYS_LINE}
       sei
       lda #$34
       sta $01
       ldy #$ff
       lda $f379,y
chk:   cmp $f379,y
       bne ok
       dey
       bne chk
       lda #$37
       sta $01
hang:  jmp hang
ok:    lda #$37
       sta $01
       ldx #5
cp:    lda prog,x
       sta $1000,x
       dex
       bpl cp
       jmp $1000
prog:  .byte $ee,$20,$d0,$4c,$00,$10
`);
      const r = go(p.prg);
      expect(r.unpacked).toBe(true);
      expect(r.saved!.entry).toBe(0x1000);
    });

    it('saves $00 where nothing wrote, not the stripes the RAM powered on with, and keeps what was written', () => {
      // the code at $1000 and 129 bytes of $ff at $1080 are one program; $1006-$107f between them were never written
      const p = asm(`${SYS_LINE}
       ldx #5
cp:    lda prog,x
       sta $1000,x
       dex
       bpl cp
       lda #$ff
       ldx #$80
fill:  sta $1080,x
       dex
       bpl fill
       jmp $1000
prog:  .byte $ee,$20,$d0,$4c,$00,$10
`);
      const r = go(p.prg), s = r.saved!;
      expect([s.start, s.end, s.entry]).toEqual([0x1000, 0x1100, 0x1000]);
      expect([...s.prg.subarray(2, 8)]).toEqual([0xee, 0x20, 0xd0, 0x4c, 0x00, 0x10]);
      expect(s.prg.subarray(8, 2 + 0x80).every(b => b === 0)).toBe(true);
      // ($ff written where the RAM powered on with $ff too is the program's)
      expect(s.prg.subarray(2 + 0x80).every(b => b === 0xff)).toBe(true);
    });

    it('follows a decruncher that runs at $0100 to the program', () => {
      const r = go(pack(PROGRAM).prg);
      expectProgram(r);
      expect(r.layers.map(l => [l.entry, l.kind])).toEqual([[0x080d, 'mover'], [0x0100, 'decruncher'], [0x1000, 'program']]);
      expect(r.stop.reason).toBe('settled');
    });

    it('tells what the run did with each loaded byte while it held what was loaded', () => {
      const p = asm(`${SYS_LINE}
       ldx #0
       lda table,x
       sta $0400
       lda #$60
       sta later
       jsr later
loop:  inc count
       jmp loop
later: nop
       rts
table: .byte 1,2,3
count: .byte 0
never: .byte $ea,$ea
`);
      const { fileUse } = go(p.prg), L = p.labels;
      expect(fileUse[0x080d]).toBe(FILE_RAN);
      expect(fileUse[0x0810]).toBe(FILE_ARG); // lda table,x
      expect(fileUse[L.table]).toBe(FILE_READ);
      expect(fileUse[L.table + 1]).toBe(0);
      // written with an RTS before it ran: what ran was not the loaded NOP, and the loaded RTS after it never ran
      expect(fileUse[L.later]).toBe(FILE_WRITTEN);
      expect(fileUse[L.later + 1]).toBe(0);
      // INC reads, then writes
      expect(fileUse[L.count]).toBe(FILE_READ | FILE_WRITTEN);
      expect(fileUse[L.never]).toBe(0);
    });

    it('finds a decruncher that never goes below $0800', () => {
      const r = go(pack(PROGRAM, { at: 0xc800 }).prg);
      expectProgram(r);
      expect(r.layers[1].entry).toBe(0xc800);
    });

    it('joins a decruncher called with JSR to the stub that called it', () => {
      const r = go(pack(PROGRAM, { exit: 'rts' }).prg);
      expectProgram(r);
      expect(r.layers).toHaveLength(2);
      expect(r.layers[0].calls).toContainEqual({ entry: 0x0100, via: 'jsr' });
    });

    it('gets through an XOR coder that runs on into the code it decrypted', () => {
      expectProgram(go(coded(PROGRAM)));
    });

    it('presses space for an intro that waits before it decrunches', () => {
      const r = go(pack(PROGRAM, { before: 'lda #0\n sta $dc00\nwait: lda $dc01\n cmp #$ef\n bne wait' }).prg);
      expectProgram(r);
      expect(r.layers[0].presses[0]).toMatch(/^space \+ fire/);
    });

    it('answers a trainer menu that asks one question after another, with the key it took before', () => {
      // twelve "(Y/N)" questions, each put up on the same line, and then a digit (1 or 2), as a +12 trainer asks;
      // other keys are ignored
      const menu = `
       lda #12
       sta $fd
ask:   lda $fd
       ora #$40
       ldy #29
pr:    sta $0428,y
       dey
       bpl pr
yn:    jsr $ffe4
       cmp #$4e
       beq nx
       cmp #$59
       bne yn
nx:    dec $fd
       bne ask
       lda #$31
       ldy #29
pr2:   sta $0428,y
       dey
       bpl pr2
dig:   jsr $ffe4
       cmp #$31
       bcc dig
       cmp #$33
       bcs dig`;
      const r = go(pack(PROGRAM, { before: menu }).prg);
      expectProgram(r);
      const keys = r.layers[0].presses.map(p => p.replace(/ at .*/, ''));
      expect(keys.slice(0, 15)).toEqual(['space + fire', 'return', ...Array(13).fill('n')]);
      expect(keys.at(-1)).toBe('1');
    });

    it('waits for the time an intro waits for on the jiffy clock, pressing no keys (Boulder Dash\'s picture)', () => {
      // until the clock's middle byte goes from 0 to 1: up to 4.3 s, longer than a program that writes nothing settles in
      const r = go(pack(PROGRAM, { before: 'lda #0\n sta $a1\nwait: lda $a1\n cmp #1\n bne wait' }).prg);
      expectProgram(r);
      expect(r.layers[0].presses).toEqual([]);
    });

    it('presses keys for an intro that waits for a frame counter its interrupt handler counts, as for a key', () => {
      // 240 interrupts, 4 s: such a wait is not taken for a wait for time (demos that wait for the next frame so made
      // the C64 time 2.5 times as long), so the keys go in while it waits
      const r = go(pack(PROGRAM, { before: `
       sei
       lda #<irq
       sta $0314
       lda #>irq
       sta $0315
       cli
wait:  lda count
       cmp #240
       bne wait
       sei
       lda #$31
       sta $0314
       lda #$ea
       sta $0315
       jmp go
irq:   inc count
       jmp $ea31
count: .byte 0
go:` }).prg);
      expectProgram(r);
      expect(r.layers[0].presses[0]).toMatch(/^space \+ fire/);
    });

    it('waits for an intro that counts down in RAM before it decrunches, pressing no keys (Thrust\'s jingle)', () => {
      // three nested DEC abs / BNE loops from 80, as Firebird's jingle waits between its notes: 4.7 s, longer than a
      // program that writes nothing settles in
      const r = go(pack(PROGRAM, { before: `
       lda #80
       jsr delay
       jmp go
delay: sta c1
d1:    sta c2
d2:    sta c3
d3:    dec c3
       bne d3
       dec c2
       bne d2
       dec c1
       bne d1
       rts
c1:    .byte 0
c2:    .byte 0
c3:    .byte 0
go:` }).prg);
      expectProgram(r);
      expect(r.layers[0].presses).toEqual([]);
    });

    it('presses keys for an intro that counts while it waits for a frame counter its interrupt handler counts', () => {
      // counting in RAM, but the loop reads what the interrupt handler writes: as a frame wait, not a wait for time
      const r = go(pack(PROGRAM, { before: `
       sei
       lda #<irq
       sta $0314
       lda #>irq
       sta $0315
       cli
wait:  inc mine
       lda count
       cmp #240
       bne wait
       sei
       lda #$31
       sta $0314
       lda #$ea
       sta $0315
       jmp go
irq:   inc count
       jmp $ea31
count: .byte 0
mine:  .byte 0
go:` }).prg);
      expectProgram(r);
      expect(r.layers[0].presses[0]).toMatch(/^space \+ fire/);
    });

    it('presses keys for an intro that watches the clock and reads the keyboard', () => {
      const r = go(pack(PROGRAM, { before: 'lda #0\n sta $dc00\nwait: lda $a2\n lda $dc01\n cmp #$ef\n bne wait' }).prg);
      expectProgram(r);
      expect(r.layers[0].presses[0]).toMatch(/^space \+ fire/);
    });

    it('gives a program that waits for time 30 s, then takes it for settled', () => {
      const p = asm(`${SYS_LINE}\nwait: lda $a1\n cmp #$ff\n bne wait`);
      const r = unpack(p.prg, { roms: mode === 'ROMs' ? roms : null, keys: false });
      expect(r.stop.reason).toBe('settled');
      expect(r.stop.cycle).toBeGreaterThan(30_000_000);
      expect(r.stop.cycle).toBeLessThan(31_000_000);
    });

    it('gives a program that counts in RAM for ever 30 s, then takes it for settled', () => {
      const p = asm(`${SYS_LINE}\ncount: inc $2000\n jmp count`);
      const r = unpack(p.prg, { roms: mode === 'ROMs' ? roms : null, keys: false });
      expect(r.stop.reason).toBe('settled');
      expect(r.stop.cycle).toBeGreaterThan(30_000_000);
      expect(r.stop.cycle).toBeLessThan(31_000_000);
    });

    it('gives a layer that starts just before the run would settle the rest of its window to make progress in (Barry Boomer Trapped Again)', () => {
      // the intro waits for space, then with nothing written until just before it would be settled (1.5 s after the
      // key was let go) jumps into the routine it copied to $c000: that waits 0.1 s, then writes 4 KB. A new layer is
      // progress when the window ends; the run took it for settled before that (Barry Boomer's second Exomizer, which
      // starts just as the drive's patience is spent, builds its tables over the ones the first left)
      const p = asm(`${SYS_LINE}
       sei
       lda #$0b
       sta $d011
       ldx #47
copy:  lda next,x
       sta $c000,x
       dex
       bpl copy
       lda #$7f
       sta $dc00
down:  lda $dc01
       and #$10
       bne down
up:    lda $dc01
       and #$10
       beq up
       ldy #0
       lda #4
wa:    ldx #0
wb:    dey
       bne wb
       dex
       bne wb
       sec
       sbc #1
       bne wa
       ldx #142
wc:    dey
       bne wc
       dex
       bne wc
       jmp $c000
next:  ldx #78
n1:    dey
       bne n1
       dex
       bne n1
       lda #$20
       sta $fc
       lda #0
       sta $fb
       ldx #16
       lda #$55
       ldy #0
fill:  sta ($fb),y
       iny
       bne fill
       inc $fc
       dex
       bne fill
       clc
stop:  bcc stop`);
      const r = go(p.prg);
      expect(r.stop.reason).toBe('settled');
      expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
      expect(r.layers[0].presses[0]).toMatch(/^space \+ fire/);
      expect(r.layers[1].writtenBytes).toBeGreaterThanOrEqual(0x1000);
    });

    it('takes a crash that goes round a BRK through a vector in RAM for settled, not for a wait for time', () => {
      // a byte written each time round, as a count would (I.C.U.P.S's game ends so, in $ffff ISC $252f,X / $0002 BRK)
      const p = asm(`${SYS_LINE}
       sei
       lda #$35
       sta $01
       lda #<crash
       sta $fffe
       lda #>crash
       sta $ffff
crash: inc $2000
       brk`);
      const r = unpack(p.prg, { roms: mode === 'ROMs' ? roms : null, keys: false });
      expect(r.stop.reason).toBe('settled');
      expect(r.stop.cycle).toBeLessThan(3_000_000);
    });

    it('goes on to the next key when a menu only complains about the one pressed', () => {
      // any key but Y puts the same line up again
      const menu = `
wt:    jsr $ffe4
       beq wt
       cmp #$59
       beq ok
       ldy #29
cm:    lda #$17
       sta $0450,y
       dey
       bpl cm
       jmp wt
ok:`;
      const r = go(pack(PROGRAM, { before: menu }).prg);
      expectProgram(r);
      expect(r.layers[0].presses.map(p => p.replace(/ at .*/, ''))).toEqual(['space + fire', 'space + fire', 'return', 'n', 'f1', 'y']);
    });

    it('saves a BASIC program a depacker starts with RUN', () => {
      const basicProgram = asm(`${SYS_LINE}
loop:  inc $d020
       jmp loop
       .fill 200, $11
`);
      const r = go(pack(basicProgram, { exit: 'basic' }).prg);
      expect(r.unpacked).toBe(true);
      const s = r.saved!;
      expect(s).toMatchObject({ basic: true, entry: 0x080d, start: 0x0801 });
      expect([...s.prg.subarray(2, 2 + basicProgram.prg.length - 2)]).toEqual([...basicProgram.prg.subarray(2)]);
    });

    it('does not take code the program writes and calls for a new layer', () => {
      const r = go(pack(WRITES_CODE).prg);
      expect(r.saved!.entry).toBe(0x1000);
      expect(r.layers.at(-1)!.calls.map(c => c.entry)).toEqual(expect.arrayContaining([0x2000]));
    });

    it('starts a file that loads over the BASIC vectors by itself', () => {
      const code = asm(`
* = $1000
loop:  inc $d020
       jmp loop`).prg.subarray(2);
      const file = asm(`
* = $02a7
start: ldx #${code.length - 1}
cp:    lda payload,x
       sta $1000,x
       dex
       bpl cp
       jmp $1000
* = $0300
       .word $e38b, start, $a57c, $a71a, $a7e4, $ae86
       .byte 0, 0, 0, 0, $4c, $48, $b2, 0
       .word $ea31, $fe66, $fe47, $f34a, $f291, $f20e, $f250, $f333, $f157, $f1ca, $f6ed, $f13e, $f32f, $fe66, $f4a5, $f5ed
payload:
${byteLines(code)}
`);
      const r = go(file.prg);
      expect(r.layers[0].entry).toBe(0x02a7);
      expect(r.saved).toMatchObject({ entry: 0x1000, start: 0x1000 });
    });

    it('starts a program under the BASIC ROM with the $01 it is given', () => {
      // a game Sindri saved can start at $a2ab with $01 = $36 (Cybernoid 2): with $37 the CPU runs BASIC's ROM there
      const code = asm(`
* = $1000
loop:  inc $d020
       jmp loop`).prg.subarray(2);
      const file = asm(`
* = $a000
       ldx #${code.length - 1}
cp:    lda payload,x
       sta $1000,x
       dex
       bpl cp
       jmp $1000
payload:
${byteLines(code)}
`);
      const run = (port?: number) => unpack(file.prg, { roms: mode === 'ROMs' ? roms : null, entry: 0xa000, ...(port != null ? { port } : {}) });
      const r = run(0x36);
      expect(r.layers[0].entry).toBe(0xa000);
      expect(r.saved).toMatchObject({ entry: 0x1000, start: 0x1000, port: 0x36 });
      expect(run().layers[0]?.entry).not.toBe(0xa000);
    });

    it('starts a program under the KERNAL with the $01 it is given', () => {
      // a game Sindri saved can start with $01 = $35, RAM all through (The Last Ninja 3 +6 Censor at $0400): the
      // KERNAL's own JMP ($0014) at $e144 is then gone
      const code = asm(`
* = $1000
loop:  inc $d020
       jmp loop`).prg.subarray(2);
      const file = asm(`
* = $e100
       ldx #${code.length - 1}
cp:    lda payload,x
       sta $1000,x
       dex
       bpl cp
       jmp $1000
payload:
${byteLines(code)}
`);
      const r = unpack(file.prg, { roms: mode === 'ROMs' ? roms : null, entry: 0xe100, port: 0x35 });
      expect(r.layers.map(l => l.entry)).toEqual([0xe100, 0x1000]);
      expect(r.saved).toMatchObject({ entry: 0x1000, start: 0x1000, port: 0x35 });
    });

    it('starts a layer where the program goes on in code it ran before and then wrote anew: a game loaded over its loader', () => {
      // as The Last Ninja 3 +6 Censor: the loader at $0400 is called, the game it loaded is copied over it, and an RTS
      // goes into the game there
      const loader = asm(`
* = $c000
       inc $d021
       rts
${byteLines(noise(28, 7))}`).prg.subarray(2);
      const game = asm(`
* = $c000
       sei
loop:  inc $d020
       jmp loop
${byteLines(noise(25, 8))}`).prg.subarray(2);
      const r = go(asm(`${SYS_LINE}
       ldx #31
c1:    lda loader,x
       sta $c000,x
       dex
       bpl c1
       jsr $c000
       ldx #31
c2:    lda game,x
       sta $c000,x
       dex
       bpl c2
       lda #$bf
       pha
       lda #$ff
       pha
       rts
loader:
${byteLines(loader)}
game:
${byteLines(game)}
`).prg);
      expect(r.layers.map(l => [l.entry, l.via])).toEqual([[0x080d, 'start'], [0xc000, 'rts']]);
      const s = r.saved!;
      expect(s).toMatchObject({ entry: 0xc000, start: 0xc000 });
      expect([...s.prg.subarray(2, 2 + game.length)]).toEqual([...game]);
    });

    it('starts no layer where the program changes an opcode of its own and jumps there', () => {
      const r = go(asm(`${SYS_LINE}
       ldx #4
next:  jmp at
at:    nop
       lda #$ea
       sta at
       dex
       bne next
loop:  inc $d020
       jmp loop
`).prg);
      expect(r.layers.map(l => l.entry)).toEqual([0x080d]);
      expect(notPacked(r)).toBe(true);
    });

    it('starts no layer where the program copies the same code there again and jumps into it', () => {
      // as Sentinel's intro at $2550: the routine it ran is written again as it was, and the program goes on in it
      const part = asm(`
* = $c000
       inc $d021
       lda $fb
       bne out
       inc $fb
       jmp $0811
out:   inc $d020
       jmp out
${byteLines(noise(16, 9))}`).prg.subarray(2);
      const r = go(asm(`${SYS_LINE}
       lda #$00
       sta $fb
again: ldx #${part.length - 1}
cp:    lda part,x
       sta $c000,x
       dex
       bpl cp
       jmp $c000
part:
${byteLines(part)}
`).prg);
      expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
      expect(r.saved).toMatchObject({ entry: 0xc000 });
    });

    it('starts a file that loads in the screen with RUN when it has a SYS line at $0801 into it', () => {
      // as Cybernoid II +17HDF at $05b8: SYS to where it loads runs into the screen's bytes (here a JAM); RUN goes on
      // from the 0 at $0800
      const packed = pack(PROGRAM).prg;
      expect(packed[0] | (packed[1] << 8)).toBe(0x0801);
      const screen = [0x02, ...new Array<number>(0x0800 - 0x05b8 - 1).fill(0x20), 0];
      const r = go(Uint8Array.from([0xb8, 0x05, ...screen, ...packed.subarray(2)]));
      expect(r.basic).toEqual(['10 SYS2061']);
      expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0x0100, 0x1000]);
      const s = r.saved!, at = 2 + 0x1000 - s.start;
      expect(s.entry).toBe(0x1000);
      expect([...s.prg.subarray(at, at + body.length)]).toEqual([...body]);
    });

    it('starts a file whose text fills the screen with RUN all the same, with a colon when BASIC would read the text after it', () => {
      // as Channel 42 Intro (FBI Crew) at $0450: rows 2-24 are its text, READY. and RUN land on two of them, and RETURN
      // hands BASIC the whole row, RUN and the text after it, which is RUN to a line number (?UNDEF'D STATEMENT
      // ERROR); SYS to where it loads runs into the text (here a JAM, $02 = B). Graphics and reversed spaces are no
      // text to BASIC: the screen editor reads a reversed space as a space and the tokenizer drops $80-$fe, so RUN
      // goes as it is there, without a colon over the file's byte
      const packed = pack(PROGRAM).prg;
      const codes = (s: string) => [...s].map(c => (c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 64 : c.charCodeAt(0)));
      const rows: [number[], boolean][] = [[codes('BEST WISHES FROM THE MAKERS OF THIS INTRO! '), true], [[0xa0, 0xa0, 0x20, 0xe9, 0x69, 0x5f, 0xdf, 0x60, 0x41], false]];
      for (const [text, colon] of rows) {
        const screen = Array.from({ length: 0x07e8 - 0x0450 }, (_, i) => text[i % text.length]);
        const file = Uint8Array.from([0x50, 0x04, ...screen, ...new Array<number>(0x0801 - 0x07e8).fill(0), ...packed.subarray(2)]);
        const r = go(file);
        expect(r.basic).toEqual(['10 SYS2061']);
        expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0x0100, 0x1000]);
        const s = r.saved!, at = 2 + 0x1000 - s.start;
        expect(s.entry).toBe(0x1000);
        expect([...s.prg.subarray(at, at + body.length)]).toEqual([...body]);
        if (mode === 'ROMs') {
          // the screen as it was saved: RUN at the start of a row, then the colon or the file's own byte
          const peek = (a: number) => s.prg[a - s.start + 2];
          const run = Array.from({ length: 25 }, (_, k) => 0x0400 + 40 * k).find(a => a >= s.start && peek(a) === 0x12 && peek(a + 1) === 0x15 && peek(a + 2) === 0x0e);
          expect(run).toBeDefined();
          expect(peek(run! + 3)).toBe(colon ? 0x3a : file[run! + 3 - 0x0450 + 2]);
        }
      }
    });

    it('starts a file that loads below BASIC with SYS to where it loads when RUN would not start it', () => {
      const code = asm(`
* = $1000
loop:  inc $d020
       jmp loop`).prg.subarray(2);
      // a line that SYSes out of the file; one that SYSes into it after a byte RUN stops at with a ?SYNTAX ERROR
      for (const [before, line] of [[0, 'SYS4096'], [0x20, 'SYS2061']] as const) {
        const file = asm(`
* = $0400
start: ldx #${code.length - 1}
cp:    lda payload,x
       sta $1000,x
       dex
       bpl cp
       jmp $1000
payload:
${byteLines(code)}
* = $0800
.byte ${before}
${basic([[10, line]])}
.byte $02
`);
        const r = go(file.prg);
        expect(r.basic).toEqual([]);
        expect(r.layers[0].entry).toBe(0x0400);
        expect(r.saved!.entry).toBe(0x1000);
      }
    });

    it('leaves code at $0801 as the file has it when it starts the file at an address', () => {
      // as a program Sindri saved: code at $0801 (JMP $1234, then a 0 at $0808), started at $0c00. LOAD's relinking
      // would turn $0801-$0802 into a link to $0809 and the JMP into an ORA
      const file = asm(`
* = $0801
       jmp loop
       lda #1
       sta 2
       .byte 0
* = $0c00
       jmp $0801
* = $1234
loop:  inc $d020
       jmp loop
`);
      const r = unpack(file.prg, { roms: mode === 'ROMs' ? roms : null, entry: 0x0c00 });
      expect(r.stop.reason).toBe('settled');
      expect(r.layers[0].code).toEqual([{ start: 0x0801, end: 0x0801 }, { start: 0x0c00, end: 0x0c00 }, { start: 0x1234, end: 0x1237 }]);
    });

    it('leaves a program over the screen as the file has it where READY. and the typed SYS went, when it starts it at an address', () => {
      // as Delta's game, which Sindri saves as $02a1-$ffff from $1770 with its sound routine at $0403-$059a: LOAD
      // typed at the prompt leaves READY. on row 8 ($0540) and SYS on row 9 ($0568), and the game ran into READY.'s
      // bytes ($12 is a JAM) at its first sound. Build & Run loads such a program from VICE's monitor, typing nothing
      const file = asm(`
* = $0400
.fill $140, $20
       inc $d020
       rts
* = $0568
       inc $d021
       rts
* = $0700
loop:  jsr $0540
       jsr $0568
       jmp loop
`);
      const lines: string[] = [];
      const r = unpack(file.prg, { roms: mode === 'ROMs' ? roms : null, entry: 0x0700, trace: l => lines.push(l) });
      expect(r.stop.reason).toBe('settled');
      expect(r.layers[0].code).toEqual([{ start: 0x0540, end: 0x0543 }, { start: 0x0568, end: 0x056b }, { start: 0x0700, end: 0x0706 }]);
      if (mode === 'ROMs') expect(lines).toContain(`put back the file's bytes typing wrote over: $0540-$0545 $0568-$056e`);
    });

    it('fingerprints a depacker by the code it ran, also when it wipes that code before the program starts', () => {
      const r = go(WIPES_ITSELF);
      expect(r.layers.map(l => [l.entry, l.kind])).toEqual([[0x080d, 'jump'], [0x0040, 'mover'], [0x1000, 'program']]);
      // ldx lda sta dex bpl jmp, twice; not the BRKs it left at $0040-$007f
      expect(r.layers[1].opcodes).toBe('a2bd9dca104c' + 'a2a995ca104c');
    });

    it('keeps the music an earlier part started when the program plays it on, as in a trackmo', () => {
      const t = trackmo('loop: inc $d020\n jmp loop'), r = go(t.prg);
      expect(r.layers.map(l => [l.entry, l.kind])).toEqual([[0x080d, 'mover'], [0x0e00, 'mover'], [0x4000, 'program']]);
      const s = r.saved!;
      // from the interrupt handler on: the part's start-up code before it, and the next part's bytes it copied
      // from in front of that, were spent before the program started
      expect(s).toMatchObject({ layer: 2, entry: 0x4000, start: t.irq, end: 0x41ff });
      expect(r.layers[2].kept).toEqual([{ layer: 1, start: t.irq, end: 0x10ff }]);
      // the music's code as the part loaded it; its tune has stepped on while it played
      const at = (a: number) => s.prg[a - s.start + 2];
      expect(Array.from({ length: MUSIC.labels.tune - 0x1000 }, (_, i) => at(0x1000 + i))).toEqual([...MUSIC.prg.subarray(2, 2 + MUSIC.labels.tune - 0x1000)]);
      expect(at(MUSIC.labels.tune + 1)).toBe(MUSIC.prg[MUSIC.labels.tune + 1 - 0x1000 + 2]);
      // the earlier layer's range holds what it ran of its own and nothing earlier
      expect(r.layers[1].kept).toEqual([]);
    });

    it('saves the program alone when it stops the earlier part\'s music, or loads code over it', () => {
      const stops = go(trackmo('sei\n lda #$31\n sta $0314\n lda #$ea\n sta $0315\n cli\nloop: inc $d020\n jmp loop').prg);
      expect(stops.saved).toMatchObject({ layer: 2, entry: 0x4000, start: 0x4000 });
      expect(stops.layers[2].kept).toEqual([]);
      // its own player over the old one: what it ran there it wrote itself
      const over = go(trackmo(`sei
       lda #$31
       sta $0314
       lda #$ea
       sta $0315
       cli
       ldx #31
cp:    lda own,x
       sta $1003,x
       dex
       bpl cp
loop:  jsr $1003
       jmp loop
own:   ${Array(10).fill('inc $d020').join('\n       ')}
       rts
       .fill 1, 0`).prg);
      expect(over.saved).toMatchObject({ layer: 2, entry: 0x4000, start: 0x4000 });
      expect(over.layers[2].kept).toEqual([]);
    });

    it('saves the program as it started, without a disk, though it writes code next to it and calls that', () => {
      const t = trackmo(`ldx #19
cp:    lda own,x
       sta $4200,x
       dex
       bpl cp
loop:  jsr $4200
       jmp loop
own:   ${Array(6).fill('inc $d020').join('\n       ')}
       rts
       .byte 0`);
      const r = go(t.prg);
      expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0x0e00, 0x4000]);
      expect(r.layers[2].calls).toEqual([{ entry: 0x4200, via: 'jsr' }]);
      // (with a disk it might have loaded that code; without one it made it from what it holds)
      expect(r.layers[2].loaded).toEqual([]);
      expect(r.saved).toMatchObject({ layer: 2, entry: 0x4000, start: t.irq, end: 0x41ff });
    });

    it('says when nothing was unpacked, and that a program that settles in its own code is not packed', () => {
      const plain = asm(`${SYS_LINE}\nloop: inc $d020\n jmp loop`).prg, r = go(plain);
      expect(r.unpacked).toBe(false);
      expect(r.saved).toBeNull();
      expect(r.layers).toHaveLength(1);
      expect(r.stop.reason).toBe('settled');
      expect(r.brk).toBeNull();
      expect(notPacked(r)).toBe(true);
      // one that goes back to BASIC is not packed either
      const back = go(asm(`${SYS_LINE}\n inc $d020\n rts`).prg);
      expect(back).toMatchObject({ unpacked: false, stop: { reason: 'ready' }, brk: null });
      expect(notPacked(back)).toBe(true);
      // one that runs into a BRK crashed (started at the wrong address, a loader that failed): the KERNAL takes it to
      // READY with the ROMs, the stand-ins stop on it, and it says nothing either way
      const crash = go(asm(`${SYS_LINE}\n inc $d020\n brk`).prg);
      expect(crash).toMatchObject({ unpacked: false, stop: { reason: mode === 'ROMs' ? 'ready' : 'brk' }, brk: 0x0810 });
      expect(notPacked(crash)).toBe(false);
      // one that changes its own instructions (a one-block intro steps its colours so) and calls code it wrote is one
      // layer, not packed
      const own = go(asm(`${SYS_LINE}
       lda #$60
       sta $c000
loop:  jsr $c000
step:  lda #$00
       sta $d020
       inc step+1
       jmp loop`).prg);
      expect(own.layers.map(l => l.kind)).toEqual(['program']);
      expect(own.layers[0].calls).toEqual([{ entry: 0xc000, via: 'jsr' }]);
      expect(notPacked(own)).toBe(true);
      // a run that ended on a limit says nothing either way: the program may still unpack later
      const cut = unpack(plain, { roms: mode === 'ROMs' ? roms : null, maxCycles: 100_000 });
      expect(cut).toMatchObject({ unpacked: false, stop: { reason: 'budget' } });
      expect(notPacked(cut)).toBe(false);
    });
  });
}

describe.skipIf(!roms)('BASIC programs, with the ROMs', () => {
  const go = (prg: Uint8Array) => unpack(prg, { roms, keys: false, maxCycles: 20_000_000 });
  /** a BASIC extension, installed with SYS2304: its command `!` flashes the border and goes on with NEWSTT */
  const WEDGE = `
* = $0900
       lda #<wedge
       sta $0308
       lda #>wedge
       sta $0309
       rts
wedge: jsr $0073
       cmp #$21
       beq bang
       jsr $0079
       jmp $a7e7
bang:  inc $d020
       jsr $0073
       jmp $a7ae`;
  /** a loop through the extension's command, then RUN again, for ever */
  const LOOP = basic([[10, 'SYS2304'], [20, '!:X=X+1:IFX<50THEN20'], [30, 'RUN']]);

  it('takes a BASIC program going on with itself for no new layer: an extension\'s command, RUN again', () => {
    const r = go(asm(`${LOOP}\n${WEDGE}`).prg);
    // (the extension starts the program, and its first jump into BASIC is one from machine code)
    expect(r.layers.map(l => [l.entry, l.basic])).toEqual([[0x0900, false], [0xa7ae, true]]);
    expect(r.stop.reason).toBe('settled');
  });

  it('starts a layer at the BASIC program a depacker wrote, and none when it goes on with itself', () => {
    const program = asm(`${LOOP}\n${WEDGE}`);
    const r = go(pack(program, { exit: 'basic' }).prg);
    // (its JSR $A659 clears BASIC's variables and returns to it, as with the stand-ins; its JMP $A7AE starts BASIC)
    expect(r.layers.map(l => [l.entry, l.basic])).toEqual([[0x080d, false], [0x0100, false], [0xa7ae, true]]);
    expect(r.saved).toMatchObject({ layer: 2, basic: true, start: 0x0801, entry: 0x0900 });
    expect([...r.saved!.prg.subarray(2, program.prg.length)]).toEqual([...program.prg.subarray(2)]);
    expect(r.stop.reason).toBe('settled');
  });

  it('takes a depacker\'s JSR $A659 for a call that returns, and the code it then jumps to for the layer', () => {
    // as The Last Ninja 3 +6 Censor's decruncher: CLR moves its return address to a fresh stack, then returns; the
    // trainer menu it jumps to next is machine code, not a BASIC program to start with RUN
    const part = asm(`
* = $c000
loop:  inc $d020
       jmp loop`).prg.subarray(2);
    const r = go(asm(`${SYS_LINE}
       ldx #${part.length - 1}
cp:    lda part,x
       sta $c000,x
       dex
       bpl cp
       jsr $a659
       jmp $c000
part:
${byteLines(part)}
`).prg);
    expect(r.layers.map(l => [l.entry, l.via, l.basic])).toEqual([[0x080d, 'start', false], [0xc000, 'jmp', false]]);
    expect(r.saved).toMatchObject({ entry: 0xc000, basic: false });
  });

  it('starts a layer at a BASIC program RUN for the first time', () => {
    // the first program moves BASIC's start to $1001 and RUNs the second, which loops through the command
    const r = go(asm(`${basic([[10, 'SYS2304:!:POKE44,16:RUN']])}
${WEDGE}
${basic([[10, '!:GOTO10']], 0x1001)}`).prg);
    expect(r.layers.map(l => [l.entry, l.via, l.basic])).toEqual([[0x0900, 'start', false], [0xa7ae, 'jmp', true], [0xa871, 'rts', true]]);
    expect(r.saved).toMatchObject({ layer: 2, basic: true, entry: 0x1001 });
    expect(r.stop.reason).toBe('settled');
  });

  /** at $0900: an RTS back to BASIC; at $0901 (SYS2305): the part at $c000 written and started */
  const PART = `
* = $0900
       rts
       ldx #part_end-part-1
copy:  lda part,x
       sta $c000,x
       dex
       bpl copy
       jmp $c000
part:  inc $d020
       jmp $c000
part_end:`;

  it('waits while BASIC counts a FOR loop before it starts the next part (Kennedy Approach)', () => {
    const r = go(asm(`${basic([[10, 'SYS2304'], [20, 'FORI=1TO3000:NEXT'], [30, 'SYS2305']])}\n${PART}`).prg);
    expect(r.layers.map(l => l.entry)).toEqual([0x0900, 0xc000]);
  });

  it('takes BASIC that counts a FOR loop while it waits for a key for settled', () => {
    const r = go(asm(`${basic([[10, 'SYS2304'], [20, 'FORI=1TO50:NEXT:GETA$:IFA$=""THEN20'], [30, 'SYS2305']])}\n${PART}`).prg);
    expect(r.layers.map(l => l.entry)).toEqual([0x0900]);
    expect(r.stop.reason).toBe('settled');
    expect(r.stop.cycle).toBeLessThan(3_000_000);
  });

  it('types RUN and presses RETURN for the KERNAL\'s keyboard scan to find, as a person does', () => {
    // the program starts where in timer A's period it starts on a C64 when RUN is typed (Subway Arts' Exomizer stub
    // races the KERNAL's interrupt and crashed from where the prompt happened to wait, with RETURN put in the buffer)
    let seen: { lastKey: number; held: number; buffer: number } | null = null;
    const r = unpack(asm(`${SYS_LINE}
loop:  inc $d020
       jmp loop`).prg, { roms, keys: false, maxCycles: 5_000_000, onStep: (_pc, m) => {
      seen ??= { lastKey: m.ram[0xc5], held: m.input.keys[0], buffer: m.ram[0xc6] };
    } });
    expect(r.layers.map(l => l.entry)).toEqual([0x080d]);
    // at its first instruction: the scan found RETURN (SCNKEY keeps the last key's matrix code in $c5: RETURN 1, none
    // 64) and took it into the buffer, BASIC took it from there, and RETURN was let go
    expect(seen).toEqual({ lastKey: 1, held: 0, buffer: 0 });
  });

  it('goes on at the READY prompt while the program\'s own interrupt handler runs, until it takes over', () => {
    // SYS: $0314 to its own handler, back to READY; 30 interrupts later the handler writes the part at $c000 and
    // jumps there (Uncensored by Booze Design starts so)
    const r = go(asm(`${SYS_LINE}
       sei
       lda #<irq
       sta $0314
       lda #>irq
       sta $0315
       cli
       rts
irq:   dec count
       beq go
       jmp $ea31
go:    ldx #part_end-part-1
copy:  lda part,x
       sta $c000,x
       dex
       bpl copy
       jmp $c000
count: .byte 30
part:  inc $d020
       jmp $c000
part_end:
`).prg);
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(r.stop.reason).toBe('settled');
  });
});

const EXOMIZER = ['C:\\C64\\exomizer-3.1.1\\win32\\exomizer.exe', '/usr/bin/exomizer', '/usr/local/bin/exomizer'].find(p => existsSync(p));

describe.skipIf(!EXOMIZER)('Exomizer', () => {
  it('unpacks an Exomizer 3 self-extracting file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sindri-exo-'));
    try {
      writeFileSync(join(dir, 'in.prg'), PROGRAM.prg);
      const p = spawnSync(EXOMIZER!, ['sfx', '0x1000', '-q', '-o', 'out.prg', 'in.prg'], { cwd: dir, encoding: 'utf8' });
      expect(p.status, p.stderr).toBe(0);
      const packed = new Uint8Array(readFileSync(join(dir, 'out.prg')));
      for (const r of [unpack(packed, { roms: null }), ...(roms ? [unpack(packed, { roms })] : [])]) {
        expect(r.saved!.entry).toBe(0x1000);
        const s = r.saved!;
        expect([...s.prg.subarray(2 + 0x1000 - s.start, 2 + 0x1000 - s.start + body.length)]).toEqual([...body]);
      }
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
