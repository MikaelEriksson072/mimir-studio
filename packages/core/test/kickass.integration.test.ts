/* Integration (spec 16): the generated projects must assemble with the real KickAss.jar to the
 * original bytes. Runs when Java and KickAss.jar are found (KICKASS_JAR / JAVA env vars or the
 * usual install folders), otherwise the suite is skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { analyze, assemble, bankFiles, SCRIPT_TEMPLATES, comparePrg, createProject, exportFiles, h4, makePrg, openCartridge, planPatch, render, withPatch } from '../src';
import { findKickAssJar, runKickAssembler, writeVfs } from '../src/node';
import { cases, demo, type Case } from './helpers/cases';

const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const available = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;

async function assembleWithKick(c: Case) {
  const A = analyze(c.project);
  const R = render(A, c.project);
  const dir = await mkdtemp(join(tmpdir(), 'mimir-it-'));
  try {
    await writeVfs(dir, R.files);
    const results = [];
    for (const [fi, f] of A.files.entries()) {
      const entry = `${R.fileNames[fi]}.asm`;
      const run = await runKickAssembler({ java, jar: jar!, cwd: dir, entry, outDir: 'out', args: ['-vicesymbols', '-showmem'] });
      const cmp = comparePrg(f, run.prg, R.excluded.filter(x => x.file === fi));
      results.push({ entry, run, cmp });
    }
    return results;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe.skipIf(!available)(`real Kick Assembler (${jar ?? 'not found'})`, () => {
  it('assembles every generated project byte-identical to the original', async () => {
    const all = cases();
    const failures: string[] = [];
    let next = 0, assembled = 0;
    const worker = async () => {
      while (next < all.length) {
        const c = all[next++];
        for (const { entry, run, cmp } of await assembleWithKick(c)) {
          assembled++;
          if (!run.ok || !cmp.ok) {
            const why = run.problems.length ? run.problems.map(p => `${p.file}:${p.line}:${p.column} ${p.message}`).join(' | ') : run.output.split('\n').slice(-6).join(' / ');
            failures.push(`${c.name} (${entry}): ${why} ${cmp.diffs.slice(0, 3).map(d => d.msg ?? `$${h4(d.addr)} expected ${d.exp} got ${d.got}`).join('; ')}`);
          } else {
            expect(run.vsPath, `${c.name}: -vicesymbols should write a VICE label file`).not.toBeNull();
          }
        }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    expect(failures).toEqual([]);
    expect(assembled).toBeGreaterThanOrEqual(all.length);
  }, 300_000);

  it('assembles an exported patch (patches/<name>.asm) on its own to the bytes it writes', async () => {
    // fx_091e (lda SID_OSC3 / and #$0f / sta COLOR_RAM+999) patched with a hardware name and a label of the program
    const p = createProject({ name: 'raster-demo', files: demo().files });
    const A = analyze(p), R = render(A, p);
    const plan = planPatch(A, R, p, { name: 'red border', start: 0x091e, end: 0x0926, source: '        lda #$02\n        sta VIC_BORDER_COLOR\n        jmp start', fill: 'nop', over: false });
    if ('error' in plan) throw new Error(plan.error);
    const q = { ...p, ...withPatch(p, plan.patch) };
    const out = exportFiles(q, render(analyze(q), q), q.settings);
    const dir = await mkdtemp(join(tmpdir(), 'mimir-it-'));
    try {
      await writeVfs(dir, { 'red_border.asm': out['patches/red_border.asm'] });
      const run = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'red_border.asm', outDir: 'out' });
      expect(run.ok, run.output).toBe(true);
      expect([...run.prg!]).toEqual([...makePrg(0x091e, plan.patch.bytes)]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);

  it('builds an exported cartridge: the chips, then <name>.crt.asm writes the image byte-identical to the one opened', async () => {
    // fixtures/crt/mimir-demo.crt (crt.test.ts), opened at its boot bank and at its other bank (bank 0 from banks/)
    const crt = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/crt/mimir-demo.crt')));
    for (const bank of [0, 1]) {
      const o = openCartridge('mimir-demo.crt', crt);
      const p = createProject({ files: bankFiles(o.crt, bank), cart: o.cart });
      const R = render(analyze(p), p), out = exportFiles(p, R, p.settings);
      const dir = await mkdtemp(join(tmpdir(), 'mimir-it-'));
      try {
        await writeVfs(dir, out);
        for (const n of R.fileNames) expect((await runKickAssembler({ java, jar: jar!, cwd: dir, entry: `${n}.asm`, outDir: 'out' })).ok).toBe(true);
        const run = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'mimir-demo.crt.asm', outDir: 'out' });
        expect(run.ok, run.output).toBe(true);
        expect(run.prgPath).toBe(join(dir, 'out', 'mimir-demo.crt'));
        expect(run.prg).toEqual(crt);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  }, 60_000);

  it('assembles every bank in one source (13.9c) alone to the image it was opened from', async () => {
    const crt = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/crt/mimir-demo.crt')));
    const o = openCartridge('mimir-demo.crt', crt), p = createProject({ files: o.files, cart: o.cart, settings: { cartOneSource: true } });
    const R = render(analyze(p), p), dir = await mkdtemp(join(tmpdir(), 'mimir-it-'));
    try {
      await writeVfs(dir, exportFiles(p, R, p.settings));
      const run = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'mimir-demo.crt.asm', outDir: 'out', args: ['-vicesymbols'] });
      expect(run.ok, run.output).toBe(true);
      expect(run.prg).toEqual(crt);
      // the labels of every bank, for VICE's monitor
      expect(run.vsPath).toBe(join(dir, 'out', 'mimir-demo.crt.vs'));
      expect(readFileSync(run.vsPath!, 'utf8')).toMatch(/al C:8009 \.start/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});

/** the code of patches and scripts beyond the generated subset: the built-in assembler writes what KickAss.jar does */
const BEYOND = [
  ['!loop: dex', ' bne !loop-', ' beq !+', ' nop', '!: inx', '!: bne !-', ' jmp !loop-'],
  ['.for (var i=0; i<3; i++) {', 'bar: .byte i*i', '}', '.var t = 0', '.while (t < 2) { .byte 9', '.eval t++ }'],
  ['.const C = 5', '.if (C > 3) .byte 1', 'else .byte 2', '.if (C < 3) {', ' .byte 3', '} else .if (C == 5) {', ' .byte 4', '} else {', ' .byte 5', '}'],
  ['lab: {', ' inner: nop', '}', ' jmp lab.inner', '.for (var i=0; i<2; i++) {', ' ldx #0', '!: dex', ' bne !-', '}'],
  ['.var v = 3', '.eval v = v + 1', '.eval v++', '.eval v *= 2', ' .byte v', '.var s = "a"', '.eval s += "b"', ' .byte s.size()'],
  [' lda #<$12ff+1', ' lda #>$12ff+1', ' .byte <$12ff+1, >$12ff+$101, >$1234 & $ff, >$1234 - $100, 2 + >$1234, -$12 + 1'],
  [' .byte 1+2*3, (2 | 1) == 3 ? 9 : 8, -7/2 & $ff, 7/2*2, [3+4]*2, round(2.6), floor(2.6), mod(10,3), ~1 & $ff, <(-1)'],
  [` .byte 'A', 'a', 1==1 ? 1 : 0, 3 < 4 ? 1 : 0, !true ? 1 : 0, "ab".size(), 5 >= 5 && 1 != 2 ? 1 : 0`],
  ['.fill 16, round(127.5 + 127.5 * sin(toRadians(i * 360 / 16)))', ' .word abs(-300), max(3, 9), pow(2, 10)'],
  [' * = $1100 "two"', 'start: lda #0', '!: sta $0400,x', ' inx', ' bne !-', ' rts'],
  // a script a user wrote (2026-11-11): the screen and the colour RAM cleared, scratchpads by name, comments after code
  ['.label pad1 = $c800', '.label pad2 = $c900', 'sub_111a:', '        ldx #$00', 'loop_111c:', '        lda #$20', '        sta $0400,x  ',
    '        sta pad1,x                   // Default screen matrix — row 0, column 0', '        sta $0500,x                     // Default screen matrix — row 6, column 16',
    '        sta $0600,x', '        sta $06e8,x', '        lda #$00', '        sta $d800,x                     // Color RAM — row 0, column 0',
    '        sta $d900,x', '        sta $da00,x', '        sta $dae8,x', '        clc', '        adc #$02', '        sta pad2,x', '        inx', '        bne loop_111c', '        rts'],
].map(l => l.join('\n'));
// the script templates (script-templates.ts), with their scratchpad as a label: as they come, and the other ways round
// their switches give
const TEMPLATE_PAD = '.label result = $c000\n.label result_end = $c400\n';
const flip = (name: string, vars: Record<string, string>) => TEMPLATE_PAD + Object.entries(vars).reduce(
  (s, [k, v]) => s.replace(new RegExp(`^(\\.var\\s+${k}\\s*=\\s*)\\S+`, 'm'), (_, h: string) => h + v), SCRIPT_TEMPLATES.find(t => t.name === name)!.source);
