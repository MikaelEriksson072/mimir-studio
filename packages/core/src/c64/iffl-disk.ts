/* IFFL files on a disk (spec 13.5m). An IFFL ("integrated file flexible loader") file is one DOS file that holds all
 * the parts a cracked game loads, one after the other, so that one directory entry carries the whole game: the
 * game's loader asks for a part by its number, and the drive walks the file's sector chain to it. Such a file is no
 * program (it has no load address, and is often larger than a C64's memory), so it neither runs nor unpacks as one.
 *
 * The layout read here is the one most IFFL cracks of the last years have (Hokuto Force, Onslaught and Excess name the
 * file IFFLDATA; Cryonix after the game): the file's first sector, 254 bytes, is the table of the parts' lengths, their
 * 127 low bytes and then their 127 high bytes, the unused entries 0; the parts follow from byte 254 with nothing
 * between them, and the lengths add up to the rest of the file exactly. That sum is what tells such a file from any
 * other: a file counts as one when at least two lengths are set, none is set after an unset one, and they end where
 * the file ends.
 *
 * A part is what the game's loader reads in one go: mostly a chain of pieces, each an `exomizer level` file as it is,
 * which the loader unpacks byte by byte as the drive sends it: where the piece ends in memory, the high byte first,
 * then the stream, read forwards and written from that end backwards. The stream is Exomizer 2's (protocol 0; Hokuto
 * Force, Onslaught, Excess) or Exomizer 3's (protocol 39; Cryonix), the same for every part of a file: the one that
 * reads more of its parts to their ends. A part is unpacked when its pieces follow each other to its end and none is
 * longer than the memory below its end; any other part (a high score table, data in a format of the game's own, as all
 * of Mickey's Space Adventure) is kept as it is stored.
 *
 * Checked on the reference archive's games (138 235 disks): 28 disks have such a file, of 9 releases; in 7 of them
 * the parts unpack (all but high score tables and the like), and the levels of two cracks of The Last Ninja packed
 * with different Exomizers and cut into different pieces (Hokuto Force's and Cryonix's) unpack to the same bytes
 * where the pieces overlap: a level's $0700-$5400 but for 5 bytes of 19 712, its $9e00-$afff and $0800-$15xx whole.
 * (No part was compared with a run of a game loading it: Sindri's runs stay in the cracks' menus.) */
import { readStream } from '@mimir/brokkr';
import type { Addr } from '../types';
import { diskSectors, parseD64, readD64File, type D64FileType } from './d64';

/** the bytes of the table: a sector's, and the entries it has room for */
export const IFFL_TABLE = 254;
export const IFFL_ENTRIES = 127;

/** the Exomizers a file's parts are packed with: the name, and the stream's protocol */
export type IfflPacker = 'exomizer2' | 'exomizer3';
export const IFFL_PACKER: Record<IfflPacker, { name: string; flags: number; how: string }> = {
  exomizer2: { name: 'Exomizer 2', flags: 0, how: 'exomizer level' },
  exomizer3: { name: 'Exomizer 3', flags: 39, how: 'exomizer level (3.1)' },
};

/** A piece of a part unpacked. */
export interface IfflPiece {
  /** where it unpacks to (end: after its last byte, which is what the piece starts with) */
  start: Addr; end: Addr;
  bytes: Uint8Array;
  /** its bytes in the part: from here, this many (the address and the stream) */
  at: number; packed: number;
}

export interface IfflPart {
  /** its number in the table (from 0): what the game's loader asks for */
  n: number;
  /** where it starts in the file, and its bytes as they are stored */
  offset: number; bytes: Uint8Array;
  /** its pieces unpacked, in the order they are stored; null: not packed (or not in a way read here) */
  pieces: IfflPiece[] | null;
}

export interface IfflFile {
  /** its directory entry (from 0), its name and type there, and where it starts on the disk */
  entry: number; name: string; type: D64FileType; track: number; sector: number;
  /** every byte of the file: the table, then the parts */
  data: Uint8Array;
  parts: IfflPart[];
  /** what its parts are packed with; null: none unpacks */
  packer: IfflPacker | null;
}

export interface IfflDisk {
  /** the disk's IFFL files, in the directory's order */
  files: IfflFile[];
}

