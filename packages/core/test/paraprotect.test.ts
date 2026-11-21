/* Para-Protect on a disk (c64/paraprotect.ts, spec 13.5o): the boot's table of requests, the files the drive's loader
 * reads by track and sector (any first byte in the data blocks, 8 sectors on or by its own table of sectors a track),
 * a page past track 35 that no request names, and a game's own directory whose data blocks follow their headers with no
 * SYNC; the loader in a program (analyze/loaders.ts). The disks are made here (helpers/paraprotect-disk.ts). */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze, makeD64, paraProtectFileList, paraProtectPrg, readParaProtectDisk, type ProjectInput } from '../src';
import { sectorOffset, sectorsOnTrack } from '../src/c64/d64';
import { fromSource } from './helpers/programs';
import { toG64 } from './helpers/g64';
import { bootPrg, directorySector, fill, loaderTrack, ownTrack } from './helpers/paraprotect-disk';

/** the directory's entries all name the boot, as Para-Protect's has them */
const boot = (requests: Parameters<typeof bootPrg>[1]) => makeD64({ name: 'para', id: 'pd', files: [{ name: 'PARA', data: bootPrg(0x0400, requests) }] });
/** a page from a seed, per sector */
const page = (t: number, s: number) => fill(256, t * 32 + s);
/** a copy of a D64 with these sectors' bytes */
function put(d64: Uint8Array, sectors: [number, number, Uint8Array][]): Uint8Array {
  const out = d64.slice();
  for (const [t, s, b] of sectors) out.set(b, sectorOffset(t, s, 35));
  return out;
}
const pagesOf = (...pages: Uint8Array[]) => { const out = new Uint8Array(pages.length * 256); pages.forEach((p, k) => out.set(p, k * 256)); return out; };

// a game's page on 40/14: it calls itself at $45xx three times
const own = new Uint8Array(256);
own.set([0x20, 0x10, 0x45, 0x20, 0x20, 0x45, 0x4c, 0x30, 0x45, 0x60], 0);
const t40: Uint8Array[] = [];
t40[14] = own;

