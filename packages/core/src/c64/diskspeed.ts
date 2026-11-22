/* Disk-Speed (Morse Technology Ltd), a copy protection and fast loader of 1985-1986, read from the disk (spec 13.5p;
 * the analysis is in docs/diskspeed.md). Firebird's Elite has it ("ELITE 64 USES THE 'DISK-SPEED' LOADING SYSTEM FROM
 * MORSE TECHNOLOGY LIMITED", its BAM says), and Digital Integration's Fighter Pilot.
 *
 * The directory lists one file, the boot. It loads at $0308 over the KERNAL's vectors, so the BASIC's next print (or
 * statement) runs it: it decodes three pages of itself (a loop whose own EOR it shifts), opens buffer 2 in the drive
 * ("#2") and sends B-E 2 0 14 0, so the DOS reads sector 14/0 into $0500 and runs it. That code (stage 1) has the DOS
 * read 14/3 and 14/14, whose data blocks have wrong checksums on the original: the job status, $05 for both, is the
 * key. It then reads 36/11 and 36/1 into $0300-$04FF itself (it finds the header with the disk's ID and takes the data
 * block after it), EORs them with the key and runs them (stage 2). A copy with good checksums gets the key $01 and
 * garbage. Stage 2 reads a table from 14/4 (the number of files; for each its load address, the bytes of its last
 * sector, its pages and a checksum; where the program starts; and the files' names from $60), sends it, and then the
 * files from 14/15 on: 11 sectors on each time on a track of 21, the next track DOWN when that comes round to 0. It
 * calls itself through the 1541's RAM mirror at $2000 (JSR $234E, JSR $2303). The C64 gets two bits at a time,
 * 128 bytes a turn, every byte inverted on the disk, checks each file's sum and starts the program with an RTS. Elite's
 * boot also calls $033C (its first file, PATCH) when two files are left, which runs a routine of FILE1 before 2NDBIT
 * loads over it. */
import { Cpu, isG64, LEN, type Bus } from '@mimir/sindri';
import { diskSectors, parseD64, readD64File, sectorsOnTrack } from './d64';

/** A file of the loader's table. */
export interface DiskSpeedFile {
  /** its entry in the table, from 0 */
  index: number;
  /** its name in the table ("FILE1"), or '' */
  label: string;
  /** the host file name it is saved under */
  name: string;
  /** its first sector, and the sectors it reads in order ("14/15", …) */
  track: number; sector: number; sectors: string[];
  /** where it loads, its bytes, and where they end (at most $10000) */
  load: number; end: number; bytes: Uint8Array;
  /** its whole sectors and the bytes it takes of the last one */
  pages: number; part: number;
  /** the checksum the table gives, and whether its bytes (EORed together with it) come to 0 */
  sum: number; ok: boolean;
  /** sectors with an error on the image, and sectors that are not on it (their bytes are 0) */
  bad: number; missing: number;
  note: string;
}

export interface DiskSpeedSector { track: number; sector: number }

export interface DiskSpeedDisk {
  format: 'G64' | 'D64';
  summary: string;
  /** the text in the BAM after the disk's name ("ELITE 64 USES THE 'DISK-SPEED' LOADING SYSTEM …"), or null */
  text: string | null;
  /** the directory's boot, decoded as it decodes itself: the drive command it sends, and the call it makes between two
   *  files (Elite: JSR $033C when two are left) */
  boot: {
    name: string; track: number; sector: number; blocks: number; load: number; end: number;
    command: string | null; hook: { at: number; left: number } | null;
  } | null;
  /** the drive code the boot runs (B-E), and where in the drive's RAM */
  stage1: DiskSpeedSector & { at: number };
  /** the DOS reads the stage-1 code makes whose job status is the key (AND of them), with the status each gets */
  checks: (DiskSpeedSector & { status: number })[];
  key: number;
  /** 'errors': the key is the checks' status on this image; 'code': they read without an error here (a copy), so the
   *  key is worked out from stage 2's first instruction */
  keyFrom: 'errors' | 'code';
  /** the sectors stage 1 reads itself into the drive's RAM and runs, EORed with the key */
  stage2: (DiskSpeedSector & { at: number })[];
  table: DiskSpeedSector;
  /** the first file's first sector */
  data: DiskSpeedSector;
  /** how the drive goes on after a sector: `step` on, round a track of `count` sectors, the next track down or up when
   *  it comes round to 0 */
  stepping: { step: number; count: number; down: boolean };
  /** where the boot's RTS starts the program once the files are in */
  start: number;
  files: DiskSpeedFile[];
}

