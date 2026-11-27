/* Integration (spec 10.7): what the Assembler's export writes, built with the real KickAss.jar and 64tass: one source
 * (the sources it imports put in, the data files beside it) gives the program the project gives; the .byte lines give
 * its bytes; the symbols file is one a source can import. Runs when the assemblers are found; otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm, ASM_SOURCE } from '../src/asm-project';
import { asmExportByteLines, asmExportProgram, asmExportSymbols, asmOneSource } from '../src/asm-export';
import { find64tass, findKickAssJar, run64tass, runKickAssembler, writeVfs } from '../src/node';
import type { ScriptLang, Vfs } from '../src/types';
import { KICK, TASS } from './asm-export-fixtures';

const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const kick = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;
const tass = find64tass();

async function built(lang: ScriptLang, vfs: Vfs, entry: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'mimir-export-'));
  try {
    await writeVfs(dir, vfs);
    const r = lang === 'kickass'
      ? await runKickAssembler({ java, jar: jar!, cwd: dir, entry, outDir: 'out', args: [] })
      : await run64tass({ exe: tass!, cwd: dir, entry, outDir: 'out', args: [] });
    expect(r.ok, r.output).toBe(true);
    return r.prg ?? new Uint8Array(await readFile(r.prgPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const [lang, on, vfs] of [['kickass', kick, KICK], ['64tass', !!tass, TASS]] as const) {
  describe.skipIf(!on)(`the export built with the real ${lang === 'kickass' ? 'KickAss.jar' : '64tass'}`, () => {
    it('one source gives the program the project gives; the .byte lines its bytes; the symbols file a source takes', async () => {
      const c = checkAsm(vfs, 'main.asm', lang);
      expect(c.problems).toEqual([]);
      const project = await built(lang, vfs, 'main.asm');
      expect([...project]).toEqual([...c.asm.prg!]);
      // one source alone, beside the data files (the other sources not there)
      const one = asmOneSource(vfs, 'main.asm', lang);
      const alone: Vfs = { 'main.asm': one.text };
      for (const [k, v] of Object.entries(vfs)) if (!ASM_SOURCE.test(k)) alone[k] = v;
      expect([...await built(lang, alone, 'main.asm')]).toEqual([...project]);
      // the .byte lines
      const p = asmExportProgram(c, 'main')!;
      expect([...await built(lang, { 'x.asm': asmExportByteLines(p, lang) }, 'x.asm')]).toEqual([...project]);
      // the symbols, imported by a source
      const sym = asmExportSymbols(p.names!, lang);
      const user = lang === 'kickass' ? '#import "main.sym"\n* = $1000\n lda #<BORDER\n' : ' .include "main.sym"\n * = $1000\n lda #<start\n';
      const want = lang === 'kickass' ? [0x00, 0x10, 0xa9, 0x20] : [0x00, 0x10, 0xa9, c.names.get('start')! & 0xff];
      expect([...await built(lang, { 'user.asm': user, 'main.sym': sym }, 'user.asm')]).toEqual(want);
    }, 60_000);
  });
}
