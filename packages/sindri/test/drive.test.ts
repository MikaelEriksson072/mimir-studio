/* The 1541: the D64 as GCR tracks the way the head reads them, the DOS reading every sector through its job queue,
 * and programs that load more files from the disk: through the KERNAL, and with drive code of their own (sent with
 * M-W, started with M-E) that reads a sector and sends it over the serial bus bit by bit. The drive tests need
 * VICE's ROMs and its 1541 DOS ROM; without them only the GCR is tested. */
import { describe, expect, it } from 'vitest';
import { unpack } from '../src/index.ts';
import { findRoms } from '../src/node.ts';
import { Drive } from '../src/drive.ts';
import { d64ToDisk, sectorsOn, TRACK_BYTES, zoneOf } from '../src/gcr.ts';
import { d64Directory, d64File, d64Pick } from '../src/d64.ts';
import { asm, byteLines, SYS_LINE } from './asm.ts';
import { makeD64 } from './disk.ts';
import { noise } from './packers.ts';

const roms = findRoms();
const withDrive = !!roms?.drive;

/** the sectors on a GCR track, decoded: header fields and the 256 data bytes, with both checksums checked */
function decodeTrack(t: Uint8Array): { track: number; sector: number; id: number[]; data: number[]; ok: boolean }[] {
  const nibble = new Map([0x0a, 0x0b, 0x12, 0x13, 0x0e, 0x0f, 0x16, 0x17, 0x09, 0x19, 0x1a, 0x1b, 0x0d, 0x1d, 0x1e, 0x15].map((g, i) => [g, i]));
  const decode = (from: number, n: number) => {
    let bits = '';
    for (let k = 0; k < Math.ceil((n * 10) / 8); k++) bits += t[(from + k) % t.length].toString(2).padStart(8, '0');
    return Array.from({ length: n }, (_, i) => (nibble.get(parseInt(bits.slice(i * 10, i * 10 + 5), 2))! << 4) | nibble.get(parseInt(bits.slice(i * 10 + 5, i * 10 + 10), 2))!);
  };
  const out = [];
  for (let p = 0; p < t.length; p++) {
    if (t[p] !== 0xff || t[(p + 1) % t.length] === 0xff || t[(p + t.length - 1) % t.length] !== 0xff) continue;
    const h = decode(p + 1, 8);
    if (h[0] !== 0x08) continue;
    // the data block: after the gap, the next SYNC
    let q = p + 11;
    while (t[q % t.length] !== 0xff) q++;
    while (t[(q + 1) % t.length] === 0xff) q++;
    const d = decode(q + 1, 258);
    const sum = d.slice(1, 257).reduce((a, b) => a ^ b, 0);
    out.push({ track: h[3], sector: h[2], id: [h[5], h[4]], data: d.slice(1, 257), ok: d[0] === 0x07 && sum === d[257] && h[1] === (h[2] ^ h[3] ^ h[4] ^ h[5]) });
  }
  return out;
}

const offset = (t: number, s: number) => { let n = 0; for (let k = 1; k < t; k++) n += sectorsOn(k); return (n + s) * 256; };
const sectorBytes = (d64: Uint8Array, t: number, s: number) => [...d64.subarray(offset(t, s), offset(t, s) + 256)];

