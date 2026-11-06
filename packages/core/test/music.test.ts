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