const hex = (n: number, w = 4): string => n.toString(16).padStart(w, '0');

/* ---- the disk's sectors ---- */

interface Sectors { tracks: number; errors: boolean; get(t: number, s: number): { data: Uint8Array; error: number } | null }

function sectors(image: Uint8Array): Sectors {
  const d = diskSectors(image);
  const tracks = d.length >= 205312 ? 42 : d.length >= 196608 ? 40 : 35;
  let total = 0;
  for (let t = 1; t <= tracks; t++) total += sectorsOnTrack(t);
  const errors = d.length === total * 257;
  return {
    tracks, errors,
    get(t, s) {
      if (t < 1 || t > tracks || s < 0 || s >= sectorsOnTrack(t)) return null;
      let i = 0;
      for (let k = 1; k < t; k++) i += sectorsOnTrack(k);
      i += s;
      return { data: d.subarray(i * 256, i * 256 + 256), error: errors ? d[total * 256 + i] || 1 : 1 };
    },
  };
}

/** where `pattern` (null: any byte) is in b[from..to) */
function find(b: Uint8Array, pattern: (number | null)[], from = 0, to = b.length): number {
  outer: for (let a = from; a + pattern.length <= to; a++) {
    for (let k = 0; k < pattern.length; k++) if (pattern[k] != null && b[a + k] !== pattern[k]) continue outer;
    return a;
  }
  return -1;
}

/** stage 1: the DOS job's status read back into $C1 (sta $04 / lda $04 / bmi / sta $c1) and the header made GCR */
const isStage1 = (b: Uint8Array): boolean => find(b, [0x85, 0x04, 0xa5, 0x04, 0x30, 0xfc, 0x85, 0xc1]) >= 0 && find(b, [0x20, 0x34, 0xf9]) >= 0;

/* ---- the boot ---- */

/**
 * The boot as it decodes itself: run on Sindri's 6510 from the vector LOAD left pointing into it (BSOUT's at $0326,
 * which prints READY., or IGONE's at $0308) until it calls the KERNAL (LISTEN, to send the drive command).
 */
function decodeBoot(prg: Uint8Array): Uint8Array | null {
  if (prg.length < 3) return null;
  const load = prg[0] | (prg[1] << 8), end = load + prg.length - 2;
  if (load > 0x0326 || end < 0x0400 || end > 0x1000) return null;
  const mem = new Uint8Array(0x10000);
  mem.set(prg.subarray(2), load);
  const vec = (a: number) => mem[a] | (mem[a + 1] << 8);
  const entry = [vec(0x0326), vec(0x0308)].find(v => v >= load && v < end);
  if (entry == null) return null;
  const bus: Bus = { read: a => mem[a], write: (a, v) => { if (a >= 2) mem[a] = v; }, fetch: a => mem[a] };
  const cpu = new Cpu(bus);
  cpu.pc = entry; cpu.s = 0xf0;
  for (let n = 0; n < 200_000 && cpu.pc < 0xa000 && !cpu.jammed; n++) cpu.step();
  return cpu.pc >= 0xa000 ? mem : null;
}

/** the B-E command in the decoded boot (B-E 2 0 14 0: channel, drive, track, sector), and the buffer "#n" opens */
function bootCommand(mem: Uint8Array): { text: string; track: number; sector: number } | null {
  const s = String.fromCharCode(...mem.subarray(0x0200, 0x0800));
  const m = /B-E[: ]?(\d{1,2})[ ,]+(\d)[ ,]+(\d{1,2})[ ,]+(\d{1,2})/.exec(s);
  return m ? { text: m[0], track: Number(m[3]), sector: Number(m[4]) } : null;
}

/* ---- the drive code: what it reads, followed instruction by instruction ---- */

interface Walk { jobs: { slot: number; track: number; sector: number }[]; reads: { track: number; sector: number; page: number }[]; to: number | null }

