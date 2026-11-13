/* Music detection (spec 5.8, analyze/music.ts): a player's jump table, found when the program calls init and play, when
 * a snapshot was taken after init ran (only play traced, from the IRQ), when nothing traced reaches it, with play after
 * two or four JMPs or right after JMP init, and never in the program's own start-up table, code that calls the player
 * or a JMP pair in code that clears the SID. The player below plays three voices from a PAL note frequency table. */
import { describe, expect, it } from 'vitest';
import { analyze, findBlock, musicPlayData, openC64File, parseVsf, render, verify, type MusicInfo, type ProjectInput } from '../src';
import { noteTables } from '../src/analyze/music';
import { runPlayer } from '../src/c64/sidrun';
import { fromSource, snapshotOf } from './helpers/programs';

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const hex = (v: number[]) => v.map(x => `$${x.toString(16).padStart(2, '0')}`).join(',');
/** C-0 to B-7 for a PAL C64 (985248 Hz) */
const FREQ = Array.from({ length: 96 }, (_, n) => Math.min(0xffff, Math.round(16.3516 * 2 ** (n / 12) * 16777216 / 985248)));

/** `table` is the player's jump table; `entries` adds code at the labels it jumps to */
const player = (table = ' jmp init\n jmp play\n', entries = '') => `.pc = $1000
${table}init: sta song
 lda #$0f
 sta $d418
 rts
${entries}play: ldx #0
voice: ldy notes,x
 lda freqlo,y
 sta $d400,x
 lda freqhi,y
 sta $d401,x
 lda #$41
 sta $d404,x
 lda #$09
 sta $d405,x
 txa
 clc
 adc #7
 tax
 cpx #21
 bne voice
 rts
song: .byte 0
notes: .byte 12,0,0,0,0,0,0,24,0,0,0,0,0,0,36
freqlo: .byte ${hex(FREQ.map(f => f & 0xff))}
freqhi: .byte ${hex(FREQ.map(f => f >> 8))}
`;
/** a player that reads its song through the pointer at $fb (a 0 ends it) while the flag at $fd is set, a note a frame;
 *  `head` is its table and the start of its init (which goes on to set the volume) */
const songPlayer = (tune: number[], head = ' jmp init\n jmp play\ninit: lda #<song\n sta $fb\n lda #>song\n sta $fc\n lda #1\n sta $fd\n') => `.pc = $1000
${head} lda #$0f
 sta $d418
 rts
play: lda $fd
 beq quiet
 ldy #0
 lda ($fb),y
 beq quiet
 tay
 lda freqlo,y
 sta $d400
 sta $d407
 lda freqhi,y
 sta $d401
 sta $d408
 lda #$40
 sta $d404
 lda #$41
 sta $d404
 lda #$21
 sta $d40b
 lda #$09
 sta $d405
 sta $d40c
 lda #$f0
 sta $d406
 sta $d40d
 inc $fb
 bne quiet
 inc $fc
quiet: rts
freqlo: .byte ${hex(FREQ.map(f => f & 0xff))}
freqhi: .byte ${hex(FREQ.map(f => f >> 8))}
song: .byte ${hex(tune)},0
`;
/** a main program at $080d: `main` runs first, then the IRQ (calling `irq`) is installed and it loops */
const program = (main: string, irq: string) => `${BASIC}${main} sei
 lda #<irqh
 sta $0314
 lda #>irqh
 sta $0315
 cli
loop: jmp loop
irqh: ${irq}
 jmp $ea31
`;
/** a tune whose init does nothing, its song set in its data (as Booze Design's): `head` where JMP init would be, then
 *  play, which runs on into a JMP (to the code that holds the notes) followed by the code that starts the next row: a
 *  JMP with code after it that plays when it is run as a table, and runs only that part of the player */
const presetTune = (head: string, at = 0x1000) => `.pc = $${at.toString(16)}
${head}play: dec tempo
 bmi next
 jmp hold
next: lda #3
 sta tempo
 inc row
 lda row
 and #7
 tax
 ldy notes,x
 lda freqlo,y
 sta $d400
 lda freqhi,y
 sta $d401
 lda #$40
 sta $d404
 lda #$41
 sta $d404
 lda freqlo+12,y
 sta $d407
 lda freqhi+12,y
 sta $d408
 lda #$20
 sta $d40b
 lda #$21
 sta $d40b
hold: lda #$0f
 sta $d418
 lda #$09
 sta $d405
 sta $d40c
 lda #$f0
 sta $d406
 sta $d40d
 rts
${head.includes('tempo:') ? '' : 'tempo: .byte 0\nrow: .byte 0\n'}notes: .byte 24,28,31,36,31,28,24,19
freqlo: .byte ${hex(FREQ.map(f => f & 0xff))}
freqhi: .byte ${hex(FREQ.map(f => f >> 8))}
`;
/** A sample player (5.8b) the program starts with `jsr start` and leaves to its interrupt. `pwm`: as Voodoo People's,
 *  its NMI copied to $0080 (the vector at $fffa, the KERNAL out) writes pages of samples at $4000-$5fff to two voices'
 *  pulse widths, 6158 times a second; else through the KERNAL's NMI vector $0318, 4-bit samples right after the code
 *  to the volume. `samples: false` writes the same value each time (a timer for something else). */
