import { describe, expect, it } from 'vitest';
import { analyze, assemble, findBlock, parsePrg, render, type ListingLine, type ProjectInput } from '@mimir/core';
import { peekOf, PEEK_ROW, PEEK_ROWS } from '../src/lib/peek';

// code, then a text, then bytes that are code no one calls: lda #$01 / sta $d020 / jmp $0822, a jam opcode, and lda
// $xxxx cut off by the end of the file
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
const A = analyze(p), R = render(A, p);
const text = (l: ListingLine) => ('tok' in l ? `${'mn' in l && l.k === 'ins' ? l.mn.toLowerCase() : 'dir' in l ? l.dir : ''} ${l.tok.map(t => t.s).join('')}`.trim() : '');

describe('the peek (Ctrl over a line)', () => {
  it('shows code as its bytes from the line, eight a row, the line\'s bytes marked', () => {
    const b = findBlock(A.blocks, 0x080d)!;
    expect(b.type).toBe('code');
    const k = peekOf(A, R, b, 0x0810, 3, false);
    expect(k.as).toBe('bytes');
    if (k.as !== 'bytes') return;
    expect(k.rows).toEqual([{ a: 0x0810, n: 4 }]);
    expect(k.mark).toEqual({ start: 0x0810, end: 0x0813 });
    expect(k.rest).toBe(0);
  });

  it('shows data as code, swept from the block\'s start, with the names the listing uses', () => {
    const b = findBlock(A.blocks, 0x0823)!;
    expect(b.type).not.toBe('code');
    const k = peekOf(A, R, b, 0x0824, 1, true);
    expect(k.as).toBe('code');
    if (k.as !== 'code') return;
    // the first line is the one the pointer's byte is in, and it is marked
    expect(k.lines[0].a).toBe(0x0823);
    expect(k.mark).toEqual({ start: 0x0824, end: 0x0825 });
    expect(k.lines.slice(0, 3).map(text)).toEqual(['lda #$01', 'sta VIC_BORDER_COLOR', `jmp ${R.labels.get(0x0822)?.name ?? '$0822'}`]);
  });

  it('a jam opcode, and an instruction that would run past the block, are .byte', () => {
    const b = findBlock(A.blocks, 0x0823)!;
    const k = peekOf(A, R, b, b.start, 0, true);
    if (k.as !== 'code') throw new Error('as code');
    const jam = k.lines.find(l => A.mem[l.a] === 0x02)!;
    expect(jam.k).toBe('dat');
    expect(jam.k === 'dat' && jam.cmt).toMatch(/halts the CPU/);
    const last = k.lines.at(-1)!;
    expect(last.a).toBe(b.end - 1);
    expect(text(last)).toBe('.byte $ad');
    expect(k.lines.every(l => l.a + l.n <= b.end)).toBe(true);
    expect(k.mark).toBeNull();
  });

  it('shows at most PEEK_ROWS rows and counts the bytes after them', () => {
    const big: ProjectInput = { files: [parsePrg('b.prg', assemble({ 'b.asm': `.pc = $1000\n.fill 400, $ea` }, 'b.asm').prg!)] };
    const B = analyze(big), S = render(B, big), b = findBlock(B.blocks, 0x1000)!;
    const bytes = peekOf(B, S, b, 0x1000, 0, false), code = peekOf(B, S, b, 0x1000, 0, true);
    expect(bytes.as === 'bytes' && bytes.rows.length).toBe(PEEK_ROWS);
    expect(bytes.as === 'bytes' && bytes.rows.every((r, i) => r.a === 0x1000 + i * PEEK_ROW && r.n === PEEK_ROW)).toBe(true);
    expect(bytes.rest).toBe(b.end - 0x1000 - PEEK_ROWS * 8);
    expect(code.as === 'code' && code.lines.length).toBe(PEEK_ROWS);
    expect(code.rest).toBe(b.end - 0x1000 - PEEK_ROWS);
  });

  describe('the mouse wheel scrolls it up and down the block', () => {
    // 400 nops at $1000: as code a line is a byte
    const big: ProjectInput = { files: [parsePrg('b.prg', assemble({ 'b.asm': `.pc = $1000\n.fill 400, $ea` }, 'b.asm').prg!)] };
    const B = analyze(big), S = render(B, big), b = findBlock(B.blocks, 0x1000)!;

    it('as bytes: rows stay eight from the pointer\'s byte, the block\'s first bytes the top row', () => {
      // the pointer at $1013: three rows above it, the first of them $1000-$1002
      const k = peekOf(B, S, b, 0x1013, 0, false, -10);
      if (k.as !== 'bytes') throw new Error('as bytes');
      expect(k.off).toBe(-3);
      expect(k.min).toBe(-3);
      expect(k.rows.slice(0, 3)).toEqual([{ a: 0x1000, n: 3 }, { a: 0x1003, n: 8 }, { a: 0x100b, n: 8 }]);
      expect(k.rows[3]).toEqual({ a: 0x1013, n: 8 });
      expect(k.before).toBe(0);
      expect(k.rest).toBe(b.end - k.rows.at(-1)!.a - 8);
      // down: one row is eight bytes on
      const d = peekOf(B, S, b, 0x1013, 0, false, 2);
      expect(d.as === 'bytes' && d.rows[0].a).toBe(0x1023);
      expect(d.before).toBe(0x23);
      // no further down than the block's last byte in the bottom row
      const end = peekOf(B, S, b, 0x1013, 0, false, 1000);
      if (end.as !== 'bytes') throw new Error('as bytes');
      expect(end.off).toBe(end.max);
      expect(end.rows).toHaveLength(PEEK_ROWS);
      expect(end.rest).toBe(0);
      expect(end.rows.at(-1)!.a + end.rows.at(-1)!.n).toBe(b.end);
    });

    it('as code: a row is an instruction, swept from the block\'s start', () => {
      const k = peekOf(B, S, b, 0x1010, 0, true, -4);
      if (k.as !== 'code') throw new Error('as code');
      expect(k.off).toBe(-4);
      expect(k.lines[0].a).toBe(0x100c);
      expect(k.before).toBe(0x0c);
      expect(peekOf(B, S, b, 0x1010, 0, true, -100).lines[0]?.a ?? -1).toBe(0x1000);
      const end = peekOf(B, S, b, 0x1010, 0, true, 1000);
      if (end.as !== 'code') throw new Error('as code');
      expect(end.lines).toHaveLength(PEEK_ROWS);
      expect(end.lines.at(-1)!.a + end.lines.at(-1)!.n).toBe(b.end);
      expect(end.rest).toBe(0);
    });

    it('near the end it starts at the pointer\'s line, and only scrolls up', () => {
      const bytes = peekOf(B, S, b, b.end - 3, 0, false, 5), code = peekOf(B, S, b, b.end - 3, 0, true, 5);
      expect([bytes.off, bytes.max, code.off, code.max]).toEqual([0, 0, 0, 0]);
      expect(bytes.as === 'bytes' && bytes.rows).toEqual([{ a: b.end - 3, n: 3 }]);
      const up = peekOf(B, S, b, b.end - 3, 0, false, -1);
      expect(up.as === 'bytes' && up.rows.map(r => r.a)).toEqual([b.end - 11, b.end - 3]);
    });
  });
});
