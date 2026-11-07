/* Loaders (analyze/loaders.ts): each known loader by its own code, taken from its source (Spindle 3.1 stage1.s, Spindle
 * 2.3's spin.exe, Krill's loader v194 hal-c64-c128.inc and install.s, Bitfire resident.asm, Sparkle sl.asm, Covert Bitops
 * loader v3 loader.s); the Action Replay's fastload, Warp*25 and tape loaders, Novaload, the Super Snapshot's turbo and
 * disk copier and the split freeze loader, by what their code does (written here from the cartridges' ROMs and the files
 * they save, a few instructions each); other disk loaders by drive
 * code, drive commands and a receive loop; tape and KERNAL loading; and the marks in the source. The programs below are
 * those loops (illegal opcodes as .byte), with a BASIC start that reaches them where the loader is called. */
import { describe, expect, it } from 'vitest';
import { analyze, createProject, demoProject, makeCrt, makeShowcase, openC64File, openCartridge, parsePrg, render, verify, type LoaderFinding, type ProjectInput } from '../src';
import { fromSource, snapshotOf } from './helpers/programs';

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const project = (src: string): ProjectInput => ({ name: 'loader', files: [fromSource('loader.prg', BASIC + src)] });
const loaders = (src: string): LoaderFinding[] => analyze(project(src)).loaders;
const ids = (src: string) => loaders(src).map(l => `${l.id}${l.sure === 'likely' ? '?' : ''}`);

const SPINDLE3 = ` jsr $0200
 rts
.pc = $0200
 lda #$18
 .byte $80,$01
 cmp #$38
 beq done
 sta $dd00
check: bit $dd00
 bmi xfer
 bvc check
done: rts
xfer: eor #$28
 sta $dd00
 ldx #8
recvloop: ora $00
 lsr
 lsr
 eor $dd00
 .byte $8f,$00,$dd
 lsr
 lsr
 iny
 sty store+1
 ora $dd00
 stx $dd00
 lsr
 lsr
 sta last+1
 lda #$c0
 and $dd00
 sta $dd00
last: ora #0
store: sta $0300
 lda $dd00
 stx $dd00
 bcc recvloop
 rts
`;

const KRILL = ` jsr getloop
 rts
.pc = $0300
getloop: lsr
 lsr
 ldx #$37
 ora $dcc9,x
 stx $dd02
 ror
 ror
 ldx #$3f
 .byte $8f
 .word merge+1
 and $dd00
 stx $dd02
merge: ora #$00
 sta $1000,y
 .byte $a7,$fb
 adc $dd00
 stx $dd02
 iny
 beq out
 lsr
 lsr
 ldx #$3f
 ora $dd00
 stx $dd02
 jmp getloop
out: rts
.pc = $2000
 .byte $4d,$2d,$45,$0b,$02,$4b,$52,$49,$4c,$4c,$2e
`;

const BITFIRE = ` jsr gloop
 rts
.pc = $0300
gloop: lsr
 lsr
 ldx $02
 ora $dd00
 stx $dd02
 ror
 ror
 ldx #$3f
 .byte $8f
 .word nibble+1
 and $dd00
 stx $dd02
nibble: ora #$00
 sta $b00b,y
 adc $dd00
 stx $dd02
 lsr
 lsr
 dey
 cpy #$01
 ldx #$3f
 ora $dd00
 stx $dd02
 bcs gloop
 rts
`;

const SPARKLE = ` jsr rcv
 rts
.pc = $0160
rcv: lda $dd00
 sty $dd00
 lsr
 lsr
 dex
 nop
 ldy #$c0
 ora $dd00
 sty $dd00
 lsr
 lsr
 cpx #$af
 beq chg
 ldy #$08
 ora $dd00
 sty $dd00
 lsr
 lsr
 sta lastbits+1
 lda #$c0
 and $dd00
 sta $dd00
lastbits: ora #$00
 sta $0300,x
 bvc rcv
chg: rts
`;

const COVERT = ` jsr fill
 rts
.pc = $0400
fill: bit $dd00
 bpl fill
wait: lda $d011
 clc
 sbc $d012
 and #$07
 beq wait
 lda #$10
 ora $dd00
 sta $dd00
 and #$03
 sta eor+1
 sta $dd00
 lda $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 cli
eor: eor #$00
 sta $0500,x
 rts
.pc = $2000
 .byte $20,$04,$04,$57,$2d,$4d
`;

