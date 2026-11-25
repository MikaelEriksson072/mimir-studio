/* =====================================================================
 * The disk images Kick Assembler 5.25 writes for `.disk` (its cc1541 disk writer and D64Image), byte for byte, so
 * Mimir's own assembler gives what the build gives (spec 10.7). Read from KickAss.jar's classes and measured against
 * it: the BAM at 18/0 with every sector free first; the directory in 18/1, 18/2 … one after another (as many as
 * visible files / 8 + 1 marked used, so 8 files take two); each file's sectors from where the last file's left off
 * (track 1, sector 0 at first), the next one `interleave` (10) sectors on, the first free one from there on the same
 * track, else the next track from sector 0; track 18 is skipped (storeFilesInDir uses it), and with
 * dontSplitFilesOverDir a file that would cross it starts again after it; the last sector's second byte is its byte
 * count + 1. Names are written as their characters' codes (no PETSCII), padded with $a0: the disk's name to 16 at $90,
 * its id to 5 at $a2 (default "   2A"; an id of 2 letters leaves $a0 where "2A" was). Errors as KickAss says them.
 * ===================================================================== */

/** sectors on each track, 1-40 (index 0 is track 1) */
const SPT = [21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 21, 19, 19, 19, 19, 19, 19, 19, 18, 18, 18, 18, 18, 18, 17, 17, 17, 17, 17, 17, 17, 17, 17, 17];

/** a file's directory type (closed: $80 on) */
export const KICK_DISK_TYPES: Record<string, number> = { del: 0x80, seq: 0x81, prg: 0x82, usr: 0x83, rel: 0x84 };
export type KickDiskFormat = 'commodore' | 'speeddos' | 'dolphindos';

export interface KickDiskFile {
  /** the name's bytes (each character's code) */
  name: Uint8Array;
  type: number;
  interleave: number;
  data: Uint8Array;
  locked: boolean;
  /** in the directory (`hide` takes it out; its sectors are still written) */
  visible: boolean;
}

/** a string's bytes as KickAss's engine gives them: each character's code (its low byte) */
export const kickBytes = (s: string): Uint8Array => Uint8Array.from([...s].map(c => c.charCodeAt(0) & 0xff));

