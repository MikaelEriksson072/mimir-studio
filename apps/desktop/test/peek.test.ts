import { describe, expect, it } from 'vitest';
import { analyze, assemble, findBlock, parsePrg, render, type ListingLine, type ProjectInput } from '@mimir/core';
import { peekOf, peekOrder, peekPane, PEEK_ROW, PEEK_ROWS, type Peek, type PeekItem, type PeekPane } from '../src/lib/peek';

// BASIC, two code blocks, a text, then bytes that are code no one calls: lda #$01 / sta $d020 / jmp $0822, a jam
// opcode, and lda $xxxx cut off by the end of the file
const src = `.pc = $0801
.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00
.pc = $080d
start: jsr show
 lda $c000
 rts
show: ldx #0
 lda msg,x
 sta $0400,x
 rts
msg: .text "HELLO"
.byte 0
tune: .byte $a9,$01,$8d,$20,$d0,$4c,$22,$08,$02,$ad`;
const prg = assemble({ 'm.asm': src }, 'm.asm').prg!;
const p: ProjectInput = { files: [parsePrg('m.prg', prg)] };
const A = analyze(p), R = render(A, p), order = peekOrder(A, R.lines);
const text = (l: ListingLine) => ('tok' in l ? `${'mn' in l && l.k === 'ins' ? l.mn.toLowerCase() : 'dir' in l ? l.dir : ''} ${l.tok.map(t => t.s).join('')}`.trim() : '');
/** the rows and dividers as text: `0810+4` (bytes), `0823 lda #$01` (code), `| 0814` (a block starts) */
const shown = (k: Peek) => k.items.map((i: PeekItem) => i.k === 'blk' ? `| ${i.b.start.toString(16).padStart(4, '0')}` : i.k === 'row' ? `${i.a.toString(16).padStart(4, '0')}+${i.n}` : `${i.a.toString(16).padStart(4, '0')} ${text(i)}`);
const lines = (k: Peek) => k.items.filter((i): i is Extract<PeekItem, { k: 'ins' | 'dat' }> => i.k === 'ins' || i.k === 'dat');