describe('Para-Protect on a disk', () => {
  // two requests: 3 pages from 21/0 (track 21's data blocks marked with their sector's number), 2 from 22/5 (the DOS's
  // $07) and back to the DOS; a page on 40/14 the game asks for itself; a directory of the game's own at 11/0
  const requests = [{ dest: 0x1000, pages: 3, track: 21, sector: 0 }, { dest: 0x2000, pages: 2, track: 22, sector: 0x85 }];
  const t21: Uint8Array[] = [], t22: Uint8Array[] = [];
  for (let s = 0; s < 19; s++) { t21[s] = page(21, s); t22[s] = page(22, s); }
  // the game's directory on 11/0 and a file, S.TEST, on 11/1 → 11/2 (300 bytes at $7000)
  const file = Uint8Array.from([0x00, 0x70, ...fill(300, 9)]);
  const t11: Uint8Array[] = [];
  t11[0] = directorySector([0, 255], [{ type: 0x82, track: 11, sector: 1, name: 'S.TEST', blocks: 2 }]);
  t11[1] = Uint8Array.from([11, 2, ...file.subarray(0, 254)]);
  t11[2] = new Uint8Array(256); t11[2][0] = 0; t11[2][1] = 1 + file.length - 254; t11[2].set(file.subarray(254), 2);
  const d64 = boot(requests);
  const g64 = toG64(d64, { 42: loaderTrack(21, t21, s => s), 44: loaderTrack(22, t22, () => 7), 80: loaderTrack(40, t40, () => 7), 22: ownTrack(11, t11) });

  it('reads the boot\'s table and the files its loader reads, a page past track 35 and the game\'s own directory', () => {
    const p = readParaProtectDisk(g64)!;
    expect(p).not.toBeNull();
    expect(p.format).toBe('G64');
    expect(p.text).toEqual(['PARA-PROTECT V2 1987']);
    expect(p.boot).toMatchObject({ name: 'PARA', load: 0x0400, stub: 0x0440, stubAt: 0x02ae });
    expect(p.boot!.requests).toEqual([
      { index: 0, dest: 0x1000, pages: 3, track: 21, sector: 0, dos: false },
      { index: 1, dest: 0x2000, pages: 2, track: 22, sector: 5, dos: true },
    ]);
    expect(p.stepping).toEqual({ step: 8, counts: null, from: null });
    expect(p.ids).toBe('mixed');
    const [a, b, pg, s] = p.files;
    // 8 sectors on: 21/0, 21/8, 21/16; 22/5, 22/13
    expect(a).toMatchObject({ kind: 'loader', name: 't21s0_1000.prg', sectors: ['21/0', '21/8', '21/16'], load: 0x1000, end: 0x1300, bad: 0, missing: 0 });
    expect(a.bytes).toEqual(pagesOf(t21[0], t21[8], t21[16]));
    expect(b).toMatchObject({ kind: 'loader', name: 't22s5_2000.prg', sectors: ['22/5', '22/13'], load: 0x2000, end: 0x2200 });
    expect(b.bytes).toEqual(pagesOf(t22[5], t22[13]));
    expect(b.note).toContain('then the drive goes back to its DOS');
    expect(pg).toMatchObject({ kind: 'page', name: 't40s14_4500.prg', track: 40, sector: 14, load: 0x4500, end: 0x4600, guessed: true });
    expect(pg.bytes).toEqual(own);
    expect(p.ownDirectory).toEqual({ track: 11, sector: 0, sectors: ['11/0'] });
    expect(s).toMatchObject({ kind: 'own', name: 'S.TEST.prg', track: 11, sector: 1, sectors: ['11/1', '11/2'], load: 0x7000, end: 0x7000 + 300 });
    expect(s.bytes).toEqual(file.subarray(2));
    expect(paraProtectPrg(s)).toEqual(file);
    expect(p.files).toHaveLength(4);
    expect(p.summary).toBe('Para-Protect V2 1987 (Paranoid): boot "PARA" at $0400; 2 loader files; 1 page past track 35; 1 file in the game\'s own directory (11/0)');
    const list = paraProtectFileList(p, 'para.g64');
    expect(list[0]).toBe('; Para-Protect files of para.g64, read by Mimir Studio: 4 files the directory does not list.');
    expect(list[3]).toMatch(/^t21s0_1000\.prg +; 21\/0, 3 sectors, loads at \$1000-\$12ff \(768 bytes\): the boot's request 0/);
  });

  it('goes by the loader\'s own table of sectors a track, read from its code on track 18', () => {
    // 3 pages from 26/16: the table says 17 sectors on tracks 25-30 (the DOS 18), so 26/16, 26/7, 26/15
    const code = new Uint8Array(256);
    code.set([0xa5, 0x0c, 0x20, 0x4b, 0xf2, 0xbd, 0xff, 0x06, 0x85, 0xc2, 0x18, 0xa5, 0x0d, 0x69, 0x08, 0xc5, 0xc2], 0x60);
    code.set([0x20, 0xa8, 0x06, 0x20, 0xb4, 0x06, 0x4c, 0x04, 0x06], 0x10);
    code[0xff] = 17;
    const stage = new Uint8Array(256);
    stage.set([17, 19, 19]);
    const t26: [number, number, Uint8Array][] = [];
    for (let s = 0; s < sectorsOnTrack(26); s++) t26.push([26, s, page(26, s)]);
    const disk = put(boot([{ dest: 0x3000, pages: 3, track: 26, sector: 16 }]), [[18, 15, code], [18, 18, stage], ...t26]);
    const p = readParaProtectDisk(disk)!;
    expect(p.format).toBe('D64');
    expect(p.stepping).toEqual({ step: 8, counts: [17, 17, 19, 19], from: '18/15' });
    expect(p.files[0].sectors).toEqual(['26/16', '26/7', '26/15']);
    expect(p.files[0].bytes).toEqual(pagesOf(page(26, 16), page(26, 7), page(26, 15)));
    // the DOS's 18 on the same disk without the code
    const dos = readParaProtectDisk(put(boot([{ dest: 0x3000, pages: 3, track: 26, sector: 16 }]), t26))!;
    expect(dos.files[0].sectors).toEqual(['26/16', '26/6', '26/14']);
  });

  it('goes on to the next track\'s sector 0 when it comes round to 0', () => {
    // 21 sectors on track 17: from 17/13, +8 = 21 → 0 on track 18 … the loader goes to 18/0
    const disk = boot([{ dest: 0x4000, pages: 3, track: 17, sector: 5 }]);
    const p = readParaProtectDisk(disk)!;
    // 17/5, 17/13, then 21 - 21 = 0: 18/0
    expect(p.files[0].sectors).toEqual(['17/5', '17/13', '18/0']);
  });

  it('says what a D64 of a disk whose data blocks are marked with their sector\'s number cannot read', () => {
    // a D64 with error bytes: track 21's sectors are 22 READ ERROR (no data block), as a DOS reads them
    const errors = new Uint8Array(683).fill(1);
    let first21 = 0;
    for (let t = 1; t < 21; t++) first21 += sectorsOnTrack(t);
    for (let s = 0; s < 19; s++) errors[first21 + s] = 4;
    const p = readParaProtectDisk(Uint8Array.from([...put(d64, t21.map((b, s) => [21, s, b] as [number, number, Uint8Array])), ...errors]))!;
    expect(p.format).toBe('D64');
    expect(p.files[0]).toMatchObject({ bad: 3 });
    expect(p.ownDirectory).toBeNull();
    expect(p.summary).toContain('3 sectors not read');
  });

  it('finds nothing on other disks', () => {
    const plain = makeD64({ name: 'demo', files: [{ name: 'DEMO', data: Uint8Array.from([0x01, 0x08, ...Array(3000).fill(0x60)]) }] });
    expect(readParaProtectDisk(plain)).toBeNull();
    expect(readParaProtectDisk(toG64(plain))).toBeNull();
  });
});

describe('the Para-Protect disk fixture', () => {
  it('is fixtures/d64/paraprotect-demo.g64, which the e2e tests mount: a loader file, a page on 40/14 and a game file', () => {
    // the raster demo from $0800 (a 0 before its $0801) as the boot's one request, from 21/0 with the data blocks marked
    // with their sector's number; the page of the first test on 40/14; a sine table as SINE in the game's directory
    const demo = new Uint8Array(readFileSync(join(__dirname, '../../../fixtures/prg/raster-demo.prg')));
    const pages = Math.ceil((demo.length - 1) / 256), image = new Uint8Array(pages * 256);
    image.set(demo.subarray(2), 1);
    const sine = Uint8Array.from({ length: 256 }, (_, i) => Math.round(127.5 + 127.5 * Math.sin((i / 256) * 2 * Math.PI)));
    const sineFile = Uint8Array.from([0x00, 0x40, ...sine]);
    // the pages where the loader reads them: 8 sectors on, the next track's sector 0 when it comes round to 0
    const tracks: Record<number, Uint8Array[]> = {};
    for (let p = 0, t = 21, s = 0; p < pages; p++) {
      (tracks[t] ??= [])[s] = image.subarray(p * 256, p * 256 + 256);
      s += 8;
      if (s >= sectorsOnTrack(t)) { s -= sectorsOnTrack(t); if (!s) t++; }
    }
    const halves: Record<number, Uint8Array> = {};
    for (const [t, data] of Object.entries(tracks)) halves[Number(t) * 2] = loaderTrack(Number(t), data, s => s);
    const dir11: Uint8Array[] = [];
    dir11[0] = directorySector([0, 255], [{ type: 0x82, track: 11, sector: 1, name: 'SINE', blocks: 2 }]);
    dir11[1] = Uint8Array.from([11, 2, ...sineFile.subarray(0, 254)]);
    dir11[2] = new Uint8Array(256); dir11[2][1] = 1 + sineFile.length - 254; dir11[2].set(sineFile.subarray(254), 2);
    const disk = toG64(boot([{ dest: 0x0800, pages, track: 21, sector: 0 }]), { ...halves, 80: loaderTrack(40, t40, () => 7), 22: ownTrack(11, dir11) });
    const path = join(__dirname, '../../../fixtures/d64/paraprotect-demo.g64');
    if (process.env.WRITE_FIXTURES) writeFileSync(path, disk);
    expect(new Uint8Array(readFileSync(path))).toEqual(disk);
    const p = readParaProtectDisk(disk)!;
    expect(p.files.map(f => f.name)).toEqual(['t21s0_0800.prg', 't40s14_4500.prg', 'SINE.prg']);
    expect(p.files[0].bytes).toEqual(image);
    expect(p.files[2].bytes).toEqual(sine);
    expect(p.summary).toBe('Para-Protect V2 1987 (Paranoid): boot "PARA" at $0400; 1 loader file (data blocks marked with their sector number); 1 page past track 35; 1 file in the game\'s own directory (11/0)');
  });
});

const BASIC = '.pc = $0801\n.byte $0b,$08,$0a,$00,$9e,$32,$30,$36,$31,$00,$00,$00\n.pc = $080d\n';
const project = (src: string): ProjectInput => ({ name: 'loader', files: [fromSource('loader.prg', BASIC + src)] });

/** a loader stub in the form of Para-Protect's (the request X from tables in page 2) and a receive loop like its own */
const SOURCE = ` ldx #0
 jsr stub
 rts
stub: sei
 lda $02c5,x
 sta $8f
 lda $02c8,x
 pha
 lda $02cb,x
 pha
 ldy $02ce,x
 pla
 tax
 pla
 jmp recv
recv: ldy #0
wait: bit $dd00
 bpl wait
line: sec
 lda $d012
 sbc #$31
 bcc go
 and #$07
 cmp #$02
 bcc line
go: lda $90
 sta $dd00
 lda $dd00
 lsr
 lsr
 eor $dd00
 sta ($8e),y
 iny
 bne wait
 rts
`;

describe('the Para-Protect loader', () => {
  it('is known by its loader stub and its receive loop', () => {
    const found = analyze(project(SOURCE)).loaders;
    const pp = found.find(l => l.id === 'paraprotect');
    expect(pp).toBeDefined();
    expect(pp!.parts.every(p => p.role === 'resident')).toBe(true);
    expect(pp!.parts.length).toBeGreaterThanOrEqual(1);
  });
});
