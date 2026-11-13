/* Cartridge images (spec 13.9): VICE's .crt format read and written, where the chips open, the cartridge's memory map
 * and start in the analysis, the source that rebuilds the image byte for byte, and the project file. The cartridges
 * are made here from source; fixtures/crt/mimir-demo.crt is one of them, which the e2e and VICE tests start. */
import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  analyze, areaAt, bankFiles, builtCartridge, cartMode, cartridgeFiles, cartridgeSource, chipAddress, compareCrt, createProject, crtBanks, deserializeProject, describeCrt, expectedCartridge, exportFiles,
  isCrt, lineText, makeCrt, openCartridge, parseCrt, planPatch, portText, reaches, rebuildCrt, render, serializeProject, spaceRender, spaceView, verify, withPatch, DEFAULT_SETTINGS, fileSpaces, splitProject, type FileInput, type ListingLine, type ProjectInput, type SpaceCache,
} from '../src';
import { fromSource } from './helpers/programs';

const pad = (f: FileInput, size = 0x2000, fill = 0xff) => { const b = new Uint8Array(size).fill(fill); b.set(f.bytes.subarray(0, size)); return b; };

/** The demo cartridge: a Magic Desk of 2 banks. Bank 0 starts it (CBM80), sets the C64 up with the KERNAL, copies a
 *  routine to $c000 that switches bank 1 in ($de00), copies its text to the screen and switches bank 0 back; then the
 *  first screen code goes to $d7ff (VICE's debug cartridge exits with it) and the border flashes. */
export const DEMO_BANK0 = `.pc = $8000
 .word cold, warm
 .byte $c3, $c2, $cd, $38, $30
cold:
 sei
 ldx #$ff
 txs
 cld
 jsr $ff84
 jsr $ff87
 jsr $ff8a
 jsr $ff81
 ldx #tramp_end - tramp - 1
copy:
 lda tramp,x
 sta $c000,x
 dex
 bpl copy
 jsr $c000
 lda $0400
 sta $d7ff
loop:
 inc $d020
 jmp loop
warm:
 rti
tramp:
 lda #$01
 sta $de00
 ldx #$00
show:
 lda $8000,x
 sta $0400,x
 inx
 bne show
 lda #$00
 sta $de00
 rts
tramp_end:
`;
const TEXT = 'MIMIR STUDIO: BANK 1 OF THE DEMO CARTRIDGE';
/** screen codes: letters $01-$1a, the rest as in PETSCII */
const screen = (s: string) => [...s].map(c => (c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 0x40 : c.charCodeAt(0)));

export function demoCartridge(): Uint8Array {
  const bank1 = new Uint8Array(0x2000).fill(0xff);
  bank1.fill(0x20, 0, 256);
  bank1.set(screen(TEXT), 0);
  return makeCrt({ name: 'MIMIR DEMO', hw: 19, exrom: 0, game: 1, chips: [{ bank: 0, load: 0x8000, bytes: pad(fromSource('bank0.prg', DEMO_BANK0)) }, { bank: 1, load: 0x8000, bytes: bank1 }] });
}

const project = (name: string, bytes: Uint8Array, bank?: number): ProjectInput => {
  const o = openCartridge(name, bytes);
  return { name, files: bank == null ? o.files : bankFiles(o.crt, bank), cart: o.cart };
};