/** a fast loader of no known kind: an installer, its drive code, the M-W/M-E commands and a 1-bit receive loop */
const OTHER = ` jsr install
 jsr receive
 rts
install: lda #8
 jsr $ffb1
 lda #$6f
 jsr $ff93
 ldx #0
send: lda mw,x
 jsr $ffa8
 inx
 cpx #6
 bne send
 jsr $ffae
 rts
receive: ldx #8
bit: lda $dd00
 asl
 ror $02
 lda $dd00
 lda $dd00
 lda $dd00
 dex
 bne bit
 rts
mw: .byte $4d,$2d,$57,$00,$05,$20
me: .byte $4d,$2d,$45,$00,$05
.pc = $3000
 sei
 lda $1800
 and #$04
 bne *-5
 lda #$08
 sta $1800
 lda $1c00
 ora #$04
 sta $1c00
 clv
 .byte $50,$fe
 lda $1c01
 sta $0300
 clv
 .byte $50,$fe
 lda $1c01
 sta $0301
 lda #$00
 sta $1800
 rts
`;

describe('loaders', () => {
  it('know Spindle 3 by its resident page and receive loop (eor $dd00 / sax $dd00)', () => {
    const [l] = loaders(SPINDLE3);
    expect(l).toMatchObject({ id: 'spindle', name: 'Spindle (lft)', sure: 'match' });
    expect(l.parts[0]).toMatchObject({ start: 0x0200, end: 0x0300, role: 'resident', what: 'resident page (jsr here to load the next part)' });
  });

  it('know Spindle 2 by its two resident pages at $0c00 and its table-driven loop', () => {
    const [l] = loaders(' jsr $0c90\n rts\n.pc = $0c90\n ldy $f6\n ldx $dd00\n sty $dd00\n eor $0c00,x\n ldy #8\n ldx $dd00\n sty $dd00\n eor $0c00,x\n rts\n');
    expect(l).toMatchObject({ id: 'spindle', parts: [{ start: 0x0c00, end: 0x0e00, role: 'resident' }] });
    expect(l.parts[0].what).toMatch(/^Spindle 2 receive loop/);
  });

  it("know Krill's loader by its receive loop, and its installer by its name next to M-E", () => {
    const [l] = loaders(KRILL);
    expect(l).toMatchObject({ id: 'krill', name: "Krill's loader (Krill/Plush)", sure: 'match' });
    expect(l.parts.map(p => p.role)).toEqual(['resident', 'command', 'text']);
    // the installer on its own: "M-E" $020b "KRILL."
    const inst = loaders(' rts\n.pc = $2000\n .byte $4d,$2d,$45,$0b,$02,$4b,$52,$49,$4c,$4c,$2e\n');
    expect(inst.map(x => [x.id, x.parts.map(p => p.role)])).toEqual([['krill', ['command', 'text']]]);
    // the name alone is any text
    expect(loaders(' rts\n.pc = $2000\n .byte $4b,$52,$49,$4c,$4c,$2e\n')).toEqual([]);
  });

  it('know Sparkle in the stack of a snapshot, which opens from $0200 without it', () => {
    // a later Sparkle: inx for dex, ora #$01 for ora #$00
    const later = SPARKLE.replace(' dex\n', ' inx\n').replace('lastbits: ora #$00', 'lastbits: ora #$01');
    expect(ids(later)).toEqual(['sparkle']);
    const vsf = snapshotOf(`.pc = $c000\n jsr $0160\n jmp $c000\n${later.replace(' jsr rcv\n rts\n', '')}`, 0xc000);
    const open = (zeroPage: boolean) => { const o = openC64File('s.vsf', vsf, { zeroPage }); return analyze({ name: 's', files: [o], entries: o.entries }).loaders; };
    const [out] = open(false);
    expect(out).toMatchObject({ id: 'sparkle', sure: 'match' });
    expect(out.parts).toEqual([{ start: 0x0160, end: 0x0193, role: 'resident', what: 'receive loop (lda $dd00 / sty $dd00), in the stack, which this snapshot is opened without', outside: true }]);
    // opened with the zero page and the stack, the loop is in the listing like any part
    const [inside] = open(true);
    expect(inside.parts.map(p => [p.start, p.role, !!p.outside])).toEqual([[0x0160, 'resident', false]]);
  });

  it('know Bitfire, Sparkle and the Covert Bitops loader by their loops', () => {
    expect(ids(BITFIRE)).toEqual(['bitfire']);
    expect(ids(SPARKLE)).toEqual(['sparkle']);
    const covert = loaders(COVERT);
    expect(covert.map(l => l.id)).toEqual(['covert']);
    expect(covert[0].parts.map(p => [p.role, p.what])).toEqual([
      ['resident', 'receive loop (waits for no badline, then lda $dd00 / lsr / lsr / eor $dd00 …)'],
      ['command', 'drive command M-W, stored backwards (its installer sends it from the end)'],
    ]);
    // the classic loop alone is many loaders'
    const classic = loaders(' jsr r\n rts\nr: lda $dd00\n lsr\n lsr\n eor $dd00\n lsr\n lsr\n eor $dd00\n lsr\n lsr\n eor $dd00\n rts\n');
    expect(classic.map(l => `${l.id}${l.sure}`)).toEqual(['fastloaderlikely']);
    expect(classic[0].parts[0].what).toMatch(/^receive loop: the classic 2-bit loop .* as in the Covert Bitops loader and many older loaders$/);
  });

  it('find any other fast loader by its drive code, drive commands, installer and receive loop', () => {
    const [l] = loaders(OTHER);
    expect(l).toMatchObject({ id: 'fastloader', name: 'A fast loader (not one of the known ones)', sure: 'likely' });
    const by = (role: string) => l.parts.filter(p => p.role === role);
    expect(by('drivecode')).toEqual([expect.objectContaining({ start: 0x3000 })]);
    expect(by('command').map(p => p.what)).toEqual(['drive command M-W $0500, 32 bytes into the drive', 'drive command M-E $0500: starts the code there in the drive']);
    expect(by('install')[0].what).toBe('talks to the drive through the KERNAL (LISTEN, SECOND, CIOUT, UNLSN): sends the drive code and its commands');
    expect(by('resident')[0].what).toBe('receive loop: reads the serial bus at $dd00 4 times (1-bit)');
  });

  it('know a tape turbo loader and the KERNAL LOAD', () => {
    expect(ids(' jsr t\n rts\nt: lda #$90\n sta $dc0d\nw: lda $dc0d\n and #$10\n beq w\n lda $dc04\n ldx #$19\n stx $dc0e\n rts\n')).toEqual(['tape?']);
    expect(loaders(' lda #1\n ldx #8\n ldy #1\n jsr $ffba\n lda #0\n jsr $ffd5\n rts\n')).toEqual([expect.objectContaining({ id: 'kernal', name: 'KERNAL LOAD', parts: [expect.objectContaining({ role: 'kernal' })] })]);
  });

  it('find nothing in programs without a loader (a VIC bank switch reads $dd00 once)', () => {
    expect(analyze(demoProject()).loaders).toEqual([]);
    const s = makeShowcase();
    expect(analyze({ name: 's', files: [parsePrg(s.name, s.prg)] }).loaders).toEqual([]);
    expect(loaders(' lda $dd00\n and #$fc\n ora #$02\n sta $dd00\n rts\n')).toEqual([]);
  });

  it('mark the parts in the source, above the line where each starts and ends, and still build byte-exact', () => {
    const p = project(OTHER);
    const A = analyze(p), R = render(A, p);
    expect(verify(A, R).ok).toBe(true);
    const text = R.files['loader.asm'] as string;
    expect(text).toContain('// loader found by Mimir Studio (the ==== lines mark their parts):\n//   A fast loader (not one of the known ones) (by its traits): reads the serial bus at $dd00 4 times (1-bit)\n');
    expect(text).toMatch(/\/\/ ==== A fast loader \(not one of the known ones\): drive command M-W \$0500, 32 bytes into the drive ====\n(\w+:\n)? +\.byte \$4d, \$2d, \$57/);
    expect(text).toContain('// ==== A fast loader (not one of the known ones): code for the 1541:');
    expect(text).toContain('// ==== end of A fast loader (not one of the known ones): its installer ====');
    // the marks are listing lines of their own
    expect(R.lines.filter(l => l.k === 'cmt' && l.mark).length).toBeGreaterThanOrEqual(6);
  });
});

