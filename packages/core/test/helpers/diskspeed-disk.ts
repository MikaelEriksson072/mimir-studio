/* Disk-Speed disks for the tests (c64/diskspeed.ts, spec 13.5p): a D64 laid out as Morse Technology's loader reads it
 * (the boot at $0308 in the directory, the drive code at 14/0, two sectors with a data checksum error, the next stage
 * at 36/11 and 36/1 EORed with their status, a table at 14/4 and the files from 14/15 on, 11 sectors on, the next
 * track down at sector 0, every byte inverted). Nothing of Morse's or the games' own code is in it: the boot and the
 * drive code here are a few instructions of their own with only the idioms the reader follows. */

const sectorsOn = (t: number) => (t <= 17 ? 21 : t <= 24 ? 19 : t <= 30 ? 18 : 17);
const index = (t: number, s: number) => { let n = 0; for (let k = 1; k < t; k++) n += sectorsOn(k); return n + s; };
const TOTAL = (tracks: number) => index(tracks + 1, 0);

export interface DemoFile { name: string; load: number; bytes: Uint8Array }

/** n bytes made from a seed */
export const fill = (n: number, seed: number): Uint8Array => Uint8Array.from({ length: n }, (_, i) => (i * 29 + seed * 11 + 3) & 0xff);

/** the files of the demo disk: one of a sector and a part, one of whole sectors, one of a few bytes (the hook) */
export const DEMO_FILES: DemoFile[] = [
  { name: 'INTRO', load: 0x0801, bytes: fill(256 + 40, 1) },
  { name: 'MAIN', load: 0x2000, bytes: fill(3 * 256, 2) },
  { name: 'HOOK', load: 0x033c, bytes: fill(10, 3) },
];
export const DEMO_START = 0x0810;

/**
 * A D64 of 36 tracks' worth (40 tracks, with error bytes unless `errors` is false) with Disk-Speed's layout.
 * `checks`: the status of 14/3 and 14/14 (5: a wrong data checksum, as on the original); `key`: what the next stage
 * is EORed with (their status ANDed, on the original). `boot`: a directory entry for the boot.
 */