/**
 * Stage 1 instruction by instruction from its start (branches not taken, JMPs in its page followed): the immediate
 * values it stores in the zero page, the DOS read jobs it starts (lda #$80 / sta $0n, the track and sector at $06+2n),
 * the sectors it reads itself (a JSR into its own page, with the track and sector at $06/$07 and the page at $31),
 * and where it jumps out of its page.
 */
function walkStage1(b: Uint8Array, base: number): Walk {
  const zp: (number | null)[] = Array(256).fill(null), seen = new Set<number>();
  const out: Walk = { jobs: [], reads: [], to: null };
  let a: number | null = null, pc = base;
  for (let n = 0; n < 400 && pc >= base && pc < base + 256; n++) {
    if (seen.has(pc)) break;
    seen.add(pc);
    const op = b[pc - base], o = b[pc - base + 1], t = o | (b[pc - base + 2] << 8);
    if (op === 0xa9) a = o;
    else if (op === 0x85) {
      zp[o] = a;
      if (o <= 4 && a === 0x80) out.jobs.push({ slot: o, track: zp[6 + 2 * o] ?? -1, sector: zp[7 + 2 * o] ?? -1 });
    } else if (op === 0x20 && t >= base && t < base + 256) out.reads.push({ track: zp[6] ?? -1, sector: zp[7] ?? -1, page: zp[0x31] ?? -1 });
    else if (op === 0x4c) {
      if (t >= base && t < base + 256) { pc = t; continue; }
      out.to = t; break;
    } else if (op === 0x60 || op === 0x00) break;
    else if (op !== 0x24 && op !== 0x2c && op < 0x80 && (op & 0x1f) === 0x10) { /* a branch: not taken */ }
    pc += LEN[op];
  }
  return out;
}

/**
 * Stage 2 in the drive's RAM from its start, the same way: the zero page it sets (and X), and for each JSR to its job
 * routine (sta $03,x / cli / lda $03,x / bmi: DOS job X+3) the track and sector of that job. The first is the table,
 * the second the first file's sector.
 */
function walkStage2(mem: Uint8Array, entry: number, from: number, to: number): { track: number; sector: number }[] {
  const zp: (number | null)[] = Array(256).fill(null), seen = new Set<number>(), out: { track: number; sector: number }[] = [];
  let a: number | null = null, x: number | null = null, pc = entry;
  const jobRoutine = (t: number) => t >= from && t < to && find(mem, [0x95, 0x03, 0x58, 0xb5, 0x03, 0x30, 0xfc], t, Math.min(to, t + 96)) >= 0;
  for (let n = 0; n < 600 && pc >= from && pc < to && out.length < 2; n++) {
    if (seen.has(pc)) break;
    seen.add(pc);
    const op = mem[pc], o = mem[pc + 1], t = o | (mem[pc + 2] << 8);
    if (op === 0xa9) a = o;
    else if (op === 0xa2) x = o;
    else if (op === 0x85) zp[o] = a;
    else if (op === 0x20 && x != null && x <= 1 && jobRoutine(t)) {
      const slot = x + 3;
      out.push({ track: zp[6 + 2 * slot] ?? -1, sector: zp[7 + 2 * slot] ?? -1 });
    } else if (op === 0x4c) { if (t >= from && t < to) { pc = t; continue; } break; } else if (op === 0x60 || op === 0x00) break;
    pc += LEN[op];
  }
  return out;
}

/** the step after each sector: lda $0d / clc / adc #step / cmp #count / bcc / sbc #count / bne / dec (or inc) $0c / sta $0d */
function stepping(mem: Uint8Array, from: number, to: number): DiskSpeedDisk['stepping'] | null {
  const at = find(mem, [0xa5, 0x0d, 0x18, 0x69, null, 0xc9, null, 0x90, null, 0xe9, null, 0xd0, null, null, 0x0c, 0x85, 0x0d], from, to);
  if (at < 0 || mem[at + 6] !== mem[at + 10] || (mem[at + 13] !== 0xc6 && mem[at + 13] !== 0xe6)) return null;
  const step = mem[at + 4], count = mem[at + 6];
  if (!step || step >= count || count > 42) return null;
  return { step, count, down: mem[at + 13] === 0xc6 };
}