/* The Action Replay (Datel). Its fastload receives a byte on a line with no badline; it keeps the code it copies to the
 * stack page and to the drive in its ROM, which is data there. */
const AR_GETBYTE = `getbyte: ldx $a9
wait: bit $dd00
 bvc wait
 sec
line: lda $d012
 sbc $aa
 bcc go
 and #$07
 beq line
go: lda $a8
 sta $dd00
 lda $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 stx $dd00
 eor $a8
 rts
`;
const AR_FASTLOAD = ` jsr getbyte
 rts
${AR_GETBYTE}.pc = $2000
stack: .byte $a9,$23,$8d,$00,$de,$b9,$00,$02,$91,$0f,$c8,$d0,$f8
.pc = $2100
drive: .byte $78,$20,$8f,$01,$a9,$7a,$8d,$02,$18,$20,$e9,$f5,$20,$62,$01,$4c,$00,$03
`;
/** the loader file it saves with a Warp*25 backup: three bytes a round onto the stack, decoded with eor #$f9 */
const AR_WARP = ` jsr recv
 jsr getbyte
 rts
recv: ldy #$50
loop: lda $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 pha
 lda $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 lsr
 lsr
 eor $dd00
 pha
 dey
 bpl loop
 ldy #$f0
 inc $01
store: pla
 eor #$f9
 dey
 sta ($ae),y
 bne store
 dec $01
 rts
${AR_GETBYTE}.pc = $2000
 .text "B-E 2 0 18 6"
`;
const B_E = ' rts\n.pc = $2000\n .byte $42,$2d,$45,$20,$32,$20,$30,$20,$31,$38,$20,$36\n';
/** a turbo or superturbo backup's loader, in the tape header at $0351 */
const AR_TAPE = `.pc = $0351
 lda #$0b
 sta $d011
 lda #$05
 sta $01
 sta $c0
d: dey
 bne d
 dex
 bne d
sync: jsr bit
 bcs sync
 jsr byte
 cmp #$52
 bne sync
 jsr byte
 cmp #$42
 bne sync
 rts
byte: lda #$80
 sta $b6
b: jsr bit
 ror $b6
 bcc b
 lda $b6
 rts
bit: lda #$10
w: bit $dc0d
 beq w
 lda $dd0d
 stx $dd0f
 lsr
 lsr
 inc $d020
 rts
`;
/** a bit as Turbo Tape 250's format has it (CIA2's timer B); the Action Replay 7.2 flashes the volume and the border with it */
const TT250 = (flash: boolean) => ` jsr bit
 rts
bit: lda #$10
w: bit $dc0d
 beq w
 lda $dd0d
 stx $dd07
 pha
 lda #$19
 sta $dd0f
 pla
${flash ? ' sta $d418\n sta $d020\n' : ''} lsr
 lsr
 rts
`;
const NOVALOAD = ` lda #$f4
 sta $dc04
 lda #$81
 sta $dc05
 jsr read
 rts
read: lda #$7f
r: pha
 inc $d020
 ldx #$11
 lda #$10
w: bit $dc0d
 beq w
 lda $dc05
 stx $dc0e
 eor #$80
 asl
 pla
 ror
 bcs r
 sta $aa
 rts
`;