BEYOND.push(...SCRIPT_TEMPLATES.map(t => TEMPLATE_PAD + t.source),
  flip('xor_rolling_key', { backwards: 'true' }), flip('xor_chain', { backwards: 'true', encrypt: 'true', withDecrypted: 'false' }),
  flip('steps', { step1: 'ROTL', key1: '3', step3: 'NONE', step4: 'ROTR', encrypt: 'true' }), flip('add_key', { subtract: 'false' }), flip('xor_key_string', { keyLength: '0' }),
  flip('xor_rolling_key', { pageKey: 'true' }));

describe.skipIf(!available)(`the built-in assembler beyond the generated subset, against ${jar ?? 'KickAss.jar'}`, () => {
  it('writes the same bytes as Kick Assembler', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mimir-beyond-'));
    try {
      for (const [i, src] of BEYOND.entries()) {
        const text = `.pc = $1000\n${src}\n`;
        const own = assemble({ 'a.asm': text }, 'a.asm');
        expect(own.errors, src).toEqual([]);
        await writeVfs(dir, { [`b${i}.asm`]: text });
        const run = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: `b${i}.asm`, outDir: 'out' });
        expect(run.ok, `${src}: ${run.output.split('\n').slice(-4).join(' / ')}`).toBe(true);
        expect([...own.prg!], src).toEqual([...run.prg!]);
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
