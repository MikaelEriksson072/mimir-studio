/* Disk images made and changed (c64/diskedit.ts): a D64 and a D81 formatted, files added, removed and renamed, the
 * BAM validated; the images compared with those VICE's c1541 makes of the same files, when it is there. */
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DiskEdit, diskKindOf, parseD64, readD64File } from '../src';

const C1541 = 'C:/C64/VICE/GTK3VICE-3.10-win64/bin/c1541.exe';
const bytes = (n: number, seed: number) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed * 13 + (i >> 8)) & 0xff);
const A = bytes(3000, 1), B = bytes(700, 2), C = bytes(254, 3), D = bytes(1, 4);

describe.each(['d64', 'd81'] as const)('a %s made and changed', kind => {
  it('is formatted empty, with its name and ID', () => {
    const d = DiskEdit.format(kind, 'test disk', 'ab');
    expect([d.kind, d.name, d.id, d.dosType, d.tracks, d.files, d.free, diskKindOf(d.bytes)]).toEqual(kind === 'd64' ? ['d64', 'TEST DISK', 'AB', '2A', 35, [], 664, 'd64'] : ['d81', 'TEST DISK', 'AB', '3D', 80, [], 3160, 'd81']);
    expect(d.isFree(1, 0)).toBe(true);
    expect(d.isFree(d.dirTrack, 0)).toBe(false);
    expect(() => d.sector(kind === 'd64' ? 36 : 81, 0)).toThrow(/there is no track/);
    expect(() => d.sector(1, kind === 'd64' ? 21 : 40)).toThrow(/there is no track 1 sector/);
  });

  it('adds files, reads them back, removes and renames them', () => {
    const d = DiskEdit.format(kind, 'work', '01'), free = d.free;
    const a = d.add('first', A), b = d.add('second', B, 'SEQ');
    d.add('exact', C); d.add('one', D, 'USR');
    expect([a.name, a.type, a.blocks, a.closed, b.type, b.blocks]).toEqual(['FIRST', 'PRG', 12, true, 'SEQ', 3]);
    expect(d.files.map(f => `${f.name}:${f.type}:${f.blocks}`)).toEqual(['FIRST:PRG:12', 'SECOND:SEQ:3', 'EXACT:PRG:1', 'ONE:USR:1']);
    expect(d.free).toBe(free - 17);
    for (const [n, x] of [['first', A], ['SECOND', B], ['exact', C], ['one', D]] as const) expect(d.read(n)).toEqual(x);
    expect(d.chain(a)).toHaveLength(12);
    expect(d.chain(a)[0]).toEqual(kind === 'd64' ? [17, 0] : [39, 0]);
    expect(d.chain(a)[1]).toEqual(kind === 'd64' ? [17, 10] : [39, 1]);
    // what cannot be added
    expect(() => d.add('first', A)).toThrow('add: "first" is on the disk already');
    expect(() => d.add('a name that is too long', A)).toThrow(/1 to 16 characters/);
    expect(() => d.add('rel', A, 'REL')).toThrow(/a REL file is not made here/);
    expect(() => d.add('big', new Uint8Array(900 * 1024))).toThrow(/needs \d+ blocks and the disk has \d+ free/);
    expect(d.free).toBe(free - 17);
    // removed: its sectors are free again, and the next file takes its place in the directory
    d.remove('first');
    expect(d.free).toBe(free - 5);
    expect(d.find('first')).toBeNull();
    d.rename('second', 'the second');
    d.setFile('the second', { locked: true, type: 'PRG' });
    d.add('third', A);
    expect(d.files.map(f => `${f.name}:${f.type}${f.locked ? '<' : ''}`)).toEqual(['THIRD:PRG', 'THE SECOND:PRG<', 'EXACT:PRG', 'ONE:USR']);
    expect(d.read('third')).toEqual(A);
    expect(() => d.rename('one', 'exact')).toThrow('rename: "exact" is on the disk already');
    expect(() => d.read('nothing')).toThrow('read: no file "nothing" on the disk');
    expect(d.validate()).toEqual([]);
  });

  it('takes more directory sectors as the files need them, and says when the disk is full', () => {
    const d = DiskEdit.format(kind, 'many', '01');
    for (let i = 0; i < 20; i++) d.add(`file ${i}`, bytes(10, i));
    expect(d.files).toHaveLength(20);
    expect(d.files[19].name).toBe('FILE 19');
    expect(d.read('file 17')).toEqual(bytes(10, 17));
    expect(d.validate()).toEqual([]);
    const full = DiskEdit.format(kind, 'full', '01');
    full.add('all', new Uint8Array(full.free * 254));
    expect(full.free).toBe(0);
    expect(() => full.add('more', D)).toThrow('add: "more" needs 1 block and the disk has 0 free');
    expect(full.read('all')).toHaveLength((kind === 'd64' ? 664 : 3160) * 254);
  });

  it('validates: the BAM worked out again from the files', () => {
    const d = DiskEdit.format(kind, 'check', '01');
    d.add('keep', A); d.add('open', B);
    const free = d.free;
    d.allocate(1, 5); d.allocate(2, 6);
    const k = d.find('keep')!, [t, s] = d.chain(k)[3];
    d.release(t, s);
    d.setFile('open', { closed: false });
    const p = d.validate();
    expect(p).toEqual(['"OPEN" was never closed: taken out of the directory', '5 sectors were taken in the BAM and no file has them: free again', '1 sector of the files was free in the BAM: taken']);
    expect(d.free).toBe(free + 3);
    expect(d.files.map(f => f.name)).toEqual(['KEEP']);
    expect(d.validate()).toEqual([]);
  });

  it.runIf(existsSync(C1541))('makes the image c1541 makes of the same files, byte for byte, and c1541 reads its files', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mimir-disk-'));
    const c = (...args: string[]) => execFileSync(C1541, args, { cwd: dir, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
    writeFileSync(join(dir, 'a.bin'), A); writeFileSync(join(dir, 'b.bin'), B); writeFileSync(join(dir, 'c.bin'), C);
    c('-format', 'test disk,ab', kind, `ref.${kind}`);
    const mine = DiskEdit.format(kind, 'test disk', 'ab');
    expect(Buffer.from(mine.bytes).equals(readFileSync(join(dir, `ref.${kind}`)))).toBe(true);
    c(`ref.${kind}`, '-write', 'a.bin', 'first', '-write', 'b.bin', 'second', '-write', 'c.bin', 'exact');
    mine.add('first', A); mine.add('second', B); mine.add('exact', C);
    const ref = new Uint8Array(readFileSync(join(dir, `ref.${kind}`)));
    // (the bytes after a file's last one, in its last sector, are whatever c1541 had there: zero here)
    const tail = new Uint8Array(ref.length);
    for (const f of mine.files) { const [lt, ls] = mine.chain(f).pop()!, o = mine.offset(lt, ls); tail.fill(1, o + mine.bytes[o + 1] + 1, o + 256); }
    const diff: number[] = [];
    for (let i = 0; i < ref.length && diff.length < 12; i++) if (ref[i] !== mine.bytes[i] && !tail[i]) diff.push(i);
    expect(diff).toEqual([]);
    // and the other way: c1541 lists and reads what was made here, after changes c1541 was not asked to make
    mine.remove('second'); mine.add('later', B, 'SEQ'); mine.rename('exact', 'renamed');
    writeFileSync(join(dir, `mine.${kind}`), mine.bytes);
    const list = c(`mine.${kind}`, '-list');
    expect(list).toMatch(/"first" +prg/);
    expect(list).toMatch(/"later" +seq/);
    expect(list).toMatch(/"renamed" +prg/);
    expect(list).toContain(`${mine.free} blocks free`);
    c(`mine.${kind}`, '-read', 'later,s', 'later.out');
    expect(new Uint8Array(readFileSync(join(dir, 'later.out')))).toEqual(B);
    c(`mine.${kind}`, '-validate');
    expect(Buffer.from(mine.bytes).equals(readFileSync(join(dir, `mine.${kind}`)))).toBe(true);
  });
});

describe('a D64 read by the readers the rest of Mimir uses', () => {
  it('has the directory and the files parseD64 and readD64File give', () => {
    const d = DiskEdit.format('d64', 'mimir', 'mi');
    d.add('first', A); d.add('second', B, 'SEQ');
    const img = parseD64(d.bytes);
    expect([img.name, img.id, img.dosType, img.tracks, img.freeBlocks, img.files.map(f => `${f.name}:${f.type}:${f.blocks}`)]).toEqual(['MIMIR', 'MI', '2A', 35, 649, ['FIRST:PRG:12', 'SECOND:SEQ:3']]);
    expect(readD64File(d.bytes, img.files[0])).toEqual(A);
    // a 40-track image is read, and written on its first 35 tracks
    const big = new Uint8Array(196608);
    big.set(d.bytes);
    const e = new DiskEdit(big);
    expect([e.tracks, e.free, e.files.length]).toEqual([40, 649, 2]);
    e.add('third', C);
    expect(e.read('third')).toEqual(C);
    expect(e.sector(40, 16)).toHaveLength(256);
    expect(() => new DiskEdit(new Uint8Array(1000))).toThrow(/not a \.d64 or \.d81 disk image: 1000 bytes/);
  });
});