export function diskSpeedD64(o: { errors?: boolean; checks?: [number, number]; key?: number; boot?: boolean; files?: DemoFile[]; badSum?: boolean } = {}): Uint8Array {
  const tracks = 40, errors = o.errors ?? true, files = o.files ?? DEMO_FILES;
  const checks = o.checks ?? [5, 5], key = o.key ?? (checks[0] & checks[1]);
  const img = new Uint8Array(TOTAL(tracks) * (errors ? 257 : 256));
  const put = (t: number, s: number, b: ArrayLike<number>) => img.set(b, index(t, s) * 256);
  const err = (t: number, s: number, e: number) => { if (errors) img[TOTAL(tracks) * 256 + index(t, s)] = e; };
  if (errors) img.fill(1, TOTAL(tracks) * 256);

  // BAM and directory: the disk's name, a text after the ID, and the boot
  const bam = new Uint8Array(256);
  bam[0] = 18; bam[1] = 1; bam[2] = 0x41;
  bam.set([...'DISKSPEED DEMO'].map(c => c.charCodeAt(0)), 0x90); bam.fill(0xa0, 0x90 + 14, 0xa0);
  bam.set([0xa0, 0xa0, 0x44, 0x53, 0xa0, 0x32, 0x41, 0xa0, 0xa0, 0xa0, 0xa0], 0xa0);
  bam.set([...` THIS DEMO USES THE 'DISK-SPEED' LOADING SYSTEM `].map(c => c.charCodeAt(0)), 0xab);
  put(18, 0, bam);
  const dir = new Uint8Array(256);
  dir[1] = 0xff;
  if (o.boot ?? true) {
    dir.set([0x82, 14, 12], 2); dir.set([...'BOOT'].map(c => c.charCodeAt(0)), 5); dir.fill(0xa0, 9, 21); dir[30] = 2;
  }
  put(18, 1, dir);

  // the boot: $0308-$041f, IGONE and BSOUT pointing to $0334, where a loop decodes $0380-$03ff (EOR #$5A) and calls
  // LISTEN; the drive command and the hook's test in what it decodes
  const boot = new Uint8Array(0x0420 - 0x0308);
  const at = (a: number, b: ArrayLike<number>) => boot.set(b, a - 0x0308);
  at(0x0308, [0x34, 0x03]); at(0x0326, [0x34, 0x03]);
  at(0x0334, [0xa2, 0x7f, 0xbd, 0x80, 0x03, 0x49, 0x5a, 0x9d, 0x80, 0x03, 0xca, 0x10, 0xf5, 0xa9, 0x08, 0x20, 0x0c, 0xed]);
  const plain = new Uint8Array(0x80);
  plain.set([...'B-E 2 0 14 0'].map(c => c.charCodeAt(0)), 0);
  plain.set([0xc6, 0xbe, 0xf0, 0x09, 0xa5, 0xbe, 0xc9, 0x02, 0xd0, 0x03, 0x20, 0x3c, 0x03, 0x60], 0x20);
  at(0x0380, plain.map(v => v ^ 0x5a));
  const prg = [0x08, 0x03, ...boot];
  put(14, 12, [14, 2, ...prg.slice(0, 254)]);
  put(14, 2, [0, prg.length - 254 + 1, ...prg.slice(254)]);

  // stage 1 at 14/0, run at $0500: DOS reads of 14/3 and 14/14 (status into $c1), then its own reads of 36/11 and
  // 36/1 into $0300 and $0400 (jsr $0550) and a jump to $0300
  const s1 = new Uint8Array(256);
  s1.set([
    0x4c, 0x03, 0x05,
    0xa9, 0x0e, 0x85, 0x0e, 0xa9, 0x03, 0x85, 0x0f, 0xa9, 0x80, 0x85, 0x04, 0xa5, 0x04, 0x30, 0xfc, 0x85, 0xc1,
    0xa9, 0x0e, 0x85, 0x0f, 0xa9, 0x80, 0x85, 0x04, 0xa5, 0x04, 0x30, 0xfc, 0x25, 0xc1, 0x85, 0xc1,
    0xa9, 0x24, 0x85, 0x06, 0xa9, 0x0b, 0x85, 0x07,
    0xa9, 0x03, 0x85, 0x31, 0x20, 0x50, 0x05,
    0xa9, 0x01, 0x85, 0x07, 0xa9, 0x04, 0x85, 0x31, 0x20, 0x50, 0x05,
    0x4c, 0x00, 0x03,
  ], 0);
  s1.set([0x20, 0x34, 0xf9, 0x60], 0x50);
  put(14, 0, s1);
  // the two checks: data blocks whose checksum is wrong on the original
  put(14, 3, fill(256, 9)); err(14, 3, checks[0]);
  put(14, 14, fill(256, 10)); err(14, 14, checks[1]);

  // stage 2 at $0300-$04ff: the table by DOS job 4 (x = 1) from 14/4, the files by job 3 (x = 0) from 14/15, its job
  // routine and its step
  const s2 = new Uint8Array(512);
  s2.set([0x4c, 0x10, 0x03], 0);
  s2.set([0xa9, 0x0e, 0x85, 0x0e, 0x85, 0x0c, 0xa9, 0x04, 0x85, 0x0f, 0xa2, 0x01, 0x20, 0x40, 0x03, 0xa9, 0x0f, 0x85, 0x0d, 0xa2, 0x00, 0x20, 0x40, 0x03, 0x60], 0x10);
  s2.set([0xa9, 0x80, 0x95, 0x03, 0x58, 0xb5, 0x03, 0x30, 0xfc, 0x78, 0xc9, 0x02, 0x60], 0x40);
  s2.set([0xa5, 0x0d, 0x18, 0x69, 0x0b, 0xc9, 0x15, 0x90, 0x06, 0xe9, 0x15, 0xd0, 0x02, 0xc6, 0x0c, 0x85, 0x0d, 0x60], 0x60);
  put(36, 11, s2.subarray(0, 256).map(v => v ^ key));
  put(36, 1, s2.subarray(256).map(v => v ^ key));

  // the table and the files
  const table = new Uint8Array(256);
  table[0] = files.length;
  let y = 1, track = 14, sector = 15;
  const next = () => { let s = sector + 11; if (s >= 21) { s -= 21; if (s === 0) track--; } sector = s; };
  files.forEach((f, i) => {
    const pages = f.bytes.length >> 8, part = f.bytes.length & 0xff;
    const sum = f.bytes.reduce((a, b) => a ^ b, 0) ^ (o.badSum && i === 1 ? 0x10 : 0);
    table.set([f.load & 0xff, f.load >> 8, part, pages, sum], y); y += 5;
    table.set([...f.name].map(c => c.charCodeAt(0)), 0x60 + 16 * i);
    for (let k = 0; k < pages + (part ? 1 : 0); k++) {
      const chunk = new Uint8Array(256).fill(0xff);
      chunk.set(f.bytes.subarray(k * 256, k * 256 + 256).map(v => v ^ 0xff));
      put(track, sector, chunk);
      next();
    }
  });
  table[y] = (DEMO_START - 1) >> 8; table[y + 1] = (DEMO_START - 1) & 0xff;
  put(14, 4, table);
  return img;
}