/* ---- the disk ---- */

/** the BAM's text after the disk's name and ID, when it has one */
function bamText(d: Sectors): string | null {
  const b = d.get(18, 0)?.data;
  if (!b) return null;
  const t = Array.from(b.subarray(0xab, 0x100), c => (c >= 0x20 && c < 0x60 ? String.fromCharCode(c) : '\0')).join('');
  const m = /[ -_]{12,}/.exec(t);
  return m && /[A-Z]{3}/.test(m[0]) ? m[0].trim() : null;
}

/** A file's host name: its name in the table (FILE1.prg), else its index and load address (file1_4000.prg). */
const fileNameOf = (label: string, index: number, load: number, taken: Set<string>): string => {
  let n = label ? `${label.replace(/[^\w.-]+/g, '_').replace(/^-+/, '_')}.prg` : `file${index + 1}_${hex(load)}.prg`;
  if (taken.has(n.toLowerCase())) n = `${n.slice(0, -4)}_${index + 1}.prg`;
  taken.add(n.toLowerCase());
  return n;
};

/**
 * Disk-Speed's files on a disk image (D64 or G64), as its drive code reads them, or null when the disk does not have
 * it: stage 1 found (by the boot's B-E command, else by its code), stage 2 decoded with the key, its table read.
 */