/** the D64 (or 40-track) image of `files`; throws KickAss's message when it cannot be made */
export function kickD64(o: { format: KickDiskFormat; name: Uint8Array; id: Uint8Array; files: readonly KickDiskFile[]; dontSplitFilesOverDir?: boolean; storeFilesInDir?: boolean }): Uint8Array {
  const nrTracks = o.format === 'commodore' ? 35 : 40;
  const extraBam = o.format === 'speeddos' ? 172 : 192;
  const track18Split = !o.dontSplitFilesOverDir, useTrack18 = !!o.storeFilesInDir;
  let size = 0;
  for (let t = 0; t < nrTracks; t++) size += SPT[t] * 256;
  const image = new Uint8Array(size);
  const linear = (t: number, s: number) => {
    if (t < 1 || t > nrTracks) throw new Error(`D64Image: Tried to access track ${t} (Allowed range is [1..${nrTracks}])`);
    if (s < 0 || s >= SPT[t - 1]) throw new Error(`D64Image: Tried to access sector ${s} on track ${t} (Allowed range for this sector is [0..${SPT[t - 1]}]`);
    let n = 0;
    for (let i = 0; i < t - 1; i++) n += SPT[i];
    return n + s;
  };
  const bam = linear(18, 0) * 256;
  const bamFor = (t: number) => t > 35 ? bam + extraBam + (t - 35) * 4 : bam + t * 4;
  const isFree = (t: number, s: number) => (image[bamFor(t) + 1 + (s >> 3)] & (1 << (s & 7))) !== 0;
  const mark = (t: number, s: number, free: boolean) => {
    if (free === isFree(t, s)) return;
    const b = bamFor(t);
    image[b] = (image[b] + (free ? 1 : -1)) & 0xff;
    const bit = 1 << (s & 7), at = b + 1 + (s >> 3);
    image[at] = free ? image[at] | bit : image[at] & ~bit;
  };
  // formatted: the BAM's link and DOS version, every sector free, the name and id area $a0, the BAM's sector used
  image[bam] = 18; image[bam + 1] = 1; image[bam + 2] = 0x41;
  for (let t = 1; t <= nrTracks; t++) for (let s = 0; s < SPT[t - 1]; s++) mark(t, s, true);
  for (let i = 0x90; i <= 0xaa; i++) image[bam + i] = 0xa0;
  mark(18, 0, false);
  for (let i = 0; i < 16; i++) image[bam + 0x90 + i] = i < o.name.length ? o.name[i] : 0xa0;
  for (let i = 0; i < 5; i++) image[bam + 0xa2 + i] = i < o.id.length ? o.id[i] : 0xa0;

  const visible = o.files.filter(f => f.visible).length, max = 8 * SPT[18];
  if (visible > max) throw new Error(`Too many visible files. Got ${visible}, max is ${max}.`);
  for (let i = 0; i < Math.floor(visible / 8) + 1; i++) mark(18, i + 1, false);

  const placed = o.files.map(() => ({ track: 0, sector: 0, sectors: 0 }));
  let track = 1, sector = 0, last = 0, prevOff = linear(1, 0) * 256;
  o.files.forEach((f, fi) => {
    const p = placed[fi], size = f.data.length;
    let pos = 0, left = size;
    while (left > 0) {
      let found = false, s = 0;
      while (!found) {
        for (let k = sector; k < sector + SPT[track - 1]; k++) { s = k % SPT[track - 1]; if (isFree(track, s)) { found = true; break; } }
        if (found) break;
        track++; sector = 0;
        if (!useTrack18 && track === 18) {
          if (!track18Split) {
            // the file starts again after track 18: what it took before it is freed and cleared
            if (p.sectors > 0) {
              let t = p.track, ss = p.sector;
              while (t !== 0) {
                mark(t, ss, true);
                const off = linear(t, ss) * 256;
                t = image[off]; ss = image[off + 1];
                image.fill(0, off, off + 256);
              }
            }
            left = size; pos = 0; p.sectors = 0;
          }
          track = 19;
        }
        if (track === nrTracks + 1) throw new Error('Disk is full!');
      }
      sector = s;
      const off = linear(track, sector) * 256;
      if (left === size) { p.track = track; p.sector = sector; }
      else { image[prevOff] = track; image[prevOff + 1] = sector; }
      last = Math.min(254, left);
      image.set(f.data.subarray(pos, pos + last), off + 2);
      left -= last; pos += last; prevOff = off;
      mark(track, sector, false);
      sector += f.interleave;
      p.sectors++;
    }
    image[prevOff] = 0; image[prevOff + 1] = (last + 1) & 0xff;
  });

  // the directory: 8 entries a sector, the first entry's link to the next sector while more files follow
  let dirSector = 1, idx = 0, remaining = visible;
  o.files.forEach((f, fi) => {
    if (!f.visible) return;
    const off = linear(18, dirSector) * 256 + idx * 32, p = placed[fi];
    mark(18, dirSector, false);
    if (idx === 0) {
      if (remaining > 8 && dirSector < SPT[18] - 1) { image[off] = 18; image[off + 1] = dirSector + 1; }
      else { image[off] = 0; image[off + 1] = 0xff; }
    } else { image[off] = 0; image[off + 1] = 0; }
    image[off + 2] = (f.type | (f.locked ? 0x40 : 0)) & 0xff;
    image[off + 3] = p.track; image[off + 4] = p.sector;
    for (let i = 0; i < 16; i++) image[off + 5 + i] = i < f.name.length ? f.name[i] : 0xa0;
    image[off + 30] = p.sectors & 0xff; image[off + 31] = (p.sectors >> 8) & 0xff;
    if (++idx === 8) { dirSector++; idx = 0; }
    remaining--;
  });
  return image;
}