const samplePlayer = (o: { pwm: boolean; samples?: boolean; latch?: number }) => {
  const latch = o.latch ?? 0x9f;
  const timer = ` lda #$${(latch & 0xff).toString(16)}\n sta $dd04\n lda #$${(latch >> 8).toString(16)}\n sta $dd05\n lda #$81\n sta $dd0d\n lda #$01\n sta $dd0e\n rts\n`;
  const value = o.samples === false ? ' lda #$08\n' : '';
  if (o.pwm) return `${BASIC} jsr start
 cli
loop: jmp loop
start: sei
 lda #$35
 sta $01
 ldx #0
copy: lda nmi_src,x
 sta $80,x
 inx
 cpx #nmi_end-nmi_src
 bne copy
 lda #$80
 sta $fffa
 lda #$00
 sta $fffb
 lda #$ff
 sta $d400
 sta $d401
 lda #$41
 sta $d404
${timer}nmi_src:
.pseudopc $80 {
nmi: pha
 tya
 pha
pos: ldy #0
smp: lda $4000,y
${value} sta $d402
 sta $d403
 lda $dd0d
 inc pos+1
 bne done
 inc smp+2
 lda smp+2
 cmp #$60
 bne done
 lda #$40
 sta smp+2
done: pla
 tay
 pla
 rti
}
nmi_end: brk
.pc = $4000
.byte ${hex(Array.from({ length: 0x2000 }, (_, i) => (i * 37 + (i >> 8) * 11) & 0xff))}
`;
  return `${BASIC} jsr start
 cli
loop: jmp loop
start: sei
 lda #<nmi
 sta $0318
 lda #>nmi
 sta $0319
 lda #0
 sta pos
${timer}nmi: pha
 txa
 pha
 ldx pos
 lda samples,x
${value} sta $d418
 inc pos
 lda $dd0d
 pla
 tax
 pla
 rti
pos: .byte 0
samples: .byte ${hex(Array.from({ length: 256 }, (_, i) => ((i * 5) >> 2) & 0x0f))}
`;
};
/** 4-bit samples at $4000-$47ff */
const SAMPLES = `.pc = $4000\n.byte ${hex(Array.from({ length: 0x800 }, (_, i) => ((i * 7) ^ (i >> 5)) & 0xff))}\n`;
/** A sample player the program's start sets up and then loops in (its init never returns), through $0318: the NMI
 *  plays the pointer at $fb on the volume. */
const loopingPlayer = `${BASIC} sei
 lda #<nmi
 sta $0318
 lda #>nmi
 sta $0319
 lda #0
 sta $fb
 lda #$40
 sta $fc
 lda #$7f
 sta $dd04
 lda #0
 sta $dd05
 lda #$81
 sta $dd0d
 lda #$01
 sta $dd0e
 cli
loop: inc $d020
 jmp loop
nmi: pha
 tya
 pha
 ldy #0
 lda ($fb),y
 and #$0f
 sta $d418
 inc $fb
 bne done
 inc $fc
 lda $fc
 cmp #$48
 bne done
 lda #$40
 sta $fc
done: lda $dd0d
 pla
 tay
 pla
 rti
${SAMPLES}`;
/** A sample player whose samples a sequencer in the program's raster IRQ starts (as Wonderland IV's): init (called)
 *  sets the NMI and the timer; the NMI is two halves that point $0318 at each other, the low nibble and then the high
 *  one, while the pointer at $fb has not reached the end page at $fd; the IRQ starts a sample every 25 frames. */