describe('the disk as GCR', () => {
  const d64 = makeD64([{ name: 'NOISE', prg: noise(20000) }]);
  for (let i = 0; i < 683; i++) d64[i * 256 + 7] ^= i & 0xff;
  const disk = d64ToDisk(d64);

  it('has every sector of every track, in order, with its header, data and checksums', () => {
    for (const track of [1, 17, 18, 24, 25, 30, 31, 35]) {
      const t = disk.tracks[track]!;
      expect(t.length).toBe(TRACK_BYTES[zoneOf(track)]);
      const sectors = decodeTrack(t);
      expect(sectors.map(s => s.sector)).toEqual([...Array(sectorsOn(track)).keys()]);
      for (const s of sectors) {
        expect(s).toMatchObject({ track, ok: true, id: [0x55, 0x54] });
        expect(s.data).toEqual(sectorBytes(d64, track, s.sector));
      }
    }
    expect(disk).toMatchObject({ name: 'TEST DISK', id: 'UT' });
    expect(disk.tracks[36]).toBeNull();
  });

  it('writes the errors of a D64 with error bytes into the sectors', () => {
    const errors = new Uint8Array(683).fill(1);
    errors[offset(1, 3) / 256] = 5; // 23: data checksum
    errors[offset(1, 4) / 256] = 2; // 20: no header
    const sectors = decodeTrack(d64ToDisk(Uint8Array.from([...d64, ...errors])).tracks[1]!);
    expect(sectors.find(s => s.sector === 3)!.ok).toBe(false);
    expect(sectors.map(s => s.sector)).not.toContain(4);
    expect(sectors.filter(s => s.ok)).toHaveLength(19);
  });

  it('reads the directory and files back', () => {
    const prg = noise(1000, 7);
    const disk = makeD64([{ name: 'FIRST', prg: asm(`${SYS_LINE}\nrts`).prg }, { name: 'SECOND', prg }]);
    expect(d64Directory(disk).map(e => [e.name, e.type, e.blocks])).toEqual([['FIRST', 'PRG', 1], ['SECOND', 'PRG', 4]]);
    expect([...d64File(disk, d64Pick(disk, 'SEC*')!)]).toEqual([...prg]);
    expect(d64Pick(disk)!.name).toBe('FIRST');
    expect(d64Pick(disk, 'THIRD')).toBeNull();
  });
});

describe.skipIf(!withDrive)('the 1541', () => {
  it('starts up and reads sectors anywhere on the disk through its DOS', () => {
    const d64 = makeD64([{ name: 'NOISE', prg: noise(60000, 3) }]);
    const d = new Drive(roms!.drive!);
    while (d.cycles < 2_500_000) d.step();
    d.insert(d64ToDisk(d64));
    for (const [t, s] of [[18, 0], [1, 0], [17, 20], [24, 18], [35, 16], [2, 9]]) {
      d.ram[0x06] = t; d.ram[0x07] = s; d.ram[0x00] = 0x80;
      const start = d.cycles;
      while (d.ram[0] >= 0x80 && d.cycles - start < 3_000_000) d.step();
      expect(d.ram[0], `track ${t} sector ${s}`).toBe(1);
      expect([...d.ram.subarray(0x300, 0x400)]).toEqual(sectorBytes(d64, t, s));
    }
  });
});

/** a program at $c000 behind a little data: the file the boot program loads */
const PART2 = asm(`
* = $c000
loop:  inc $d020
       dec $d021
       jmp loop
${byteLines(noise(600, 9))}
`);

/** a boot file that loads PART2 through the KERNAL (LOAD "PART2",8,1) and jumps to it */
const KERNAL_BOOT = asm(`${SYS_LINE}
       lda #5
       ldx #<name
       ldy #>name
       jsr $ffbd
       lda #1
       ldx #8
       ldy #1
       jsr $ffba
       lda #0
       jsr $ffd5
       bcs fail
       jmp $c000
fail:  inc $d020
       jmp fail
name:  .text "PART2"
`);

/** side 1's boot file: it asks for the other side, waits for a key and loads PART2 from it (LOAD "PART2",8,1), and
 *  asks again while the file is not there (Tower Power: "INSERT DISKSIDE 2 AND PRESS SPACE") */
const TURN_BOOT = asm(`${SYS_LINE}
ask:   ldx #0
show:  lda text,x
       beq wait
       jsr $ffd2
       inx
       bne show
wait:  jsr $ffe4
       beq wait
       lda #5
       ldx #<name
       ldy #>name
       jsr $ffbd
       lda #1
       ldx #8
       ldy #1
       jsr $ffba
       lda #0
       jsr $ffd5
       bcs ask
       jmp $c000
text:  .text "TURN DISK AND PRESS SPACE"
       .byte 13, 0
name:  .text "PART2"
`);

/** a backup saved as two files, as the Super Snapshot and the Action Replay write them: the first copies the page it
 *  holds to $d000 under the I/O, puts a "1" in front of the name it was loaded by and loads that file over itself,
 *  going on at $080d */