describe('the peek (Ctrl over a line)', () => {
  it('has the blocks in the order of the listing', () => {
    expect(order.map(b => [b.type, b.start])).toEqual([['basic', 0x0801], ['code', 0x080d], ['code', 0x0814], ['text', 0x081d], ['data', 0x0823]]);
  });

  it('shows code as its bytes from the line, eight a row, the line\'s bytes marked; the next blocks under a divider', () => {
    const b = findBlock(A.blocks, 0x080d)!;
    const k = peekOf(A, R, order, b, 0x0810, 3, false);
    expect(k.as).toBe('bytes');
    expect(shown(k)).toEqual(['0810+4', '| 0814', '0814+8', '081c+1', '| 081d', '081d+6', '| 0823', '0823+8', '082b+2']);
    expect(k.mark).toEqual({ start: 0x0810, end: 0x0813 });
    expect(k.head).toBe(b);
    expect(k.before).toBe(3);
    expect(k.tail.start).toBe(0x0823);
    expect(k.rest).toBe(0);
  });

  it('shows data as code, swept from the block\'s start, with the names the listing uses', () => {
    const b = findBlock(A.blocks, 0x0823)!;
    expect(b.type).not.toBe('code');
    const k = peekOf(A, R, order, b, 0x0824, 1, true);
    expect(k.as).toBe('code');
    // the first line is the one the pointer's byte is in, and it is marked
    expect(lines(k)[0].a).toBe(0x0823);
    expect(k.mark).toEqual({ start: 0x0824, end: 0x0825 });
    expect(lines(k).slice(0, 3).map(text)).toEqual(['lda #$01', 'sta VIC_BORDER_COLOR', `jmp ${R.labels.get(0x0822)?.name ?? '$0822'}`]);
  });

  it('a jam opcode, and an instruction that would run past the block, are .byte', () => {
    const b = findBlock(A.blocks, 0x0823)!;
    const k = peekOf(A, R, order, b, b.start, 0, true);
    const jam = lines(k).find(l => A.mem[l.a] === 0x02)!;
    expect(jam.k).toBe('dat');
    expect(jam.k === 'dat' && jam.cmt).toMatch(/halts the CPU/);
    const last = lines(k).at(-1)!;
    expect(last.a).toBe(b.end - 1);
    expect(text(last)).toBe('.byte $ad');
    expect(lines(k).every(l => l.a + l.n <= b.end)).toBe(true);
    expect(k.mark).toBeNull();
  });

  it('a block is swept from its own start, also after another one', () => {
    // the text "HELLO" (PETSCII, H is $48: pha) as code from $081d, after the rts of show
    const k = peekOf(A, R, order, findBlock(A.blocks, 0x0814)!, 0x0814, 2, true);
    expect(shown(k).slice(0, 6)).toEqual(['0814 ldx #$00', `0816 lda ${R.labels.get(0x081d)!.name},x`, '0819 sta SCREEN_RAM,x', '081c rts', '| 081d', '081d pha']);
  });

  describe('the mouse wheel scrolls it up and down the file', () => {
    it('as bytes: above the pointer\'s line its block\'s first bytes, then the blocks before it; no further than the file\'s start', () => {
      const b = findBlock(A.blocks, 0x080d)!;
      const up = peekOf(A, R, order, b, 0x0810, 3, false, -100);
      expect(up.off).toBe(-3);
      expect(up.min).toBe(-3);
      expect(up.head.type).toBe('basic');
      expect(up.before).toBe(0);
      expect(shown(up).slice(0, 5)).toEqual(['0801+8', '0809+4', '| 080d', '080d+3', '0810+4']);
      // one up: the head is the pointer's block, from its start
      const one = peekOf(A, R, order, b, 0x0810, 3, false, -1);
      expect(shown(one)[0]).toBe('080d+3');
      expect(one.head).toBe(b);
      expect(one.before).toBe(0);
    });

    it('as code: an instruction a row, the head the block of the top row; no further down than the file\'s end in the bottom row', () => {
      const b = findBlock(A.blocks, 0x080d)!;
      const k = peekOf(A, R, order, b, 0x0810, 3, true, 2);
      expect(k.off).toBe(2);
      expect(shown(k).slice(0, 3)).toEqual(['0814 ldx #$00', `0816 lda ${R.labels.get(0x081d)!.name},x`, '0819 sta SCREEN_RAM,x']);
      expect(k.head.start).toBe(0x0814);
      const end = peekOf(A, R, order, b, 0x0810, 3, true, 1000);
      expect(end.off).toBe(end.max);
      expect(end.items).toHaveLength(PEEK_ROWS);
      expect(end.items.at(-1)!.k).not.toBe('blk');
      const last = lines(end).at(-1)!;
      expect(last.a + last.n).toBe(0x082d);
      expect(end.rest).toBe(0);
      // one row less than the most: the file's last byte is below the box
      const less = peekOf(A, R, order, b, 0x0810, 3, true, end.max - 1);
      expect(less.rest).toBeGreaterThan(0);
    });

    it('near the file\'s end it starts at the pointer\'s line, and only scrolls up', () => {
      const b = findBlock(A.blocks, 0x0823)!;
      const bytes = peekOf(A, R, order, b, b.end - 3, 0, false, 5), code = peekOf(A, R, order, b, b.end - 1, 0, true, 5);
      expect([bytes.off, bytes.max, code.off, code.max]).toEqual([0, 0, 0, 0]);
      expect(shown(bytes)).toEqual(['082a+3']);
      expect(shown(peekOf(A, R, order, b, b.end - 3, 0, false, -1))).toEqual(['0823+7', '082a+3']);
    });

    it('shows at most PEEK_ROWS rows and counts the bytes of the bottom row\'s block after them', () => {
      const big: ProjectInput = { files: [parsePrg('b.prg', assemble({ 'b.asm': `.pc = $1000\n.fill 400, $ea` }, 'b.asm').prg!)] };
      const B = analyze(big), S = render(B, big), o = peekOrder(B, S.lines), b = findBlock(B.blocks, 0x1000)!;
      const bytes = peekOf(B, S, o, b, 0x1013, 0, false), code = peekOf(B, S, o, b, 0x1013, 0, true);
      expect(bytes.items).toHaveLength(PEEK_ROWS);
      expect(bytes.items.every((r, i) => r.k === 'row' && r.a === 0x1013 + i * PEEK_ROW && r.n === PEEK_ROW)).toBe(true);
      expect(bytes.rest).toBe(b.end - 0x1013 - PEEK_ROWS * 8);
      expect(bytes.before).toBe(0x13);
      expect(code.items).toHaveLength(PEEK_ROWS);
      expect(code.rest).toBe(b.end - 0x1013 - PEEK_ROWS);
      // up to the start: the rows stay eight from the pointer's byte, the first row has what is left
      const up = peekOf(B, S, o, b, 0x1013, 0, false, -10);
      expect(up.off).toBe(-3);
      expect(shown(up).slice(0, 4)).toEqual(['1000+3', '1003+8', '100b+8', '1013+8']);
    });

    it('a block missing from the order is shown alone', () => {
      const b = findBlock(A.blocks, 0x0814)!;
      const k = peekOf(A, R, [], b, 0x0814, 0, false, -5);
      expect(shown(k)).toEqual(['0814+8', '081c+1']);
    });
  });
});