/** A part as a chain of `exomizer level` pieces of this packer, unpacked; null when it is not one to its end. */
export function unpackIfflPart(bytes: Uint8Array, packer: IfflPacker): IfflPiece[] | null {
  const pieces: IfflPiece[] = [];
  let at = 0;
  try {
    while (at < bytes.length) {
      if (bytes.length - at < 4) return null;
      const end = (bytes[at] << 8) | bytes[at + 1];
      // it is written from its end down: it cannot be longer than the memory below
      const d = readStream(bytes.subarray(at + 2), IFFL_PACKER[packer].flags, undefined, end);
      if (!d.data.length) return null;
      pieces.push({ start: end - d.data.length, end, bytes: d.data.reverse(), at, packed: 2 + d.read });
      at += 2 + d.read;
    }
  } catch { return null; }
  return pieces.length ? pieces : null;
}

/** The parts of an IFFL file (all its bytes, as the drive reads them) and what they are packed with; null when it is
 *  not one. */
export function readIffl(data: Uint8Array): { parts: IfflPart[]; packer: IfflPacker | null } | null {
  if (data.length <= IFFL_TABLE) return null;
  const lengths: number[] = [];
  for (let i = 0; i < IFFL_ENTRIES; i++) {
    const len = data[i] | (data[IFFL_ENTRIES + i] << 8);
    // no entry after the last one
    if (len && lengths.length !== i) return null;
    if (len) lengths.push(len);
  }
  if (lengths.length < 2 || IFFL_TABLE + lengths.reduce((a, b) => a + b, 0) !== data.length) return null;
  const read = (packer: IfflPacker | null): IfflPart[] => {
    let offset = IFFL_TABLE;
    return lengths.map((len, n): IfflPart => {
      const bytes = data.subarray(offset, offset + len), part = { n, offset, bytes, pieces: packer && unpackIfflPart(bytes, packer) };
      offset += len;
      return part;
    });
  };
  const count = (parts: IfflPart[]) => parts.filter(p => p.pieces).length;
  const e3 = read('exomizer3'), e2 = read('exomizer2');
  if (!count(e3) && !count(e2)) return { parts: read(null), packer: null };
  return count(e3) >= count(e2) ? { parts: e3, packer: 'exomizer3' } : { parts: e2, packer: 'exomizer2' };
}

/** The IFFL files of a disk; null when it has none. */
export function readIfflDisk(disk: Uint8Array): IfflDisk | null {
  let image: Uint8Array, img: ReturnType<typeof parseD64>;
  try { image = diskSectors(disk); img = parseD64(image); } catch { return null; }
  const files: IfflFile[] = [], seen = new Set<number>();
  img.files.forEach((f, entry) => {
    // an entry that starts where an earlier one does is the same file
    if (!f.track || f.type === 'DEL' || seen.has(f.track * 32 + f.sector)) return;
    seen.add(f.track * 32 + f.sector);
    let data: Uint8Array;
    try { data = readD64File(image, f); } catch { return; }
    const r = readIffl(data);
    if (r) files.push({ entry, name: f.name, type: f.type, track: f.track, sector: f.sector, data, ...r });
  });
  return files.length ? { files } : null;
}

const hx = (v: number, w: number) => v.toString(16).padStart(w, '0');
const stem = (f: IfflFile, p: IfflPart) => `iffl${hx(f.entry, 2)}_part${String(p.n).padStart(2, '0')}`;

/** A part's name as it is stored: the file's directory entry and the part's number, `.exo` when it is packed, else
 *  `.bin` (it has no address). */
export const ifflPartName = (f: IfflFile, p: IfflPart): string => `${stem(f, p)}.${p.pieces ? 'exo' : 'bin'}`;
/** The name of an unpacked piece: its part, and where it unpacks to. */
export const ifflPieceName = (f: IfflFile, p: IfflPart, piece: IfflPiece): string => `${stem(f, p)}_${hx(piece.start, 4)}.prg`;

/** An unpacked piece as a PRG at where it unpacks to. */
export function ifflPiecePrg(piece: IfflPiece): Uint8Array {
  const out = new Uint8Array(piece.bytes.length + 2);
  out[0] = piece.start & 0xff; out[1] = piece.start >> 8;
  out.set(piece.bytes, 2);
  return out;
}