const SPLIT_FIRST = asm(`${SYS_LINE}
       sei
       inc $01
       ldx #$01
       ldy #$00
copy:  lda $0847,y
       sta $d000,y
       iny
       bne copy
       inc copy+2
       inc copy+5
       dex
       bne copy
       dec $01
       jsr one
       iny
       sty $b9
       lda #$08
       pha
       lda #$0c
       pha
       txa
       jmp $ffd5
one:   lda $bb
       bne o
       dec $bc
o:     dec $bb
       inc $b7
       lda #$31
       sta ($bb),y
       rts
${byteLines(noise(256, 5))}
`);
/** the second file: here it puts PART2's loop at $c000 and jumps there */
const SPLIT_SECOND = asm(`${SYS_LINE}
       ldx #0
copy:  lda part,x
       sta $c000,x
       inx
       bne copy
       jmp $c000
part:
${byteLines(PART2.prg.subarray(2, 258))}
`);

/** LOAD "<name>",8,1 through the KERNAL, the name at `label` */
const kernalLoad = (label: string, length: number) => `
       lda #${length}
       ldx #<${label}
       ldy #>${label}
       jsr $ffbd
       lda #1
       ldx #8
       ldy #1
       jsr $ffba
       lda #0
       jsr $ffd5`;

/** a trackmo's first part: it plays the music at $1000 in its interrupt, loads PART2 and jumps to it */
const MUSIC_PART = asm(`
* = $0e00
       sei
       lda #<irq
       sta $0314
       lda #>irq
       sta $0315
       cli
${kernalLoad('name', 5)}
       jmp $c000
irq:   jsr $1003
       jmp $ea31
name:  .text "PART2"
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

/** music on its own: a JMP table at $1000, play writes the SID from its tune and steps it on */
const TUNE = asm(`
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
${byteLines(noise(128, 5))}
`);

/** a trackmo's framework, as No Bounds has one: it loads the music after it starts, calls its init and plays it in
 *  its interrupt (subroutine calls into code it loaded: they return to it) */
const FRAMEWORK = asm(`
* = $c000
${kernalLoad('name', 4)}
       jsr $1000
       sei
       lda #<irq
       sta $0314
       lda #>irq
       sta $0315
       cli
loop:  jmp loop
irq:   jsr $1003
       jmp $ea31
name:  .text "TUNE"
`);

/** a part that writes a routine of its own next to it after it starts and calls it, and loads nothing */
const MAKES_CODE = asm(`
* = $c000
       ldx #19
cp:    lda own,x
       sta $c100,x
       dex
       bpl cp
loop:  jsr $c100
       jmp loop
own:   ${Array(6).fill('inc $d020').join('\n       ')}
       rts
       .byte 0
`);

/** a boot file that loads `name` through the KERNAL and starts it at $c000 */
const bootInto = (name: string) => asm(`${SYS_LINE}
${kernalLoad('name', name.length)}
       jmp $c000
name:  .text "${name}"
`);

/** a trackmo's boot file: it loads MUSIC_PART and starts it */
const TRACKMO_BOOT = asm(`${SYS_LINE}
${kernalLoad('name', 5)}
       jmp $0e00
name:  .text "MUSIC"
`);

/**
 * Drive code for $0500: it reads track 1 sector 0 into buffer 4 ($0700) through the job queue, pulls DATA low to
 * say it is ready, then sends the 256 bytes: a bit on DATA (low for 1) at every edge of CLK, which the C64 drives;
 * a last CLK pulse lets it go.
 */
const DRIVE_CODE = asm(`
* = $0500
       lda #1
       sta $0e
       lda #0
       sta $0f
       lda #$80
       sta $04
       cli
wait:  lda $04
       bmi wait
       sei
       lda #$02
       sta $1800
       ldy #0
byte:  lda $0700,y
       sta $85
       ldx #4
pair:
low:   lda $1800
       and #$04
       beq low
       jsr put
high:  lda $1800
       and #$04
       bne high
       jsr put
       dex
       bne pair
       iny
       bne byte
last:  lda $1800
       and #$04
       beq last
       lda #0
       sta $1800
       cli
       rts
put:   lda #0
       asl $85
       rol
       asl
       sta $1800
       rts
`).prg.subarray(2);

/** the DOS commands that send DRIVE_CODE (M-W, 32 bytes at a time) and start it (M-E), each with its length first */
function commands(code: Uint8Array, at: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < code.length; k += 32) {
    const part = [...code.subarray(k, k + 32)], a = at + k;
    out.push(6 + part.length, 0x4d, 0x2d, 0x57, a & 0xff, a >> 8, part.length, ...part);
  }
  out.push(5, 0x4d, 0x2d, 0x45, at & 0xff, at >> 8, 0);
  return out;
}

/** a boot file that sends the drive code over the command channel, then takes the sector to $c000 and runs it */
const FAST_BOOT = asm(`${SYS_LINE}
       lda #0
       jsr $ffbd
       lda #15
       ldx #8
       ldy #15
       jsr $ffba
       jsr $ffc0
       ldx #0
next:  lda cmds,x
       beq sent
       sta $fb
       inx
       stx $fc
       ldx #15
       jsr $ffc9
send:  ldx $fc
       lda cmds,x
       jsr $ffd2
       inc $fc
       dec $fb
       bne send
       jsr $ffcc
       ldx $fc
       jmp next
sent:  sei
       lda $dd00
       and #$07
       sta $fd
       sta $dd00
       ldx #0
pause: dex
       bne pause
ready: bit $dd00
       bmi ready
       ldy #0
rbyte: ldx #4
rpair: lda $fd
       ora #$10
       sta $dd00
       jsr delay
       lda $dd00
       eor #$80
       asl
       rol $fe
       lda $fd
       sta $dd00
       jsr delay
       lda $dd00
       eor #$80
       asl
       rol $fe
       dex
       bne rpair
       lda $fe
       sta $c000,y
       iny
       bne rbyte
       lda $fd
       ora #$10
       sta $dd00
       jsr delay
       lda $fd
       sta $dd00
       cli
       jmp $c000
delay: lda #12
       sta $fb
dl:    dec $fb
       bne dl
       rts
cmds:
${byteLines(commands(DRIVE_CODE, 0x0500))}
`);

/** the screen's rows as text when the program's first instruction at `at` runs (screen codes $00-$3f) */
/** The C64's RAM (a copy) when the program first gets to `at` */
function ramAt(prg: Uint8Array, at: number, o: object): Uint8Array {
  let ram: Uint8Array | null = null;
  unpack(prg, { roms, maxCycles: 5_000_000, ...o, onStep: (pc, m) => { if (pc === at && !ram) ram = m.ram.slice(); } });
  return ram!;
}

/** The screen's rows then, as text */
function rowsAt(prg: Uint8Array, at: number, o: object): string[] {
  const ram = ramAt(prg, at, o);
  const ch = (v: number) => (v < 0x20 ? String.fromCharCode(v + 64) : v < 0x40 ? String.fromCharCode(v) : '#');
  return Array.from({ length: 25 }, (_, r) => Array.from(ram.subarray(0x0400 + 40 * r, 0x0428 + 40 * r), ch).join('').trimEnd());
}

describe.skipIf(!withDrive)('programs that load from the disk', () => {
  it('has the KERNAL print SEARCHING FOR and LOADING for the LOAD at the prompt, so READY. and RUN or SYS go on rows 10 and 11 as on a C64', () => {
    // VICE after LOAD"MY PROGRAM",8,1 and RUN typed, and its autostart (LOAD"*",8,1): LOAD on row 6, SEARCHING FOR
    // and the name on row 8, LOADING on row 9, READY. on row 10, RUN on row 11 (without the messages: READY. on row 8)
    const prg = asm(`${SYS_LINE}\nloop:  jmp loop`).prg, mc = asm('* = $c000\nloop:  jmp loop').prg;
    const disk = makeD64([{ name: 'MY PROGRAM', prg }, { name: 'MC', prg: mc }]);
    expect(rowsAt(prg, 0x080d, { disk }).slice(5, 13)).toEqual(['READY.', 'LOAD"MY PROGRAM",8,1', '', 'SEARCHING FOR MY PROGRAM', 'LOADING', 'READY.', 'RUN', '']);
    expect(rowsAt(mc, 0xc000, { disk }).slice(5, 13)).toEqual(['READY.', 'LOAD"MC",8,1', '', 'SEARCHING FOR MC', 'LOADING', 'READY.', 'SYS49152', '']);
    // a file alone loads as from a disk, as VICE's autostart of a D64 types it
    expect(rowsAt(prg, 0x080d, {}).slice(5, 13)).toEqual(['READY.', 'LOAD"*",8,1', '', 'SEARCHING FOR *', 'LOADING', 'READY.', 'RUN', '']);
  });

  it('types LOAD"name",8,1 as VICE does, so BASIC leaves what it leaves on a C64: $b8, $49, the name, the input buffer', () => {
    // VICE at $080d after LOAD"MY PROGRAM",8,1 and RUN typed with -keybuf: the screen and $0002-$03ff the same but for
    // the jiffy clock, the cursor's blink and RETURN in the keyboard matrix; $b8 is the secondary address BASIC passed
    // SETLFS in A, $49 the device it parsed, and the input buffer the tokenized RUN over the rest of the LOAD line
    const prg = asm(`${SYS_LINE}\nloop:  jmp loop`).prg;
    const ram = ramAt(prg, 0x080d, { disk: makeD64([{ name: 'MY PROGRAM', prg }]) });
    expect([0xb7, 0xb8, 0xb9, 0xba, 0x49, 0x35, 0x36, 0x50].map(a => ram[a])).toEqual([10, 1, 0x60, 8, 8, 0x00, 0xa0, 0x19]);
    expect(ram[0xbb] | (ram[0xbc] << 8)).toBe(0x9ff6);
    expect(String.fromCharCode(...ram.subarray(0x9ff6, 0xa000))).toBe('MY PROGRAM');
    expect([...ram.subarray(0x0200, 0x0213)]).toEqual([0x8a, 0, 0x4e, 0, ...[...' PROGRAM",8,1'].map(c => c.charCodeAt(0)), 0, 0x2c]);
  });

  it('types a byte of the name that typing does not give back as ?, which the drive takes for any character', () => {
    // a lowercase letter ($61) is a graphics character at the prompt and comes back as $c1, DEL deletes: A?B and C?D
    const prg = asm(`${SYS_LINE}\nloop:  jmp loop`).prg;
    for (const [name, typed] of [['A\x61B', 'A?B'], ['C\x14D', 'C?D']]) {
      const disk = makeD64([{ name, prg }]);
      expect(rowsAt(prg, 0x080d, { disk }).slice(6, 9)).toEqual([`LOAD"${typed}",8,1`, '', `SEARCHING FOR ${typed}`]);
    }
  });

  it('leaves the zero page as the KERNAL\'s serial LOAD does: $b9 $60, $94 and $a3 $40, $95 $ff, the last byte taken in $a4', () => {
    // VICE at $080d after its autostart (LOAD"*",8,1) or LOAD"END",8 typed, with true drive emulation or without: the
    // KERNAL makes the secondary address $60 for the load and never puts it back (Sindri left 1, and 0 in the others)
    const prg = asm(`${SYS_LINE}\nloop:  jmp loop\n       .byte $5a`).prg;
    const disk = makeD64([{ name: 'END', prg }]);
    for (const o of [{ disk }, {}]) {
      const ram = ramAt(prg, 0x080d, o);
      expect([0xb9, 0x94, 0xa3, 0x95, 0xa4].map(a => ram[a])).toEqual([0x60, 0x40, 0x40, 0xff, 0x5a]);
    }
  });

  it('follows a KERNAL LOAD of the next file through the drive', () => {
    const disk = makeD64([{ name: 'BOOT', prg: KERNAL_BOOT.prg }, { name: 'PART2', prg: PART2.prg }]);
    const r = unpack(KERNAL_BOOT.prg, { roms, disk });
    expect(r.drive).toMatch(/^1541 with "TEST DISK" UT, \d+ bytes read$/);
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(r.saved).toMatchObject({ entry: 0xc000, start: 0xc000, end: PART2.end });
    expect([...r.saved!.prg]).toEqual([...PART2.prg]);
  });

  it('turns to the next side when the program asks for it and waits, and goes on loading from that one', () => {
    const side1 = makeD64([{ name: 'BOOT', prg: TURN_BOOT.prg }], [], 'SIDE 1', 'S1');
    const side2 = makeD64([{ name: 'PART2', prg: PART2.prg }], [], 'SIDE 2', 'S2');
    // with side 1 alone it asks for ever
    expect(unpack(TURN_BOOT.prg, { roms, disk: side1 }).layers.map(l => l.entry)).toEqual([0x080d]);
    const r = unpack(TURN_BOOT.prg, { roms, disk: side1, disks: [side2] });
    expect(r.drive).toMatch(/^1541 with "SIDE 1" S1, then "SIDE 2" S2 at \d+\.\d s, \d+ bytes read$/);
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    const s = r.saved!;
    expect(s.entry).toBe(0xc000);
    expect([...s.prg.subarray(2 + 0xc000 - s.start, 2 + PART2.end + 1 - s.start)]).toEqual([...PART2.prg.subarray(2)]);
  });

  it('loads the file by its name on the disk, as LOAD"name",8,1 leaves it: a split freeze loads "1" and the name', () => {
    const disk = makeD64([{ name: 'SPLIT', prg: SPLIT_FIRST.prg }, { name: '1SPLIT', prg: SPLIT_SECOND.prg }]);
    const r = unpack(SPLIT_FIRST.prg, { roms, disk });
    expect(r.stop.reason).toBe('settled');
    // (the second file, loaded over the first and gone on with at $080d where the first ran, is a layer of its own)
    expect(r.layers.map(l => [l.entry, l.via])).toEqual([[0x080d, 'start'], [0x080d, 'rts'], [0xc000, 'jmp']]);
    expect(r.saved).toMatchObject({ entry: 0xc000 });
  });

  it('keeps the music an earlier part loaded when the part it loads next plays it on', () => {
    const disk = makeD64([{ name: 'BOOT', prg: TRACKMO_BOOT.prg }, { name: 'MUSIC', prg: MUSIC_PART.prg }, { name: 'PART2', prg: PART2.prg }]);
    const r = unpack(TRACKMO_BOOT.prg, { roms, disk });
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0x0e00, 0xc000]);
    // from the interrupt handler to the music's end: the start-up code before it and the name it loaded by were spent
    const irq = MUSIC_PART.labels.irq;
    expect(r.layers[2].kept).toEqual([{ layer: 1, start: irq, end: MUSIC_PART.end }]);
    const s = r.saved!;
    expect(s).toMatchObject({ entry: 0xc000, start: irq, end: PART2.end });
    expect([...s.prg.subarray(2 + 0xc000 - irq)]).toEqual([...PART2.prg.subarray(2)]);
    // the music's code as it was loaded; its tune has stepped on as it played
    const tune = MUSIC_PART.labels.tune, at = (a: number, prg: Uint8Array, load: number) => prg[a - load + 2];
    for (let a = 0x1000; a < tune; a++) expect(at(a, s.prg, irq)).toBe(at(a, MUSIC_PART.prg, 0x0e00));
    expect(at(tune + 1, s.prg, irq)).toBe(at(tune + 1, MUSIC_PART.prg, 0x0e00));
  });

  it('keeps the music a framework loaded after it started and plays, as it was when the run stopped', () => {
    const boot = bootInto('FRAME');
    const disk = makeD64([{ name: 'BOOT', prg: boot.prg }, { name: 'FRAME', prg: FRAMEWORK.prg }, { name: 'TUNE', prg: TUNE.prg }]);
    const r = unpack(boot.prg, { roms, disk });
    // the calls into the music returned to the framework: it is the newest layer
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(r.layers[1].calls).toEqual([{ entry: 0x1000, via: 'jsr' }, { entry: 0x1003, via: 'jsr' }]);
    expect(r.layers[1].loaded).toEqual([{ start: 0x1000, end: TUNE.end }]);
    expect(r.layers[1].kept).toEqual([]);
    const s = r.saved!;
    expect(s).toMatchObject({ layer: 1, entry: 0xc000, start: 0x1000, end: FRAMEWORK.end });
    const at = (a: number) => s.prg[a - s.start + 2];
    // the framework as it started, and the music as the run left it: its code as loaded, its tune stepped on
    expect(Array.from({ length: FRAMEWORK.end - 0xc000 + 1 }, (_, i) => at(0xc000 + i))).toEqual([...FRAMEWORK.prg.subarray(2)]);
    const tune = TUNE.labels.tune;
    expect(Array.from({ length: tune - 0x1000 }, (_, i) => at(0x1000 + i))).toEqual([...TUNE.prg.subarray(2, 2 + tune - 0x1000)]);
    expect(at(tune)).not.toBe(TUNE.prg[2 + tune - 0x1000]);
    expect(at(tune + 1)).toBe(TUNE.prg[2 + tune + 1 - 0x1000]);
  });

  it('saves a part as it started when it makes code of its own and loads nothing more', () => {
    const boot = bootInto('PART');
    const disk = makeD64([{ name: 'BOOT', prg: boot.prg }, { name: 'PART', prg: MAKES_CODE.prg }]);
    const r = unpack(boot.prg, { roms, disk });
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(r.layers[1].calls).toEqual([{ entry: 0xc100, via: 'jsr' }]);
    // the drive lets go of the bus after the load ended, while the part has started: that is not loading
    expect(r.layers[1].loaded).toEqual([]);
    expect([...r.saved!.prg]).toEqual([...MAKES_CODE.prg]);
  });

  it('follows drive code of the program\'s own that sends a sector over the serial bus', () => {
    const sector = PART2.prg.subarray(2, 258);
    const disk = makeD64([{ name: 'BOOT', prg: FAST_BOOT.prg }], [{ track: 1, sector: 0, bytes: sector }]);
    const r = unpack(FAST_BOOT.prg, { roms, disk });
    expect(r.layers.map(l => l.entry)).toEqual([0x080d, 0xc000]);
    expect(r.saved).toMatchObject({ entry: 0xc000, start: 0xc000, end: 0xc0ff });
    expect([...r.saved!.prg.subarray(2)]).toEqual([...sector]);
  });

  it('stops at the load without a disk, or without the DOS ROM', () => {
    const disk = makeD64([{ name: 'BOOT', prg: KERNAL_BOOT.prg }, { name: 'PART2', prg: PART2.prg }]);
    const none = unpack(KERNAL_BOOT.prg, { roms });
    expect(none.stop).toMatchObject({ reason: 'load', detail: 'loads "PART2" from device 8' });
    expect(none.drive).toBeNull();
    const noDos = unpack(KERNAL_BOOT.prg, { roms: { ...roms!, drive: undefined }, disk });
    expect(noDos.stop.reason).toBe('load');
    expect(noDos.drive).toBe('no 1541 DOS ROM: the disk was not used');
    expect(unpack(KERNAL_BOOT.prg, { roms: null, disk }).drive).toBe('the stand-ins have no serial bus: the disk was not used');
  });
});

describe("the 1541's address decoding", () => {
  // the drive decodes A15 and A10-A12 only: its RAM and VIAs at $0000-$1fff are there again at $2000, $4000 and
  // $6000 (Elite's Disk-Speed drive code calls itself at $2303 and $234e)
  it('has its RAM and VIAs at $2000, $4000 and $6000 too, for the CPU as well', () => {
    const d = new Drive(new Uint8Array(0x4000));
    d.write(0x2345, 0xab);
    expect(d.ram[0x345]).toBe(0xab);
    for (const a of [0x0345, 0x2345, 0x4345, 0x6345]) expect(d.read(a), `$${a.toString(16)}`).toBe(0xab);
    d.write(0x7c03, 0x5a); // VIA 2's port A direction, through the mirror at $6000
    expect(d.read(0x1c03)).toBe(0x5a);
    // jsr $2510 at $0500, which stores $42 at $0600 through $4600 and returns
    d.ram.set([0x20, 0x10, 0x25, 0xea], 0x0500);
    d.ram.set([0xa9, 0x42, 0x8d, 0x00, 0x46, 0x60], 0x0510);
    d.cpu.pc = 0x0500; d.cpu.s = 0xff;
    for (let i = 0; i < 4; i++) d.cpu.step();
    expect(d.ram[0x600]).toBe(0x42);
    expect(d.cpu.pc).toBe(0x0503);
  });
});