const sequencedPlayer = `${BASIC} jsr start
 sei
 lda #<irqh
 sta $0314
 lda #>irqh
 sta $0315
 cli
loop: jmp loop
start: lda #<nmi1
 sta $0318
 lda #>nmi1
 sta $0319
 lda #0
 sta $fb
 lda #$40
 sta $fc
 sta $fd
 lda #$7f
 sta $dd04
 lda #0
 sta $dd05
 lda #$81
 sta $dd0d
 lda #$01
 sta $dd0e
 rts
nmi1: pha
 tya
 pha
 lda $fc
 cmp $fd
 beq q1
 ldy #0
 lda ($fb),y
 sta $02
 and #$0f
 sta $d418
q1: lda #<nmi2
 sta $0318
 lda #>nmi2
 sta $0319
 lda $dd0d
 pla
 tay
 pla
 rti
nmi2: pha
 lda $fc
 cmp $fd
 beq q2
 lda $02
 lsr
 lsr
 lsr
 lsr
 sta $d418
 inc $fb
 bne q2
 inc $fc
q2: lda #<nmi1
 sta $0318
 lda #>nmi1
 sta $0319
 lda $dd0d
 pla
 rti
irqh: inc $d019
 dec count
 bpl out
 lda #25
 sta count
 lda #0
 sta $fb
 lda #$40
 sta $fc
 lda #$44
 sta $fd
out: jmp $ea81
count: .byte 0
${SAMPLES}`;
const project = (src: string): ProjectInput => ({ name: 'music', files: [fromSource('music.prg', src)] });
const music = (p: ProjectInput) => analyze(p).music.map((m: MusicInfo) => [m.start, m.init, m.play]);