export function readDiskSpeedDisk(image: Uint8Array): DiskSpeedDisk | null {
  let d: Sectors;
  try { d = sectors(image); } catch { return null; }

  // the boot: the directory's first PRG, decoded
  let boot: DiskSpeedDisk['boot'] = null, stage1: DiskSpeedSector | null = null, bootMem: Uint8Array | null = null;
  try {
    const img = parseD64(diskSectors(image));
    const f = img.files.find(e => e.type === 'PRG' && e.track);
    if (f) {
      const prg = readD64File(diskSectors(image), f);
      bootMem = decodeBoot(prg);
      const cmd = bootMem ? bootCommand(bootMem) : null;
      const sectorsIn = (() => { let n = 0, [t, s] = [f.track, f.sector]; const seen = new Set<string>(); while (t && !seen.has(`${t}/${s}`)) { seen.add(`${t}/${s}`); n++; const b = d.get(t, s)?.data; if (!b) break; [t, s] = [b[0], b[1]]; } return n; })();
      if (cmd && bootMem) {
        const hk = find(bootMem, [0xa5, 0xbe, 0xc9, null, 0xd0, null, 0x20], 0x0300, 0x0800);
        boot = {
          name: f.name, track: f.track, sector: f.sector, blocks: sectorsIn, load: prg[0] | (prg[1] << 8), end: (prg[0] | (prg[1] << 8)) + prg.length - 2,
          command: cmd.text, hook: hk >= 0 ? { at: bootMem[hk + 7] | (bootMem[hk + 8] << 8), left: bootMem[hk + 3] } : null,
        };
        if (isStage1(d.get(cmd.track, cmd.sector)?.data ?? new Uint8Array(0))) stage1 = { track: cmd.track, sector: cmd.sector };
      }
    }
  } catch { /* no directory */ }
  // without the boot: stage 1 by its code
  for (let t = 1; !stage1 && t <= Math.min(d.tracks, 40); t++) {
    for (let s = 0; s < sectorsOnTrack(t); s++) if (isStage1(d.get(t, s)!.data)) { stage1 = { track: t, sector: s }; break; }
  }
  if (!stage1) return null;

  // stage 1: where it runs (B-E into buffer 2 at $0500: the page its first JMP jumps into), what it reads
  const s1 = d.get(stage1.track, stage1.sector)!.data;
  const base = s1[0] === 0x4c && s1[2] >= 0x03 && s1[2] <= 0x07 ? s1[2] << 8 : 0x0500;
  const w = walkStage1(s1, base);
  if (w.reads.length < 1 || w.to == null || w.reads.some(r => r.track < 1 || r.sector < 0 || r.page < 0 || r.page > 7)) return null;
  const checks = w.jobs.filter(j => j.track >= 1).map(j => ({ track: j.track, sector: j.sector, status: d.get(j.track, j.sector)?.error ?? 2 }));
  const fromErrors = checks.reduce((k, c) => k & c.status, 0xff) & 0xff;

  // stage 2: its sectors in the drive's RAM, EORed with the key; the key from its first instruction when the image
  // reads the checks without an error
  const ram = new Uint8Array(0x0800);
  const stage2 = w.reads.map(r => ({ track: r.track, sector: r.sector, at: r.page << 8 }));
  const pages = stage2.map(r => r.at);
  const lo = Math.min(...pages), hi = Math.max(...pages) + 256;
  const decode = (key: number) => {
    for (const r of stage2) { const b = d.get(r.track, r.sector)?.data ?? new Uint8Array(256); for (let i = 0; i < 256; i++) ram[r.at + i] = b[i] ^ key; }
    const e = w.to!;
    return e >= lo && e < hi && ram[e] === 0x4c && (ram[e + 1] | (ram[e + 2] << 8)) >= lo && (ram[e + 1] | (ram[e + 2] << 8)) < hi;
  };
  let key = checks.length ? fromErrors : 0, keyFrom: DiskSpeedDisk['keyFrom'] = 'errors';
  if (!decode(key)) {
    key = (d.get(stage2[0].track, stage2[0].sector)?.data[w.to - stage2[0].at] ?? 0) ^ 0x4c;
    keyFrom = 'code';
    if (!decode(key)) return null;
  }
  const entry = ram[w.to + 1] | (ram[w.to + 2] << 8);
  const reads = walkStage2(ram, entry, lo, hi);
  const step = stepping(ram, lo, hi);
  if (reads.length < 2 || !step || reads.some(r => r.track < 1 || r.sector < 0)) return null;
  const [table, data] = reads;

  // the table: the number of files, 5 bytes each (load address, bytes of the last sector, pages, checksum), the start
  // (high byte first, an RTS goes there + 1), the names from $60, 16 bytes each
  const tb = d.get(table.track, table.sector)?.data;
  if (!tb) return null;
  const n = tb[0];
  if (n < 1 || 1 + 5 * n + 2 > 256) return null;
  const start = (((tb[1 + 5 * n] << 8) | tb[2 + 5 * n]) + 1) & 0xffff;
  const names = 1 + 5 * n + 2 <= 0x60 ? Array.from({ length: n }, (_, i) => {
    const at = 0x60 + 16 * i;
    if (at + 16 > 256) return '';
    const raw = tb.subarray(at, at + 16), z = raw.indexOf(0), s = raw.subarray(0, z < 0 ? 16 : z);
    return s.length && s.every(c => c >= 0x20 && c < 0x60) ? String.fromCharCode(...s).trim() : '';
  }) : Array(n).fill('');

  const files: DiskSpeedFile[] = [], taken = new Set<string>();
  let { track, sector } = data;
  const next = () => { let s = sector + step.step; if (s >= step.count) { s -= step.count; if (s === 0) track += step.down ? -1 : 1; } sector = s; };
  for (let i = 0; i < n; i++) {
    const e = 1 + 5 * i, load = tb[e] | (tb[e + 1] << 8), part = tb[e + 2], pgs = tb[e + 3], sum = tb[e + 4];
    const first = { track, sector }, list: string[] = [], chunks: Uint8Array[] = [];
    let bad = 0, missing = 0;
    // a sector per page, then one for the bytes of the last (a file of neither still takes a sector)
    const count = Math.max(1, pgs + (part ? 1 : 0));
    for (let k = 0; k < count; k++) {
      list.push(`${track}/${sector}`);
      const r = d.get(track, sector);
      if (!r) missing++; else if (r.error !== 1) bad++;
      const take = k < pgs ? 256 : k === pgs ? part : 0;
      chunks.push((r?.data ?? new Uint8Array(256)).subarray(0, take).map(v => v ^ 0xff));
      next();
    }
    const bytes = new Uint8Array(chunks.reduce((a, c) => a + c.length, 0));
    chunks.reduce((o, c) => (bytes.set(c, o), o + c.length), 0);
    let x = sum;
    for (const v of bytes) x ^= v;
    const label = names[i];
    files.push({
      index: i, label, name: fileNameOf(label, i, load, taken), track: first.track, sector: first.sector, sectors: list,
      load, end: Math.min(0x10000, load + bytes.length), bytes, pages: pgs, part, sum, ok: x === 0, bad, missing, note: '',
    });
  }
  // notes: what each is to the loader, the files it loads over, the hook and the start
  for (const f of files) {
    const notes = [`${!f.pages ? `${f.part} bytes in one sector` : `${f.pages} whole sector${f.pages === 1 ? '' : 's'}${f.part ? ` and ${f.part} bytes of one more` : ''}`}, inverted on the disk`];
    notes.push(f.ok ? `checksum $${hex(f.sum, 2)} right` : `checksum $${hex(f.sum, 2)} wrong`);
    for (const g of files) {
      if (g.index >= f.index) break;
      const a = Math.max(f.load, g.load), b = Math.min(f.end, g.end);
      if (a < b) notes.push(`loads over ${g.label || g.name}'s $${hex(a)}-$${hex(b - 1)}`);
    }
    if (boot?.hook && boot.hook.at >= f.load && boot.hook.at < f.end) {
      const before = files[n - boot.hook.left];
      notes.push(`the boot calls $${hex(boot.hook.at)} (JSR) when ${boot.hook.left} file${boot.hook.left === 1 ? ' is' : 's are'} left${before ? `, before ${before.label || before.name} loads` : ''}`);
    }
    if (start >= f.load && start < f.end) notes.push(`the program starts here, at $${hex(start)}`);
    f.note = notes.join('; ');
  }

  const text = bamText(d);
  const st = (c: { status: number }) => `$${hex(c.status, 2)}`;
  const summary = `Disk-Speed (Morse Technology): ${n} file${n === 1 ? '' : 's'} from the table at ${table.track}/${table.sector}, the program starting at $${hex(start)}; `
    + (checks.length ? `the drive code at ${stage1.track}/${stage1.sector} reads ${checks.map(c => `${c.track}/${c.sector}`).join(' and ')} (status ${checks.map(st).join(' and ')})` : `the drive code at ${stage1.track}/${stage1.sector}`)
    + `, ${keyFrom === 'errors' ? 'its key' : 'no error on this image, the key from the code'} $${hex(key, 2)} for ${stage2.map(r => `${r.track}/${r.sector}`).join(' + ')}`;
  return {
    format: isG64(image) ? 'G64' : 'D64',
    summary, text, boot, stage1: { ...stage1, at: base }, checks, key, keyFrom, stage2, table, data, stepping: step, start, files,
  };
}