describe("the Action Replay's loaders", () => {
  it('know its fastload by its own code, with the code it copies to the stack page and the drive', () => {
    const [l] = loaders(AR_FASTLOAD);
    expect(l).toMatchObject({ id: 'ar-fastload', name: 'Action Replay fastload (Datel)', sure: 'match' });
    expect(l.parts.map(p => [p.role, p.start])).toEqual([['resident', 0x0811], ['resident', 0x2000], ['drivecode', 0x2100]]);
    expect(l.parts[0].what).toBe('receives a byte: waits for the drive and for a line with no badline, then reads the serial bus four times');
    // code kept to run elsewhere is its whole span, as far as the file goes
    expect(l.parts[2]).toMatchObject({ end: 0x2112, what: 'code for the 1541 at $0150: it receives the rest of the drive code fast, then starts it at $0300' });
  });

  it('know the Warp*25 loader file, and B-E only with its code', () => {
    const found = loaders(AR_WARP);
    // the receive loop and the decoding are one routine here: one part
    expect(found.map(l => [l.id, l.parts.map(p => p.role)])).toEqual([['ar-fastload', ['resident']], ['ar-warp', ['resident', 'command']]]);
    expect(found[1].parts.map(p => p.what.split(':')[0])).toEqual(['receive loop', 'drive command B-E 2 0 18 x']);
    // MK4 banks the ROMs out the other way round
    expect(ids(AR_WARP.replace(' inc $01\n', ' dec $01\n').replace(' dec $01\n rts', ' inc $01\n rts'))).toEqual(['ar-fastload', 'ar-warp']);
    // other loaders start their drive code with the same B-E
    expect(loaders(B_E)).toEqual([]);
  });

  it('give what every disk loader has to its fastload when it finds more of its loaders', () => {
    const found = loaders(`${AR_WARP} .byte $4d,$2d,$57,$00,$05,$20\n`);
    expect(found.map(l => l.id)).toEqual(['ar-fastload', 'ar-warp']);
    expect(found[0].parts.map(p => p.what)).toContain('drive command M-W $0500, 32 bytes into the drive');
  });

  it("know a tape backup's loader in the tape header, and not as an unknown tape turbo", () => {
    const [l, ...rest] = analyze({ name: 't', files: [fromSource('t.prg', AR_TAPE)] }).loaders;
    expect(rest).toEqual([]);
    expect(l).toMatchObject({ id: 'ar-tape', name: 'Action Replay tape backups (Datel)' });
    expect(l.parts[0]).toMatchObject({ start: 0x0351, role: 'tape' });
    expect(l.parts.map(p => p.what.split(':')[0])).toContain('reads a bit');
  });

  it('know the 7.2 turbo tape by its flashes; Turbo Tape 250 elsewhere is a tape turbo timed with CIA2', () => {
    expect(ids(TT250(true))).toEqual(['ar-turbotape']);
    expect(ids(TT250(false))).toEqual(['tape?']);
  });

  it("know Novaload, which the 7.2's Nova transfer reads with Novaload's own code", () => {
    const [l] = loaders(NOVALOAD);
    expect(l).toMatchObject({ id: 'novaload', name: 'Novaload (Novagen)' });
    // the routine that sets the timer runs straight into the one that reads: one part
    expect(l.parts.map(p => [p.role, p.start])).toEqual([['tape', 0x080d]]);
    // its timer on its own is not enough
    expect(ids(' lda #$f4\n sta $dc04\n lda #$81\n sta $dc05\n rts\n')).toEqual([]);
  });

  it('know them in the banks of an Action Replay cartridge', () => {
    const rom = (src: string) => { const b = new Uint8Array(0x2000).fill(0xff), f = fromSource('b.prg', `.pc = $8000\n${src}`); b.set(f.bytes.subarray(0, 0x2000)); return b; };
    const empty = new Uint8Array(0x2000).fill(0xff);
    const crt = makeCrt({ name: 'AR', hw: 1, exrom: 0, game: 1, chips: [
      { bank: 0, load: 0x8000, bytes: empty }, { bank: 1, load: 0x8000, bytes: empty },
      { bank: 2, load: 0x8000, bytes: rom(AR_FASTLOAD.replace('.pc = $2000', '.pc = $9000').replace('.pc = $2100', '.pc = $9100')) },
      { bank: 3, load: 0x8000, bytes: rom(`.byte 0\n${AR_TAPE.replace('.pc = $0351\n', '')}`) },
    ] });
    const o = openCartridge('ar.crt', crt);
    const A = analyze(createProject({ files: o.files, cart: o.cart }));
    // bank 2's and bank 3's addresses
    expect(A.loaders.map(l => [l.id, l.parts[0].start.toString(16)])).toEqual([['ar-fastload', '28004'], ['ar-tape', '38001']]);
    expect(A.loaders[0].parts.map(p => p.start.toString(16))).toEqual(['28004', '29000', '29100']);
  });
});