describe('the pane beside the listing (V)', () => {
  const rows = (v: PeekPane) => [...Array(v.pad).fill('-'), ...v.items.map((i: PeekItem) => i.k === 'blk' ? `| ${i.b.start.toString(16).padStart(4, '0')}` : i.k === 'row' ? `${i.a.toString(16).padStart(4, '0')}+${i.n}` : `${i.a.toString(16).padStart(4, '0')} ${text(i)}`)];
  const name = (a: number) => R.labels.get(a)!.name;

  it("shows every block as code, an instruction a row from the block's start, whatever the listing makes of it", () => {
    const b = findBlock(A.blocks, 0x0814)!;
    const v = peekPane(A, R, order, b, 0x0814, 0, 8);
    expect(rows(v)).toEqual(['0814 ldx #$00', `0816 lda ${name(0x081d)},x`, '0819 sta SCREEN_RAM,x', '081c rts', '| 081d', '081d pha', '081e eor $4c', '0820 jmp $004f']);
    expect(v.items.every(i => i.k !== 'row')).toBe(true);
    expect(v.head).toBe(b);
    expect(v.at.a).toBe(0x0814);
  });

  it('puts the row of the byte `above` items down, the rows and dividers over it counted; `at` is that row', () => {
    const b = findBlock(A.blocks, 0x080d)!;
    const v = peekPane(A, R, order, b, 0x0810, 3, 5);
    expect(rows(v)).toEqual(['080c brk', '| 080d', `080d jsr ${name(0x0814)}`, '0810 lda $c000', '0813 rts']);
    expect(v.head.type).toBe('basic');
    expect([v.at.a, v.at.n]).toEqual([0x0810, 3]);
    // a byte inside an instruction: the instruction's row
    const mid = peekPane(A, R, order, b, 0x0811, 0, 1);
    expect(rows(mid)).toEqual(['0810 lda $c000']);
    expect([mid.at.a, mid.at.n]).toEqual([0x0810, 3]);
  });

  it("with room for one item above a block's first row, that is its divider, and the head names the block", () => {
    const b = findBlock(A.blocks, 0x080d)!;
    const d = peekPane(A, R, order, b, 0x080d, 1, 3);
    expect(rows(d)).toEqual(['| 080d', `080d jsr ${name(0x0814)}`, '0810 lda $c000']);
    expect(d.head).toBe(b);
  });

  it("near the file's start the rows that are not there are empty; an anchor above the top leaves its items out", () => {
    expect(rows(peekPane(A, R, order, findBlock(A.blocks, 0x0801)!, 0x0801, 2, 3))).toEqual(['-', '-', '0801 anc #$08']);
    expect(rows(peekPane(A, R, order, findBlock(A.blocks, 0x080d)!, 0x0810, -1, 2))).toEqual(['0813 rts', '| 0814']);
  });

  it('scrolled with `off`, it stays within the file', () => {
    const b = findBlock(A.blocks, 0x080d)!;
    const up = peekPane(A, R, order, b, 0x080d, 0, 2, -100);
    expect(up.off).toBe(up.min);
    expect(rows(up)).toEqual(['0801 anc #$08', '0803 asl']);
    const down = peekPane(A, R, order, b, 0x080d, 0, 2, 100);
    expect(down.off).toBe(down.max);
    expect(rows(down)).toEqual(['082c .byte $ad']);
  });
});
