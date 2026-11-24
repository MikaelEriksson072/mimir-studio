/* Cartridge images made and changed (spec 10.3): the standard structures are the images VICE's cartconv writes, an
 * image read and written again is the image it was, and a cartridge that starts a program has it where its boot
 * copies it from. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CBM80, CRT_LAYOUTS, CrtEdit, crtLayout, describeCrt, makeCrt, parseCrt, programCartridge } from '../src';

const CARTCONV = 'C:/C64/VICE/GTK3VICE-3.10-win64/bin/cartconv.exe';
const noise = (n: number, seed = 7) => { const b = new Uint8Array(n); let s = seed; for (let i = 0; i < n; i++) { s = (Math.imul(s, 1103515245) + 12345) >>> 0; b[i] = (s >>> 16) & 0xff; } return b; };

describe('the standard structures of cartridges', () => {
  it('has every hardware type cartconv makes, with the sizes each comes in', () => {
    expect(CRT_LAYOUTS.length).toBe(84);
    expect(CRT_LAYOUTS.slice(0, 2).map(l => [l.key, l.hw, l.name, l.sizes])).toEqual([
      ['normal', 0, 'Normal cartridge (8K or 16K mode)', [4096, 8192, 12288, 16384]], ['ulti', 0, 'Normal cartridge in Ultimax mode', [4096, 8192, 16384]]]);
    const of = (k: string) => CRT_LAYOUTS.find(l => l.key === k)!;
    expect([of('md').name, of('md').sizes.map(s => s / 1024)]).toEqual(['Magic Desk (Domark, HES Australia)', [32, 64, 96, 128, 256, 512, 1024]]);
    expect([of('easy').hw, of('easy').sizes]).toEqual([32, [1024 * 1024]]);
    expect(new Set(CRT_LAYOUTS.map(l => l.key)).size).toBe(84);
  });

  it('gives a structure of a size: the lines at reset, the banks and the chips', () => {
    expect(crtLayout('normal')).toEqual({ key: 'normal', hw: 0, name: 'Normal cartridge (8K or 16K mode)', size: 4096, exrom: 0, game: 1, banks: 1, chips: [{ bank: 0, load: 0x8000, size: 4096, type: 0 }] });
    expect(crtLayout('normal', 16384)).toMatchObject({ exrom: 0, game: 0, chips: [{ bank: 0, load: 0x8000, size: 16384, type: 0 }] });
    expect(crtLayout('ulti', 16384)!.chips).toEqual([{ bank: 0, load: 0x8000, size: 8192, type: 0 }, { bank: 0, load: 0xe000, size: 8192, type: 0 }]);
    const easy = crtLayout('easy')!;
    expect([easy.exrom, easy.game, easy.banks, easy.chips.length, easy.chips[1], easy.chips[127]]).toEqual([1, 0, 64, 128, { bank: 0, load: 0xa000, size: 8192, type: 2 }, { bank: 63, load: 0xa000, size: 8192, type: 2 }]);
    // an Ocean cartridge of 256 KB has its upper half at $a000; a Fun Play's banks are numbered in eights
    const ocean = crtLayout('ocean', 256 * 1024)!;
    expect([ocean.chips[15].load, ocean.chips[16].load, ocean.chips[16].bank]).toEqual([0x8000, 0xa000, 16]);
    expect(crtLayout('fp')!.chips.slice(0, 9).map(c => c.bank)).toEqual([0, 8, 16, 24, 32, 40, 48, 56, 1]);
    // by the hardware type's number; what there is not
    expect(crtLayout(19, 32768)!.key).toBe('md');
    expect([crtLayout('md', 8192), crtLayout('nothing'), crtLayout(999)]).toEqual([null, null, null]);
  });

  it.runIf(existsSync(CARTCONV))('makes of a .bin the image cartconv makes, byte for byte, for every structure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-crt-'));
    try {
      let n = 0;
      for (const l of CRT_LAYOUTS) for (const size of l.sizes) {
        // (the largest are the same structure longer: one of each key over a megabyte is enough)
        if (size > 1024 * 1024 && size !== l.sizes[0]) continue;
        const bin = noise(size, size + l.hw);
        writeFileSync(join(dir, 'in.bin'), bin);
        rmSync(join(dir, 'out.crt'), { force: true });
        execFileSync(CARTCONV, ['-b', '-t', l.key, '-i', join(dir, 'in.bin'), '-o', join(dir, 'out.crt'), '-n', 'TEST'], { stdio: 'pipe' });
        const ours = CrtEdit.of(crtLayout(l.key, size)!, { name: 'TEST', data: bin }).image();
        expect(Buffer.from(ours).equals(readFileSync(join(dir, 'out.crt'))), `${l.key} ${size}`).toBe(true);
        n++;
      }
      expect(n).toBeGreaterThan(120);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }, 120_000);
});

describe('a cartridge image read and written', () => {
  it('is the image it was, and the image the reader reads', () => {
    const img = makeCrt({ name: 'GAME', hw: 19, exrom: 0, game: 1, chips: [0, 1, 2, 3].map(bank => ({ bank, load: 0x8000, bytes: noise(8192, bank + 1) })) });
    const e = CrtEdit.open(img, 'game.crt');
    expect(Buffer.from(e.image()).equals(Buffer.from(img))).toBe(true);
    expect([e.name, e.hw, e.exrom, e.game, e.mode, e.banks, e.bootBank, e.total, e.chips.length]).toEqual(['GAME', 19, 0, 1, '8k', [0, 1, 2, 3], 0, 32768, 4]);
    e.chips[2].data[5] = 0x99; e.setName('OTHER'); e.hw = 5;
    const c = parseCrt(e.image(), 'x.crt');
    expect([c.name, c.hw, c.chips[2].data[5], c.chips.length, describeCrt(c)]).toEqual(['OTHER', 5, 0x99, 4, 'Ocean, 4 banks of 8 KB (32 KB), 8K mode']);
  });

  it('keeps what an odd image has: a longer header, a packet longer than its data, bytes after the last packet', () => {
    const base = makeCrt({ name: 'ODD', exrom: 0, game: 1, chips: [{ bank: 0, load: 0x8000, bytes: noise(4096) }, { bank: 1, load: 0x8000, bytes: noise(4096, 3) }] });
    // a header of $50 bytes, the first packet 8 bytes longer than its data, 3 bytes after the last, a name with
    // bytes after its zero, reserved bytes set
    const p0 = 0x40, p1 = p0 + 16 + 4096;
    const odd = new Uint8Array(base.length + 16 + 8 + 3);
    odd.set(base.subarray(0, 0x40)); odd[0x13] = 0x50; odd.fill(0xaa, 0x40, 0x50); odd[0x1c] = 7; odd[0x2a] = 0x41;
    odd.set(base.subarray(p0, p1), 0x50); odd[0x50 + 7] = 0x18; odd[0x50 + 6] = 0x10; odd.fill(0xbb, 0x50 + 16 + 4096, 0x50 + 16 + 4096 + 8);
    odd.set(base.subarray(p1), 0x50 + 16 + 4096 + 8); odd.fill(0xcc, odd.length - 3);
    const e = CrtEdit.open(odd, 'odd.crt');
    expect(Buffer.from(e.image()).equals(Buffer.from(odd))).toBe(true);
    expect([e.chips.length, e.chips[0].extra?.length, e.chips[1].extra]).toEqual([2, 8, undefined]);
    // a header that says it is shorter than 64 bytes (old images) stays so
    const old = base.slice(); old[0x13] = 0x20;
    expect(Buffer.from(CrtEdit.open(old, 'old.crt').image()).equals(Buffer.from(old))).toBe(true);
  });

  it('says how the C64 starts it: the CBM80 vectors, or the CPU\'s own in Ultimax mode', () => {
    const rom = new Uint8Array(8192); rom.set([0x09, 0x80, 0x5e, 0xfe, ...CBM80]);
    expect(CrtEdit.of(crtLayout('normal', 8192)!, { data: rom }).start).toEqual({ kind: 'cbm80', cold: 0x8009, warm: 0xfe5e });
    expect(CrtEdit.of(crtLayout('normal', 8192)!).start).toBeNull();
    const high = new Uint8Array(8192); high.set([0x00, 0xe0, 0x10, 0xe0, 0x20, 0xe0], 0x1ffa);
    const u = CrtEdit.of(crtLayout('ulti', 8192)!, { data: high });
    expect([u.mode, u.start]).toEqual(['ultimax', { kind: 'vectors', nmi: 0xe000, reset: 0xe010, irq: 0xe020 }]);
    // an EasyFlash keeps its boot bank's ROMH at $a000: the CPU sees it at $e000
    const easy = CrtEdit.of(crtLayout('easy')!);
    easy.chips[1].data.set([0x00, 0xe0, 0x10, 0xe0, 0x20, 0xe0], 0x1ffa);
    expect([easy.address(easy.chips[1]), easy.address(easy.chips[3]), easy.chipAt(0, 0xfffc), easy.chipAt(0, 0xbffc), easy.chipAt(1, 0xfffc), easy.start]).toEqual([0xe000, 0xa000, 1, 1, -1, { kind: 'vectors', nmi: 0xe000, reset: 0xe010, irq: 0xe020 }]);
  });
});

describe('a cartridge that starts a program', () => {
  it('is a Magic Desk cartridge with the boot in bank 0 and the program after it, bank after bank', () => {
    const prg = noise(20000, 5);
    const p = programCartridge(0x0801, prg, { name: 'GAME' });
    const c = parseCrt(p.crt.image(), 'game.crt');
    expect([c.hw, c.exrom, c.game, c.name, c.chips.length, p.banks, p.basic, p.start]).toEqual([19, 0, 1, 'GAME', 4, 4, true, 0xa7ae]);
    expect(p.crt.start).toEqual({ kind: 'cbm80', cold: 0x8009, warm: 0xfe5e });
    const rom = new Uint8Array(4 * 8192); c.chips.forEach((x, i) => rom.set(x.data, i * 8192));
    expect(Buffer.from(rom.subarray(p.data - 0x8000, p.data - 0x8000 + prg.length)).equals(Buffer.from(prg))).toBe(true);
    expect(rom[p.data - 0x8000 + prg.length]).toBe(0xff);
    // the boot: sei, then the routine it copies to $0100 right before the program, which ends in RUN
    expect(rom[9]).toBe(0x78);
    expect(Array.from(rom.subarray(p.data - 0x8000 - 7, p.data - 0x8000))).toEqual([0x58, 0x20, 0x59, 0xa6, 0x4c, 0xae, 0xa7]);
    // machine code is jumped to, where it loads or where it is said
    const m = programCartridge(0xc000, Uint8Array.of(0x60), { start: 0xc000 });
    const mr = m.crt.chips[0].data;
    expect([m.basic, m.start, m.banks, Array.from(mr.subarray(m.data - 0x8000 - 4, m.data - 0x8000 + 1))]).toEqual([false, 0xc000, 4, [0x58, 0x4c, 0x00, 0xc0, 0x60]]);
    expect(programCartridge(0x0801, Uint8Array.of(0x60), { start: 0x0801 }).basic).toBe(false);
    // as many banks as the program needs
    expect(programCartridge(0x0810, noise(0xf000)).banks).toBe(8);
    for (const g of [() => programCartridge(0x0100, Uint8Array.of(1)), () => programCartridge(0xffff, Uint8Array.of(1, 2)), () => programCartridge(0x0801, new Uint8Array(0))]) expect(g).toThrow(RangeError);
  });
});
