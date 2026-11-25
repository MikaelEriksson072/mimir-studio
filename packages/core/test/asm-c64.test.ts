import { describe, expect, it } from 'vitest';
import { AsmC64, asmC64Text, c64Held, c64Key, C64_KEYS, FRAME_CYCLES } from '../src/asm-c64';
import { asmCallSite, asmLineAt, checkAsm } from '../src/asm-project';
import { VIC_SCREEN } from '../src/c64/vicscreen';
import { findC64Roms } from '../src/node';

const roms = findC64Roms();

/** a raster bar: the border white on raster line $80 and black again on $90, every frame, with interrupts off */
const BARS = `BasicUpstart2(start)
start:
  sei
!wait:
  lda $d012
  cmp #$80
  bne !wait-
  lda #1
  sta $d020
!wait:
  lda $d012
  cmp #$90
  bne !wait-
  lda #0
  sta $d020
  jmp !wait--
`;

/** waits for a key with the KERNAL's GETIN, writes it on the screen and returns */
const KEY = `BasicUpstart2(start)
start:
  jsr $ffe4
  beq start
  sta $0400
  rts
`;

describe.skipIf(!roms)('the Assembler\'s program in the whole C64', () => {
  it('starts with RUN from READY and stops at its first instruction, the return into BASIC on the stack', () => {
    const c = checkAsm({ 'main.asm': BARS }, 'main.asm', 'kickass');
    const m = new AsmC64(c, { roms: roms! });
    expect(m.typed).toBe('RUN');
    expect(m.cpu.pc).toBe(c.entry);
    expect(asmLineAt(c, m.cpu.pc)).toEqual({ file: 'main.asm', line: 3 });
    expect(m.instructions).toBe(0);
    // BASIC's SYS called it: its return is at the top of the stack
    expect(m.stack().some(e => e.ret?.by === 'start')).toBe(true);
    expect(m.peek(0xfffc) | (m.peek(0xfffd) << 8)).toBe(0xfce2);
  });

  it('runs in the C64\'s own time, and its picture has the border white on the raster lines it set it for', () => {
    const c = checkAsm({ 'main.asm': BARS }, 'main.asm', 'kickass');
    const m = new AsmC64(c, { roms: roms! });
    expect(m.runFor(FRAME_CYCLES * 3, null)).toBe('more');
    expect(m.drawn).toBeGreaterThanOrEqual(2);
    expect(m.seconds).toBeGreaterThan(0.05);
    const p = m.picture(), row = (line: number) => p.pixels[(line - VIC_SCREEN.firstLine) * p.width];
    // the left border's colour on each raster line: white from $80 to $90, black elsewhere
    expect(row(0x70)).toBe(0);
    expect(row(0x85)).toBe(1);
    expect(row(0x95)).toBe(0);
    expect(asmC64Text(m, () => null)).toMatch(/^Stopped at \$.* after .* s of the C64's time\)\.$/);
  });

  it('stops at a breakpoint, and the keys pressed go into the keyboard matrix', () => {
    const c = checkAsm({ 'main.asm': KEY }, 'main.asm', 'kickass');
    const m = new AsmC64(c, { roms: roms! });
    const sta = c.names.get('start')! + 5;
    // no key: it waits
    expect(m.runFor(FRAME_CYCLES * 5, x => x.cpu.pc === sta)).toBe('more');
    // A held down: GETIN gives it, and it is written to the screen
    m.setKeys([C64_KEYS.A]);
    expect(m.runFor(FRAME_CYCLES * 10, x => x.cpu.pc === sta)).toBe('stopped');
    m.setKeys([]);
    m.step();
    expect(m.m.ram[0x0400]).toBe(0x41);
    // its RTS goes back to BASIC, which goes on: nothing ends the run
    expect(m.runFor(FRAME_CYCLES * 20, null)).toBe('more');
    expect(m.end).toBeNull();
    expect(m.text().codes.length).toBe(1000);
  });

  it('at no line of the sources, says the line it is running for: the JSR into the KERNAL, the line an interrupt came before', () => {
    const c = checkAsm({ 'main.asm': 'BasicUpstart2(start)\nstart:\n  lda #$41\n  jsr $ffd2\n!loop:\n  inc $d020\n  jmp !loop-\n' }, 'main.asm', 'kickass');
    const m = new AsmC64(c, { roms: roms! });
    expect(asmCallSite(c, m)).toBeNull();
    m.step(); m.step();
    // in CHROUT: the JSR's line, and on in the KERNAL's own routines (their JSRs have no line)
    expect(m.cpu.pc).toBe(0xffd2);
    expect(asmLineAt(c, m.cpu.pc)).toBeNull();
    expect(asmCallSite(c, m)).toEqual({ file: 'main.asm', line: 4, at: c.names.get('start')! + 2, by: 'jsr' });
    for (let i = 0; i < 4; i++) m.step();
    expect(m.cpu.pc).toBeGreaterThanOrEqual(0xe000);
    expect(asmCallSite(c, m)?.line).toBe(4);
    // back in the loop, the KERNAL's IRQ: its handler is inside an interrupt that came before a line of the loop
    expect(m.runFor(FRAME_CYCLES * 2, x => x.cpu.pc === 0xff48)).toBe('stopped');
    const site = asmCallSite(c, m)!;
    expect(site.by).toBe('interrupt');
    expect([6, 7]).toContain(site.line);
    const st = m.stack(), ret = st.find(e => e.ret?.by === 'interrupt')!;
    expect(ret.ret!.to).toBe(site.at);
    expect(st[st.indexOf(ret) + 1].low).toBe(true);
    expect(st[st.indexOf(ret) + 2].flags).toBe(true);
    // its RTI: the interrupt's return is gone from the stack
    expect(m.runFor(FRAME_CYCLES, x => x.cpu.lastOp === 0x40)).toBe('stopped');
    expect(m.stack().some(e => e.ret?.by === 'interrupt')).toBe(false);
    expect(asmLineAt(c, m.cpu.pc)?.line).toBe(site.line);
  });

  it('starts a program without a BASIC line with SYS', () => {
    const c = checkAsm({ 'main.asm': '* = $c000\nstart:\n  inc $d020\n  rts\n' }, 'main.asm', 'kickass');
    const m = new AsmC64(c, { roms: roms! });
    expect(m.typed).toBe('SYS49152');
    expect(m.cpu.pc).toBe(0xc000);
  });
});

describe('the PC\'s keys on the C64\'s keyboard', () => {
  it('maps letters, digits and keys by where they are, punctuation by the character typed', () => {
    expect(c64Key('KeyQ', 'q')).toEqual({ keys: [C64_KEYS.Q] });
    expect(c64Key('Digit2', '2')).toEqual({ keys: [C64_KEYS[2]] });
    expect(c64Key('Enter', 'Enter')).toEqual({ keys: [C64_KEYS.RETURN] });
    expect(c64Key('ArrowUp', 'ArrowUp')).toEqual({ keys: [C64_KEYS.DOWN], shift: true });
    expect(c64Key('F2', 'F2')).toEqual({ keys: [C64_KEYS.F1], shift: true });
    expect(c64Key('Escape', 'Escape')).toEqual({ keys: [C64_KEYS.STOP] });
    // a Swedish keyboard's Shift+2 is ", the C64's SHIFT and 2; its Shift+' is *, which the C64 has without SHIFT
    expect(c64Key('Quote', '"')).toEqual({ keys: [C64_KEYS[2]], shift: true });
    expect(c64Key('Backslash', '*')).toEqual({ keys: [C64_KEYS['*']], shift: false });
    expect(c64Key('IntlBackslash', '§')).toBeNull();
    // held: the PC's Shift is SHIFT, unless a key held says otherwise
    const shift = { code: 'ShiftLeft', key: c64Key('ShiftLeft', 'Shift')! };
    expect(c64Held([shift, { code: 'KeyA', key: c64Key('KeyA', 'A')! }])).toEqual([C64_KEYS.LSHIFT, C64_KEYS.A]);
    expect(c64Held([shift, { code: 'Backslash', key: c64Key('Backslash', '*')! }])).toEqual([C64_KEYS['*']]);
    expect(c64Held([{ code: 'Quote', key: c64Key('Quote', '"')! }])).toEqual([C64_KEYS[2], C64_KEYS.LSHIFT]);
  });
});
