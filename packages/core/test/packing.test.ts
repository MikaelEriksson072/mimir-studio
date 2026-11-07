/* Packed programs: a decruncher stub in front of compressed data is reported, plain programs are not.
 * (The thresholds were calibrated on a few hundred PRGs from the CSDB archive, see src/packing.ts.) */
import { describe, expect, it } from 'vitest';
import { analyze, detectPacking, makeDemo, OPC, packerSignature, parsePrg } from '../src';
import { allOpcodesProgram, fromSource } from './helpers/programs';

/** 10 SYS2061, a decruncher that copies itself to $0100 and jumps there, then `data` from $0830 */
function packedPrg(data: Uint8Array) {
  const stub = fromSource('stub.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n sei\n ldx #0\nl: lda $0830,x\n sta $0100,x\n inx\n bne l\n jmp $0100\n.pc = $082f\n .byte 0');
  const bytes = new Uint8Array(0x0830 - 0x0801 + data.length);
  bytes.set(stub.bytes);
  bytes.set(data, 0x0830 - 0x0801);
  return { name: 'packed.prg', load: 0x0801, bytes };
}
/** 10 SYS2061, a freezer backup's depacker of the shape `code` gives (from $080d), then `data` from $0900 */
function backupPrg(code: string, data: Uint8Array) {
  const stub = fromSource('backup.prg', `.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n sei\n lda #$7f\n sta $dd0d\n lda #$34\n sta $01\n ldx #$0c\n ldy #$00\nl: lda $0900,y\n sta $ff00,y\n dey\n cpy #$ff\n bne l\n${code}\n.pc = $08ff\n .byte 0`);
  const bytes = new Uint8Array(0x0900 - 0x0801 + data.length);
  bytes.set(stub.bytes);
  bytes.set(data, 0x0900 - 0x0801);
  return { name: 'backup.prg', load: 0x0801, bytes };
}
const random = (n: number, values = 256, seed = 7) => { let x = seed; return Uint8Array.from({ length: n }, () => { x = (x * 1103515245 + 12345) >>> 0; return (x >>> 16) % values; }); };
const check = (f: { name: string; load: number; bytes: Uint8Array }) => detectPacking(analyze({ name: 'p', files: [f] }));