describe('cartridge images', () => {
  it('reads the header and the CHIP packets', () => {
    const b = demoCartridge();
    expect(isCrt(b)).toBe(true);
    const c = parseCrt(b, 'demo.crt');
    expect(c).toMatchObject({ name: 'MIMIR DEMO', version: [1, 0], hw: 19, exrom: 0, game: 1, mode: '8k', headerLength: 0x40 });
    expect(c.chips.map(x => [x.index, x.bank, x.load, x.data.length, x.offset])).toEqual([[0, 0, 0x8000, 0x2000, 0x40], [1, 1, 0x8000, 0x2000, 0x40 + 0x2010]]);
    expect(describeCrt(c)).toBe('Magic Desk (Domark, HES Australia), 2 banks of 8 KB (16 KB), 8K mode');
    expect(crtBanks(c).map(x => x.bank)).toEqual([0, 1]);
  });

  it('refuses what is not a C64 cartridge, or is cut short', () => {
    const b = demoCartridge();
    expect(() => parseCrt(new Uint8Array(100), 'x.crt')).toThrow('x.crt is not a cartridge image (.crt)');
    const c128 = b.slice(); c128.set([...'C128 CARTRIDGE  '].map(x => x.charCodeAt(0)), 0);
    expect(isCrt(c128)).toBe(true);
    expect(() => parseCrt(c128, 'x.crt')).toThrow('x.crt is a cartridge for the C128, not the C64');
    expect(() => parseCrt(b.subarray(0, 0x40 + 0x10 + 0x1000), 'x.crt')).toThrow('x.crt is cut short: its CHIP packet 0 (bank 0) says it holds 8192 bytes, but the file ends after 4096 of them');
    expect(() => parseCrt(b.subarray(0, 0x40), 'x.crt')).toThrow('x.crt: the cartridge has no CHIP packets');
  });

  it('opens the boot bank where the CPU sees it: an EasyFlash boots its ROMH at $e000', () => {
    const k = (n: number) => new Uint8Array(0x2000).fill(n);
    const ef = parseCrt(makeCrt({ hw: 32, exrom: 1, game: 0, chips: [{ bank: 0, load: 0x8000, bytes: k(1) }, { bank: 0, load: 0xa000, bytes: k(2) }, { bank: 1, load: 0x8000, bytes: k(3) }, { bank: 1, load: 0xa000, bytes: k(4) }] }));
    expect(ef.mode).toBe('ultimax');
    expect(ef.chips.map(c => chipAddress(ef, c))).toEqual([0x8000, 0xe000, 0x8000, 0xa000]);
    const boot = bankFiles(ef), one = bankFiles(ef, 1);
    expect(boot.map(f => [f.name, f.load, f.chip])).toEqual([['bank00_8000.prg', 0x8000, 0], ['bank00_e000.prg', 0xe000, 1]]);
    expect(one.map(f => [f.name, f.load])).toEqual([['bank01_8000.prg', 0x8000], ['bank01_a000.prg', 0xa000]]);
    // the boot bank runs in Ultimax mode, the others as a 16K cartridge
    expect(cartMode(ef, boot)).toBe('ultimax');
    expect(cartMode(ef, one)).toBe('16k');
    expect(cartMode(ef, [boot[0]])).toBe('8k');
  });

  it('maps the cartridge in where the PLA does', () => {
    // 8K: ROML at $8000 with LORAM and HIRAM; BASIC and the KERNAL as without a cartridge
    expect(areaAt(0x8000, 7, false, '8k')).toBe('cart');
    expect(areaAt(0x8000, 6, false, '8k')).toBe('ram');
    expect(areaAt(0xa000, 7, false, '8k')).toBe('basic');
    expect(areaAt(0x8000, 7, true, '8k')).toBe('ram');
    // 16K: ROMH at $a000 wherever HIRAM is set
    expect(areaAt(0xa000, 7, false, '16k')).toBe('cart');
    expect(areaAt(0xa000, 6, false, '16k')).toBe('cart');
    expect(areaAt(0xa000, 5, false, '16k')).toBe('ram');
    // Ultimax: ROMH at $e000 and I/O at $d000 whatever $01 says
    expect(areaAt(0xe000, 5, false, 'ultimax')).toBe('cart');
    expect(areaAt(0xd020, 0, false, 'ultimax')).toBe('io');
    expect(reaches(0xffd2, 0x80, false, 'ultimax')).toBe('ram');
    expect(reaches(0xa000, 0x80, false, '16k')).toBe('ram');
    expect(reaches(0xa000, 0x80, false)).toBe('hw');
    expect(portText(7, '16k')).toBe('ROML · ROMH · I/O · KERNAL');
    expect(portText(5, '8k')).toBe('RAM · RAM · I/O · RAM');
    expect(portText(7)).toBe('BASIC · I/O · KERNAL');
  });
});