describe('music detection', () => {
  it('finds a player whose init and play the program calls, with its note table and the data after the code', () => {
    const p = project(program(' lda #0\n jsr $1000\n', 'jsr $1003') + player());
    const A = analyze(p);
    expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    expect(A.music[0].why).toEqual(expect.arrayContaining(['JMP init / JMP play table', 'init and play both called from outside', 'play called from the IRQ']));
    expect(A.music[0].why.some(w => /^note frequency table at \$10/.test(w))).toBe(true);
    // the block holds the tables after the code
    expect(A.music[0].end).toBe(p.files[0].load + p.files[0].bytes.length);
    expect(findBlock(A.blocks, 0x1000)?.type).toBe('music');
  });

  it('finds the player in a VICE snapshot taken after init ran: only play is traced, from the IRQ', () => {
    // the program called init and installed its IRQ before the snapshot; the CPU is in the main loop at $0900
    const src = `.pc = $0900\nloop: jmp loop\nirqh: jsr $1003\n jmp $ea31\n.pc = $0314\n.byte <irqh, >irqh\n` + player();
    const o = openC64File('tune.vsf', snapshotOf(src, 0x0900));
    expect(o.entries).toEqual([0x0900, 0x0903]);
    const p: ProjectInput = { name: 'tune', files: [o], entries: o.entries };
    const A = analyze(p);
    expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    expect(A.music[0].why).toEqual(expect.arrayContaining(['play called from the IRQ']));
    expect(A.music[0].why.some(w => /instructions decoded from the table \(the trace did not reach them\)/.test(w))).toBe(true);
    // the source loads it as a .sid and the IRQ calls music.play; it still assembles to the same bytes
    const R = render(A, p);
    const asm = Object.entries(R.files).find(([n]) => n.endsWith('.asm') && !n.startsWith('include/'))![1] as string;
    expect(asm).toContain('.var music = LoadSid("music/music_1000.sid")');
    expect(asm).toContain('jsr music.play');
    expect(verify(A, R).ok).toBe(true);
  });

  it('decodes a player nothing traced reaches when its table starts a page and its code reads a note table', () => {
    expect(music(project(`${BASIC} rts\n` + player()))).toEqual([[0x1000, 0x1000, 0x1003]]);
    // off a page boundary, with nothing calling it, its code alone does not make it a player: running it does
    const off = analyze(project(`${BASIC} rts\n` + player().replace('.pc = $1000', '.pc = $1040'))).music;
    expect(off.map(m => [m.start, m.init, m.play])).toEqual([[0x1040, 0x1040, 0x1043]]);
    expect(off[0].why).toContain('init and play run: 13 SID registers and 3 notes in 3 s');
    expect(off[0].run).toEqual({ regs: 13, notes: 3, seconds: 30 });
  });

  it('finds a music file loaded on its own: its table at the load address, the program\'s start, nothing calling it', () => {
    const p = project(player());
    expect(analyze(p).entry).toBe(0x1000);
    expect(music(p)).toEqual([[0x1000, 0x1000, 0x1003]]);
  });

  it('takes a tune whose init does nothing (an rts where JMP init would be), not a JMP inside its play code (Codeboys)', () => {
    // loaded on its own: the rts, the tempo and row in the two bytes after it, play at +3
    const p = project(presetTune(' rts\ntempo: .byte 0\nrow: .byte 0\n'));
    const A = analyze(p);
    expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    expect(A.music[0].why).toEqual(expect.arrayContaining(['an init that does nothing (rts), then the play code at +3', 'init and play run: 11 SID registers and 76 notes in 3 s']));
    expect(A.music[0].end).toBe(p.files[0].load + p.files[0].bytes.length);
    // it plays from its block alone
    const m = A.music[0], d = musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play);
    expect(d.alone).toBeUndefined();
    // nop / rts and nop / nop / rts, with play called from the IRQ and init never called
    for (const [head, what] of [[' nop\n rts\n .byte 0\n', 'nop / rts'], [' nop\n nop\n rts\n', 'nop / nop / rts']]) {
      const B = analyze(project(program('', 'jsr $1003') + presetTune(head)));
      expect(B.music.map(x => [x.start, x.init, x.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
      expect(B.music[0].why).toEqual(expect.arrayContaining([`an init that does nothing (${what}), then the play code at +3`, 'play called from the IRQ']));
    }
  });

  it('takes an init that does nothing only at the start of a page, and only for a player that plays', () => {
    // off a page the rts is the end of some routine: the JMP inside the play code is all there is to find
    expect(music(project(presetTune(' rts\n .byte 0,0\n', 0x1040))).every(([, init]) => init !== 0x1040)).toBe(true);
    // a page that starts with an rts and code at +3 that writes the SID without playing notes
    expect(music(project(`${BASIC} jsr $1003\n rts\n.pc = $1000\n rts\n .byte 0,0\n lda #$0f\n sta $d418\n lda #$21\n sta $d404\n rts\n`))).toEqual([]);
  });

  it('takes a player whose tune starts quietly, not a part of its play routine that plays at once (The Lab, unpacked)', () => {
    // play waits 100 frames, then goes through `on`: a JMP followed by the code it runs (a JMP init / play code table
    // for the run), which plays from the first frame but runs the voice code before it
    const src = `.pc = $1000
 jmp init
 jmp play
init: lda #0
 sta wait
 lda #<song
 sta $fb
 lda #>song
 sta $fc
 rts
voices: lda #$0f
 sta $d418
 ldy #0
 lda ($fb),y
 tay
 lda freqlo,y
 sta $d400
 sta $d407
 lda freqhi,y
 sta $d401
 sta $d408
 lda #$40
 sta $d404
 lda #$41
 sta $d404
 lda #$21
 sta $d40b
 lda #$09
 sta $d405
 sta $d40c
 rts
play: lda wait
 cmp #100
 bcs on
 inc wait
 rts
on: jmp tick
tick: inc $fb
 jmp voices
wait: .byte 0
freqlo: .byte ${hex(FREQ.map(f => f & 0xff))}
freqhi: .byte ${hex(FREQ.map(f => f >> 8))}
song: .byte ${hex(Array.from({ length: 256 }, (_, i) => 12 + ((i * 5) % 48)))}
`;
    const p = project(src), A = analyze(p);
    expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    const m = A.music[0];
    expect(m.end).toBe(p.files[0].load + p.files[0].bytes.length);
    // the block plays on its own; cut before the code `on` jumps to, it runs out of it once the tune starts
    expect(musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play).alone).toBeUndefined();
    // `on`: the JMP to the byte after it
    let on = 0x1006;
    while (!(A.mem[on] === 0x4c && A.mem[on + 1] === ((on + 3) & 0xff) && A.mem[on + 2] === (on + 3) >> 8)) on++;
    expect(musicPlayData(A.mem.slice(0x1000, on + 3), 0x1000, 0x1000, 0x1003).alone).toBe(`play runs into $${(on + 3).toString(16)}, which is not loaded (call 101)`);
  });

  it('counts the registers a buffered player writes in one loop, and finds it on its own by running it', () => {
    const buffered = `.pc = $1000
 jmp init
 jmp play
init: lda #$0f
 sta buf+$18
 rts
play: ldx #0
voice: ldy notes,x
 lda freqlo,y
 sta buf,x
 lda freqhi,y
 sta buf+1,x
 lda #$41
 sta buf+4,x
 lda #$09
 sta buf+5,x
 txa
 clc
 adc #7
 tax
 cpx #21
 bne voice
 ldx #0
copy: lda buf,x
 sta $d400,x
 inx
 cpx #$19
 bne copy
 rts
notes: .byte 12,0,0,0,0,0,0,24,0,0,0,0,0,0,36
buf: .fill 25, 0
freqlo: .byte ${hex(FREQ.map(f => f & 0xff))}
freqhi: .byte ${hex(FREQ.map(f => f >> 8))}
`;
    const called = analyze(project(program(' lda #0\n jsr $1000\n', 'jsr $1003') + buffered)).music;
    expect(called.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    expect(called[0].why).toContain('writes 25 SID registers');
    expect(music(project(buffered.replace('.pc = $1000', '.pc = $1040')))).toEqual([[0x1040, 0x1040, 0x1043]]);
  });

  it('takes the song data the player reads through a pointer into the block, past a byte the program reads too', () => {
    const tune = Array.from({ length: 600 }, (_, i) => 12 + ((i * 5) % 48));
    const src = program(' lda #0\n jsr $1000\n', 'jsr $1003\n lda song+$40\n sta $0400') + songPlayer(tune);
    const p = project(src), A = analyze(p);
    expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    // the song ends with its 0, the file's last byte
    expect(A.music[0].end).toBe(p.files[0].load + p.files[0].bytes.length);
    expect(A.music[0].why.some(w => /^the song data its run read reaches \$/.test(w))).toBe(true);
  });

  it('plays a snapshot\'s player on from where it was when its init no longer starts it again', () => {
    // the first play call set the player up and changed its play entry to the main routine; init now stops the tune
    // (the flag at $fd) and calls play, which no longer sets it up again. The zero page holds where the song is
    const tune = Array.from({ length: 300 }, (_, i) => 12 + ((i * 7) % 48));
    const src = `.pc = $00fb\n.byte <(song+5), >song, 1\n.pc = $0900\nloop: jmp loop\nirqh: jsr $1003\n jmp $ea31\n.pc = $0314\n.byte <irqh, >irqh\n`
      + songPlayer(tune, ' jmp init\n jmp main\ninit: lda #0\n sta $fd\n jsr $1003\n rts\nstart: lda #<main\n sta $1004\n lda #>main\n sta $1005\n')
        .replace('play: lda $fd', 'main: lda $fd');
    const o = openC64File('tune.vsf', snapshotOf(src, 0x0900));
    const p: ProjectInput = { name: 'tune', files: [o], entries: o.entries };
    const A = analyze(p), m = A.music[0];
    expect(A.music.map(x => [x.init, x.play])).toEqual([[0x1000, 0x1003]]);
    // (with init it writes the SID no more: the minute's run stops after 10 s)
    expect(m.why.some(w => /^init does not start it again \(play writes no SID register in 500 calls\), play goes on from the snapshot: /.test(w))).toBe(true);
    // where the song is and the flag, as the snapshot has them (no SID module in this snapshot)
    const ram = parseVsf(o.vsf!).ram;
    expect(m.resume).toEqual([[0xfb, ram[0xfb]], [0xfc, ram[0xfc]], [0xfd, 1]]);
    // played with a routine after the block that puts them back as init: it plays with nothing else in memory
    const d = musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play, m.resume);
    expect(d.resume).toEqual({ at: m.end, bytes: 2 * new Set(m.resume!.map(([, v]) => v)).size + 2 * 3 + 1 });
    const mem = new Uint8Array(0x10000);
    mem.set(d.data, d.load);
    const r = runPlayer(mem, { init: d.init, play: d.play, frames: 100 });
    expect(r.notes).toBeGreaterThan(50);
    // without them it plays nothing
    expect(runPlayer(mem, { init: m.init, play: m.play, frames: 100 }).notes).toBe(0);
  });

  it('takes play from the entry the IRQ calls: the play code after two JMPs (+6) or four (+12)', () => {
    const two = player(' jmp init\n jmp sfx\n', 'sfx: sta $d40b\n rts\n').replace('play: ldx #0', 'play: ldx #0');
    expect(music(project(program(' lda #0\n jsr $1000\n', 'jsr $1006') + two.replace(' jmp sfx\n', ' jmp sfx\nplaycode:\n').replace('init: sta song', 'jmp play\ninit: sta song')))).toEqual([[0x1000, 0x1000, 0x1006]]);
    const four = ' jmp init\n jmp sfx\n jmp sfx\n jmp sfx\n jmp play\n';
    expect(music(project(program(' lda #0\n jsr $1000\n', 'jsr $100c') + player(four, 'sfx: sta $d40b\n rts\n')))).toEqual([[0x1000, 0x1000, 0x100c]]);
  });

  it('takes the play code right after JMP init when the program calls both', () => {
    const src = program(' lda #0\n jsr $1000\n', 'jsr $1003') + player(' jmp init\n').replace('init: sta song\n lda #$0f\n sta $d418\n rts\n', '').replace('song: .byte 0', 'init: sta song\n lda #$0f\n sta $d418\n rts\nsong: .byte 0');
    expect(music(project(src))).toEqual([[0x1000, 0x1000, 0x1003]]);
  });

  it('takes play from the entry the IRQ calls, not one the program calls (a volume entry)', () => {
    const table = ' jmp init\n jmp volume\n jmp play\n';
    const src = program(' lda #0\n jsr $1000\n lda #8\n jsr $1003\n', 'jsr $1006') + player(table, 'volume: sta $d418\n rts\n');
    expect(music(project(src))).toEqual([[0x1000, 0x1000, 0x1006]]);
  });

  it('is not fooled by the program\'s own start-up table or by a routine that calls init and play', () => {
    // BASIC starts the JMP table at $080d; the IRQ calls a routine at $0c00 that follows a JMP and calls play
    const src = `${BASIC} jmp start\n jmp $1000\n jmp $1003\nstart: lda #0\n jsr $1000\n sei\n lda #<irqh\n sta $0314\n lda #>irqh\n sta $0315\n cli\nloop: jmp loop\nirqh: jsr frame\n jmp $ea31\n`
      + `.pc = $0c00\n jmp start\nframe: inc $d020\n jsr $1003\n dec $d020\n rts\n` + player();
    expect(music(project(src))).toEqual([[0x1000, 0x1000, 0x1003]]);
  });

  it('takes the JMP init the program writes into place before it calls it, and plays from its target (Mathematica)', () => {
    // the file has $00 where JMP init is (Mathematica's player at $0800, where BASIC's zero byte is) and the target
    // after it, or nothing at all: the program writes the JMP (`lda #$4c / sta`), calls init there and play from the IRQ
    for (const [table, main] of [
      [' .byte 0, <init, >init\n jmp play\n', ' lda #$4c\n sta $1000\n'],
      [' .byte 0, 0, 0\n jmp play\n', ' lda #$4c\n sta $1000\n lda #<$1006\n sta $1001\n lda #>$1006\n sta $1002\n'],
    ]) {
      const p = project(program(`${main} lda #0\n jsr $1000\n`, 'jsr $1003') + player(table));
      const A = analyze(p);
      expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1006, 0x1003]]);
      expect(A.music[0].why).toEqual(expect.arrayContaining(['the program writes JMP $1006 at $1000 before it calls it: init is $1006', 'play called from the IRQ']));
      expect(A.music[0].run?.notes).toBeGreaterThan(0);
      // the block's own bytes play from that init (they have no JMP at $1000)
      const m = A.music[0], d = musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play);
      expect(d.alone).toBeUndefined();
    }
    // a byte the program writes two values into is no JMP it puts in place (a JMP switched on and off)
    const both = project(program(' lda #$4c\n sta $1000\n lda #0\n jsr $1000\n lda #$2c\n sta $1000\n', 'jsr $1003') + player(' .byte 0, <init, >init\n jmp play\n'));
    expect(music(both).some(([, init]) => init === 0x1006)).toBe(false);
  });

  it('finds a sample player by running the routine that starts its timer and then its NMI, as the timer calls it (Voodoo People)', () => {
    const p = project(samplePlayer({ pwm: true }));
    const A = analyze(p);
    expect(A.music).toHaveLength(1);
    const m = A.music[0], start = 0x0814;
    // init is the routine that starts the timer, nothing is called each frame
    expect([m.start, m.init, m.play]).toEqual([start, start, 0]);
    expect(m.digi).toMatchObject({ nmi: true, hz: 6158, latch: 0x9f, handler: 0x0080, vector: 0xfffa, port: 0x35, regs: [0xd402, 0xd403] });
    expect(m.digi!.values).toBeGreaterThan(200);
    // the block holds init and the NMI's source the copy loop reads; the samples it plays are its parts
    expect(m.end).toBeGreaterThan(0x0850);
    expect(m.end).toBeLessThan(0x0900);
    expect(m.digi!.parts).toEqual([[0x4000, 0x6000]]);
    expect(m.why[0]).toBe('a sample player: init $0814 starts CIA 2\'s timer (every 160 cycles, 6158 Hz) with its NMI at $0080 (vector $fffa)');
    expect(findBlock(A.blocks, start)?.type).toBe('music');
    // the samples are data, whatever they look like
    const s = findBlock(A.blocks, 0x4000)!;
    expect([s.type, s.end, s.props.sub, s.reason]).toEqual(['data', 0x6000, 'samples', 'samples and song of the sample player at $0814: its NMI reads them']);
    // and they play with the block: init wrapped, nothing to call each frame
    const d = musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play, undefined,
      { nmi: true, hz: m.digi!.hz, wrote: m.digi!.wrote, parts: m.digi!.parts.map(([s0, e]) => ({ load: s0, data: A.mem.slice(s0, e) })) });
    expect(d.alone).toBeUndefined();
    expect(d.wrapped?.init).toBe(start);
    expect(d.play).toBe(0);
  });

  it('finds a sample player through the KERNAL\'s NMI vector, its 4-bit samples to the volume in its block', () => {
    const A = analyze(project(samplePlayer({ pwm: false })));
    expect(A.music).toHaveLength(1);
    const m = A.music[0];
    expect([m.init, m.play]).toEqual([0x0814, 0]);
    expect(m.digi).toMatchObject({ nmi: true, vector: 0x0318, regs: [0xd418], values: 16, parts: [] });
    // the samples right after the code are the block's
    expect(m.end).toBe(A.files[0].load + A.files[0].bytes.length);
    expect(m.why[1]).toMatch(/^the NMI writes samples to \$d418 \(volume\) in every interrupt: 16 different values in \d+ s$/);
  });

  it('the fixture fixtures/prg/sample-demo.prg, which the e2e tests open, is the sample player as Voodoo People\'s', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { makePrg } = await import('../src');
    const f = fromSource('sample-demo.prg', samplePlayer({ pwm: true })), prg = makePrg(f.load, f.bytes);
    const path = join(__dirname, '../../../fixtures/prg/sample-demo.prg');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, prg);
    expect(new Uint8Array(readFileSync(path))).toEqual(prg);
  });

  it('gives a frame player whose init also starts samples (digi drums) its sample player, and keeps its play', () => {
    const drums = `init2: lda #<nmi
 sta $0318
 lda #>nmi
 sta $0319
 lda #$7f
 sta $dd04
 lda #0
 sta $dd05
 lda #$81
 sta $dd0d
 lda #$01
 sta $dd0e
 jmp init
nmi: pha
 txa
 pha
 ldx $02
 lda $3000,x
 sta $d418
 inc $02
 lda $dd0d
 pla
 tax
 pla
 rti
`;
    const p = project(program(' lda #0\n jsr $1000\n', 'jsr $1003') + player(' jmp init2\n jmp play\n', drums)
      + `.pc = $3000\n.byte ${hex(Array.from({ length: 256 }, (_, i) => (i * 3) & 0x0f))}\n`);
    const A = analyze(p);
    expect(A.music.map(m => [m.start, m.init, m.play])).toEqual([[0x1000, 0x1000, 0x1003]]);
    expect(A.music[0].run?.notes).toBeGreaterThan(0);
    expect(A.music[0].digi).toMatchObject({ nmi: true, vector: 0x0318, regs: [0xd418], parts: [[0x3000, 0x3100]] });
    expect(A.music[0].why).toEqual(expect.arrayContaining(['JMP init / JMP play table', expect.stringMatching(/^a sample player: init \$1000 starts CIA 2's timer/)]));
  });

  it('plays a sample player whose init never returns from what init left: the bytes it read, its vector, $01, its timer (Youthquake)', () => {
    const A = analyze(project(loopingPlayer));
    expect(A.music).toHaveLength(1);
    const m = A.music[0];
    expect([m.init, m.play]).toEqual([0x080d, 0]);
    expect(m.digi).toMatchObject({ loop: true, nmi: true, vector: 0x0318, regs: [0xd418], timer: { cia: 2, b: false, ctl: 1 }, latch: 0x7f, parts: [[0x4000, 0x4800]] });
    // the block is the NMI's code, not the program's start
    expect(m.start).toBeGreaterThan(0x0830);
    expect(m.why[0]).toBe('a sample player: init $080d, which does not return (it goes on into the program), leaves CIA 2\'s timer (every 128 cycles, 7697 Hz) with its NMI at $' + m.start.toString(16).padStart(4, '0') + ' (vector $0318)');
    // what init left: $01, the vector, the pointer at $fb (the zero page, which nothing loaded)
    expect(m.resume).toEqual(expect.arrayContaining([[1, 0x37], [0x0318, m.start & 0xff], [0x0319, m.start >> 8], [0xfb, 0], [0xfc, 0x40]]));
    const d = musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play, m.resume, { ...m.digi!, parts: m.digi!.parts.map(([s, e]) => ({ load: s, data: A.mem.slice(s, e) })) });
    expect(d.resume).toBeDefined();
    expect(d.alone).toBeUndefined();
    // the wrapper calls the routine that puts the bytes back, then starts CIA 2's timer A again ($7f, $81, $11)
    const w = [...d.data.subarray(d.wrapped!.at - d.load, d.wrapped!.at - d.load + d.wrapped!.bytes)];
    expect(w.slice(4, 7)).toEqual([0x20, d.wrapped!.init & 0xff, d.wrapped!.init >> 8]);
    expect(w.slice(7, 27)).toEqual([0xa9, 0x7f, 0x8d, 0x04, 0xdd, 0xa9, 0x00, 0x8d, 0x05, 0xdd, 0xa9, 0x81, 0x8d, 0x0d, 0xdd, 0xa9, 0x11, 0x8d, 0x0e, 0xdd]);
  });

  it('plays the samples a sequencer in the program\'s IRQ starts, with an NMI in two halves that point the vector at each other (Wonderland IV)', () => {
    const A = analyze(project(sequencedPlayer));
    expect(A.music).toHaveLength(1);
    const m = A.music[0], irqh = [...A.entryKind].find(([, k]) => k === 'irq')![0];
    expect([m.init, m.play]).toEqual([0x081f, 0]);
    expect(m.digi).toMatchObject({ nmi: true, vector: 0x0318, irq: { handler: irqh, kernal: true }, regs: [0xd418], values: 16 });
    expect(m.why[1]).toBe(`the program's IRQ at $${irqh.toString(16).padStart(4, '0')} starts the samples (a sequencer there): with it run once a frame the NMI plays`);
    // init is wrapped with the IRQ installed: $0314 to the handler, the raster interrupt on
    const d = musicPlayData(A.mem.slice(m.start, m.end), m.start, m.init, m.play, undefined, { ...m.digi!, parts: m.digi!.parts.map(([s, e]) => ({ load: s, data: A.mem.slice(s, e) })) });
    const w = [...d.data.subarray(d.wrapped!.at - d.load, d.wrapped!.at - d.load + d.wrapped!.bytes)];
    expect(w.slice(8, 23)).toEqual([0xa9, irqh & 0xff, 0x8d, 0x14, 0x03, 0xa9, irqh >> 8, 0x8d, 0x15, 0x03, 0xa9, 0x01, 0x8d, 0x1a, 0xd0]);
    expect(d.digi?.irq).toEqual({ handler: irqh, kernal: true });
    expect(d.alone).toBeUndefined();
  });

  it('takes no sample player that maps its samples through a table the program builds as it runs (Macho Programming)', () => {
    // the NMI writes the samples to the volume, and the cutoff through a table at $c000, which nothing loaded
    const src = samplePlayer({ pwm: false }).replace(' sta $d418\n', ' sta $d418\n tax\n lda $c000,x\n sta $d416\n').replace('((i * 5) >> 2) & 0x0f', 'i');
    expect(analyze(project(src.replace(/samples: \.byte .*/, `samples: .byte ${hex(Array.from({ length: 256 }, (_, i) => i))}`))).music).toEqual([]);
  });

  it('takes no timer interrupt for a sample player that writes the same value each time, or that comes a frame apart', () => {
    expect(analyze(project(samplePlayer({ pwm: true, samples: false }))).music).toEqual([]);
    expect(analyze(project(samplePlayer({ pwm: false, samples: false }))).music).toEqual([]);
    expect(analyze(project(samplePlayer({ pwm: false, latch: 0x4cc7 }))).music).toEqual([]);
  });

  it('does not take a JMP pair in code that clears the SID for a player', () => {
    const src = `${BASIC} ldx #$18\n lda #0\nclear: sta $d400,x\n dex\n bpl clear\n lda #$0f\n sta $d418\n jmp next\n jmp clear\nnext: sta $d404\n sta $d40b\n rts\n`;
    expect(music(project(src))).toEqual([]);
  });
});

describe('note frequency tables', () => {
  const at = (bytes: number[], a = 0x2000) => { const mem = new Uint8Array(0x10000); mem.set(bytes, a); return noteTables(mem, x => x >= 0x1000 && x < 0x4000); };
  it('finds the high bytes of a table, apart from the low bytes or in pairs with them', () => {
    expect(at([...FREQ.map(f => f & 0xff), ...FREQ.map(f => f >> 8)]).map(t => t.start)).toContain(0x2060);
    expect(at(FREQ.flatMap(f => [f & 0xff, f >> 8])).map(t => t.start)).toContain(0x2001);
  });
  it('ignores a ramp, a fill and a sine', () => {
    expect(at(Array.from({ length: 256 }, (_, i) => i))).toEqual([]);
    expect(at(Array(256).fill(0x20))).toEqual([]);
    expect(at(Array.from({ length: 256 }, (_, i) => Math.round(127 + 127 * Math.sin(i / 256 * 2 * Math.PI))))).toEqual([]);
  });
});