/** A file as a PRG: its load address and its bytes, as far as memory holds them. */
export function diskSpeedPrg(f: DiskSpeedFile): Uint8Array {
  const out = new Uint8Array(2 + f.end - f.load);
  out[0] = f.load & 0xff; out[1] = f.load >> 8;
  out.set(f.bytes.subarray(0, f.end - f.load), 2);
  return out;
}

/** The files as text (files.txt beside them when they are saved): a line each, after a header that says what they are. */
export function diskSpeedFileList(disk: DiskSpeedDisk, name: string): string[] {
  const n = disk.files.length, st = disk.stepping;
  const out = [
    `; Disk-Speed files of ${name}, read by Mimir Studio: ${n} file${n === 1 ? '' : 's'} of the loader's table at ${disk.table.track}/${disk.table.sector} (the directory lists only the boot).`,
    `; From ${disk.data.track}/${disk.data.sector}: ${st.step} sectors on each time round a track of ${st.count}, the next track ${st.down ? 'down' : 'up'} at sector 0; every byte inverted on the disk.`,
    `; The program starts at $${hex(disk.start)}.`,
  ];
  for (const f of disk.files) {
    const past = f.load + f.bytes.length - f.end;
    out.push(`${f.name.padEnd(16)} ; ${f.track}/${f.sector}, ${f.sectors.length} sector${f.sectors.length === 1 ? '' : 's'}, loads at $${hex(f.load)}-$${hex(f.end - 1)} (${f.end - f.load} bytes)${f.bad ? `, ${f.bad} bad` : ''}${f.missing ? `, ${f.missing} missing` : ''}${past > 0 ? `, the ${past} bytes past $ffff left out` : ''}: ${f.note}`);
  }
  return out;
}