/* The Super Snapshot V5 (LMS). Its turbo LOADs four bytes a handshake and stores them with code it copies to $0200;
 * SAVE sends each byte as two halves; the ROM keeps the drive code. It reads Warp*25 files with the Action Replay's
 * code. The disk copier takes a sector at a time into $0500; a backup broken into 2 files starts with a loader. */
const SS_TURBO = ` jsr recv
 jsr send
 rts
recv: bit $dd00
 bvs recv
 ldy #$03
 nop
 bit $80
r: lda $dd00
 lsr
 lsr
 nop
 nop
 ora $dd00
 lsr
 lsr
 nop
 nop
 ora $dd00
 lsr
 lsr
 nop
 nop
 ora $dd00
 sta $00aa,y
 dey
 bpl r
 rts
.pc = $0900
send: bit $dd00
 bpl send
line: sec
 lda $d012
 sbc $26
 bcc go
 and #$07
 cmp #$02
 bcc line
go: lda #$07
 sta $dd00
 rts
.pc = $2000
store: .byte $a9,$34,$85,$01,$a5,$aa,$91,$93,$c8,$98,$48,$a9,$37,$85,$01
.pc = $2100
drive: .byte $78,$20,$8d,$01,$20,$e9,$f5,$20,$5d,$01,$4c,$00,$03
`;
const SS_COPIER = ` ldy #$00
 jsr recv
 rts
recv: lda $dd00
 bmi recv
 ora #$17
 sta $dd00
w: lda $dd00
 bpl w
 and #$07
 sta $dd00
 nop
 lda $dd00
 lsr
 lsr
 nop
 eor $dd00
 lsr
 lsr
 pha
 pla
 eor $dd00
 lsr
 lsr
 nop
 eor $dd00
 eor #$f9
 sta $0500,y
 iny
 bne recv
 rts
`;
/** the first file of a backup broken into 2 files, from $080d (where its BASIC line starts it) */
const SPLIT = ` sei
 inc $01
 ldx #$10
 ldy #$00
l: lda $0847,y
 sta $d000,y
 iny
 bne l
 inc l+2
 inc l+5
 dex
 bne l
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
one: lda $bb
 bne o
 dec $bc
o: dec $bb
 inc $b7
 lda #$31
 sta ($bb),y
 rts
`;