describe('the analysis of a cartridge', () => {
  it('starts an 8K cartridge from its CBM80 vectors: the header is words and text, the KERNAL keeps its names', () => {
    const p = project('demo.crt', demoCartridge());
    const A = analyze(p), R = render(A, p);
    expect(A.mcfg?.cart).toBe('8k');
    expect(A.entry).toBe(0x8009);
    expect(A.log.find(l => l.cat === 'entry' && l.lvl === 'ok')?.msg).toBe('Cartridge: "CBM80" at $8004, cold start $8009, warm start $8034');
    expect(A.blocks.slice(0, 2).map(b => [b.type, b.start, b.end, b.props.enc, b.user])).toEqual([['words', 0x8000, 0x8004, undefined, false], ['text', 0x8004, 0x8009, 'petscii-mixed', false]]);
    const src = R.files['bank00_8000.asm'] as string;
    expect(src).toContain('cart_vectors:\n        .word start\n        .word warm_start\n');
    expect(src).toContain('cbm80:\n        .encoding "petscii_mixed"\n        .text "CBM80"\n');
    expect(src).toMatch(/jsr IOINIT\s.*\n\s+jsr RAMTAS\s.*\n\s+jsr RESTOR\s.*\n\s+jsr CINT\s/);
    expect(src).toMatch(/warm_start:\n\s+rti/);
    expect(verify(A, R).ok).toBe(true);
  });

  it('a cartridge without CBM80 is not started by the KERNAL: its first byte is the entry, and the log says so', () => {
    const b = parseCrt(demoCartridge()), chips = b.chips.map(c => ({ bank: c.bank, load: c.load, bytes: c.data.slice() }));
    chips[0].bytes[4] = 0;
    const p = project('nocbm.crt', makeCrt({ hw: 19, exrom: 0, game: 1, chips }));
    const A = analyze(p);
    expect(A.entry).toBe(0x8000);
    expect(A.log.some(l => l.msg.startsWith('No "CBM80" at $8004'))).toBe(true);
  });

  it('traces a 16K cartridge into its ROMH instead of naming BASIC', () => {
    const src = '.pc = $8000\n .word cold, cold\n .byte $c3, $c2, $cd, $38, $30\ncold:\n jsr $a7ae\n jmp cold\n.pc = $a7ae\n lda #1\n sta $d020\n rts';
    const rom = new Uint8Array(0x4000).fill(0xff), f = fromSource('rom.prg', src);
    rom.set(f.bytes.subarray(0, 0x4000));
    const p = project('x16.crt', makeCrt({ exrom: 0, game: 0, chips: [{ bank: 0, load: 0x8000, bytes: rom }] }));
    const A = analyze(p), R = render(A, p);
    expect(A.mcfg?.cart).toBe('16k');
    expect(A.insLen[0xa7ae]).toBe(2);
    expect(R.files['bank00_8000.asm']).toMatch(/jsr sub_a7ae\n/);
    expect(verify(A, R).ok).toBe(true);
    // without the cartridge the code at $8009 could run with RAM there, and $a7ae be BASIC's NEXT statement
    const plain: ProjectInput = { name: 'p', files: [{ name: 'rom.prg', load: 0x8000, bytes: rom }], entryPoint: 0x8009 };
    expect(render(analyze(plain), plain).files['rom.asm']).toMatch(/jsr sub_a7ae +\/\/ RAM or BASIC ROM/);
  });

  it('starts an Ultimax cartridge from the CPU vectors in its ROMH, where no KERNAL is', () => {
    const src = '.pc = $e000\nreset:\n sei\n jsr $ffd2\n lda #2\n sta $d020\n jmp reset\nnmi:\n rti\n.pc = $ffd2\n rts\n.pc = $fffa\n .word nmi, reset, nmi';
    const rom = new Uint8Array(0x2000).fill(0xff), f = fromSource('ulti.prg', src);
    rom.set(f.bytes.subarray(0, 0x2000));
    const p = project('ulti.crt', makeCrt({ exrom: 1, game: 0, chips: [{ bank: 0, load: 0xe000, bytes: rom }] }));
    const A = analyze(p), R = render(A, p), asm = R.files['bank00_e000.asm'] as string;
    expect(A.mcfg?.cart).toBe('ultimax');
    expect(A.entry).toBe(0xe000);
    expect(asm).toContain('cpu_vectors:\n        .word nmi_e00c\n        .word start\n        .word nmi_e00c\n');
    expect(asm).toMatch(/jsr sub_ffd2/);
    expect(asm).toMatch(/sta VIC_BORDER_COLOR/);
    expect(verify(A, R).ok).toBe(true);
  });
});

