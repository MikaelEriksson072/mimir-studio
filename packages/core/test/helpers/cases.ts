/* The projects every assembler must build byte-identical to the original (kickass.integration.test.ts, tass.test.ts):
 * the demo in every setting variant, binary blocks, snapshots, the showcase, texts in every encoding, PETSCII control
 * codes, excluded blocks and junk, relocated blocks, all opcodes, zero-page code and seeded random projects. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { analyze, formatOverride, makeDemo, makePrg, OPC, openC64File, parsePrg, showcaseProject, type ProjectInput } from '../../src';
import { allOpcodesProgram, fromSource, randomPrg, relocProgram, seededProject, SETTING_VARIANTS, zeroPageProgram } from './programs';

export interface Case { name: string; project: ProjectInput }

export const demo = (): ProjectInput => { const d = makeDemo(); return { name: 'raster-demo', files: [parsePrg(d.name, d.prg)] }; };

export function cases(): Case[] {
  const out: Case[] = SETTING_VARIANTS.map((settings, i) => ({ name: `demo/settings#${i} ${JSON.stringify(settings)}`, project: { ...demo(), settings } }));
  {
    const A = analyze(demo()), code = A.blocks.find(b => b.start <= 0x0866 && b.end > 0x0866)!.start;
    out.push({ name: 'demo/blocks saved as binary files (code with labels inside, sine table, charset, music)', project: { ...demo(), binary: [code, 0x09b5, 0x3000, 0x1000] } });
    out.push({ name: 'demo/a binary code block left out of the build', project: { ...demo(), binary: [code, 0x09b5], excluded: [code] } });
  }
  {
    // a dump to $ffff that sets its own IRQ vector and reads RAM under the KERNAL, its top 8 KB one binary block
    const dump = fromSource('dump.prg', '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n sei\n lda #<irq\n sta $fffe\n lda #>irq\n sta $ffff\n lda #$35\n sta $01\n lda $eaa5\n sta $d020\n cli\n jmp *\nirq:\n rti\n.pc = $e000\n .byte 1,2,3,4\n.pc = $ffff\n .byte 0');
    for (const hwInclude of ['import', 'none'] as const) out.push({ name: `dump over the CPU vectors, binary top block (hwInclude ${hwInclude})`, project: { name: 'dump', files: [dump], overrides: [{ start: 0xe000, end: 0x10000, type: 'charset' }], binary: [0xe000], settings: { hwInclude } } });
  }
  {
    // number formats: the colour table in binary, 4 a row, and the same bytes as words in decimal and binary
    const A = analyze(demo()), colors = A.blocks.find(b => b.start === 0x0939)!;
    out.push({ name: 'demo/a table in binary, 4 a row', project: { ...demo(), overrides: [formatOverride(colors, { fmt: 'bin', row: 4 })] } });
    for (const fmt of ['dec', 'bin', 'hex'] as const) out.push({ name: `demo/words in ${fmt}, 3 a row`, project: { ...demo(), overrides: [{ start: 0x0939, end: 0x0949, type: 'words' }, { start: 0x0939, end: 0x0949, type: 'words', props: { fmt, row: 3 } }] } });
  }
  const snap = openC64File('raster-demo.vsf', new Uint8Array(readFileSync(join(__dirname, '../../../../fixtures/vsf/raster-demo.vsf'))));
  out.push({ name: 'VICE snapshot (RAM $0200-$ffff, entries at the PC and the IRQ handler)', project: { name: 'snapshot', files: [snap], entries: snap.entries } });
  const snapZp = openC64File('raster-demo.vsf', new Uint8Array(readFileSync(join(__dirname, '../../../../fixtures/vsf/raster-demo.vsf'))), { zeroPage: true });
  out.push({ name: 'VICE snapshot with the zero page and the stack (RAM $0002-$ffff)', project: { name: 'snapshot_zp', files: [snapZp], entries: snapZp.entries } });
  out.push({ name: 'demo/raw addresses with hardware comments (no include file)', project: { ...demo(), settings: { hwInclude: 'none', hwComments: true } } });
  {
    // the app's Demo: a bitmap logo above a text screen, a word jump table, the tour's names and comments
    const p = showcaseProject();
    out.push({ name: 'the showcase with its tour (names, comments, a commented zero-page variable)', project: p });
    out.push({ name: 'the showcase with raw addresses', project: { ...p, settings: { ...p.settings, hwInclude: 'none' } } });
  }
  out.push({ name: 'demo/renamed+commented', project: { ...demo(), labels: { 0x0810: 'main' }, comments: { 0x0810: 'entry "quoted" // and /* more */' } } });
  out.push({ name: 'text in every encoding (mixed case, @ inside screen code text)', project: { name: 'text', files: [randomPrg(77, 0xc000, 600)], overrides: [
    { start: 0xc000, end: 0xc080, type: 'text', props: { enc: 'screen-mixed' } }, { start: 0xc080, end: 0xc100, type: 'text', props: { enc: 'petscii-mixed' } },
    { start: 0xc100, end: 0xc180, type: 'text', props: { enc: 'screen' } }, { start: 0xc180, end: 0xc200, type: 'text', props: { enc: 'petscii' } },
  ] } });
  {
    // every byte as PETSCII text: the control codes by name (`.text PET_CLR + "..."`), in both cases and hex cases
    const all = makePrg(0xc000, Uint8Array.from({ length: 512 }, (_, i) => i & 0xff));
    const overrides = [{ start: 0xc000, end: 0xc100, type: 'text' as const, props: { enc: 'petscii' as const } }, { start: 0xc100, end: 0xc200, type: 'text' as const, props: { enc: 'petscii-mixed' as const } }];
    for (const hexCase of ['lower', 'upper'] as const) out.push({ name: `PETSCII control codes by name (hex ${hexCase} case)`, project: { name: 'controls', files: [parsePrg('controls.prg', all)], overrides, settings: { hexCase } } });
  }
  out.push({ name: 'demo/blocks excluded from the build (BASIC stub, sine table, music)', project: { ...demo(), excluded: [0x0801, 0x09b5, 0x1000] } });
  // 11.7: junk in the middle (the sine table, part of the fill after it), at the end (the charset), and next to a block left out
  out.push({ name: 'demo/junk in the middle and at the end, beside an excluded block', project: { ...demo(), junk: [{ start: 0x09b5, end: 0x0b00 }, { start: 0x3000, end: 0x3800 }], excluded: [0x1000] } });
  out.push({ name: 'demo/program start set by the user', project: { ...demo(), entryPoint: 0x0866 } });
  out.push({ name: 'demo/comment lines and blocks', project: { ...demo(), notes: { 0x0810: { text: 'set up the raster IRQ' }, 0x09c1: { text: 'block with "quotes"\nand */ inside', block: true } }, blockComments: { 0x0939: 'two\nlines' } } });
  out.push({
    name: '$01 and VIC bank switching (RAM under I/O, KERNAL out, $dd02)',
    project: {
      name: 'banks',
      files: [fromSource('banks.prg', '.pc = $c000\n lda #$35\n sta $01\n sta $d020\n jsr $ffd2\n dec $01\n lda $d000\n inc $01\n lda #$3d\n sta $dd02\n lda #$18\n sta $d018\n jsr sub\n rts\nsub: sta $d021\n rts\n.pc = $d000\n .byte 1, 2, 3, 4')],
      bankZones: [{ start: 0xc01a, end: 0xc01e, port: 0x34 }],
    },
  });
  {
    // 8.1b: a block the program copies to $2000 to run there, written inside .pseudopc; one relocated again from there
    // ($2009-$200c to $c000: Kick Assembler cannot nest .pseudopc, so the outer one pauses), and the whole block left
    // out or saved as a binary file
    const moved = { name: 'moved', files: [relocProgram()], relocs: [{ start: 0x1000, end: 0x1011, to: 0x2000 }] };
    out.push({ name: 'a relocated block (.pseudopc)', project: moved });
    out.push({ name: 'a block relocated from where another one runs (.pseudopc in .pseudopc)', project: { ...moved, relocs: [...moved.relocs, { start: 0x2009, end: 0x200d, to: 0xc000 }], labels: { 0x2009: 'sub', 0xc000: 'sub_c000' } } });
    out.push({ name: 'a relocated block that ends with one relocated from it', project: { ...moved, relocs: [...moved.relocs, { start: 0x200d, end: 0x2011, to: 0xc000 }] } });
    out.push({ name: 'a relocated block left out of the build', project: { ...moved, excluded: [0x1000] } });
    out.push({ name: 'a relocated block saved as a binary file', project: { ...moved, binary: [0x1000] } });
    out.push({ name: 'junk between the code and a relocated block', project: { ...moved, junk: [{ start: 0x0820, end: 0x1000 }] } });
  }
  out.push({ name: 'all opcodes', project: { name: 'opcodes', files: [allOpcodesProgram(OPC)] } });
  out.push({ name: 'zero-page program (.zp/.abs)', project: { name: 'zp', files: [zeroPageProgram()] } });
  // shapes the fuzz test found: wrapping branches at $0000, word tables, music overrides
  out.push({ name: 'load at $0000', project: { name: 'wrap', files: [randomPrg(-137153725, 0x0000, 200)] } });
  out.push({ name: 'word table + music overrides', project: { name: 'ov', files: [randomPrg(11, 0x0801, 1200)], overrides: [{ start: 0x0801, end: 0x080c, type: 'words' }, { start: 0x0900, end: 0x0940, type: 'music' }, { start: 0x0a00, end: 0x0a41, type: 'sprite' }] } });
  for (let seed = 1; seed <= 12; seed++) out.push({ name: `seeded #${seed}`, project: seededProject(seed) });
  return out;
}