describe('packing', () => {
  it('reports a decruncher in front of compressed data', () => {
    const r = check(packedPrg(random(8192)));
    expect(r).toMatchObject({ verdict: 'packed', decruncher: 0x080d, signature: null });
    expect(r!.packedShare).toBeGreaterThan(0.9);
    expect(r!.entropy).toBeGreaterThan(7.9);
    expect(r!.codeBytes).toBeLessThan(40);
    expect(r!.reasons.join(' | ')).toMatch(/% of the file looks compressed.*bits of entropy per byte outside the code.*only \d+ bytes of code can be traced/);
  });

  it('counts older crunchers (less entropy) as packed when they say so, and as maybe when they do not', () => {
    // ~6.6 bits per byte: what byte-oriented crunchers of the 80s leave
    const old = random(6000, 100);
    expect(check(packedPrg(old))).toMatchObject({ verdict: 'maybe', packedShare: 0 });
    const said = Uint8Array.from([...old.slice(0, 3000), ...new TextEncoder().encode('CRUNCHED BY TIME CRUNCHER'), ...old.slice(3000)]);
    expect(check(packedPrg(said))).toMatchObject({ verdict: 'packed', signature: 'Time Cruncher' });
  });

  it('knows an Action Replay backup by its depacker, also where the data does not look packed enough', () => {
    const data = random(30000, 100); // ~6.6 bits per byte: on its own only "maybe"
    const backup = backupPrg(' lda #$20\n ldx #$06\n sta $de00\n sta $dffe\n stx $de00\n dec $01\n ldy #$00\n jmp $008e', data);
    const ar = check(backup);
    expect(ar).toMatchObject({ verdict: 'packed', decruncher: 0x080d, signature: 'Datel Action Replay backup' });
    expect(ar!.reasons[0]).toBe('the code at $080d is the depacker of a Datel Action Replay backup');
    expect(ar!.reasons.join(' | ')).not.toMatch(/the file names/);
    // the BASIC line made NOPs (to be started at the load address) or cleared: the depacker is still at 2061
    for (const fill of [0xea, 0x00]) {
      const changed = check({ ...backup, bytes: backup.bytes.slice().fill(fill, 0, 12) });
      expect(changed).toMatchObject({ verdict: 'packed', decruncher: 0x080d, signature: 'Datel Action Replay backup' });
      expect(changed!.reasons[0]).toBe('the code at $080d is the depacker of a Datel Action Replay backup');
    }
    // one whose cartridge writes were changed to $d020 (a re-release that runs without the cartridge)
    expect(check(backupPrg(' lda #$00\n ldx #$00\n sta $d020\n sta $d020\n stx $d020\n dec $01\n ldy #$00\n jmp $008e', data))).toMatchObject({ signature: 'Datel Action Replay backup' });
  });

  it('knows a Freeze Machine backup by its depacker, and the first file of a Split Freeze', () => {
    const data = random(30000, 100);
    // the same start as the Action Replay's, the zero page and the stack put back from the file, on at $007e
    const backup = backupPrg(' ldy #$00\nz: lda $0b00,y\n sta $0000,y\n lda $0c00,y\n sta $0100,y\n iny\n bne z\n dec $01\n ldy #$00\n jmp $007e', data);
    const fm = check(backup);
    expect(fm).toMatchObject({ verdict: 'packed', decruncher: 0x080d, signature: 'Evesham Freeze Machine backup' });
    expect(fm!.reasons[0]).toBe('the code at $080d is the depacker of an Evesham Freeze Machine backup');
    expect(check(backupPrg(' ldy #$00\n jmp $008e', data))).toMatchObject({ signature: 'Datel Action Replay backup' });
    // a Split Freeze's first file: the top of memory, which its loader puts at $a000 before it loads the second file
    // (a whole backup) over itself and goes on at 2061; the code from $08f8 is left over from a backup
    const split = fromSource('split.prg', `.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n sei\n lda #$7f\n sta $dd0d\n lda #$34\n sta $01\n ldy #$00\nl: lda $0900,y\n sta $a000,y\n iny\n bne l\n inc l+2\n inc l+5\n bne l\n lda #$37\n sta $01\n lda #5\n ldx #<name\n ldy #>name\n jsr $ffbd\n lda #$0f\n ldx #$08\n ldy #$0f\n jsr $ffba\n lda #$08\n pha\n lda #$0c\n pha\n lda #$00\n jmp $ffd5\nname: .text "PART2"\n.pc = $08f8\n dec $01\n ldy #$00\n jmp $007e\n .byte 0`);
    const first = { ...split, bytes: Uint8Array.from([...split.bytes, ...random(11000, 100)]) };
    for (const fill of [null, 0x00]) {
      const r = check(fill == null ? first : { ...first, bytes: first.bytes.slice().fill(fill, 0, 12) });
      expect(r, String(fill)).toMatchObject({ verdict: 'packed', decruncher: 0x080d, signature: 'Evesham Freeze Machine backup' });
    }
  });

  it('knows a Super Snapshot backup by its depacker, which turns off both CIAs\' interrupts', () => {
    const data = random(30000, 100);
    // sei / lda #$7f / sta $dc0d / sta $dd0d / lda #$34 / sta $01, the packed data moved up, on at $008e
    const stub = fromSource('snap.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n sei\n lda #$7f\n sta $dc0d\n sta $dd0d\n lda #$34\n sta $01\n ldx #$0c\n ldy #$04\nl: lda $df71,y\n sta $fffb,y\n dey\n cpy #$ff\n bne l\n inc $01\n ldx #$f2\n txs\n dec $01\n ldy #$00\n jmp $008e\n.pc = $08ff\n .byte 0');
    const bytes = Uint8Array.from([...stub.bytes, ...data]);
    const ss = check({ name: 'snap.prg', load: 0x0801, bytes });
    expect(ss).toMatchObject({ verdict: 'packed', decruncher: 0x080d, signature: 'LMS Super Snapshot backup' });
    expect(ss!.reasons[0]).toBe('the code at $080d is the depacker of an LMS Super Snapshot backup');
    // the same start that goes on elsewhere is something else
    const other = fromSource('other.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n sei\n lda #$7f\n sta $dc0d\n sta $dd0d\n lda #$34\n sta $01\n jmp $0900\n.pc = $08ff\n .byte 0');
    expect(check({ name: 'other.prg', load: 0x0801, bytes: Uint8Array.from([...other.bytes, ...data]) })?.signature ?? null).not.toBe('LMS Super Snapshot backup');
  });

  it('leaves plain programs alone', () => {
    const d = makeDemo();
    expect(check(parsePrg(d.name, d.prg))).toBeNull();
    expect(check(allOpcodesProgram(OPC))).toBeNull();
    // too small to tell
    expect(check(packedPrg(random(500)))).toBeNull();
  });

  it('finds packer names in ASCII, PETSCII and screen codes', () => {
    const enc = new TextEncoder();
    expect(packerSignature(enc.encode('xx exomizer 3.1 xx'))).toBe('Exomizer');
    expect(packerSignature(Uint8Array.from('PUCRUNCH'.split('').map(c => c.charCodeAt(0) - 64)))).toBe('PuCrunch'); // screen codes
    expect(packerSignature(Uint8Array.from('BYTEBOOZER'.split('').map(c => c.charCodeAt(0) + 0x80)))).toBe('ByteBoozer'); // shifted PETSCII
    expect(packerSignature(enc.encode('PACKED WITH SOMETHING'))).toBe('a cruncher');
    expect(packerSignature(enc.encode('a demo by dalinda'))).toBeNull();
    expect(packerSignature(random(4000))).toBeNull();
  });
});
