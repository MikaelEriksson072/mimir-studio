/* Integration (spec 10.7): an Assembler project's arguments give the real KickAss.jar and 64tass the bytes they give
 * Mimir's own check (the defines in them: -define NAME, -D NAME=value). Runs when the assemblers are found;
 * otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkAsm } from '../src/asm-project';
import { find64tass, findKickAssJar, run64tass, runKickAssembler, writeVfs } from '../src/node';
import type { ScriptLang } from '../src/types';

const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const kick = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;
const tass = find64tass();

const KICK = `BasicUpstart2(start)
* = $0810
start:
#if DEBUG
 inc $d020
#elif TRACE && !DEBUG
 inc $d021
#endif
#if !QUIET
 lda #1
#endif
 rts
`;
const TASS = `* = $0801
 .word (+), 2026
 .null $9e, format("%d", start)
+ .word 0
.weak
SPEED = 1
DEBUG = 0
.endweak
start
.if DEBUG
 inc $d020
.fi
 lda #SPEED
 rts
`;
const cases: [ScriptLang, boolean, string, string[]][] = [
  ['kickass', kick, KICK, []], ['kickass', kick, KICK, ['-define', 'DEBUG']], ['kickass', kick, KICK, ['-define', 'TRACE', '-define', 'QUIET']],
  ['64tass', !!tass, TASS, []], ['64tass', !!tass, TASS, ['-D', 'DEBUG=1']], ['64tass', !!tass, TASS, ['-DSPEED=$c0+1', '-D', 'DEBUG']],
];

async function built(lang: ScriptLang, text: string, args: string[]): Promise<Uint8Array | null> {
  const dir = await mkdtemp(join(tmpdir(), 'mimir-args-'));
  try {
    await writeVfs(dir, { 'main.asm': text });
    const r = lang === 'kickass'
      ? await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'main.asm', outDir: 'out', args: ['-showmem', ...args] })
      : await run64tass({ exe: tass!, cwd: dir, entry: 'main.asm', outDir: 'out', args });
    expect(r.ok, r.output).toBe(true);
    return r.prg ?? new Uint8Array(await readFile(r.prgPath));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

for (const [lang, there, text, args] of cases) {
  describe.skipIf(!there)(`the arguments with the real ${lang === '64tass' ? '64tass' : 'Kick Assembler'}`, () => {
    it(`give the bytes Mimir's check gives: ${args.join(' ') || 'none'}`, async () => {
      const c = checkAsm({ 'main.asm': text }, 'main.asm', lang, { args });
      expect(c.problems).toEqual([]);
      expect([...(await built(lang, text, args))!]).toEqual([...c.asm.prg!]);
    }, 60_000);
  });
}
