/* Integration (spec 10.7): the blocks Insert block writes build with the real KickAss.jar and 64tass to the bytes
 * Mimir's own assembler makes of them, as .byte lines and as files the source imports. Runs when the assemblers are
 * found (KICKASS_JAR / JAVA / TASS64 env vars or the usual install folders); otherwise skipped. */
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { asmBlockText, type AsmBlockRequest } from '../src/asm-blocks';
import { checkAsm } from '../src/asm-project';
import { makePsid } from '../src/c64/psid';
import { picture, pictureData, writePicture } from '../src/c64/pictures';
import { find64tass, findKickAssJar, runKickAssembler, writeVfs } from '../src/node';
import type { ScriptLang, Vfs } from '../src/types';

const jar = process.env.KICKASS_JAR || findKickAssJar();
const java = process.env.JAVA || 'java';
const kick = !!jar && spawnSync(java, ['-version'], { windowsHide: true }).status === 0;
const tass = find64tass();

const bytes = (n: number, f: (i: number) => number) => Uint8Array.from({ length: n }, (_, i) => f(i) & 0xff);
const pic = picture({ mc: true, bitmap: bytes(8000, i => i * 13), screen: bytes(1000, i => i * 3), color: bytes(1000, i => i & 15), bg: 11 });
const sid = makePsid(bytes(300, i => i * 5 + 1), 0x1000, 0x1000, 0x1003, 'Tune');
const FILES: Vfs = {
  'sprites/ship.spr': Uint8Array.from([0x00, 0x20, ...bytes(192, i => i * 7)]),
  'bitmaps/pic.kla': writePicture('koala', pic),
  'music/tune.sid': sid,
  'data/tab.bin': bytes(33, i => 200 - i),
};
/** each kind, as .byte lines and imported (none over another: those at the caret first) */
const BLOCKS: Omit<AsmBlockRequest, 'lang'>[] = [
  { kind: 'sprite', name: 'ship', bytes: bytes(192, i => i * 7), mc: true, at: null },
  { kind: 'charset', name: 'font', bytes: bytes(64, i => i ^ 0xa5), at: null },
  { kind: 'screen', name: 'scr', bytes: bytes(1000, i => i), at: null },
  { kind: 'data', name: 'tab', bytes: bytes(33, i => 200 - i), at: null },
  { kind: 'data', name: 'tab_f', bytes: bytes(33, i => 200 - i), at: null, file: { path: 'data/tab.bin' } },
  { kind: 'sprite', name: 'ship_f', bytes: bytes(192, i => i * 7), mc: false, at: 0x3000, file: { path: 'sprites/ship.spr', offset: 2 } },
  { kind: 'bitmap', name: 'pic', bytes: pictureData(pic), picture: true, mc: true, at: 0x4000 },
  { kind: 'bitmap', name: 'pic_f', bytes: pictureData(pic), picture: true, mc: true, at: 0x8000, file: { path: 'bitmaps/pic.kla', offset: 2 } },
];
const MUSIC: Omit<AsmBlockRequest, 'lang'>[] = [
  { kind: 'music', name: 'tune', bytes: sid, at: null },
  { kind: 'music', name: 'tune', bytes: sid, at: null, file: { path: 'music/tune.sid' } },
];

function source(lang: ScriptLang, blocks: readonly Omit<AsmBlockRequest, 'lang'>[]): string {
  const head = lang === '64tass'
    ? '        * = $0801\n        .byte $0b, $08, $ea, $07, $9e\n        .text "2061"\n        .byte 0, 0, 0\nstart   rts\n'
    : 'BasicUpstart2(start)\nstart:  rts\n';
  return head + blocks.map(b => asmBlockText({ ...b, lang }).text).join('');
}

async function build(lang: ScriptLang, text: string): Promise<Uint8Array> {
  const dir = await mkdtemp(join(tmpdir(), 'mimir-blocks-'));
  try {
    await writeVfs(dir, { ...FILES, 'main.asm': text });
    if (lang === 'kickass') {
      const r = await runKickAssembler({ java, jar: jar!, cwd: dir, entry: 'main.asm', outDir: 'out' });
      expect(r.output ?? '').not.toMatch(/error/i);
      return new Uint8Array(await readFile(join(dir, 'out', 'main.prg')));
    }
    const r = spawnSync(tass!, ['-a', '-C', '-o', 'main.prg', 'main.asm'], { cwd: dir, windowsHide: true, encoding: 'utf8' });
    expect(r.status, r.stdout + r.stderr).toBe(0);
    return new Uint8Array(await readFile(join(dir, 'main.prg')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const cases: [ScriptLang, boolean][] = [['kickass', kick], ['64tass', !!tass]];
for (const [lang, there] of cases) {
  describe.skipIf(!there)(`blocks built with the real ${lang === '64tass' ? '64tass' : 'Kick Assembler'}`, () => {
    for (const [what, blocks] of [['every kind, as .byte lines and imported', BLOCKS], ['music, as .byte lines', MUSIC.slice(0, 1)], ['music, from its .sid', MUSIC.slice(1)]] as const) {
      it(`gives the bytes Mimir's assembler gives: ${what}`, async () => {
        const text = source(lang, blocks);
        const c = checkAsm({ ...FILES, 'main.asm': text }, 'main.asm', lang);
        expect(c.problems).toEqual([]);
        expect([...await build(lang, text)]).toEqual([...c.asm.prg!]);
      }, 60_000);
    }
  });
}
