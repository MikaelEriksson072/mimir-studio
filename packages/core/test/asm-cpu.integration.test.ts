/* Integration (spec 10.7): 64tass's other processors (.cpu "65816", "65c02", "w65c02"), .dpage and .databank,
 * random() and .seed, and the operators x and ` give in Mimir's own check the bytes the real 64tass 1.57 writes (-a -C,
 * --cbm-prg). Runs when 64tass is found; otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm } from '../src/asm-project';
import { find64tass } from '../src/node';
import { cpuMnemonics, cpuOp, TASS_CPUS, type CpuMode } from '../src/verify/tass-cpu';

const tass = find64tass();

const SOURCES: Record<string, string> = {
  "the 65816: every addressing mode, .al/.xl, .dpage and .databank, @b/@w/@l": "        .cpu \"65816\"\n        * = $1000\nstart   clc\n        xce\n        rep #$30\n        .al\n        .xl\n        lda #$1234\n        ldx #$5678\n        ldy #$9abc\n        cpx #$100\n        sep #$20\n        .as\n        lda #$12\n        bit #$34\n        and #$0f\n        lda @w #$12\n        .xs\n        ldx #$12\n        lda $12\n        lda $1234\n        lda $123456\n        lda $12,x\n        lda $1234,x\n        lda $123456,x\n        lda $1234,y\n        lda ($12)\n        lda ($12,x)\n        lda ($12),y\n        lda [$12]\n        lda [$12],y\n        lda 3,s\n        lda #3,s\n        lda (3,s),y\n        lda (#3,s),y\n        sta $123456\n        stz $12\n        stz $1234,x\n        jmp $1234\n        jml $123456\n        jsr $1234\n        jsl $123456\n        jmp ($1234)\n        jmp ($1234,x)\n        jsr ($1234,x)\n        jmp [$1234]\n        jml [$1234]\n        mvn #1,#2\n        mvp #3,#4\n        pea #$1234\n        pea $1234\n        pei ($12)\n        per start\n        brl start\n        cop #5\n        wdm #6\n        phb\n        plb\n        phd\n        pld\n        phk\n        rtl\n        tcd\n        tdc\n        tcs\n        tsc\n        txy\n        tyx\n        xba\n        wai\n        stp\n        inc a\n        dec a\n        ina\n        dea\n        phx\n        phy\n        plx\n        ply\n        tsb $12\n        trb $1234\n        brk\n        lda @l $1234\n        lda @w $12\n        .dpage $400\n        lda $456\n        lda $12\n        .dpage 0\n        .databank $10\n        lda $101234\n        lda $1234\n        .databank 0\n",
  "the 65816: .autsiz with REP and SEP, the ,d ,b ,k forms, brk #, jsl/jml, mvn": " .cpu \"65816\"\n * = $1000\n .autsiz\n rep #$30\n lda #$1234\n ldx #$1234\n sep #$20\n lda #$12\n ldx #$1234\n sep #$10\n ldx #$12\n rep #$20\n lda #$1234\n .mansiz\n sep #$20\n lda #$1234\n lda #$1234,b\n lda #$12,d\n jsr #$1234,k\n lda #$12,d,x\n lda (#$12,d),y\n lda [#$12,d]\n ldx $12,y\n ldx $1234,y\n lda $1234,b\n lda $12,d\n brk #$12\n brk\n jsl $1234\n jml lab\nlab rts\n jmp ($12)\n mvn 1,2\nphx\nplb\n .al\n pea lab\n lda #-1\n",
  "the 6502: .dpage, brk #, a parenthesised expression, the aliases": " * = $1000\n .dpage $400\n lda $456\n lda $12\n lda ($412),y\n .dpage ?\n lda $12\n .dpage 0\n brk #$12\n lda ($10)+2\n jmp ($1000)+2\n bge l\n blt l\nl cpa #1\n shl\n shr $12\n",
  "the 65C02": " .cpu \"65c02\"\n * = $1000\n bra l\nl stz $12\n phx\n lda ($12)\n bit #1\n inc a\n jmp ($1234,x)\n tsb $12\n ina\n dea\n clr $1234,x\n nop\n brk\n bit $12,x\n bit $1234,x\nply\n",
  "the W65C02: rmb, smb, bbr, bbs, wai, stp, its NOPs": " .cpu \"w65c02\"\n * = $1000\nl rmb 1,$12\n smb 7,$12\n bbr 3,$12,l\n bbs 5,$12,m\nm wai\n stp\n hlt\n nop $12\n nop $12,x\n nop #3\n nop $1234\n",
  "the 65816 in bank 1: .logical $018000, per/brl, the bank byte, * = $018100": " .cpu \"65816\"\n * = $c000\n .logical $018000\na lda a\n jmp a\n jsr a\n lda b\n per a\n brl a\n .here\nb .byte 0\n .databank 1\n lda a\n lda #<a\n lda #`a\n lda #>a\n * = $018100\n lda #1\n",
  "random() and .seed": "* = $1000\n.byte random([256] x 8)\n.byte random([10] x 8)\n.word random(1000, 50000, 7)\n.byte (random() * 256)\n.seed 1234\n.byte random([256] x 4)\nx = random(100)\n.byte x, random(3, 9)\n.seed $123456789abcdef0123456789\n.byte random([5] x 3)\n",
  "the repeat operator x and the bank byte": "* = $1000\n.byte [1,2] x 1+1\n.byte 9\n.byte [1] x 2 * 2\n.byte 9\n.byte [1] x 2 << 1\n.byte 9\n.byte [3] x 2 | 4\n.byte 9\n.text \"ab\" x 2\n.byte 9\n.byte [5] x 0\n.byte 9\n.byte `$123456, `$12\n.byte [2] x 2 ** 2\n.byte 9\n.byte `$123456+$10000\n.byte 9\n.byte [1,2] x 2 x 2\n",
  "random() over the passes a forward reference takes": " * = $1000\n lda later\nx = random(100)\n.byte x, random(3, 9), random(0, 1000, 7) & 255\nlater = $1234\n",
};

describe.skipIf(!tass)("64tass's processors, random() and .seed built with the real 64tass", () => {
  for (const [what, text] of Object.entries(SOURCES)) {
    it(`gives the bytes Mimir's check gives: ${what}`, async () => {
      const c = checkAsm({ 'main.asm': text }, 'main.asm', '64tass');
      expect(c.problems).toEqual([]);
      const dir = await mkdtemp(join(tmpdir(), 'mimir-cpu-'));
      try {
        await writeFile(join(dir, 'main.asm'), text);
        const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
        expect(r.status, r.stdout + r.stderr).toBe(0);
        expect([...c.asm.prg!]).toEqual([...new Uint8Array(await readFile(join(dir, 'main.prg')))]);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }
  it('says no where 64tass does', async () => {
    // (each a list of lines)
    const wrong = [[' .cpu "65816"', ' jmp $123456'], [' .cpu "65816"', ' lda @b $1234'], [' .cpu "65816"', ' lda $123456,y'], [' lda ($12)'], [' .cpu "65c02"', ' rmb 1,$12'], [' stz $12'],
      [' .cpu "65c02"', ' lda [$12]'], [' .cpu "65816"', ' jmp @l $1234'], [' .cpu "65816"', ' lda $1234,s'], [' .cpu "65816"', ' cop $5'], [' .databank $10', ' lda $1234'], [' .cpu "65816"', ' .as', ' lda #$1234']];
    for (const lines of wrong) {
      const text = [' * = $1000', ...lines, ''].join('\n'), w = lines.join(' / ');
      expect(checkAsm({ 'main.asm': text }, 'main.asm', '64tass').problems.length, w).toBeGreaterThan(0);
      const dir = await mkdtemp(join(tmpdir(), 'mimir-cpu-'));
      try {
        await writeFile(join(dir, 'main.asm'), text);
        expect(spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true }).status, w).not.toBe(0);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }, 60_000);
});

/** an operand of each addressing mode (a branch to itself; one the 65CE02 has 16 bits of too, far for those) */
const OPERAND: Record<CpuMode, string> = {
  imp: '', acc: 'a', imm: '#$12', dp: '$12', dpx: '$12,x', dpy: '$12,y', abs: '$1234', abx: '$1234,x', aby: '$1234,y', long: '$123456', longx: '$123456,x',
  dpi: '($12)', dpix: '($12,x)', dpiy: '($12),y', dpiz: '($12),z', dpil: '[$12]', dpily: '[$12],y', sr: '#$12,s', sriy: '(#$12,s),y', rr: '#$12,r', rriy: '(#$12,r),y',
  rel: '*', rell: '*', absi: '($1234)', absix: '($1234,x)', absil: '[$1234]', move: '#$12,#$34', bit: '3,$12', bitrel: '3,$12,*',
};
describe.skipIf(!tass)('every instruction of every processor 64tass has, in every addressing mode, built with the real 64tass', () => {
  for (const cpu of TASS_CPUS) {
    it(`gives the bytes Mimir's check gives: ${cpu}`, async () => {
      const lines: string[] = [];
      for (const mn of cpuMnemonics(cpu)) {
        const modes = cpuOp(cpu, mn)!.modes;
        for (const mode of Object.keys(modes) as CpuMode[]) lines.push(` ${mn.toLowerCase()} ${mode === 'rell' && modes.rel !== undefined ? '*+$1000' : OPERAND[mode]}`);
      }
      const text = [` .cpu "${cpu}"`, ' * = $1000', ...lines, ''].join('\n');
      const c = checkAsm({ 'main.asm': text }, 'main.asm', '64tass');
      expect(c.problems).toEqual([]);
      const dir = await mkdtemp(join(tmpdir(), 'mimir-cpus-'));
      try {
        await writeFile(join(dir, 'main.asm'), text);
        const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
        expect(r.status, r.stdout + r.stderr).toBe(0);
        const real = new Uint8Array(await readFile(join(dir, 'main.prg'))), got = c.asm.prg!;
        // (where they first differ: that line)
        const at = [...real].findIndex((b, i) => b !== got[i]), pc = 0x1000 + at - 2;
        const line = at < 0 ? null : [...(c.asm.linePcs ?? [])].filter(([, p]) => p <= pc).sort((a, b) => b[1] - a[1])[0]?.[0];
        expect(at < 0 && real.length === got.length ? '' : `line ${line}: ${text.split('\n')[(line ?? 1) - 1]}`, `${lines.length} instructions`).toBe('');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }
});

describe.skipIf(!tass)('the always taken branches (gcc, gne, gra …) on every processor, built with the real 64tass', () => {
  for (const cpu of TASS_CPUS) {
    it(`give the bytes Mimir's check gives, near, far, skipping nothing, one byte, two and three: ${cpu}`, async () => {
      const dir = await mkdtemp(join(tmpdir(), 'mimir-g-'));
      try {
        for (const g of ['gcc', 'gcs', 'geq', 'gne', 'gmi', 'gpl', 'gvc', 'gvs', 'glt', 'gge', 'gra']) {
          const text = [` .cpu "${cpu}"`, ' * = $1000', 'back nop', ` ${g} t0`, 't0', ` ${g} t1`, ' nop', 't1', ` ${g} t2`, ' lda #1', 't2', ` ${g} t3`, ' lda $1234', 't3',
            ` ${g} back`, `self ${g} self`, ` ${g} +`, ' nop', '+', ` ${g} far`, ' .fill 300', 'far rts', ` ${g} back`, ''].join('\n');
          await writeFile(join(dir, 'main.asm'), text);
          const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
          const c = checkAsm({ 'main.asm': text }, 'main.asm', '64tass');
          // (gra needs BRA: none on the 6502)
          if (r.status !== 0) { expect(c.ok, `${g}: 64tass says no`).toBe(false); continue; }
          expect(c.problems, g).toEqual([]);
          expect([...c.asm.prg!], g).toEqual([...new Uint8Array(await readFile(join(dir, 'main.prg')))]);
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }, 60_000);
  }
});