describe('rebuilding the image', () => {
  it('writes a Kick Assembler source of the header, the packets and the chips, and rebuilds the image byte for byte', () => {
    const b = demoCartridge(), p = project('demo.crt', b);
    const A = analyze(p), R = render(A, p), V = verify(A, R);
    const c = cartridgeFiles(p, R, DEFAULT_SETTINGS)!;
    expect(c.entry).toBe('demo.crt.asm');
    expect(c.output).toBe('demo.crt');
    // every bank is re-assembled: no chip comes from banks/
    expect(Object.keys(c.files)).toEqual(['demo.crt.asm']);
    const src = c.files['demo.crt.asm'] as string;
    expect(src).toContain('.file [name="demo.crt", type="bin", segments="Cartridge"]');
    expect(src).toContain('.byte $00, $13                          // hardware type 19: Magic Desk (Domark, HES Australia)');
    expect(src).toContain('.text "MIMIR DEMO"                      // the name');
    expect(src).toContain('.import binary "out/bank00_8000.prg", 2 // the re-assembled chip, without its load address');
    expect(src).toContain('.import binary "out/bank01_8000.prg", 2');
    expect(src).toContain('.errorif * - chip1 != 8192, "out/bank01_8000.prg does not hold the chip\'s 8192 bytes"');
    const built = builtCartridge(p, V.results.map(r => r.prg))!;
    expect(built.problems).toEqual([]);
    expect(compareCrt(parseCrt(b), built.crt)).toEqual({ ok: true, same: b.length, total: b.length, diffs: [] });
  });

  it('reports where a rebuilt image differs, and a chip of the wrong length', () => {
    const c = parseCrt(demoCartridge());
    const changed = c.chips[0].data.slice(); changed[0x10] ^= 1;
    const r = rebuildCrt(c, new Map([[0, changed], [1, new Uint8Array(10)]]));
    expect(r.problems).toEqual(['bank01_8000: built 10 bytes, the chip has 8192']);
    expect(compareCrt(c, r.crt).diffs).toEqual([`CHIP 0 (bank 0) at $8010: expected $${c.chips[0].data[0x10].toString(16).padStart(2, '0')}, got $${changed[0x10].toString(16).padStart(2, '0')}`]);
    expect(compareCrt(c, r.crt.subarray(0, 100)).diffs[0]).toBe(`the image built is 100 bytes, the original ${c.bytes.length}`);
    const s = cartridgeSource('x.crt', c, { outDir: 'out', sources: new Map() });
    expect(Object.keys(s.files)).toEqual(['banks/bank00_8000.bin', 'banks/bank01_8000.bin']);
  });

  it('opens another bank, and the export rebuilds the whole cartridge from it', () => {
    const b = demoCartridge(), p = createProject({ files: bankFiles(parseCrt(b), 1), cart: { name: 'demo.crt', crt: b } });
    expect(p.name).toBe('demo');
    const A = analyze(p), R = render(A, p), V = verify(A, R);
    expect(V.ok).toBe(true);
    const out = exportFiles(p, R, p.settings, V);
    expect(Object.keys(out)).toEqual(expect.arrayContaining(['bank01_8000.asm', 'demo.crt.asm', 'banks/bank00_8000.bin', 'original/demo.crt', 'out/demo.crt', 'build.bat']));
    expect(out['out/demo.crt']).toEqual(b);
    expect(out['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" demo.crt.asm -odir out');
    expect(out['build.bat']).toContain('-cartcrt out\\demo.crt');
    expect(out['build.sh']).toContain('-cartcrt out/demo.crt');
    expect(out['README.md']).toContain('- the cartridge `demo.crt`: Magic Desk (Domark, HES Australia), 2 banks of 8 KB (16 KB), 8K mode, "MIMIR DEMO", 2 chips; this chip is re-assembled:');
  });

  it('rebuilds a patched cartridge with the patch in its chip, and checks it against the image the chips now make', () => {
    // the border flash ("inc $d020") written over with a red border
    const b = demoCartridge(), p0 = createProject({ files: openCartridge('demo.crt', b).files, cart: { name: 'demo.crt', crt: b } });
    const A0 = analyze(p0), R0 = render(A0, p0);
    const at = 0x802e;
    expect(A0.mem[at]).toBe(0xee);
    const plan = planPatch(A0, R0, p0, { name: 'red', start: at, end: at + 3, source: '        lda #2\n        sta VIC_BORDER_COLOR', fill: 'nop', over: true });
    if ('error' in plan) throw new Error(plan.error);
    const p = { ...p0, ...withPatch(p0, plan.patch) };
    const A = analyze(p), R = render(A, p), V = verify(A, R);
    expect(V.ok).toBe(true);
    const built = builtCartridge(p, V.results.map(r => r.prg))!, expected = expectedCartridge(p)!;
    expect(built.crt).toEqual(expected);
    expect(built.crt).not.toEqual(b);
    expect(compareCrt(parseCrt(b), built.crt, expected).ok).toBe(true);
    expect(compareCrt(parseCrt(b), built.crt).diffs[0]).toBe('CHIP 0 (bank 0) at $802e: expected $ee, got $a9');
    expect(exportFiles(p, R, p.settings, V)['out/demo.crt']).toEqual(expected);
  });

  it('keeps the cartridge and the chips in the project file', () => {
    const b = demoCartridge(), p = createProject({ files: openCartridge('demo.crt', b).files, cart: { name: 'demo.crt', crt: b } });
    const s = serializeProject(p);
    expect(s.cart?.name).toBe('demo.crt');
    expect(s.files[0].chip).toBe(0);
    const back = deserializeProject(JSON.parse(JSON.stringify(s)));
    expect(back.cart?.crt).toEqual(b);
    expect(back.files[0].chip).toBe(0);
    // a project without one keeps none
    expect(deserializeProject(serializeProject(createProject({ files: [{ name: 'a.prg', load: 0x1000, bytes: new Uint8Array(4) }] }))).cart).toBeNull();
  });
});

describe('every bank at once, each a space of its own (13.9b)', () => {
  const SPACE = 0x10000;
  /** a 16K cartridge of two banks: bank 0 has ROML ($8000, CBM80) and ROMH, bank 1 only ROMH ($a000), whose code calls
   *  a routine in bank 0's ROML, as one bank calls the fixed one */
  const crossBank = () => {
    const rom = (src: string, load: number) => { const b = new Uint8Array(0x2000).fill(0xff), f = fromSource('x.prg', src); b.set(f.bytes.subarray(0, 0x2000), f.load - load); return b; };
    return makeCrt({ hw: 17, exrom: 0, game: 0, chips: [
      { bank: 0, load: 0x8000, bytes: rom('.pc = $8000\n .word cold, cold\n .byte $c3, $c2, $cd, $38, $30\ncold:\n jmp cold\n.pc = $8100\n lda #1\n sta $d020\n rts', 0x8000) },
      { bank: 0, load: 0xa000, bytes: rom('.pc = $a000\n rts', 0xa000) },
      { bank: 1, load: 0xa000, bytes: rom('.pc = $a000\n jsr $8100\n jmp $a000', 0xa000) },
    ] });
  };

  it('opens every bank, and lists them one after the other at bank addresses', () => {
    const b = demoCartridge(), o = openCartridge('demo.crt', b);
    expect(o.files.map(f => [f.name, f.load, f.chip])).toEqual([['bank00_8000.prg', 0x8000, 0], ['bank01_8000.prg', 0x8000, 1]]);
    const p: ProjectInput = { name: 'demo', files: o.files, cart: o.cart };
    const A = analyze(p), R = render(A, p);
    expect(A.spaces?.map(s => [s.space, s.bank, s.files, s.cart, s.entry])).toEqual([[0, 0, [0], '8k', 0x8009], [1, 1, [1], '8k', null]]);
    expect(A.mem.length).toBe(2 * SPACE);
    expect(A.mem[SPACE + 0x8000]).toBe(0x0d); // "M" of bank 1's text
    expect(R.lines.filter(l => l.k === 'file').map(l => [l.a, (l as { text: string }).text])).toEqual([[0x8000, 'bank00_8000.asm · bank 0'], [SPACE + 0x8000, 'bank01_8000.asm · bank 1']]);
    expect(R.fileNames).toEqual(['bank00_8000', 'bank01_8000']);
    // bank 1 has no start of its own: it is not decoded as code from its first byte
    expect(A.blocks.find(x => x.start === SPACE + 0x8000)?.type).not.toBe('code');
    expect(A.log.some(l => l.msg === 'Bank 1: Bank 1 has no start of its own: it is traced from what other banks call in it and from the code you mark (C)')).toBe(true);
    expect(verify(A, R).ok).toBe(true);
  });

  it('keeps the work on each bank in that bank: labels, comments and overrides at bank addresses', () => {
    const o = openCartridge('demo.crt', demoCartridge());
    const p: ProjectInput = { name: 'demo', files: o.files, cart: o.cart, labels: { [SPACE + 0x8000]: 'bank1_text', [0x8009]: 'reset', [0xc000]: 'ram_code' }, comments: { [SPACE + 0x8000]: 'shown by bank 0' }, overrides: [{ start: SPACE + 0x8000, end: SPACE + 0x802a, type: 'text', props: { enc: 'screen' } }] };
    const A = analyze(p), R = render(A, p);
    expect(R.labels.get(SPACE + 0x8000)?.name).toBe('bank1_text');
    expect(R.labels.get(0x8009)?.name).toBe('reset');
    expect(R.labels.get(0x8000)?.name).toBe('cart_vectors');
    expect(A.blocks.find(x => x.start === SPACE + 0x8000)).toMatchObject({ type: 'text', user: true });
    expect(A.blocks.find(x => x.start === 0x8000)?.type).toBe('words');
    expect(R.files['bank01_8000.asm']).toMatch(/bank1_text:\n\s+\.encoding "screencode_upper"\n\s+\.text "MIMIR STUDIO: BANK 1 OF THE DEMO CARTRIDGE" +\/\/ shown by bank 0/);
    expect(R.files['bank00_8000.asm']).not.toContain('bank1_text');
    expect(verify(A, R).ok).toBe(true);
    // one bank as 64 KB: its own blocks and names at their plain addresses
    const v = spaceView(A, 1);
    expect(v.blocks[0]).toMatchObject({ start: 0x8000, type: 'text' });
    expect(v.mem[0x8000]).toBe(0x0d);
    expect(spaceRender(R, A, 1).labels.get(0x8000)?.name).toBe('bank1_text');
    expect(spaceRender(R, A, 0).labels.get(0x8000)?.name).toBe('cart_vectors');
    // bank 0's names of its own bytes are not bank 1's; the names of what no bank loads are every bank's
    expect(spaceRender(R, A, 0).labels.get(0x8009)?.name).toBe('reset');
    expect(spaceRender(R, A, 1).labels.has(0x8009)).toBe(false);
    expect(spaceRender(R, A, 1).labels.get(0xc000)?.name).toBe('ram_code');
  });

  it('leaves junk out of its own bank only (11.7)', () => {
    const o = openCartridge('demo.crt', demoCartridge());
    const p: ProjectInput = { name: 'demo', files: o.files, cart: o.cart, junk: [{ start: SPACE + 0x8000, end: SPACE + 0x802a }] };
    expect(splitProject(p, fileSpaces(p)!).map(x => x.input.junk)).toEqual([[], [{ start: 0x8000, end: 0x802a }]]);
    const A = analyze(p), R = render(A, p);
    expect(R.files['bank01_8000.asm']).not.toContain('MIMIR STUDIO: BANK 1');
    expect(R.files['bank00_8000.asm']).toContain('cart_vectors');
    expect(R.excluded).toEqual([{ start: SPACE + 0x8000, end: SPACE + 0x802a, file: 1, name: '', junk: true }]);
    expect(verify(A, R).ok).toBe(true);
  });

  it('shows a view offset in its own bank, in the listing only (10.4)', () => {
    const o = openCartridge('demo.crt', demoCartridge());
    const off = { start: SPACE + 0x8000, end: SPACE + 0x8010, to: SPACE + 0xa000 };
    const p: ProjectInput = { name: 'demo', files: o.files, cart: o.cart, viewOffsets: [off] };
    expect(splitProject(p, fileSpaces(p)!).map(x => x.input.viewOffsets)).toEqual([[], [{ start: 0x8000, end: 0x8010, to: 0xa000 }]]);
    const A = analyze(p), R = render(A, p, { viewOffsets: true }), plain = render(A, p);
    expect(R.viewOffsets).toEqual([off]);
    expect(R.files).toEqual(plain.files);
    expect(R.lines.some(l => l.k === 'cmt' && l.text.startsWith('==== shown at $a000-$a00f'))).toBe(true);
    expect(plain.lines.some(l => l.k === 'cmt' && l.text.includes('shown at'))).toBe(false);
    // the files' names stay those of the source
    expect([...R.fileLabels!.values()].map(l => l.name).sort()).toEqual([...plain.labels.values()].map(l => l.name).sort());
    expect(verify(A, R).ok).toBe(true);
  });

  it('gives each bank its bookmarks at plain addresses, an area to its end there', () => {
    const o = openCartridge('demo.crt', demoCartridge());
    const p: ProjectInput = { name: 'demo', files: o.files, cart: o.cart, bookmarks: { [SPACE + 0x8000]: { title: 'text', text: '', end: SPACE + 0x802a }, [0x8009]: { title: 'reset', text: '' } } };
    const parts = splitProject(p, fileSpaces(p)!);
    expect(parts.map(x => x.input.bookmarks)).toEqual([{ 0x8009: { title: 'reset', text: '' } }, { 0x8000: { title: 'text', text: '', end: 0x802a } }]);
  });

  it('traces what one bank calls in another, and names it there (the nearest bank that has the address)', () => {
    const o = openCartridge('x.crt', crossBank());
    // bank 1 has no start: its code is marked as an entry point, at its bank address
    const p: ProjectInput = { name: 'x', files: o.files, cart: o.cart, entries: [SPACE + 0xa000] };
    const A = analyze(p), R = render(A, p);
    expect(A.spaces?.map(s => [s.bank, s.files])).toEqual([[0, [0, 1]], [1, [2]]]);
    // bank 0 never calls $8100 itself: bank 1 does
    expect(A.insLen[0x8100]).toBe(2);
    expect(A.entryKind.get(0x8100)).toBe('sub');
    const b1 = R.files['bank01_a000.asm'] as string;
    expect(b1).toContain('// labels in other banks of the cartridge\n.label sub_8100 = $8100');
    expect(b1).toMatch(/jsr sub_8100\n/);
    // in the listing the operand goes to bank 0's routine; bank 1's own $a000 stays its own
    const jsr = R.lines.find(l => l.k === 'ins' && l.a === SPACE + 0xa000) as Extract<ListingLine, { k: 'ins' }>;
    expect(jsr.tok.find(t => t.t === 'lbl')?.to).toBe(0x8100);
    expect(A.xrefs.get(0x8100)?.map(x => x.from)).toEqual([SPACE + 0xa000]);
    expect(verify(A, R).ok).toBe(true);
    const V = verify(A, R), built = builtCartridge(p, V.results.map(r => r.prg))!;
    expect(compareCrt(parseCrt(crossBank()), built.crt).ok).toBe(true);
  });

  it('analyses only the bank that changed again, with a cache', () => {
    const o = openCartridge('demo.crt', demoCartridge()), cache: SpaceCache = new Map();
    const p: ProjectInput = { name: 'demo', files: o.files, cart: o.cart };
    const A = analyze(p, cache), again = analyze({ ...p, labels: { 1: 'x' } }, cache);
    expect(again.parts![0]).toBe(A.parts![0]);
    expect(again.parts![1]).toBe(A.parts![1]);
    const marked = analyze({ ...p, overrides: [{ start: SPACE + 0x8000, end: SPACE + 0x8010, type: 'text' }] }, cache);
    expect(marked.parts![0]).toBe(A.parts![0]);
    expect(marked.parts![1]).not.toBe(A.parts![1]);
  });

  it('writes a patch in bank 0, never in another bank at the same address', () => {
    const o = openCartridge('demo.crt', demoCartridge()), p = createProject({ files: o.files, cart: o.cart });
    const A = analyze(p), R = render(A, p);
    expect(planPatch(A, R, p, { name: 'b1', start: SPACE + 0x8000, end: SPACE + 0x8003, source: ' nop', fill: 'nop', over: false })).toEqual({ error: 'Patches can only be written in bank 0 of a cartridge so far.' });
    const plan = planPatch(A, R, p, { name: 'b0', start: 0x802e, end: 0x8031, source: ' lda #2', fill: 'nop', over: false });
    if ('error' in plan) throw new Error(plan.error);
    const q = withPatch(p, plan.patch);
    expect(q.files[0].bytes[0x2e]).toBe(0xa9);
    expect(q.files[1].bytes).toEqual(p.files[1].bytes);
  });
});

describe('every bank in one source (13.9c)', () => {
  const one = () => { const o = openCartridge('demo.crt', demoCartridge()); return createProject({ files: o.files, cart: o.cart, settings: { cartOneSource: true } }); };

  it('writes one <name>.crt.asm: a segment per chip, a namespace per bank, the names they share once, the image last', () => {
    const p = one(), A = analyze(p), R = render(A, p), src = R.files['demo.crt.asm'] as string;
    expect(R.main).toBe('demo.crt.asm');
    expect(Object.keys(R.files).filter(k => k.endsWith('.asm'))).toEqual(['include/c64-hardware.asm', 'demo.crt.asm']);
    expect(src).toContain('.file [name="demo.crt", type="bin", segments="Cartridge"]\n.segmentdef Cartridge [start=0]\n.segmentdef Bank00_8000 [min=$8000, max=$9fff, fill] // bank 0\n.segmentdef Bank01_8000 [min=$8000, max=$9fff, fill] // bank 1\n');
    expect(src.match(/#import "include\/c64-hardware\.asm"/g)).toHaveLength(1);
    expect(src).toContain('.namespace bank00 {\n.segment Bank00_8000\n');
    expect(src).toContain('.namespace bank01 {\n.segment Bank01_8000\n');
    expect(src).toMatch(/\} +\/\/ end of bank 1\n/);
    expect(src).toContain('.segment Cartridge\n        .encoding "ascii"');
    expect(src).toMatch(/chip1:\n +\.segmentout \[segments="Bank01_8000"\]\n +\.errorif \* - chip1 != 8192, "segment Bank01_8000 does not hold the chip's 8192 bytes"/);
    // the listing shows the same file, under one file bar
    expect(R.lines.filter(l => l.k === 'file').map(l => (l as { text: string }).text)).toEqual(['demo.crt.asm · every bank']);
    expect(R.lines.filter(l => l.k !== 'file').map(l => lineText(l, DEFAULT_SETTINGS)).join('\n') + '\n').toBe(src);
    // the built-in assembler still checks the chips
    expect(verify(A, R).ok).toBe(true);
  });

  it('exports the one source, a build that assembles it alone, and the image it writes', () => {
    const p = one(), A = analyze(p), R = render(A, p), V = verify(A, R), out = exportFiles(p, R, p.settings, V);
    expect(Object.keys(out).filter(k => k.endsWith('.asm'))).toEqual(['include/c64-hardware.asm', 'demo.crt.asm']);
    expect(out['out/demo.crt']).toEqual(demoCartridge());
    expect(out['build.bat']).toContain('"%JAVA%" -jar "%KICKASS%" demo.crt.asm -odir out');
    expect(out['build.bat']).not.toContain('bank00_8000.asm');
    expect(out['build.bat']).toContain('-moncommands out\\demo.crt.vs -cartcrt out\\demo.crt');
    expect(out['README.md']).toContain('- `demo.crt.asm` — every bank of the cartridge in one source: assemble it alone, it writes `demo.crt`');
    expect(out['README.md']).not.toContain('`bank00_8000.asm`');
  });

  it('defines the PETSCII control codes the banks write by name once, at the top', () => {
    const msg = [0x93, 0x48, 0x49, 0x0d, 0x00]; // CLR, "HI", RETURN, $00
    const b0 = pad(fromSource('bank0.prg', DEMO_BANK0)), b1 = new Uint8Array(0x2000).fill(0xff);
    b0.set(msg, 0x100); b1.set([0x05, ...msg], 0x100);
    const o = openCartridge('pet.crt', makeCrt({ name: 'PET', hw: 19, exrom: 0, game: 1, chips: [{ bank: 0, load: 0x8000, bytes: b0 }, { bank: 1, load: 0x8000, bytes: b1 }] }));
    // the texts at $8100 in both banks (bank 1's addresses are $10000 on)
    const text = { type: 'text' as const, props: { enc: 'petscii' as const } };
    const p: ProjectInput = { ...createProject({ files: o.files, cart: o.cart, settings: { cartOneSource: true } }), overrides: [{ start: 0x8100, end: 0x8105, ...text }, { start: 0x18100, end: 0x18106, ...text }] };
    const A = analyze(p), R = render(A, p), src = R.files['pet.crt.asm'] as string;
    expect(src.match(/\.const PET_CLR = /g)).toHaveLength(1);
    expect(src).toMatch(/\n\/\/ PETSCII control codes, written by name in the texts\n\.const PET_WHITE = @"\\\$05" +\/\/ text color white\n\.const PET_RETURN = @"\\\$0d" +\/\/ [^\n]*\n\.const PET_CLR = @"\\\$93" +\/\/ clear the screen\n/);
    expect(src.indexOf('.const PET_CLR')).toBeLessThan(src.indexOf('.namespace bank00'));
    expect(src).toMatch(/\.namespace bank01 \{[^}]*\.text PET_WHITE \+ PET_CLR \+ "HI" \+ PET_RETURN\n/);
    expect(verify(A, R).ok).toBe(true);
  });

  it('works for a cartridge of one bank too, and takes a chip left out of the project from banks/', () => {
    const o = openCartridge('demo.crt', demoCartridge());
    const p = createProject({ files: [o.files[0]], cart: o.cart, settings: { cartOneSource: true } }), A = analyze(p), R = render(A, p);
    expect(A.spaces).toBeUndefined();
    const src = R.files['demo.crt.asm'] as string;
    expect(src).toContain('.namespace bank00 {');
    expect(src).not.toContain('.namespace bank01');
    expect(src).toMatch(/chip1:\n +\.import binary "banks\/bank01_8000\.bin"/);
    expect(R.files['banks/bank01_8000.bin']).toEqual(o.files[1].bytes);
    expect(verify(A, R).ok).toBe(true);
  });
});

describe('the cartridge fixture', () => {
  it('is fixtures/crt/mimir-demo.crt, which the e2e tests open', () => {
    const path = join(__dirname, '../../../fixtures/crt/mimir-demo.crt'), b = demoCartridge();
    if (process.env.WRITE_FIXTURES) writeFileSync(path, b);
    expect(new Uint8Array(readFileSync(path))).toEqual(b);
  });
});