describe("the Super Snapshot's loaders", () => {
  it('know its turbo by its own code, with the code it copies to $0200 and the drive', () => {
    const [l, ...rest] = loaders(SS_TURBO);
    expect(rest).toEqual([]);
    expect(l).toMatchObject({ id: 'ss-turbo', name: 'Super Snapshot turbo (LMS)', sure: 'match' });
    expect(l.parts.map(p => [p.role, p.start])).toEqual([['resident', 0x0814], ['resident', 0x0900], ['resident', 0x2000], ['drivecode', 0x2100]]);
    expect(l.parts[1].what).toBe('sends a byte (SAVE, the file copier): waits for the drive and for a line with no badline, then sends it as two halves from a table');
    expect(l.parts[3]).toMatchObject({ end: 0x210d, what: 'code for the 1541 at $0150: it receives the rest of the drive code fast, then starts it at $0300' });
  });

  it("take the Action Replay's Warp*25 code as the turbo's, which reads that format with it", () => {
    // the Action Replay's receive loop and decoding, with labels of their own
    const warp = AR_WARP.slice(AR_WARP.indexOf('recv:'), AR_WARP.indexOf(AR_GETBYTE)).replace(/\b(recv|loop|store)\b/g, 'w$1');
    const found = loaders(SS_TURBO.replace(' jsr send\n', ' jsr send\n jsr wrecv\n').replace(' rts\n.pc = $0900\n', ` rts\n${warp}.pc = $0900\n`));
    expect(found.map(l => l.id)).toEqual(['ss-turbo']);
    expect(found[0].parts.filter(p => /Action Replay/.test(p.what)).map(p => p.what)).toEqual(['receive loop: three bytes a round, pushed onto the stack (lda $dd00 / lsr / lsr / eor $dd00 … pha) (the Action Replay Warp*25\'s code)']);
    // the Action Replay's own loader file stays the Action Replay's
    expect(ids(AR_WARP)).toEqual(['ar-fastload', 'ar-warp']);
  });

  it('know the disk copier by the loop that takes a sector into $0500', () => {
    const [l] = loaders(SS_COPIER);
    expect(l).toMatchObject({ id: 'ss-copier', name: 'Super Snapshot copiers (LMS)', sure: 'match' });
    expect(l.parts.map(p => [p.role, p.start])).toEqual([['resident', 0x0813]]);
  });

  it("know the loader a backup broken into 2 files starts with, the Action Replay's too, and not as a fast loader", () => {
    const [l, ...rest] = loaders(SPLIT);
    expect(rest).toEqual([]);
    expect(l).toMatchObject({ id: 'freezer-split', name: 'Split freeze loader (Action Replay, Super Snapshot)' });
    expect(l.parts.map(p => p.start)).toEqual([0x080d]);
    // the Action Replay's copy as many pages as its backup has at the top of memory
    expect(ids(SPLIT.replace('ldx #$10', 'ldx #$2c'))).toEqual(['freezer-split']);
    // a drive command with it is not its
    expect(ids(`${SPLIT}.pc = $2000\n .byte $4d,$2d,$57,$00,$05,$20\n`)).toEqual(['freezer-split', 'fastloader?']);
  });

  it('find no loader in drive commands that only read the drive or set its device number', () => {
    expect(loaders(' rts\n.pc = $2000\n .byte $4d,$2d,$52,$fa,$02,$02\n')).toEqual([]);
    expect(loaders(' rts\n.pc = $2000\n .byte $4d,$2d,$57,$77,$00,$02,$48,$28\n')).toEqual([]);
    // code put into the drive and started is a loader
    expect(ids(' rts\n.pc = $2000\n .byte $4d,$2d,$57,$00,$05,$20\n')).toEqual(['fastloader?']);
    expect(ids(' rts\n.pc = $2000\n .byte $4d,$2d,$45,$00,$05\n')).toEqual(['fastloader?']);
  });

  it('know them in the banks of a Super Snapshot V5 cartridge', () => {
    const rom = (src: string) => { const b = new Uint8Array(0x4000).fill(0xff), f = fromSource('b.prg', `.pc = $8000\n${src}`); b.set(f.bytes.subarray(0, 0x4000)); return b; };
    const crt = makeCrt({ name: 'SS5', hw: 20, exrom: 0, game: 0, chips: [
      { bank: 0, load: 0x8000, bytes: rom(SS_TURBO.replace('.pc = $0900', '.pc = $85e6').replace('.pc = $2000', '.pc = $a1c1').replace('.pc = $2100', '.pc = $a200')) },
      { bank: 1, load: 0x8000, bytes: rom(' rts\n.pc = $b057\n .byte $4d,$2d,$52,$fa,$02,$02\n') },
      // the loader it writes as the first file, kept as data (made for $080d)
      { bank: 2, load: 0x8000, bytes: rom(` rts\n.pc = $8df2\n .byte ${[...fromSource('s.prg', `.pc = $080d\n${SPLIT}`).bytes].join(',')}`) },
      { bank: 3, load: 0x8000, bytes: rom(SS_COPIER) },
    ] });
    const o = openCartridge('ss5.crt', crt);
    const A = analyze(createProject({ files: o.files, cart: o.cart }));
    // bank 0's, bank 2's and bank 3's addresses; bank 1 only reads the drive
    expect(A.loaders.map(l => [l.id, l.parts[0].start.toString(16)])).toEqual([['ss-turbo', '8007'], ['freezer-split', '28df2'], ['ss-copier', '38006']]);
  });
});

/** fixtures/prg/loader-demo.prg (the e2e tests open it): an installer that sends drive code with M-W and starts it with
 *  M-E, the drive code, and a Spindle 3 resident page at $0c00 that the program calls */
export const LOADER_DEMO = OTHER.replace(' jsr receive\n', ' jsr $0c00\n') + SPINDLE3.replace(' jsr $0200\n rts\n.pc = $0200\n', '.pc = $0c00\n').replace('store: sta $0300', 'store: sta $0d00');

describe('the loader fixture', () => {
  it('is fixtures/prg/loader-demo.prg, which the e2e tests open', async () => {
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const { makePrg } = await import('../src');
    const f = fromSource('loader-demo.prg', BASIC + LOADER_DEMO), prg = makePrg(f.load, f.bytes);
    const path = join(__dirname, '../../../fixtures/prg/loader-demo.prg');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, prg);
    expect(new Uint8Array(readFileSync(path))).toEqual(prg);
    const A = analyze({ name: 'loader-demo', files: [f] });
    expect(A.loaders.map(l => [l.id, l.parts.map(p => p.role)])).toEqual([['spindle', ['install', 'command', 'command', 'resident', 'drivecode']]]);
  });
});
