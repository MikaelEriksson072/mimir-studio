/* Disks whose directories show how the 1541 and BASIC's LIST treat odd names: shifted spaces and quotes in them,
 * graphics, control codes, BASIC keywords, file types 5-7. VICE's screens of them are in dirlist-vice.ts. */
import { sectorOffset, sectorsOnTrack } from '../../src/c64/d64';

const asc = (s: string) => [...s].map(c => c.charCodeAt(0));
const pad = (b: number[], n = 16) => Uint8Array.from({ length: n }, (_, i) => b[i] ?? 0xa0);
type Entry = [type: number, name: number[], blocks: number];

function disk(name: number[], idDos: number[], entries: Entry[]): Uint8Array {
  const d = new Uint8Array(174848);
  const bam = sectorOffset(18, 0, 35);
  d[bam] = 18; d[bam + 1] = 1; d[bam + 2] = 0x41;
  // 630 blocks free: every track but the directory's with one sector used
  for (let t = 1; t <= 35; t++) { d[bam + 4 * t] = t === 18 ? 0 : sectorsOnTrack(t) - 1; d.fill(0xff, bam + 4 * t + 1, bam + 4 * t + 3); d[bam + 4 * t + 3] = 0x1f; }
  d.set(pad(name), bam + 0x90);
  d[bam + 0xa0] = d[bam + 0xa1] = 0xa0;
  d.set(idDos, bam + 0xa2);
  d.fill(0xa0, bam + 0xa7, bam + 0xab);
  const sectors = [1, 4, 7];
  entries.forEach(([type, nm, blocks], i) => {
    const e = sectorOffset(18, sectors[i >> 3], 35) + (i & 7) * 32;
    d[e + 2] = type; d[e + 3] = 17; d[e + 4] = 0; d.set(pad(nm), e + 5); d[e + 30] = blocks & 255; d[e + 31] = blocks >> 8;
  });
  const used = Math.ceil(entries.length / 8);
  for (let k = 0; k < used; k++) { const o = sectorOffset(18, sectors[k], 35); d[o] = k + 1 < used ? 18 : 0; d[o + 1] = k + 1 < used ? sectors[k + 1] : 0xff; }
  return d;
}

const ODD: Entry[] = [
  [0x82, asc('NORMAL'), 5],
  [0x82, [...asc('GAME'), 0xa0, ...asc(',8,1')], 42],
  [0x82, asc('ABCDEFGHIJKLMNOP'), 123],
  [0x82, [0x60, 0x61, 0x7a, 0x7e, 0x7f, 0xa1, 0xa6, 0xbf, 0xc1, 0xda, 0xdf, 0xe0, 0xff, 0x5c, 0x5e, 0x5f], 1000],
  [0x82, [0x41, 0x05, 0x42, 0x12, 0x43, 0x1c, 0x44, 0x93, 0x45, 0x0d, 0x46, 0x14, 0x47, 0x8d, 0x11, 0x48], 0],
  [0x02, asc('SPLAT'), 7],
  [0xc2, asc('LOCKED'), 8],
  [0x80, asc('DELFILE'), 9],
  [0x81, asc('SEQFILE'), 10],
  [0x83, asc('USRFILE'), 11],
  [0x84, asc('RELFILE'), 12],
  [0x82, [...asc('QU'), 0x22, ...asc('OTE')], 13],
  [0x82, [...asc('TOK'), 0xa0, 0x99, 0x85, 0xc1, 0x22, 0x05, 0x41], 14],
  [0x85, asc('TYPE5'), 15],
  [0x82, [...asc('AB'), 0xa0, 0xa0, ...asc('CD')], 65535],
];

/** names with shifted spaces, quotes, graphics, control codes and a keyword's byte, the disk's name with a shifted space */
export const oddDisk = () => disk([...asc('DISK'), 0xa0, ...asc('HIDDEN'), 0x60, 0x7e], [...asc('ID'), 0xa0, ...asc('2A')], ODD);

/** the same and types 6 and 7 (whose lines end early), a scratched entry, a name starting with a quote, $0e in a name */
export const typesDisk = () => disk([0x58, 0xc1, 0x05, 0x93, 0x22, 0x59, 0xc1, 0x99, 0x05, 0xa0, 0x5a], [0x49, 0xc4, 0x2a, 0xb2, 0x41], [
  ...ODD,
  [0x86, asc('TYPE6'), 1], [0x87, asc('TYPE7'), 2], [0x05, asc('SPLAT5'), 3], [0x42, asc('LOCKSPLAT'), 4], [0x00, asc('SCRATCHED'), 5],
  [0x82, [0x22, ...asc('Q1')], 6], [0x82, [...asc('LOW'), 0x0e, ...asc('ER')], 7],
]);

/** a disk's name with control codes, a quote and keywords' bytes after it, an odd ID; one file */
export const headerDisk = () => disk([0x58, 0xc1, 0x05, 0x93, 0x22, 0x59, 0xc1, 0x99, 0x05, 0xa0, 0x5a], [0x49, 0xc4, 0x2a, 0xb2, 0x41], [[0x82, asc('ONE'), 1]]);
